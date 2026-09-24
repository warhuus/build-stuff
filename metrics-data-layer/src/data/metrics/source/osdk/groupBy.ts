/**
 * Grouped aggregates of the OSDK adapter (spec §9.0 `itemGroupBy`, `ahGroupBy`, `aofGroupBy`; §9 1.1, 3.1, 4.1).
 * `$groupBy` keys are literals: each switch sits at the aggregate call site and reads `$group.<same literal>`
 * in the same case, so the group is precisely typed (F7). Every exact group-by carries
 * `$exactWithLimit: config.MAX_GROUPS`; `$ranges` never does. Results are read defensively (S7); null groups
 * are dropped; booleans become `config.ESCALATED_GROUP_LABELS` (F6).
 */
import type { ObjectSet } from "@osdk/client";
import type {
  AlertHistory,
  AlertOrderFulfillment,
  AppUsageEvent,
  OtifOrderVerdict,
  SalesOrderOtifEvaluation,
  SalesOrders,
} from "@app/sdk";
import type { GroupCount, GroupCountValue, MetricsConfig, OtifMode, RangeCount } from "../../types";
import type { AppUsageGroupField, EventGroupField, ItemGroupField, OpenAlertGroupField } from "../../query/specs";

type Num = number | null | undefined;
const ITEM_SEL = { $count: "unordered", "valueUsd:sum": "unordered" } as const;
const ACTOR_SEL = { "eventActor:exactDistinct": "unordered" } as const;
const ALERT_SEL = { "riskAlertId:exactDistinct": "unordered" } as const;
const COUNT_SEL = { $count: "unordered" } as const;

const n = (v: Num): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Group rows → `GroupCount[]`; null/undefined groups dropped; group values as strings. */
export function toGroupCounts<R>(rows: readonly R[], groupOf: (r: R) => unknown, countOf: (r: R) => Num): GroupCount[] {
  return (Array.isArray(rows) ? rows : []).flatMap((r) => {
    const g = groupOf(r);
    return g === null || g === undefined ? [] : [{ group: String(g), count: n(countOf(r)) }];
  });
}

function toGroupCountValues<R extends { readonly $count?: Num; readonly valueUsd?: { readonly sum?: Num } }>(
  rows: readonly R[],
  groupOf: (r: R) => unknown,
): GroupCountValue[] {
  return (Array.isArray(rows) ? rows : []).flatMap((r) => {
    const g = groupOf(r);
    return g === null || g === undefined ? [] : [{ group: String(g), count: n(r.$count), valueUsd: n(r.valueUsd?.sum) }];
  });
}

/** Items grouped by an item dimension: count and USD value per group (spec §9.0 `stageByItemDim`). */
export async function itemsGrouped(set: ObjectSet<SalesOrders>, dim: ItemGroupField, max: number): Promise<GroupCountValue[]> {
  switch (dim) {
    case "businessLine": {
      const r = await set.aggregate({ $select: ITEM_SEL, $groupBy: { businessLineName: { $exactWithLimit: max } } });
      return toGroupCountValues(r, (x) => x.$group.businessLineName);
    }
    case "productLine": {
      const r = await set.aggregate({ $select: ITEM_SEL, $groupBy: { productLineName: { $exactWithLimit: max } } });
      return toGroupCountValues(r, (x) => x.$group.productLineName);
    }
    case "region": {
      const r = await set.aggregate({ $select: ITEM_SEL, $groupBy: { iscRegionName: { $exactWithLimit: max } } });
      return toGroupCountValues(r, (x) => x.$group.iscRegionName);
    }
    case "plant": {
      const r = await set.aggregate({ $select: ITEM_SEL, $groupBy: { plantCode: { $exactWithLimit: max } } });
      return toGroupCountValues(r, (x) => x.$group.plantCode);
    }
  }
}

