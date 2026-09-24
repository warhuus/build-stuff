import { describe, expect, it } from "vitest";
import { AGE_EDGES_DAYS, DURATION_EDGES_HOURS } from "../../../../config/metrics";
import { assignBin, countBins, quantileFromBins, rangesFromEdges, zeroFilledBins } from "../../compute/bins";

describe("rangesFromEdges / zeroFilledBins", () => {
  it("builds [start, end) ranges with an open-ended last bin", () => {
    expect(rangesFromEdges([0, 1, 2])).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: null },
    ]);
    expect(rangesFromEdges([])).toEqual([]);
  });
  it("duration bins: 12 bins, last from 2160 h upward open-ended", () => {
    const bins = zeroFilledBins(DURATION_EDGES_HOURS);
    expect(bins).toHaveLength(12);
    expect(bins[11]).toEqual({ binStart: 2160, binEnd: null, count: 0 });
    expect(bins[0]).toEqual({ binStart: 0, binEnd: 1, count: 0 });
  });
  it("age bins: 1-day bins 0–30, then 30–60, 60–90, 90+ open-ended", () => {
    const bins = zeroFilledBins(AGE_EDGES_DAYS);
    expect(bins).toHaveLength(33);
    expect(bins[29]).toEqual({ binStart: 29, binEnd: 30, count: 0 });
    expect(bins[30]).toEqual({ binStart: 30, binEnd: 60, count: 0 });
    expect(bins[32]).toEqual({ binStart: 90, binEnd: null, count: 0 });
  });
});

describe("assignBin (spec §13 Bins)", () => {
  const E = DURATION_EDGES_HOURS;
  it("a value exactly on an edge belongs to the bin starting there (1 h ∈ [1, 2))", () => {
    expect(assignBin(1, E)).toBe(1);
    expect(assignBin(0.999, E)).toBe(0);
    expect(assignBin(0, E)).toBe(0);
    expect(assignBin(2, E)).toBe(2);
  });
  it("2160 h and above land in the open-ended last bin", () => {
    expect(assignBin(2159.99, E)).toBe(10);
    expect(assignBin(2160, E)).toBe(11);
    expect(assignBin(1e9, E)).toBe(11);
  });
  it("below the first edge, NaN, or no edges → null", () => {
    expect(assignBin(-0.5, E)).toBeNull();
    expect(assignBin(Number.NaN, E)).toBeNull();
    expect(assignBin(3, [])).toBeNull();
  });
});

describe("countBins", () => {
  it("zero-fills and skips values that fit no bin", () => {
    expect(countBins([0, 0.5, 1, 5, 7, -1], [0, 1, 4])).toEqual([
      { binStart: 0, binEnd: 1, count: 2 },
      { binStart: 1, binEnd: 4, count: 1 },
      { binStart: 4, binEnd: null, count: 2 },
    ]);
    expect(countBins([], [0, 1])).toEqual(zeroFilledBins([0, 1]));
  });
});

describe("quantileFromBins (Appendix A O7)", () => {
  const bins = [
    { binStart: 0, binEnd: 1, count: 2 },
    { binStart: 1, binEnd: 2, count: 0 },
    { binStart: 2, binEnd: 4, count: 6 },
    { binStart: 4, binEnd: null, count: 2 },
  ];
  it("interpolates linearly within the containing bin", () => {
    // n = 10, median target 5: c_before = 2 (bin [0,1)), empty bin skipped, [2,4) holds it:
    // 2 + (5 − 2) / 6 · 2 = 3
    expect(quantileFromBins(bins, 0.5)).toBe(3);
    // target 2 sits exactly at the end of the first bin: 0 + 2/2 · 1 = 1
    expect(quantileFromBins(bins, 0.2)).toBe(1);
    // target 8 = end of [2,4): 2 + 6/6 · 2 = 4
    expect(quantileFromBins(bins, 0.8)).toBe(4);
  });
  it("null when the containing bin is open-ended (p90 here)", () => {
    expect(quantileFromBins(bins, 0.9)).toBeNull();
  });
  it("null when n = 0 and when no bin qualifies (q = 0)", () => {
    expect(quantileFromBins(zeroFilledBins([0, 1]), 0.5)).toBeNull();
    expect(quantileFromBins([], 0.5)).toBeNull();
    expect(quantileFromBins(bins, 0)).toBeNull();
  });
});
