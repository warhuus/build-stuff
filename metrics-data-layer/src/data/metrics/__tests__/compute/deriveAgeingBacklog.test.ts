import { describe, expect, it } from "vitest";
import { deriveAgeingBacklog } from "../../compute/deriveAgeingBacklog";
import { allowedBreakdowns, isItemDim } from "../../breakdowns";
import type { AgeingBacklogRaw } from "../../types";
import { NOW_ISO, SMALL, daysAgo, ev, item, openAlert, win } from "../helpers/deriveRows";
import { sel } from "../helpers/testKit";

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

  it("every registry dim of 4.5 (TST-10): alert dims from the alert row, item dims from its item", () => {
    // a1, a2 → V2 (2 alerts); a3 → V1 (1); a4 → null alert fields and an unknown item → other.
    const V1 = { routingPersona: "P1", priority: "High", alertType: "T1", escalated: "true", businessLine: "BL1", productLine: "PL1", region: "R1", plant: "P01" };
    const V2 = { routingPersona: "P2", priority: "Low", alertType: "T2", escalated: "false", businessLine: "BL2", productLine: "PL2", region: "R2", plant: "P02" };
    const alertOf = (id: string, so: string, v: typeof V1 | null) =>
      openAlert(id, { salesOrderId: so, persona: v?.routingPersona ?? null, priority: v?.priority ?? null, riskType: v?.alertType ?? null, escalated: v === null ? null : v.escalated === "true" });
    const raw: AgeingBacklogRaw = {
      ...base,
      alerts: [alertOf("a1", "s2", V2), alertOf("a2", "s2", V2), alertOf("a3", "s1", V1), alertOf("a4", "s9", null)],
      items: [item("s1", V1), item("s2", V2)],
    };
    const dims = allowedBreakdowns("ageingBacklog", "item");
    expect(dims).toHaveLength(8);
    for (const dimension of dims) {
      if (!(dimension in V1)) throw new Error(`unexpected dim ${dimension}`);
      const key = dimension as keyof typeof V1;
      const out = deriveAgeingBacklog({ ...raw, dimension }, sel());
      expect(out.data.breakdown?.groups.map((g) => [g.group, g.data.openAlerts]), dimension).toEqual([
        [V2[key], 2],
        [V1[key], 1],
      ]);
      expect(out.data.breakdown?.other?.openAlerts, dimension).toBe(1);
      expect(out.caveats.includes("overlap"), dimension).toBe(!isItemDim(dimension));
    }
  });

});