/** Distinct actors (`eventActor`) per AlertHistory group-by field (spec §9.0 `ahGroupBy`). */
async function actorsGrouped(set: ObjectSet<AlertHistory>, g: EventGroupField, max: number): Promise<GroupCount[]> {
  const count = (x: { readonly eventActor?: { readonly exactDistinct?: Num } }): Num => x.eventActor?.exactDistinct;
  switch (g) {
    case "queueFilter":
    case "routingPersona": {
      const r = await set.aggregate({ $select: ACTOR_SEL, $groupBy: { persona: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.persona, count);
    }
    case "alertType": {
      const r = await set.aggregate({ $select: ACTOR_SEL, $groupBy: { riskType: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.riskType, count);
    }
    case "priority": {
      const r = await set.aggregate({ $select: ACTOR_SEL, $groupBy: { priorityAtEvent: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.priorityAtEvent, count);
    }
    case "actionType":
    case "writebackType": {
      const r = await set.aggregate({ $select: ACTOR_SEL, $groupBy: { eventType: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.eventType, count);
    }
  }
}

/** Distinct alerts (`riskAlertId`) per AlertHistory group-by field (spec §9.0 `ahGroupBy`). */
async function alertsGrouped(set: ObjectSet<AlertHistory>, g: EventGroupField, max: number): Promise<GroupCount[]> {
  const count = (x: { readonly riskAlertId?: { readonly exactDistinct?: Num } }): Num => x.riskAlertId?.exactDistinct;
  switch (g) {
    case "queueFilter":
    case "routingPersona": {
      const r = await set.aggregate({ $select: ALERT_SEL, $groupBy: { persona: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.persona, count);
    }
    case "alertType": {
      const r = await set.aggregate({ $select: ALERT_SEL, $groupBy: { riskType: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.riskType, count);
    }
    case "priority": {
      const r = await set.aggregate({ $select: ALERT_SEL, $groupBy: { priorityAtEvent: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.priorityAtEvent, count);
    }
    case "actionType":
    case "writebackType": {
      const r = await set.aggregate({ $select: ALERT_SEL, $groupBy: { eventType: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.eventType, count);
    }
  }
}

/** Distinct actors or alerts of an event set per group-by field. Spec §9 1.2–1.4, 2.1. */
export function eventsGrouped(
  set: ObjectSet<AlertHistory>,
  distinct: "actor" | "alert",
  g: EventGroupField,
  max: number,
): Promise<GroupCount[]> {
  return distinct === "actor" ? actorsGrouped(set, g, max) : alertsGrouped(set, g, max);
}

/** `$count` of open alerts per AlertOrderFulfillment field; escalated → config labels (spec §9.0 `aofGroupBy`). */
export async function openAlertsGrouped(
  set: ObjectSet<AlertOrderFulfillment>,
  g: OpenAlertGroupField,
  config: MetricsConfig,
): Promise<GroupCount[]> {
  const max = config.MAX_GROUPS;
  const count = (x: { readonly $count?: Num }): Num => x.$count;
  switch (g) {
    case "routingPersona": {
      const r = await set.aggregate({ $select: COUNT_SEL, $groupBy: { persona: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.persona, count);
    }
    case "priority": {
      const r = await set.aggregate({ $select: COUNT_SEL, $groupBy: { priority: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.priority, count);
    }
    case "alertType": {
      const r = await set.aggregate({ $select: COUNT_SEL, $groupBy: { riskType: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.riskType, count);
    }
    case "escalated": {
      const r = await set.aggregate({ $select: COUNT_SEL, $groupBy: { escalated: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => escalatedLabel(x.$group.escalated, config), count);
    }
  }
}

/** Label of a boolean group value, safe for `true` and `"true"` (F6); null stays null (dropped). */
export function escalatedLabel(v: unknown, config: MetricsConfig): string | null {
  if (v === null || v === undefined) return null;
  const labels = config.ESCALATED_GROUP_LABELS;
  return String(v) === "true" ? labels.true : labels.false;
}

/** Distinct app users per queue-filter persona (spec §9 1.1; AppUsageEvent.persona is exact). */
export async function appUsersGrouped(set: ObjectSet<AppUsageEvent>, g: AppUsageGroupField, max: number): Promise<GroupCount[]> {
  switch (g) {
    case "queueFilter": {
      const r = await set.aggregate({
        $select: { "userId:exactDistinct": "unordered" },
        $groupBy: { persona: { $exactWithLimit: max } },
      });
      return toGroupCounts(r, (x) => x.$group.persona, (x) => x.userId?.exactDistinct);
    }
  }
}

/** Gated verdict `$count` per the mode's classification (spec §9 4.1 step 1; critClassification group-by only). */
export async function verdictsGrouped(set: ObjectSet<OtifOrderVerdict>, mode: OtifMode, max: number): Promise<GroupCount[]> {
  const count = (x: { readonly $count?: Num }): Num => x.$count;
  switch (mode) {
    case "otif": {
      const r = await set.aggregate({ $select: COUNT_SEL, $groupBy: { initOtifClassification: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.initOtifClassification, count);
    }
    case "crit": {
      const r = await set.aggregate({ $select: COUNT_SEL, $groupBy: { critClassification: { $exactWithLimit: max } } });
      return toGroupCounts(r, (x) => x.$group.critClassification, count);
    }
  }
}

/**
 * `$count` per `otifScore` range (spec §9 3.1 `byRange`): a mutable copy of the ranges (F5), no
 * `$exactWithLimit`; rows keyed by `startValue`; empty or unreadable ranges omitted.
 */
export async function riskByRanges(
  set: ObjectSet<SalesOrderOtifEvaluation>,
  ranges: readonly (readonly [number, number])[],
): Promise<RangeCount[]> {
  if (ranges.length === 0) return [];
  const mutable = ranges.map(([lo, hi]): [number, number] => [lo, hi]);
  const r = await set.aggregate({ $select: COUNT_SEL, $groupBy: { otifScore: { $ranges: mutable } } });
  return (Array.isArray(r) ? r : []).flatMap((x) => {
    const start: unknown = x.$group.otifScore?.startValue;
    const count = n(x.$count);
    return typeof start === "number" && count > 0 ? [{ startValue: start, count }] : [];
  });
}
