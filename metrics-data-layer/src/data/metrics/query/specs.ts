/**
 * Declarative query specs: plain data describing WHAT to fetch (instructions §6). No OSDK types and no
 * property apiNames: fields are business names; `source/osdk/compileSpec.ts` maps them to apiNames,
 * links and where clauses (spec §9.0), and `source/fake` evaluates them in memory with the same semantics.
 *
 * Four object sets, each closed under the pivots the plans use:
 *   ItemSet (SalesOrders) · EventSet (AlertHistory) · OpenAlertSet (AlertOrderFulfillment) ·
 *   RiskSet (SalesOrderOtifEvaluation).
 *
 * Group-by-only rule (spec §3, §5 B9): no spec can put `$eq`/`$in` on AlertHistory.persona, riskType,
 * priorityAtEvent or OtifOrderVerdict.critClassification. Enforced structurally: an EventFilter can only
 * name fixed predicates and a window; open-alert conditions only name exact AlertOrderFulfillment fields;
 * verdict filters only name the mode (gate = exact field) and the window. The group-by-only fields are
 * reachable only through the group-field unions below.
 */
import type { ItemDim, ItemFilters, OtifMode, RiskBucketId, Window } from "../types";

/**
 * Named AlertHistory predicates (spec §4, §9.0 `PRED`). `human` = viewed OR action OR writeback;
 * `lifecycle` = opened OR closed. Values come from config at compile time.
 */
export type EventPredicate = "viewed" | "action" | "writeback" | "human" | "opened" | "closed" | "lifecycle";

/**
 * A filter on AlertHistory rows: predicates OR-ed, AND the time bound. `window: null` = no time bound
 * (all events); a window with `start: null` ("now") = `eventTimestamp <= end` only (spec §9.0 `tsIn`).
 */
export interface EventFilter {
  readonly predicates: readonly EventPredicate[];
  readonly window: Window | null;
}

/** Binary set operation on sets of one object type (OSDK `intersect` / `union` / `subtract`). */
export interface SetOp<S> {
  readonly kind: "intersect" | "union" | "subtract";
  readonly a: S;
  readonly b: S;
}

/** Sales order items (SalesOrders). `$count` = distinct items. */
export type ItemSet =
  /** Every item. */
  | { readonly kind: "all" }
  /** 2.0 proxy: created ≤ end AND (isOpen OR actualGiDate ≥ start), date-only bounds; "now" = isOpen only. */
  | { readonly kind: "openInWindow"; readonly window: Window }
  /** `base` restricted by item filters: one `$in` per non-empty dimension, none when all empty. */
  | { readonly kind: "filtered"; readonly base: ItemSet; readonly filters: ItemFilters }
  /** Items of these events (pivot `salesOrder_1`). */
  | { readonly kind: "ofEvents"; readonly events: EventSet }
  /** Items of these open alerts (pivot `sourceSalesOrder`). */
  | { readonly kind: "ofOpenAlerts"; readonly alerts: OpenAlertSet }
  /** Items of these risk evaluations (pivot `salesOrder`). */
  | { readonly kind: "ofRisk"; readonly risk: RiskSet }
  | SetOp<ItemSet>;

/** Alert events (AlertHistory). */
export type EventSet =
  /** Every event. */
  | { readonly kind: "all" }
  /** All events of these items (pivot `alertHistory`). */
  | { readonly kind: "ofItems"; readonly items: ItemSet }
  /** All events of these open alerts (pivot `historyEvents`). */
  | { readonly kind: "ofOpenAlerts"; readonly alerts: OpenAlertSet }
  /** `base` narrowed by an event filter. */
  | { readonly kind: "where"; readonly base: EventSet; readonly filter: EventFilter }
  | SetOp<EventSet>;

/** Exact-matchable AlertOrderFulfillment fields that may be filtered (spec §9.0 `aofWhere`). */
export type OpenAlertFilterField = "routingPersona" | "priority" | "escalated";
/** An `$eq` condition on an open alert. `escalated` compares booleans; the others raw strings. */
export type OpenAlertCondition =
  | { readonly field: "escalated"; readonly value: boolean }
  | { readonly field: Exclude<OpenAlertFilterField, "escalated">; readonly value: string };

/** Currently open alerts (AlertOrderFulfillment; the pipeline deletes the row on close). */
export type OpenAlertSet =
  /** Every open alert. */
  | { readonly kind: "all" }
  /** Open alerts of these items (pivot `orderFulfillmentAlerts`). */
  | { readonly kind: "ofItems"; readonly items: ItemSet }
  /** Open alerts of these events (pivot `alert`; resolves only for alerts open now). */
  | { readonly kind: "ofEvents"; readonly events: EventSet }
  /** `base` narrowed by one exact condition. */
  | { readonly kind: "where"; readonly base: OpenAlertSet; readonly condition: OpenAlertCondition }
  | SetOp<OpenAlertSet>;

/**
 * A risk-evaluation condition (spec §9 3.1): `bucket` = the bucket's where clause (unscored: not Delayed and
 * score null; delayed: otifStatus Delayed; scored: not Delayed and lo ≤ score < hi from config ranges);
 * `notDelayed` = the pre-filter of the `$ranges` group-by.
 */
export type RiskCondition = { readonly kind: "bucket"; readonly bucket: RiskBucketId } | { readonly kind: "notDelayed" };

/** Current risk evaluations of open items (SalesOrderOtifEvaluation). */
export type RiskSet =
  /** Every evaluation. */
  | { readonly kind: "all" }
  /** Evaluations of these items (pivot `otifEvaluation`). */
  | { readonly kind: "ofItems"; readonly items: ItemSet }
  /** `base` narrowed by a risk condition. */
  | { readonly kind: "where"; readonly base: RiskSet; readonly condition: RiskCondition }
  | SetOp<RiskSet>;

/**
 * AlertHistory group-by fields, named by the breakdown they serve (spec §9.0 `ahGroupBy`):
 * queueFilter, routingPersona → persona; alertType → riskType; priority → priorityAtEvent;
 * actionType, writebackType → eventType. The first three properties are group-by only.
 */
export type EventGroupField =
  | "queueFilter"
  | "routingPersona"
  | "alertType"
  | "priority"
  | "actionType"
  | "writebackType";
/** What an event aggregate counts distinct: `actor` = eventActor (users), `alert` = riskAlertId. */
export type EventDistinctField = "actor" | "alert";

/** AlertOrderFulfillment group-by fields (spec §9.0 `aofGroupBy`): persona, priority, riskType, escalated. */
export type OpenAlertGroupField = "routingPersona" | "priority" | "alertType" | "escalated";

/** AppUsageEvent group-by field: queueFilter → persona (spec §9 1.1). */
export type AppUsageGroupField = "queueFilter";

/** Item group-by fields: the item dimensions (spec §9.0 `itemGroupBy`). */
export type ItemGroupField = ItemDim;

/**
 * 4.1 verdict filter (spec §9 4.1): the mode's exclusion gate = "No" AND the verdict date
 * (`VERDICT_DATE_PROPERTY`) in the window on UTC calendar dates; "now" = no lower bound.
 * Totals are grouped by the mode's classification (critClassification is group-by only).
 */
export interface VerdictFilter {
  readonly mode: OtifMode;
  readonly window: Window;
}
