/**
 * In-memory evaluation of query specs (query/specs.ts) with the OSDK semantics of spec §8 and
 * instructions §6: every set evaluates to the primary keys of its objects, so set operations work by
 * primary key; pivots resolve only to objects that exist (the `alert` pivot only to open alerts, since
 * AlertOrderFulfillment holds open alerts only). Event predicates reuse `compute/eventPredicates.ts` (D8).
 */
import { ITEM_DIMS, SCORED_BUCKETS } from "../../../../config/metrics";
import type { MetricsConfig } from "../../../../config/metrics";
import { matchesAnyPredicate } from "../../compute/eventPredicates";
import type { ItemFilters, Window } from "../../types";
import { inWindow, toDateOnly } from "../../window";
import type { EventFilter, EventSet, ItemSet, OpenAlertCondition, OpenAlertSet, RiskCondition, RiskSet } from "../../query/specs";
import type { FixtureEvent, FixtureItem, FixtureOpenAlert, FixtureRisk, MetricsFixtures } from "./fakeTypes";

/** Rows of each object type indexed by primary key, plus the config the predicates read. */
export interface EvalCtx {
  readonly items: ReadonlyMap<string, FixtureItem>;
  readonly events: ReadonlyMap<string, FixtureEvent>;
  readonly openAlerts: ReadonlyMap<string, FixtureOpenAlert>;
  readonly risk: ReadonlyMap<string, FixtureRisk>;
  readonly config: MetricsConfig;
}

/** Indexes a dataset by primary key (items: salesOrderId, events: historyEventId, alerts: riskAlertId). */
export function createEvalCtx(data: MetricsFixtures, config: MetricsConfig): EvalCtx {
  return {
    items: new Map(data.items.map((r) => [r.salesOrderId, r])),
    events: new Map(data.events.map((r) => [r.historyEventId, r])),
    openAlerts: new Map(data.openAlerts.map((r) => [r.riskAlertId, r])),
    risk: new Map(data.risk.map((r) => [r.salesOrderId, r])),
    config,
  };
}

type Keys = ReadonlySet<string>;

/** OSDK `intersect` / `union` / `subtract` on primary keys. */
export function setOp(kind: "intersect" | "union" | "subtract", a: Keys, b: Keys): Set<string> {
  if (kind === "union") return new Set([...a, ...b]);
  const keep = kind === "intersect";
  return new Set([...a].filter((k) => b.has(k) === keep));
}

function keysWhere<R>(rows: ReadonlyMap<string, R>, test: (row: R) => boolean): Set<string> {
  return new Set([...rows].filter(([, row]) => test(row)).map(([key]) => key));
}

/** Link resolution: the keys produced by `linkOf` for the source keys, kept only when the target exists. */
function pivot<R>(keys: Keys, rows: ReadonlyMap<string, R>, linkOf: (row: R) => string | null, target: Keys | ReadonlyMap<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const key of keys) {
    const row = rows.get(key);
    const link = row === undefined ? null : linkOf(row);
    if (link !== null && target.has(link)) out.add(link);
  }
  return out;
}

/**
 * Spec §9 2.0 proxy on one item: created ≤ end date AND (isOpen OR actualGiDate ≥ start date), UTC calendar
 * dates; under "now" `isOpen = true` only. Null dates never match a bound.
 */
export function isOpenInWindow(item: FixtureItem, w: Window): boolean {
  if (w.start === null) return item.isOpen === true;
  const created = item.salesOrderItemCreationDate;
  if (created === null || created > toDateOnly(w.end)) return false;
  return item.isOpen === true || (item.actualGiDate !== null && item.actualGiDate >= toDateOnly(w.start));
}

/** Spec §9.0 `withItemFilters` on one item: `$in` per non-empty dimension; a null value never matches. */
export function matchesItemFilters(item: FixtureItem, f: ItemFilters): boolean {
  return ITEM_DIMS.every((d) => {
    const value = item[d];
    return f[d].length === 0 || (value !== null && f[d].includes(value));
  });
}

/** Keys (salesOrderId) of an item set. */
export function evalItems(set: ItemSet, ctx: EvalCtx): Set<string> {
  switch (set.kind) {
    case "all":
      return new Set(ctx.items.keys());
    case "openInWindow":
      return keysWhere(ctx.items, (item) => isOpenInWindow(item, set.window));
    case "filtered":
      return setOp("intersect", evalItems(set.base, ctx), keysWhere(ctx.items, (i) => matchesItemFilters(i, set.filters)));
    case "ofEvents":
      return pivot(evalEvents(set.events, ctx), ctx.events, (e) => e.salesOrderId, ctx.items);
    case "ofOpenAlerts":
      return pivot(evalOpenAlerts(set.alerts, ctx), ctx.openAlerts, (a) => a.salesOrderId, ctx.items);
    case "ofRisk":
      return pivot(evalRisk(set.risk, ctx), ctx.risk, (r) => r.salesOrderId, ctx.items);
    case "intersect":
    case "union":
    case "subtract":
      return setOp(set.kind, evalItems(set.a, ctx), evalItems(set.b, ctx));
  }
}

