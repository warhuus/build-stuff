import { describe, expect, it } from "vitest";
import {
  allItems,
  closedNotOpenNow,
  escalatedEvents,
  events,
  hasItemFilters,
  humanEvents,
  itemsWithEvent,
  itemsWithOpenAlertWhere,
  l3Items,
  l3OpenAlerts,
  l3OpenedEvents,
  openAlerts,
  openedEventsOfItemsOf,
  openItemsInWindow,
  touchedEventsChain,
  touchedOpenAlerts,
  withItemFilters,
  workedItems,
} from "../../query/build";
import type { ItemFilters, Window } from "../../types";

const NONE: ItemFilters = { businessLine: [], productLine: [], region: [], plant: [] };
const BL: ItemFilters = { ...NONE, businessLine: ["BL-A"] };
const TWO: ItemFilters = { ...NONE, businessLine: ["BL-A"], plant: ["P100", "P200"] };
const W7: Window = { key: 7, start: "2026-08-25T12:00:00.000Z", end: "2026-09-01T12:00:00.000Z" };
const NOW: Window = { key: "now", start: null, end: "2026-09-01T12:00:00.000Z" };
const FILTERED_ITEMS = { kind: "filtered", base: { kind: "all" }, filters: BL } as const;

describe("withItemFilters (spec §9.0)", () => {
  it("returns the base set itself when every dimension is empty (no condition emitted)", () => {
    const base = openItemsInWindow(W7);
    expect(withItemFilters(base, NONE)).toBe(base);
    expect(hasItemFilters(NONE)).toBe(false);
  });

  it("wraps the base with the filters when any dimension is set; one condition per non-empty dim at compile", () => {
    expect(withItemFilters(allItems, TWO)).toEqual({ kind: "filtered", base: { kind: "all" }, filters: TWO });
    expect(hasItemFilters(TWO)).toBe(true);
  });
});

describe("events (spec §9.0 events)", () => {
  it("filters AlertHistory directly without item filters", () => {
    expect(events(["viewed"], W7, NONE)).toEqual({
      kind: "where",
      base: { kind: "all" },
      filter: { predicates: ["viewed"], window: W7 },
    });
  });

  it("pivots from the filtered items when any filter is set", () => {
    expect(events(["closed"], W7, BL)).toEqual({
      kind: "where",
      base: { kind: "ofItems", items: FILTERED_ITEMS },
      filter: { predicates: ["closed"], window: W7 },
    });
  });

  it("L1 = human events in the window", () => {
    expect(humanEvents(NOW, NONE)).toEqual(events(["human"], NOW, NONE));
  });
});

describe("item and open-alert sets", () => {
  it("2.0 under now is the openInWindow spec with start null (compiler emits isOpen only)", () => {
    expect(openItemsInWindow(NOW)).toEqual({ kind: "openInWindow", window: { key: "now", start: null, end: NOW.end } });
  });

  it("aofSet: all open alerts without filters, open alerts of the filtered items with filters", () => {
    expect(openAlerts(NONE)).toEqual({ kind: "all" });
    expect(openAlerts(BL)).toEqual({ kind: "ofItems", items: FILTERED_ITEMS });
  });

  it("itemsWithEvent pivots unfiltered AlertHistory to its items", () => {
    expect(itemsWithEvent(["action"], W7)).toEqual({
      kind: "ofEvents",
      events: { kind: "where", base: { kind: "all" }, filter: { predicates: ["action"], window: W7 } },
    });
    expect(workedItems(W7)).toEqual(itemsWithEvent(["human"], W7));
  });

  it("itemsWithOpenAlertWhere = aofSet(f).where(cond).pivotTo(sourceSalesOrder)", () => {
    expect(itemsWithOpenAlertWhere(BL, { field: "priority", value: "High" })).toEqual({
      kind: "ofOpenAlerts",
      alerts: { kind: "where", base: { kind: "ofItems", items: FILTERED_ITEMS }, condition: { field: "priority", value: "High" } },
    });
  });

  it("escalatedEvents = AOF.where(escalated).historyEvents.where(pred, window), no item filters", () => {
    expect(escalatedEvents(true, ["writeback"], W7)).toEqual({
      kind: "where",
      base: {
        kind: "ofOpenAlerts",
        alerts: { kind: "where", base: { kind: "all" }, condition: { field: "escalated", value: true } },
      },
      filter: { predicates: ["writeback"], window: W7 },
    });
  });
});

describe("4.2 / 4.6 / L2 / L3 chains", () => {
  it("closedNotOpenNow = closed events − events of their open alerts", () => {
    const closed = events(["closed"], W7, BL);
    expect(closedNotOpenNow(W7, BL)).toEqual({
      kind: "subtract",
      a: closed,
      b: { kind: "ofOpenAlerts", alerts: { kind: "ofEvents", events: closed } },
    });
  });

  it("openedEventsOfItemsOf = opened events (all-time) of the items of the set", () => {
    const set = closedNotOpenNow(W7, NONE);
    expect(openedEventsOfItemsOf(set)).toEqual({
      kind: "where",
      base: { kind: "ofItems", items: { kind: "ofEvents", events: set } },
      filter: { predicates: ["opened"], window: null },
    });
  });

  it("touchedEventsChain = lifecycle+human events (no time bound) of items with a human event", () => {
    expect(touchedEventsChain(W7, NONE)).toEqual({
      kind: "where",
      base: { kind: "ofItems", items: { kind: "ofEvents", events: humanEvents(W7, NONE) } },
      filter: { predicates: ["lifecycle", "human"], window: null },
    });
    expect(touchedOpenAlerts(W7, BL)).toEqual({ kind: "ofEvents", events: humanEvents(W7, BL) });
  });

  it("L3: open alerts, their opened events via historyEvents, their items via sourceSalesOrder", () => {
    expect(l3OpenAlerts(BL)).toEqual(openAlerts(BL));
    expect(l3OpenedEvents(NONE)).toEqual({
      kind: "where",
      base: { kind: "ofOpenAlerts", alerts: { kind: "all" } },
      filter: { predicates: ["opened"], window: null },
    });
    expect(l3Items(BL)).toEqual({ kind: "ofOpenAlerts", alerts: openAlerts(BL) });
  });
});
