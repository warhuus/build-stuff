/**
 * Pure spec builders (spec §9.0 shared preamble): each returns a plain-data spec from `query/specs.ts`.
 * No OSDK, no apiNames, no I/O. Item-funnel stage sets live in `buildFunnel.ts`; risk and 4.1/L3 sets in
 * `buildRisk.ts`. Both re-use the primitives exported here.
 */
import { ITEM_DIMS } from "../../../config/metrics";
import type { ItemFilters, Window } from "../types";
import type {
  EventFilter,
  EventPredicate,
  EventSet,
  ItemSet,
  OpenAlertCondition,
  OpenAlertSet,
} from "./specs";

/** Non-empty predicate list (OR-ed), as `EventFilter.predicates` requires (decision D3). */
export type Predicates = readonly [EventPredicate, ...EventPredicate[]];

/** True when at least one item-filter dimension has a value (spec §9.0 `isEmpty` negated). */
export const hasItemFilters = (f: ItemFilters): boolean => ITEM_DIMS.some((d) => f[d].length > 0);

/** Every sales order item (SalesOrders). */
export const allItems: ItemSet = { kind: "all" };

/** Every AlertHistory event. */
export const allEvents: EventSet = { kind: "all" };

/** Every open alert (AlertOrderFulfillment). */
export const allOpenAlerts: OpenAlertSet = { kind: "all" };

/**
 * Spec §9 2.0 proxy: items open at any point in `w` (created ≤ end AND (isOpen OR actualGiDate ≥ start),
 * date-only bounds). Under "now" (`start` null) the compiler emits `isOpen = true` only.
 */
export const openItemsInWindow = (w: Window): ItemSet => ({ kind: "openInWindow", window: w });

/**
 * Spec §9.0 `withItemFilters`: `set` restricted by the item filters (one `$in` per non-empty dimension,
 * applied by the compiler). Returns `set` itself, unchanged, when every dimension is empty.
 */
export const withItemFilters = (set: ItemSet, f: ItemFilters): ItemSet =>
  hasItemFilters(f) ? { kind: "filtered", base: set, filters: f } : set;

/** `base` events narrowed by predicates (OR) and a window (`null` = no time bound; "now" = ≤ end). */
export const eventsWhere = (base: EventSet, predicates: Predicates, window: Window | null): EventSet => {
  const filter: EventFilter = { predicates, window };
  return { kind: "where", base, filter };
};

/**
 * Spec §9.0 `events(pred, w, f)`: events matching `preds` in `w`. With any item filter the events are
 * reached by pivoting from the filtered items (`ofItems`); without filters AlertHistory is filtered directly.
 */
export const events = (preds: Predicates, w: Window, f: ItemFilters): EventSet =>
  eventsWhere(hasItemFilters(f) ? { kind: "ofItems", items: withItemFilters(allItems, f) } : allEvents, preds, w);

/** Spec §9.0.1 L1: human events in `w` (all-time up to end under "now"), item filters by pivot. */
export const humanEvents = (w: Window, f: ItemFilters): EventSet => events(["human"], w, f);

/** Spec §9.0 `aofSet(f)`: open alerts; with item filters, those of the filtered items (pivot). */
export const openAlerts = (f: ItemFilters): OpenAlertSet =>
  hasItemFilters(f) ? { kind: "ofItems", items: withItemFilters(allItems, f) } : allOpenAlerts;

/** Items of an event set (pivot `salesOrder_1`). */
export const itemsOfEvents = (set: EventSet): ItemSet => ({ kind: "ofEvents", events: set });

/** Items of an open-alert set (pivot `sourceSalesOrder`). */
export const itemsOfOpenAlerts = (set: OpenAlertSet): ItemSet => ({ kind: "ofOpenAlerts", alerts: set });

/** Open alerts of an event set (pivot `alert`; resolves only for alerts open now). */
export const openAlertsOfEvents = (set: EventSet): OpenAlertSet => ({ kind: "ofEvents", events: set });

/** All events of an open-alert set (pivot `historyEvents`). */
export const eventsOfOpenAlerts = (set: OpenAlertSet): EventSet => ({ kind: "ofOpenAlerts", alerts: set });

