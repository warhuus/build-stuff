// Ageing backlog (4.5): age bins, unknown age, item value once per item, threshold tiles.
import { describe, expect, it } from "vitest";
import { deriveAgeingBacklog } from "../../compute/deriveAgeingBacklog";
import type { AgeingBacklogRaw } from "../../types";
import { NOW_ISO, daysAgo, ev, item, openAlert, win } from "../helpers/deriveRows";
import { sel } from "../helpers/testKit";

// Ages: a1 40 d (s1), a2 10 d (s1), a3 5 d (s2), a4 unknown (s3, no opened event).
const base: AgeingBacklogRaw = {
  window: win(30),
  dimension: null,
  asOf: NOW_ISO,
  alerts: [
    openAlert("a1", { salesOrderId: "s1" }),
    openAlert("a2", { salesOrderId: "s1" }),
    openAlert("a3", { salesOrderId: "s2" }),
    openAlert("a4", { salesOrderId: "s3" }),
  ],
  openedEvents: [
    ev("a1", "opened", { eventTimestamp: daysAgo(40) }),
    ev("a1", "opened", { eventTimestamp: daysAgo(20) }), // raisedAt = earliest opened
    ev("a2", "opened", { eventTimestamp: daysAgo(10) }),
    ev("a3", "opened", { eventTimestamp: daysAgo(5) }),
  ],
  items: [item("s1", { valueUsd: 100 }), item("s2", { valueUsd: 50 }), item("s3", { valueUsd: 7 })],
};

describe("deriveAgeingBacklog (4.5)", () => {
  it("alert and item bins; unknown age skipped and counted; an item is placed once by its oldest alert", () => {
    const t = deriveAgeingBacklog(base, sel({ ageingThresholdDays: 30 })).data.total;
    expect(t).toMatchObject({ openAlerts: 4, unknownAge: 1, asOf: NOW_ISO });
    expect(t.alertBins).toHaveLength(33);
    expect(t.alertBins.filter((b) => b.alertCount > 0).map((b) => [b.binStart, b.alertCount])).toEqual([[5, 1], [10, 1], [30, 1]]);
    // s1 by a1 (40 d) → [30, 60) with its value once (not 2 × 100); s2 → [5, 6); s3 unknown → no bin
    expect(t.itemBins.filter((b) => b.itemCount > 0)).toEqual([
      { binStart: 5, binEnd: 6, itemCount: 1, valueUsd: 50 },
      { binStart: 30, binEnd: 60, itemCount: 1, valueUsd: 100 },
    ]);
  });

  // pct = alerts over N / alerts with a known age (3); value = distinct items of those alerts
  it.each([
    [40, { alerts: 0, valueUsd: 0, pct: 0 }], // strict > N: 40 is not over 40
    [30, { alerts: 1, valueUsd: 100, pct: 1 / 3 }],
    [7, { alerts: 2, valueUsd: 100, pct: 2 / 3 }], // a1 + a2 both on s1 → 100 once
    [1, { alerts: 3, valueUsd: 150, pct: 1 }],
  ])("threshold N = %s re-derives the tiles from the same raw", (days, tiles) => {
    const t = deriveAgeingBacklog(base, sel({ ageingThresholdDays: days })).data.total;
    expect(t.threshold).toEqual({ days, ...tiles });
    expect(t.alertBins).toEqual(deriveAgeingBacklog(base, sel()).data.total.alertBins);
  });

  it("no known age → pct null", () => {
    const t = deriveAgeingBacklog({ ...base, alerts: base.alerts.slice(3) }, sel({ ageingThresholdDays: 30 })).data.total;
    expect(t).toMatchObject({ openAlerts: 1, unknownAge: 1 });
    expect(t.threshold).toEqual({ days: 30, alerts: 0, valueUsd: 0, pct: null });
  });
});
