/**
 * Test helper: the spec §9 plans written out as expected OSDK call chains (`chainOf` steps), from the spec's
 * pseudocode literals, NOT from production code. Used by the plan-chain tests (TST-02 / OSD-03).
 */
import type { Window } from "../../types";
import type { Step } from "./recordingClient";

// Spec §9.0 named predicates, verbatim.
/** `PRED.viewed`. */
export const VIEWED = { eventType: { $eq: "opened_by_user" } };
/** `PRED.action`. */
export const ACTION = {
  $and: [
    { $or: [{ eventSource: { $in: ["user", "user action", "action"] } }, { eventType: { $eq: "deeplink_clicked" } }] },
    { $not: { eventType: { $eq: "updated" } } },
  ],
};
/** `PRED.writeback`. */
export const WRITEBACK = {
  eventType: { $in: ["delivery_block_removed", "delivery_tolerance_corrected", "allocation_rejection_lifted"] },
};
/** `PRED.human`. */
export const HUMAN = { $or: [VIEWED, ACTION, WRITEBACK] };
/** `PRED.opened`. */
export const OPENED = { eventType: { $eq: "opened" } };
/** `PRED.closed`. */
export const CLOSED = { eventType: { $eq: "closed" } };
/** `PRED.lifecycle`. */
export const LIFECYCLE = { eventType: { $in: ["opened", "closed"] } };

/** Spec §9.0 `tsIn(w)` on `eventTimestamp` (AlertHistory, AppUsageEvent). */
export const tsIn = (w: Window): unknown =>
  w.start === null
    ? { eventTimestamp: { $lte: w.end } }
    : { $and: [{ eventTimestamp: { $gte: w.start } }, { eventTimestamp: { $lte: w.end } }] };

/** Spec §9.0 `withItemFilters` for the harness's SOME_FILTERS (businessLine BL1; region EU, NA). */
export const SOME_FILTERS_WHERE = {
  $and: [{ businessLineName: { $in: ["BL1"] } }, { iscRegionName: { $in: ["EU", "NA"] } }],
};

/** `client(X)`. */
export const base = (objectType: string): Step => ({ base: objectType });
/** `.where(w)`. */
export const where = (w: unknown): Step => ({ where: w });
/** `.pivotTo(link)`. */
export const pivot = (link: string): Step => ({ pivotTo: link });
/** `a.intersect(b)`. */
export const intersect = (a: Step[], b: Step[]): Step[] => [{ intersect: [a, b] }];
/** `a.union(b)`. */
export const union = (a: Step[], b: Step[]): Step[] => [{ union: [a, b] }];
/** `a.subtract(b)`. */
export const subtract = (a: Step[], b: Step[]): Step[] => [{ subtract: [a, b] }];

/** `withItemFilters(client(SalesOrders), f)`: filtered = SOME_FILTERS, else no where. */
export const filteredItems = (filtered: boolean): Step[] =>
  filtered ? [base("SalesOrders"), where(SOME_FILTERS_WHERE)] : [base("SalesOrders")];

/** Spec §9.0 `events(pred, w, f)`: AlertHistory directly, or pivoted from the filtered items. */
export const events = (pred: unknown, w: Window, filtered: boolean): Step[] =>
  filtered
    ? [...filteredItems(true), pivot("alertHistory"), where({ $and: [pred, tsIn(w)] })]
    : [base("AlertHistory"), where({ $and: [pred, tsIn(w)] })];

/** Spec §9.0 `aofSet(f)`. */
export const aofSet = (filtered: boolean): Step[] =>
  filtered ? [...filteredItems(true), pivot("orderFulfillmentAlerts")] : [base("AlertOrderFulfillment")];

/** Spec §9 4.2 / 4.6 `finalSet` = closedSet.subtract(closedSet.pivotTo("alert").pivotTo("historyEvents")). */
export const finalSet = (w: Window, filtered: boolean): Step[] => {
  const closedSet = events(CLOSED, w, filtered);
  return subtract(closedSet, [...closedSet, pivot("alert"), pivot("historyEvents")]);
};

/** Spec §9 2.0 `open` (date-only bounds; "now" = isOpen only). */
export const openInWindow = (w: Window): Step[] =>
  w.start === null
    ? [base("SalesOrders"), where({ isOpen: { $eq: true } })]
    : [
        base("SalesOrders"),
        where({
          $and: [
            { salesOrderItemCreationDate: { $lte: w.end.slice(0, 10) } },
            { $or: [{ isOpen: { $eq: true } }, { actualGiDate: { $gte: w.start.slice(0, 10) } }] },
          ],
        }),
      ];

/** `client(AlertHistory).where({ $and: [pred, tsIn(w)] }).pivotTo("salesOrder_1")` (spec §9 2.1–2.4, 4.1). */
export const itemsWith = (pred: unknown, w: Window): Step[] => [
  base("AlertHistory"),
  where({ $and: [pred, tsIn(w)] }),
  pivot("salesOrder_1"),
];
