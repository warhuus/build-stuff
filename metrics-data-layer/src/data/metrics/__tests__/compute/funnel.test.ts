import { describe, expect, it } from "vitest";
import {
  deriveFunnel,
  firstOkStageId,
  funnelSeries,
  itemAmounts,
  notApplicableStage,
  okStage,
  outsidePathOf,
  unavailableStage,
  usesCountFallback,
} from "../../compute/funnel";
import type { FunnelStageRaw } from "../../types";

const itemStages: FunnelStageRaw[] = [
  okStage("2.0", { count: 100, valueUsd: 10_000 }, ["proxy"]),
  okStage("2.1", { count: 50, valueUsd: 8_000 }),
  okStage("2.2", { count: 20, valueUsd: 2_000 }),
  okStage("2.3", { count: 10, valueUsd: 1_600 }, ["not-a-conversion"], outsidePathOf("2.3", { count: 4, valueUsd: 300 })),
  okStage("2.4", { count: 0, valueUsd: 0 }, ["low-volume"], outsidePathOf("2.4", { count: 1, valueUsd: 50 })),
];

describe("deriveFunnel (spec §9.0, Appendix A F2–F3, B8)", () => {
  it("count unit: pctPrev vs previous, pctFirst vs 2.0, trackValue = previous, null on the first", () => {
    const { stages, caveats } = deriveFunnel(itemStages, "count");
    expect(stages.map((s) => s.pctPrev)).toEqual([null, 0.5, 0.4, 0.5, 0]);
    expect(stages.map((s) => s.pctFirst)).toEqual([1, 0.5, 0.2, 0.1, 0]);
    expect(stages.map((s) => s.trackValue)).toEqual([null, 100, 50, 20, 10]);
    expect(caveats).toEqual([]);
  });
  it("value unit gives different percentages from the same raw numbers", () => {
    const { stages } = deriveFunnel(itemStages, "valueUsd");
    expect(stages.map((s) => s.pctPrev)).toEqual([null, 0.8, 0.25, 0.8, 0]);
    expect(stages.map((s) => s.pctFirst)).toEqual([1, 0.8, 0.2, 0.16, 0]);
    expect(stages[1].trackValue).toBe(10_000);
  });
  it("zero previous stage → null pctPrev; zero first → null pctFirst", () => {
    const stages = [okStage("2.0", { count: 0, valueUsd: 0 }), okStage("2.1", { count: 0, valueUsd: 0 })];
    const derived = deriveFunnel(stages, "count").stages;
    expect(derived[1].pctPrev).toBeNull();
    expect(derived[1].pctFirst).toBeNull();
    expect(derived[1].trackValue).toBe(0);
  });
  it("1.0 no-source is skipped: first ok = 1.1, section 1 unit valueUsd falls back to counts", () => {
    const stages = [
      unavailableStage("1.0", "no-source", ["no-source"]),
      okStage("1.1", { count: 40, valueUsd: null }),
      okStage("1.2", { count: 10, valueUsd: null }, ["id-space-differs"]),
    ];
    const { stages: derived, caveats } = deriveFunnel(stages, "valueUsd");
    expect(derived[0]).toMatchObject({ availability: "no-source", count: null, pctPrev: null, pctFirst: null, trackValue: null });
    expect(derived[1]).toMatchObject({ pctPrev: null, pctFirst: 1, trackValue: null });
    expect(derived[2]).toMatchObject({ pctPrev: 0.25, pctFirst: 0.25, trackValue: 40 });
    expect(caveats).toEqual(["value-item-view-only"]);
    expect(firstOkStageId(stages)).toBe("1.1");
  });
  it("not-applicable stages in the middle are skipped as previous", () => {
    const stages = [okStage("2.1", { count: 50, valueUsd: null }), notApplicableStage("2.2"), okStage("2.3", { count: 5, valueUsd: null })];
    const derived = deriveFunnel(stages, "count").stages;
    expect(derived[1]).toMatchObject({ availability: "not-applicable", pctPrev: null, trackValue: null });
    expect(derived[2]).toMatchObject({ pctPrev: 0.1, trackValue: 50 });
  });
  it("a null ok-stage count (defensive) gives null percentages", () => {
    const nullStage: FunnelStageRaw = { ...okStage("2.1", { count: 0, valueUsd: 0 }), count: null };
    const derived = deriveFunnel([okStage("2.0", { count: 10, valueUsd: 1 }), nullStage, okStage("2.2", { count: 5, valueUsd: 1 })], "count").stages;
    expect(derived[1].pctPrev).toBeNull();
    expect(derived[2]).toMatchObject({ pctPrev: null, trackValue: null, pctFirst: 0.5 });
  });
  it("no ok stage at all → every derived field null", () => {
    const derived = deriveFunnel([notApplicableStage("2.0")], "count");
    expect(derived.stages[0].pctFirst).toBeNull();
  });
});

