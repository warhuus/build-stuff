import { describe, expect, it } from "vitest";
import { deriveAgeingBacklog } from "../../compute/deriveAgeingBacklog";
import type { AgeingBacklogRaw, BreakdownDimension } from "../../types";
import { NOW_ISO, SMALL, daysAgo, ev, item, openAlert, sel, win } from "./deriveTestUtils";

const base: AgeingBacklogRaw = {
  window: win(30),
  dimension: null,
  asOf: NOW_ISO,
  alerts: [
    openAlert("a1", { salesOrderId: "s1", riskType: "T1", escalated: true }),
    openAlert("a2", { salesOrderId: "s1", riskType: "T2", escalated: false }),
    openAlert("a3", { salesOrderId: "s2", riskType: "T1", escalated: null }),
    openAlert("a4", { salesOrderId: "s3", riskType: "T3" }),
  ],
  openedEvents: [
    ev("a1", "opened", { eventTimestamp: daysAgo(40) }),
    ev("a2", "opened", { eventTimestamp: daysAgo(10) }),
    ev("a3", "opened", { eventTimestamp: daysAgo(5) }),
  ],
  items: [item("s1", { valueUsd: 100, plant: "X" }), item("s2", { valueUsd: 50, plant: "Y" }), item("s3", { valueUsd: 7, plant: "X" })],
};

describe("deriveAgeingBacklog (4.5)", () => {
  it("total with threshold N from the selection; unit does not matter", () => {
    const out = deriveAgeingBacklog(base, sel({ ageingThresholdDays: 30 }));
    // ages: a1 40, a2 10, a3 5, a4 unknown
    expect(out.data.total).toMatchObject({ openAlerts: 4, unknownAge: 1 });
    expect(out.data.total.threshold).toEqual({ days: 30, alerts: 1, valueUsd: 100, pct: 1 / 3 });
    expect(out.caveats).toEqual(["opened-events-since-pipeline-start", "no-target-property"]);
    expect(deriveAgeingBacklog(base, sel({ ageingThresholdDays: 30, unit: "valueUsd" }))).toEqual(out);
  });

  it("threshold change re-derives the tiles from the same raw (no refetch)", () => {
    const n7 = deriveAgeingBacklog(base, sel({ ageingThresholdDays: 7 }));
    // N = 7: a1 (40, s1) and a2 (10, s1) → 2 alerts, value s1 once = 100
    expect(n7.data.total.threshold).toEqual({ days: 7, alerts: 2, valueUsd: 100, pct: 2 / 3 });
    const n1 = deriveAgeingBacklog(base, sel({ ageingThresholdDays: 1 }));
    expect(n1.data.total.threshold).toEqual({ days: 1, alerts: 3, valueUsd: 150, pct: 1 });
    expect(n1.data.total.alertBins).toEqual(n7.data.total.alertBins);
  });

  it("no opened-events caveat when every age is known", () => {
    const out = deriveAgeingBacklog({ ...base, alerts: base.alerts.slice(0, 3) }, sel());
    expect(out.caveats).toEqual(["no-target-property"]);
  });

  it("alert-dim breakdown: additive on alerts, overlap on value, top-N + truncated", () => {
    const out = deriveAgeingBacklog({ ...base, dimension: "alertType" }, sel({ ageingThresholdDays: 7 }), SMALL);
    const bd = out.data.breakdown;
    // T1: a1, a3; T2: a2; T3: a4 → shown T1, T2 (tie by name); other = a4
    expect(bd?.groups.map((g) => [g.group, g.data.openAlerts])).toEqual([
      ["T1", 2],
      ["T2", 1],
    ]);
    expect(bd?.other?.openAlerts).toBe(1);
    // s1 value counts in T1 (a1) and T2 (a2): overlap
    expect(bd?.groups[0].data.threshold.valueUsd).toBe(100);
    expect(bd?.groups[1].data.threshold.valueUsd).toBe(100);
    expect(out.caveats).toEqual(["overlap", "opened-events-since-pipeline-start", "no-target-property", "truncated"]);
  });

  it("escalated groups; null flag lands in other", () => {
    const out = deriveAgeingBacklog({ ...base, dimension: "escalated" }, sel());
    expect(out.data.breakdown?.groups.map((g) => [g.group, g.data.openAlerts])).toEqual([
      ["false", 2],
      ["true", 1],
    ]);
    expect(out.data.breakdown?.other?.openAlerts).toBe(1);
  });

  it("item-dim breakdown from the alert's item, no overlap caveat", () => {
    const dims: BreakdownDimension[] = ["plant"];
    for (const dimension of dims) {
      const out = deriveAgeingBacklog({ ...base, dimension }, sel());
      expect(out.data.breakdown?.groups.map((g) => [g.group, g.data.openAlerts])).toEqual([
        ["X", 3],
        ["Y", 1],
      ]);
      expect(out.caveats).not.toContain("overlap");
    }
  });
});