/** All events of an item set (pivot `alertHistory`). */
export const eventsOfItems = (set: ItemSet): EventSet => ({ kind: "ofItems", items: set });

/**
 * Spec §9 2.1–2.4 item view, 3.1, 4.1: items having an event matching `preds` in `w`
 * (`AlertHistory.where(pred ∧ tsIn(w)).pivotTo("salesOrder_1")`). Unfiltered: callers intersect with a
 * filtered item set where filters apply.
 */
export const itemsWithEvent = (preds: Predicates, w: Window): ItemSet =>
  itemsOfEvents(eventsWhere(allEvents, preds, w));

/** Open alerts of `base` matching one exact condition (spec §9.0 `aofWhere`). */
export const openAlertsWhere = (base: OpenAlertSet, condition: OpenAlertCondition): OpenAlertSet => ({
  kind: "where",
  base,
  condition,
});

/**
 * Spec §9 2.1 `perGroup`: items with at least one open alert (of the filtered items) matching `cond`
 * (`aofSet(f).where(aofWhere(d, g)).pivotTo("sourceSalesOrder")`).
 */
export const itemsWithOpenAlertWhere = (f: ItemFilters, cond: OpenAlertCondition): ItemSet =>
  itemsOfOpenAlerts(openAlertsWhere(openAlerts(f), cond));

/**
 * Spec §9 1.2–1.4 escalated groups: events matching `preds` in `w` of open alerts with `escalated = v`
 * (`AOF.where(escalated).pivotTo("historyEvents").where(pred ∧ tsIn)`). Section 1: no item filters.
 */
export const escalatedEvents = (v: boolean, preds: Predicates, w: Window): EventSet =>
  eventsWhere(eventsOfOpenAlerts(openAlertsWhere(allOpenAlerts, { field: "escalated", value: v })), preds, w);

/**
 * Spec §9 4.2 / 4.6 `finalSet`: closed events in `w` (item filters by pivot) minus all events of the
 * alerts among them that are open now = closed events of alerts closed and not open now.
 */
export const closedNotOpenNow = (w: Window, f: ItemFilters): EventSet => {
  const closedSet = events(["closed"], w, f);
  return { kind: "subtract", a: closedSet, b: eventsOfOpenAlerts(openAlertsOfEvents(closedSet)) };
};

/**
 * Spec §9 4.2 not-worked `openedEv`: `opened` events (all-time) of every alert on the items of `set`
 * (`set.pivotTo("salesOrder_1").pivotTo("alertHistory").where(opened)`); a superset, joined by alert id.
 */
export const openedEventsOfItemsOf = (set: EventSet): EventSet =>
  eventsWhere(eventsOfItems(itemsOfEvents(set)), ["opened"], null);

/**
 * Spec §9.0.1 L2 `evSet`: all-time lifecycle and human events of every alert on items with a human event
 * in `w` (item filters by pivot). Caller keeps only the touched alert ids.
 */
export const touchedEventsChain = (w: Window, f: ItemFilters): EventSet =>
  eventsWhere(eventsOfItems(itemsOfEvents(humanEvents(w, f))), ["lifecycle", "human"], null);

/** Spec §9.0.1 L2 `openIds`: touched alerts that are open now (`events(human, w, f).pivotTo("alert")`). */
export const touchedOpenAlerts = (w: Window, f: ItemFilters): OpenAlertSet => openAlertsOfEvents(humanEvents(w, f));

/** Spec §9.0.1 L3 `alerts`: every open alert, item filters by pivot. */
export const l3OpenAlerts = (f: ItemFilters): OpenAlertSet => openAlerts(f);

/** Spec §9.0.1 L3 `opened`: the all-time `opened` events of the open alerts (pivot `historyEvents`). */
export const l3OpenedEvents = (f: ItemFilters): EventSet =>
  eventsWhere(eventsOfOpenAlerts(openAlerts(f)), ["opened"], null);

/** Spec §9.0.1 L3 `items`: the items of the open alerts (pivot `sourceSalesOrder`). */
export const l3Items = (f: ItemFilters): ItemSet => itemsOfOpenAlerts(openAlerts(f));

/** Spec §9 4.1 step 2: items with a human event in `w` (all-time under "now"); item filters not applied. */
export const workedItems = (w: Window): ItemSet => itemsWithEvent(["human"], w);
