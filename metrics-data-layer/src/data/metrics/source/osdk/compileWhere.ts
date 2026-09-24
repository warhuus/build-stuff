/**
 * Where clauses of the OSDK adapter (spec §4, §9.0 shared code, §9 2.0, 3.1, 4.1). Every clause is a literal
 * with one operator per property object; bounds on one property are combined with `$and` (spec §8).
 * Values come from `MetricsConfig`, so the predicate constants are built per config in one object literal (S9).
 */
import type { WhereClause } from "@osdk/client";
import type {
  AlertHistory,
  AlertOrderFulfillment,
  AppUsageEvent,
  OtifOrderVerdict,
  SalesOrderOtifEvaluation,
  SalesOrders,
} from "@app/sdk";
import { SCORED_BUCKETS } from "../../../../config/metrics";
import type { ItemFilters, MetricsConfig, OtifMode, Window } from "../../types";
import type { EventFilter, EventPredicate, OpenAlertCondition, RiskCondition } from "../../query/specs";

/** The named AlertHistory predicates (spec §4, §9.0 `PRED`). */
export type PredicateClauses = Readonly<Record<EventPredicate, WhereClause<AlertHistory>>>;

/** Calendar date (`YYYY-MM-DD`, UTC) of an ISO-8601 UTC timestamp, for `datetime` (date) properties. Spec §8, F9. */
export const toDateOnly = (iso: string): string => iso.slice(0, 10);

/**
 * `eventTimestamp` in the window: `$and` of `$gte start` and `$lte end` (full ISO strings); under `"now"`
 * (`start` null) only `$lte end`. Spec §9.0 `tsIn`.
 */
export function tsIn(w: Window): WhereClause<AlertHistory> {
  return w.start !== null
    ? { $and: [{ eventTimestamp: { $gte: w.start } }, { eventTimestamp: { $lte: w.end } }] }
    : { eventTimestamp: { $lte: w.end } };
}

/**
 * The predicate constants built from config values in ONE object literal (S9; spec §4 strings exactly).
 * `human` = viewed OR action OR writeback; `lifecycle` = opened OR closed.
 */
export function buildPredicates(config: MetricsConfig): PredicateClauses {
  const types = config.EVENT_TYPES;
  const viewed: WhereClause<AlertHistory> = { eventType: { $eq: types.viewed } };
  const action: WhereClause<AlertHistory> = {
    $and: [
      { $or: [{ eventSource: { $in: config.ACTION_EVENT_SOURCES } }, { eventType: { $eq: types.deeplink } }] },
      { $not: { eventType: { $eq: types.updated } } },
    ],
  };
  const writeback: WhereClause<AlertHistory> = { eventType: { $in: types.writeback } };
  return {
    viewed,
    action,
    writeback,
    human: { $or: [viewed, action, writeback] },
    opened: { eventType: { $eq: types.opened } },
    closed: { eventType: { $eq: types.closed } },
    lifecycle: { eventType: { $in: [types.opened, types.closed] } },
  };
}

/**
 * An EventFilter as one clause: the predicates OR-ed (a single predicate without the `$or` wrapper), AND the
 * window (`tsIn`); `window: null` → predicates only. Spec §9.0 `events`.
 */
export function eventFilterWhere(filter: EventFilter, pred: PredicateClauses): WhereClause<AlertHistory> {
  const [first, ...rest] = filter.predicates;
  const p: WhereClause<AlertHistory> = rest.length === 0 ? pred[first] : { $or: filter.predicates.map((k) => pred[k]) };
  return filter.window === null ? p : { $and: [p, tsIn(filter.window)] };
}

/**
 * Item filters: one `$in` per non-empty dimension inside one `$and`; `null` when every dimension is empty
 * (never an empty `$in`, which matches all objects; F1). Spec §9.0 `withItemFilters`.
 */
export function itemFiltersWhere(f: ItemFilters): WhereClause<SalesOrders> | null {
  const c: WhereClause<SalesOrders>[] = [];
  if (f.businessLine.length > 0) c.push({ businessLineName: { $in: f.businessLine } });
  if (f.productLine.length > 0) c.push({ productLineName: { $in: f.productLine } });
  if (f.region.length > 0) c.push({ iscRegionName: { $in: f.region } });
  if (f.plant.length > 0) c.push({ plantCode: { $in: f.plant } });
  return c.length > 0 ? { $and: c } : null;
}

/**
 * 2.0 proxy: created ≤ end date AND (isOpen OR actualGiDate ≥ start date), date-only UTC bounds;
 * under `"now"` `isOpen` only. Spec §9 2.0.
 */
