import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import {
  agedAlerts,
  ageingBacklog,
  alertAgeBins,
  itemAgeBins,
  oldestAgeByItem,
  raisedAtByAlert,
  thresholdTiles,
} from "../../compute/ageing";
import { itemsById } from "../../compute/dimValues";
import { NOW_ISO, daysAgo, ev, item, openAlert } from "../helpers/deriveRows";

describe("raisedAtByAlert", () => {
  it("takes the earliest opened timestamp per alert", () => {
    const map = raisedAtByAlert([
      ev("a", "opened", { eventTimestamp: daysAgo(3) }),
      ev("a", "opened", { eventTimestamp: daysAgo(5) }),
      ev("a", "opened", { eventTimestamp: daysAgo(4) }),
      ev("b", "opened", { eventTimestamp: daysAgo(1) }),
    ]);
    expect(map.get("a")).toBe(daysAgo(5));
    expect(map.get("b")).toBe(daysAgo(1));
  });
});

describe("ageing", () => {
  const alerts = [
    openAlert("a1", { salesOrderId: "s1" }),
    openAlert("a2", { salesOrderId: "s1" }),
    openAlert("a3", { salesOrderId: "s2" }),
    openAlert("a4", { salesOrderId: "s3" }),
    openAlert("a5", { salesOrderId: "s4" }),
  ];
  const raised = new Map([
    ["a1", daysAgo(0.5)],
    ["a2", daysAgo(45)],
    ["a3", daysAgo(100)],
    ["a5", "2026-09-25T00:00:00.000Z"], // after asOf → age 0
  ]);
  const aged = agedAlerts(alerts, raised, NOW_ISO);
  const items = itemsById([item("s1", { valueUsd: 10 }), item("s2", { valueUsd: null }), item("s4", { valueUsd: 5 })]);

  it("computes ages in days; unknown when no opened event; never negative", () => {
    expect(aged.map((a) => a.ageDays)).toEqual([0.5, 45, 100, null, 0]);
  });

  it("alertBins on AGE_EDGES_DAYS, zero-filled, unknown skipped", () => {
    const bins = alertAgeBins(aged, METRICS_CONFIG);
    expect(bins).toHaveLength(33);
    expect(bins[0]).toEqual({ binStart: 0, binEnd: 1, alertCount: 2 });
    expect(bins.find((b) => b.binStart === 30)).toEqual({ binStart: 30, binEnd: 60, alertCount: 1 });
    expect(bins[32]).toEqual({ binStart: 90, binEnd: null, alertCount: 1 });
  });

  it("places each item once by its oldest alert; value once per item", () => {
    expect([...oldestAgeByItem(aged)]).toEqual([
      ["s1", 45],
      ["s2", 100],
      ["s4", 0],
    ]);
    const bins = itemAgeBins(aged, items, METRICS_CONFIG);
    expect(bins).toHaveLength(33);
    expect(bins.find((b) => b.binStart === 30)).toEqual({ binStart: 30, binEnd: 60, itemCount: 1, valueUsd: 10 });
    expect(bins[32]).toEqual({ binStart: 90, binEnd: null, itemCount: 1, valueUsd: 0 }); // null value → 0
    expect(bins[0]).toEqual({ binStart: 0, binEnd: 1, itemCount: 1, valueUsd: 5 });
  });

  it("skips items whose age fits no bin (edges not starting at 0)", () => {
    const bins = itemAgeBins(aged, items, { ...METRICS_CONFIG, AGE_EDGES_DAYS: [1, 50] });
    expect(bins).toEqual([
      { binStart: 1, binEnd: 50, itemCount: 1, valueUsd: 10 },
      { binStart: 50, binEnd: null, itemCount: 1, valueUsd: 0 },
    ]);
  });

  it("threshold tiles: strict > N, value over distinct items, pct over known ages", () => {
    // N = 30: a2 (45, s1) and a3 (100, s2) → 2 alerts; value s1 10 + s2 0; pct 2 / 4 known
    expect(thresholdTiles(aged, items, 30)).toEqual({ days: 30, alerts: 2, valueUsd: 10, pct: 0.5 });
    // N = 45: only a3 (45 is not > 45)
    expect(thresholdTiles(aged, items, 45)).toEqual({ days: 45, alerts: 1, valueUsd: 0, pct: 0.25 });
    expect(thresholdTiles(agedAlerts([openAlert("u")], new Map(), NOW_ISO), items, 1).pct).toBeNull();
  });

  it("ageingBacklog assembles the card; itemBins present when empty", () => {
    const out = ageingBacklog({ aged, items, asOf: NOW_ISO, thresholdDays: 30 }, METRICS_CONFIG);
    expect(out).toMatchObject({ openAlerts: 5, unknownAge: 1, asOf: NOW_ISO, threshold: { alerts: 2 } });
    const empty = ageingBacklog({ aged: [], items, asOf: NOW_ISO, thresholdDays: 30 }, METRICS_CONFIG);
    expect(empty.itemBins.every((b) => b.itemCount === 0)).toBe(true);
    expect(empty.threshold).toEqual({ days: 30, alerts: 0, valueUsd: 0, pct: null });
  });
});
