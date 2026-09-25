// Risk distribution (3.1): bucket boundaries, unscored by subtraction, not worked = all − worked, 14 rows,
// shareOfBucket per unit, one breakdown.
import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import { deriveRiskDistribution } from "../../compute/deriveRiskDistribution";
import { bucketOf, bucketRows, riskSideTotals } from "../../compute/riskBuckets";
import type { BucketAmounts } from "../../compute/riskBuckets";
import type { GroupCountValue, RiskBucketId, RiskDistributionRaw, RiskSideRaw } from "../../types";
import { SMALL, win } from "../helpers/deriveRows";
import { sel } from "../helpers/testKit";

const C = METRICS_CONFIG;
const cv = (count: number, valueUsd: number) => ({ count, valueUsd });
const Z = cv(0, 0);
const amounts = (over: Partial<BucketAmounts> = {}): BucketAmounts => ({
  unscored: Z, b15_30: Z, b31_50: Z, b51_70: Z, b71_90: Z, b91_100: Z, delayed: Z, ...over,
});
const noGroups = (): Record<RiskBucketId, GroupCountValue[]> => ({
  unscored: [], b15_30: [], b31_50: [], b51_70: [], b71_90: [], b91_100: [], delayed: [],
});

describe("bucketOf (spec §13 Risk buckets)", () => {
  it.each([
    [null, "At Risk", "unscored"],
    [15, "At Risk", "b15_30"],
    [30, "At Risk", "b15_30"],
    [31, "At Risk", "b31_50"],
    [100, "Delayed", "delayed"],
    [100, "At Risk", "b91_100"],
  ] as const)("score %s, status %s → %s", (score, status, bucket) => {
    expect(bucketOf(score, status, C)).toBe(bucket);
  });
});

describe("unscored by subtraction", () => {
  const side = (over: Partial<RiskSideRaw> = {}): RiskSideRaw => ({
    totalCount: 100,
    rangeCounts: [
      { startValue: 0, count: 10 },
      { startValue: 31, count: 5 },
      { startValue: 91, count: 20 },
      { startValue: 999, count: 7 }, // unknown range start → ignored
    ],
    delayedCount: 15,
    totalValue: 10_000,
    bucketTotals: { b15_30: cv(10, 1000), b31_50: cv(5, 500), b51_70: Z, b71_90: Z, b91_100: cv(20, 3000), delayed: cv(15, 2500) },
    groups: null,
    ...over,
  });
  it.each([
    // 100 − (10 + 5 + 20) − 15 = 50; 10000 − (1000 + 500 + 3000) − 2500 = 3000
    ["total − Σ ranges − delayed", side(), cv(50, 3000)],
    ["never negative", side({ totalCount: 10, totalValue: 0 }), cv(0, 0)],
  ])("%s", (_, raw, unscored) => {
    expect(riskSideTotals(raw, C).unscored).toEqual(unscored);
  });
});

describe("bucketRows", () => {
  it("not worked = all − worked, clamped at 0 per amount", () => {
    const rows = bucketRows(amounts({ b91_100: cv(10, 1000), delayed: cv(4, 100) }), amounts({ b91_100: cv(4, 800), delayed: cv(6, 50) }), "count");
    expect(rows.filter((r) => r.bucket === "b91_100")).toEqual([
      { bucket: "b91_100", worked: true, count: 4, valueUsd: 800, shareOfBucket: 0.4 },
      { bucket: "b91_100", worked: false, count: 6, valueUsd: 200, shareOfBucket: 0.6 },
    ]);
    // delayed: count 4 − 6 → 0; value 100 − 50 = 50
    expect(rows.find((r) => r.bucket === "delayed" && !r.worked)).toMatchObject({ count: 0, valueUsd: 50 });
  });
});

describe("deriveRiskDistribution (3.1)", () => {
  // all: 10 items / 1000 USD: b15_30 4 (400), delayed 2 (200) → unscored 4 (400); worked: b15_30 1 (300)
  const all: RiskSideRaw = {
    totalCount: 10,
    rangeCounts: [{ startValue: 0, count: 4 }],
    delayedCount: 2,
    totalValue: 1000,
    bucketTotals: { b15_30: cv(4, 400), b31_50: Z, b51_70: Z, b71_90: Z, b91_100: Z, delayed: cv(2, 200) },
    groups: null,
  };
  const worked: RiskSideRaw = {
    totalCount: 1,
    rangeCounts: [{ startValue: 0, count: 1 }],
    delayedCount: 0,
    totalValue: 300,
    bucketTotals: { b15_30: cv(1, 300), b31_50: Z, b51_70: Z, b71_90: Z, b91_100: Z, delayed: Z },
    groups: null,
  };
  const raw: RiskDistributionRaw = { window: win(30), dimension: null, all, worked };

  it.each([
    // b15_30 worked 1 / 4 items; value 300 / 400
    ["count", [0.25, 0.75]],
    ["valueUsd", [0.75, 0.25]],
  ] as const)("14 zero-filled rows; shareOfBucket in unit %s", (unit, shares) => {
    const rows = deriveRiskDistribution(raw, sel({ unit })).data.total;
    expect(rows).toHaveLength(14);
    expect(rows.filter((r) => r.bucket === "b15_30").map((r) => [r.worked, r.count, r.valueUsd, r.shareOfBucket])).toEqual([
      [true, 1, 300, shares[0]],
      [false, 3, 100, shares[1]],
    ]);
    expect(rows.find((r) => r.bucket === "unscored" && !r.worked)?.count).toBe(4);
    expect(rows.find((r) => r.bucket === "b51_70" && r.worked)).toMatchObject({ count: 0, shareOfBucket: null });
  });

  it("item-dim breakdown: top-N by count over all buckets, other per bucket, truncated", () => {
    const allGroups = noGroups();
    allGroups.b15_30 = [{ group: "X", count: 2, valueUsd: 200 }, { group: "Y", count: 1, valueUsd: 100 }, { group: "Z", count: 1, valueUsd: 50 }];
    allGroups.delayed = [{ group: "Y", count: 2, valueUsd: 200 }];
    const workedGroups = noGroups();
    workedGroups.b15_30 = [{ group: "X", count: 1, valueUsd: 300 }];
    const out = deriveRiskDistribution(
      { ...raw, dimension: "plant", all: { ...all, groups: allGroups }, worked: { ...worked, groups: workedGroups } },
      sel(),
      SMALL,
    );
    const bd = out.data.breakdown;
    // totals across buckets: Y 3, X 2, Z 1 → shown Y, X
    expect(bd?.groups.map((g) => g.group)).toEqual(["Y", "X"]);
    expect(bd?.groups[1].data.filter((r) => r.bucket === "b15_30").map((r) => [r.worked, r.count])).toEqual([[true, 1], [false, 1]]);
    // other b15_30: all 4 − (2 + 1) = 1 (Z); worked 1 − 1 = 0
    expect(bd?.other?.filter((r) => r.bucket === "b15_30").map((r) => [r.worked, r.count])).toEqual([[true, 0], [false, 1]]);
    expect(bd?.truncated).toEqual({ shown: 2, total: 3 });
  });
});