export function openInWindowWhere(w: Window): WhereClause<SalesOrders> {
  if (w.start === null) return { isOpen: { $eq: true } };
  return {
    $and: [
      { salesOrderItemCreationDate: { $lte: toDateOnly(w.end) } },
      { $or: [{ isOpen: { $eq: true } }, { actualGiDate: { $gte: toDateOnly(w.start) } }] },
    ],
  };
}

/** One exact AlertOrderFulfillment condition (spec §9.0 `aofWhere`; routingPersona → `persona`). */
export function openAlertWhere(c: OpenAlertCondition): WhereClause<AlertOrderFulfillment> {
  switch (c.field) {
    case "routingPersona":
      return { persona: { $eq: c.value } };
    case "priority":
      return { priority: { $eq: c.value } };
    case "escalated":
      return { escalated: { $eq: c.value } };
  }
}

/**
 * Risk condition (spec §9 3.1): notDelayed = `$not otifStatus = Delayed`; delayed; unscored = not delayed AND
 * score `$isNull`; scored bucket i = not delayed AND lo ≤ score < hi from `config.RISK_RANGES[i]`.
 */
export function riskWhere(c: RiskCondition, config: MetricsConfig): WhereClause<SalesOrderOtifEvaluation> {
  const delayed: WhereClause<SalesOrderOtifEvaluation> = { otifStatus: { $eq: config.OTIF_STATUS_DELAYED } };
  const notDelayed: WhereClause<SalesOrderOtifEvaluation> = { $not: delayed };
  if (c.kind === "notDelayed") return notDelayed;
  switch (c.bucket) {
    case "delayed":
      return delayed;
    case "unscored":
      return { $and: [notDelayed, { otifScore: { $isNull: true } }] };
    default: {
      const [lo, hi] = scoredRange(c.bucket, config);
      return { $and: [notDelayed, { otifScore: { $gte: lo } }, { otifScore: { $lt: hi } }] };
    }
  }
}

function scoredRange(bucket: (typeof SCORED_BUCKETS)[number], config: MetricsConfig): readonly [number, number] {
  const range = config.RISK_RANGES[SCORED_BUCKETS.indexOf(bucket)];
  if (range === undefined) throw new Error(`RISK_RANGES has no range for bucket ${bucket}`);
  return range;
}

/** The mode's exclusion gate `= EXCLUSION_GATE_PASS` (spec §9 4.1 `MODE[m].gate`; never swapped). */
export function verdictGate(mode: OtifMode, config: MetricsConfig): WhereClause<OtifOrderVerdict> {
  switch (mode) {
    case "otif":
      return { officialExclusionOtif: { $eq: config.EXCLUSION_GATE_PASS } };
    case "crit":
      return { officialExclusionCrit: { $eq: config.EXCLUSION_GATE_PASS } };
  }
}

/**
 * Verdict date in the window on UTC calendar dates, on `config.VERDICT_DATE_PROPERTY` (spec §9 4.1 `dateIn`).
 * Throws while the property is the placeholder (loadCard blocks the card before this can run).
 */
export function verdictDateIn(w: Window, config: MetricsConfig): WhereClause<OtifOrderVerdict> {
  const s = w.start !== null ? toDateOnly(w.start) : null;
  const e = toDateOnly(w.end);
  switch (config.VERDICT_DATE_PROPERTY) {
    case "otifOtShipmentEndDate":
      return s !== null
        ? { $and: [{ otifOtShipmentEndDate: { $gte: s } }, { otifOtShipmentEndDate: { $lte: e } }] }
        : { otifOtShipmentEndDate: { $lte: e } };
    case "otifFirstInitialDeliveryDateTarget":
      return s !== null
        ? { $and: [{ otifFirstInitialDeliveryDateTarget: { $gte: s } }, { otifFirstInitialDeliveryDateTarget: { $lte: e } }] }
        : { otifFirstInitialDeliveryDateTarget: { $lte: e } };
    default:
      throw new Error("VERDICT_DATE_PROPERTY is not set (needs-integration-value)");
  }
}

/**
 * AppUsageEvent of the alert app in the window (spec §9 1.1): `appId = ALERT_APP_ID` AND timestamp bounds.
 * Throws while `ALERT_APP_ID` is the placeholder (loadCard blocks the card first).
 */
export function appUsageWhere(w: Window, config: MetricsConfig): WhereClause<AppUsageEvent> {
  if (config.ALERT_APP_ID === config.PLACEHOLDER) throw new Error("ALERT_APP_ID is not set (needs-integration-value)");
  const inWindow: WhereClause<AppUsageEvent> =
    w.start !== null
      ? { $and: [{ eventTimestamp: { $gte: w.start } }, { eventTimestamp: { $lte: w.end } }] }
      : { eventTimestamp: { $lte: w.end } };
  return { $and: [{ appId: { $eq: config.ALERT_APP_ID } }, inWindow] };
}
