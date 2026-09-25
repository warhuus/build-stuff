// Duration cards (4.2–4.4): bins, O7 median / p90, negative clamp, populations and exclusions.
import { describe, expect, it } from "vitest";
import { DURATION_EDGES_HOURS, METRICS_CONFIG } from "../../../../config/metrics";
import { assignBin, quantileFromBins } from "../../compute/bins";
import { deriveFirstViewToClosure, deriveRaisedToClosed, deriveRaisedToFirstView } from "../../compute/deriveDurations";
import { durationSeries } from "../../compute/durations";
import type { DurationRaw, WindowKey } from "../../types";
import { daysAgo, fact, win } from "../helpers/deriveRows";
import { sel } from "../helpers/testKit";

const raw = (overrides: Partial<DurationRaw> = {}, key: WindowKey = 7): DurationRaw => ({
  window: win(key),
  dimension: null,
  facts: [],
  notWorked: null,
  items: null,
  ...overrides,
});

describe("bins (spec §13 Bins)", () => {
  it.each([
    [1, 1], // a value on an edge belongs to the bin starting there: 1 h ∈ [1, 2)
    [0.999, 0],
    [2160, 11], // open-ended last bin [2160, ∞)
  ])("%s h → bin %s", (hours, bin) => {
    expect(assignBin(hours, DURATION_EDGES_HOURS)).toBe(bin);
  });
});

describe("quantileFromBins (Appendix A O7)", () => {
  const bins = [
    { binStart: 0, binEnd: 1, count: 2 },
    { binStart: 1, binEnd: 2, count: 0 },
    { binStart: 2, binEnd: 4, count: 6 },
    { binStart: 4, binEnd: null, count: 2 },
  ];
  it.each([
    // n = 10, target 5: c_before 2, [2,4) holds it → 2 + (5 − 2) / 6 · 2 = 3
    ["median interpolates in its bin", bins, 0.5, 3],
    ["p90 in the open-ended bin → null", bins, 0.9, null],
    ["n = 0 → null", [{ binStart: 0, binEnd: 1, count: 0 }], 0.5, null],
  ])("%s", (_, input, q, expected) => {
    expect(quantileFromBins(input, q)).toBe(expected);
  });
});

describe("durationSeries", () => {
  it("clamps negatives to 0 and counts them; median and p90", () => {
    const { series, clampedNegative } = durationSeries("worked", [-1, 0.5, 1, 3, 3000], METRICS_CONFIG);
    expect(clampedNegative).toBe(1);
    expect(series.n).toBe(5);
    // [0,1): −1→0 and 0.5; [1,2): 1; [2,4): 3; [2160,∞): 3000
    expect(series.bins.filter((b) => b.count > 0).map((b) => [b.binStart, b.count])).toEqual([[0, 2], [1, 1], [2, 1], [2160, 1]]);
    // median target 2.5: [1,2) with c_before 2 → 1 + 0.5/1 · 1 = 1.5; p90 target 4.5 in the open-ended bin → null
    expect(series).toMatchObject({ median: 1.5, p90: null });
  });
});

describe("deriveRaisedToClosed (4.2)", () => {
  const facts = [
    fact("w1", { raisedAt: daysAgo(2), closedAt: daysAgo(1) }), // 24 h
    fact("w2", { raisedAt: null }), // noRaise
    fact("w3", { closedAt: daysAgo(20) }), // closed outside the 7-day window
  ];
  // n1 not worked (48 h); the not-worked copy of w1 is touched (in the facts) → excluded
  const notWorked = [fact("n1", { worked: false, raisedAt: daysAgo(3), closedAt: daysAgo(1) }), fact("w1", { worked: false })];

  it("worked and not-worked populations at 7 d; worked only at 30 d", () => {
    const total = deriveRaisedToClosed(raw({ facts, notWorked }), sel()).data.total;
    expect(total.series.map((s) => [s.key, s.n])).toEqual([["worked", 1], ["notWorked", 1]]);
    expect(total.series[0].median).toBe(24 + 0.5 * 24); // [24,48) bin, target 0.5 of 1
    expect(total.excluded).toEqual([{ reason: "noRaise", count: 1 }]);
    expect(deriveRaisedToClosed(raw({ facts }, 30), sel()).data.total.series.map((s) => s.key)).toEqual(["worked"]);
  });
});

describe("deriveRaisedToFirstView (4.3)", () => {
  it("population = first view in the window; no raise excluded and counted", () => {
    const facts = [
      fact("v1", { raisedAt: daysAgo(1), firstViewAt: daysAgo(0.5) }),
      fact("v2", { raisedAt: null, firstViewAt: daysAgo(0.5) }),
      fact("v3", { firstViewAt: daysAgo(10) }), // viewed before the window
    ];
    const total = deriveRaisedToFirstView(raw({ facts }), sel()).data.total;
    expect(total.series.map((s) => [s.key, s.n])).toEqual([["all", 1]]);
    expect(total.excluded).toEqual([{ reason: "noRaise", count: 1 }]);
  });
});

describe("deriveFirstViewToClosure (4.4)", () => {
  it("close before view excluded and counted; a tie is kept; unviewed not in the population", () => {
    const facts = [
      fact("k1", { firstViewAt: daysAgo(2), closedAt: daysAgo(1) }),
      fact("tie", { firstViewAt: daysAgo(1), closedAt: daysAgo(1) }),
      fact("cbv", { firstViewAt: daysAgo(0.5), closedAt: daysAgo(1) }),
      fact("nv", { firstViewAt: null }),
    ];
    const out = deriveFirstViewToClosure(raw({ facts }), sel());
    expect(out.data.total.series[0].n).toBe(2);
    expect(out.data.total.excluded).toEqual([{ reason: "closeBeforeView", count: 1 }]);
    expect(out.caveats).toContain("excludes-close-before-view");
  });
});