describe("usesCountFallback", () => {
  it("only for unit valueUsd with a null value on an ok stage", () => {
    expect(usesCountFallback(itemStages, "valueUsd")).toBe(false);
    expect(usesCountFallback([okStage("2.1", { count: 1, valueUsd: null })], "count")).toBe(false);
    expect(usesCountFallback([okStage("2.1", { count: 1, valueUsd: null })], "valueUsd")).toBe(true);
    expect(usesCountFallback([notApplicableStage("2.0")], "valueUsd")).toBe(false);
  });
});

describe("stage builders", () => {
  it("notApplicableStage and unavailableStage carry labels and null amounts", () => {
    expect(notApplicableStage("2.0")).toEqual({
      id: "2.0",
      label: "Open items",
      count: null,
      valueUsd: null,
      availability: "not-applicable",
      caveats: [],
      outsidePath: null,
    });
    expect(unavailableStage("1.0", "no-source").label).toBe("Users who should use the app");
  });
  it("okStage defaults and outsidePathOf labels", () => {
    expect(okStage("2.2", { count: 3, valueUsd: 9 })).toMatchObject({ availability: "ok", caveats: [], outsidePath: null, label: "Alert viewed" });
    expect(outsidePathOf("2.3", { count: 4, valueUsd: null })).toEqual({ count: 4, valueUsd: null, label: "Acted without a view" });
    expect(outsidePathOf("2.4", { count: 1, valueUsd: 5 }).label).toBe("Written back outside the path");
    expect(itemAmounts({ count: 2, valueUsd: 7 })).toEqual({ count: 2, valueUsd: 7 });
  });
});

describe("funnelSeries", () => {
  it("alert view: 2.0 not-applicable → firstStageId 2.1, value fallback caveat", () => {
    const stages = [notApplicableStage("2.0"), okStage("2.1", { count: 8, valueUsd: null }), okStage("2.2", { count: 2, valueUsd: null })];
    const { series, caveats } = funnelSeries({ section: 2, view: "alert", window: 30, unit: "valueUsd", generatedAt: "2026-06-01T00:00:00Z", stages });
    expect(series.firstStageId).toBe("2.1");
    expect(series.stages[2].pctFirst).toBe(0.25);
    expect(series).toMatchObject({ section: 2, view: "alert", window: 30, unit: "valueUsd", generatedAt: "2026-06-01T00:00:00Z" });
    expect(caveats).toEqual(["value-item-view-only"]);
  });
  it("item view: firstStageId 2.0, no caveat", () => {
    const { series, caveats } = funnelSeries({ section: 2, view: "item", window: "now", unit: "count", generatedAt: "x", stages: itemStages });
    expect(series.firstStageId).toBe("2.0");
    expect(caveats).toEqual([]);
  });
  it("no ok stage → the section's first stage id", () => {
    const one = funnelSeries({ section: 1, view: "user", window: 7, unit: "count", generatedAt: "x", stages: [unavailableStage("1.0", "no-source")] });
    expect(one.series.firstStageId).toBe("1.0");
    const two = funnelSeries({ section: 2, view: "item", window: 7, unit: "count", generatedAt: "x", stages: [] });
    expect(two.series.firstStageId).toBe("2.0");
  });
});