/** Spec §9.0 `PRED` OR-ed AND `tsIn(w)` (inclusive bounds; "now" = ≤ end; null window = no bound). */
export function matchesEventFilter(event: FixtureEvent, filter: EventFilter, config: MetricsConfig): boolean {
  const inTime = filter.window === null || inWindow(event.eventTimestamp, filter.window);
  return inTime && matchesAnyPredicate(filter.predicates, event, config);
}

/** Keys (historyEventId) of an event set. */
export function evalEvents(set: EventSet, ctx: EvalCtx): Set<string> {
  switch (set.kind) {
    case "all":
      return new Set(ctx.events.keys());
    case "ofItems": {
      const items = evalItems(set.items, ctx);
      return keysWhere(ctx.events, (e) => e.salesOrderId !== null && items.has(e.salesOrderId));
    }
    case "ofOpenAlerts": {
      const alerts = evalOpenAlerts(set.alerts, ctx);
      return keysWhere(ctx.events, (e) => alerts.has(e.riskAlertId));
    }
    case "where":
      return setOp("intersect", evalEvents(set.base, ctx), keysWhere(ctx.events, (e) => matchesEventFilter(e, set.filter, ctx.config)));
    case "intersect":
    case "union":
    case "subtract":
      return setOp(set.kind, evalEvents(set.a, ctx), evalEvents(set.b, ctx));
  }
}

/** Spec §9.0 `aofWhere`: `$eq` on persona / priority / escalated; null never matches. */
export function matchesOpenAlertCondition(alert: FixtureOpenAlert, c: OpenAlertCondition): boolean {
  switch (c.field) {
    case "escalated":
      return alert.escalated === c.value;
    case "routingPersona":
      return alert.persona === c.value;
    case "priority":
      return alert.priority === c.value;
  }
}

/** Keys (riskAlertId) of an open-alert set; only rows of AlertOrderFulfillment (open now) can appear. */
export function evalOpenAlerts(set: OpenAlertSet, ctx: EvalCtx): Set<string> {
  switch (set.kind) {
    case "all":
      return new Set(ctx.openAlerts.keys());
    case "ofItems": {
      const items = evalItems(set.items, ctx);
      return keysWhere(ctx.openAlerts, (a) => items.has(a.salesOrderId));
    }
    case "ofEvents":
      return pivot(evalEvents(set.events, ctx), ctx.events, (e) => e.riskAlertId, ctx.openAlerts);
    case "where":
      return setOp("intersect", evalOpenAlerts(set.base, ctx), keysWhere(ctx.openAlerts, (a) => matchesOpenAlertCondition(a, set.condition)));
    case "intersect":
    case "union":
    case "subtract":
      return setOp(set.kind, evalOpenAlerts(set.a, ctx), evalOpenAlerts(set.b, ctx));
  }
}

/**
 * Spec §9 3.1 where clauses: delayed = otifStatus Delayed; unscored = not Delayed AND score null;
 * scored bucket = not Delayed AND lo ≤ score < hi (config RISK_RANGES, index-aligned with SCORED_BUCKETS);
 * notDelayed = `$not` Delayed (a null otifStatus counts as not Delayed; unverified in OSDK, spec §9 3.1).
 */
export function matchesRiskCondition(row: FixtureRisk, c: RiskCondition, config: MetricsConfig): boolean {
  const delayed = row.otifStatus === config.OTIF_STATUS_DELAYED;
  if (c.kind === "notDelayed") return !delayed;
  if (c.bucket === "delayed") return delayed;
  if (delayed) return false;
  if (c.bucket === "unscored") return row.otifScore === null;
  const [lo, hi] = config.RISK_RANGES[SCORED_BUCKETS.indexOf(c.bucket)];
  return row.otifScore !== null && row.otifScore >= lo && row.otifScore < hi;
}

/** Keys (salesOrderId) of a risk-evaluation set. */
export function evalRisk(set: RiskSet, ctx: EvalCtx): Set<string> {
  switch (set.kind) {
    case "all":
      return new Set(ctx.risk.keys());
    case "ofItems": {
      const items = evalItems(set.items, ctx);
      return keysWhere(ctx.risk, (r) => items.has(r.salesOrderId));
    }
    case "where":
      return setOp("intersect", evalRisk(set.base, ctx), keysWhere(ctx.risk, (r) => matchesRiskCondition(r, set.condition, ctx.config)));
    case "intersect":
    case "union":
    case "subtract":
      return setOp(set.kind, evalRisk(set.a, ctx), evalRisk(set.b, ctx));
  }
}
