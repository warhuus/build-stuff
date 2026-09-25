import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import type { MetricsConfig } from "../../../../config/metrics";
import {
  bucketAmountsOfGroup,
  bucketAmountsOutside,
  bucketOf,
  bucketOfRangeStart,
  bucketRows,
  groupTotalsAcrossBuckets,
  rangesFromConfig,
  riskSideTotals,
  shareOfBucket,
} from "../../compute/riskBuckets";
import type { BucketAmounts, BucketGroups } from "../../compute/riskBuckets";
import type { BucketRow, RiskSideRaw } from "../../types";

const C = METRICS_CONFIG;
const cv = (count: number, valueUsd: number) => ({ count, valueUsd });
const Z = cv(0, 0);
const emptyBucketAmounts = () => ({ unscored: Z, b15_30: Z, b31_50: Z, b51_70: Z, b71_90: Z, b91_100: Z, delayed: Z });

describe("bucketOf (spec §9 3.1, §13 Risk buckets)", () => {
  it("null score → unscored", () => {
    expect(bucketOf(null, "At Risk", C)).toBe("unscored");
    expect(bucketOf(null, null, C)).toBe("unscored");
  });
  it("15 and 30 → b15_30; 31 → b31_50 (score 30 vs 31 boundary)", () => {
    expect(bucketOf(15, "At Risk", C)).toBe("b15_30");
    expect(bucketOf(30, "At Risk", C)).toBe("b15_30");
    expect(bucketOf(31, "At Risk", C)).toBe("b31_50");
    expect(bucketOf(50, null, C)).toBe("b31_50");
    expect(bucketOf(51, null, C)).toBe("b51_70");
    expect(bucketOf(71, null, C)).toBe("b71_90");
    expect(bucketOf(90, null, C)).toBe("b71_90");
    expect(bucketOf(91, null, C)).toBe("b91_100");
  });
  it("100 + Delayed → delayed; 100 + At Risk → b91_100; Delayed wins whatever the score", () => {
    expect(bucketOf(100, "Delayed", C)).toBe("delayed");
    expect(bucketOf(100, "At Risk", C)).toBe("b91_100");
    expect(bucketOf(20, "Delayed", C)).toBe("delayed");
    expect(bucketOf(null, "Delayed", C)).toBe("delayed");
  });
  it("out-of-range low score lands in b15_30, high score in b91_100", () => {
    expect(bucketOf(3, null, C)).toBe("b15_30");
    expect(bucketOf(-4, null, C)).toBe("b15_30");
    expect(bucketOf(101, null, C)).toBe("b91_100");
  });
  it("uses the ranges of the config parameter", () => {
    const custom: MetricsConfig = { ...C, RISK_RANGES: [[15, 40], [40, 101]] };
    expect(bucketOf(10, null, custom)).toBe("b15_30");
    expect(bucketOf(39, null, custom)).toBe("b15_30");
    expect(bucketOf(40, null, custom)).toBe("b31_50");
    expect(bucketOf(200, null, custom)).toBe("b31_50");
    expect(bucketOf(50, null, { ...C, RISK_RANGES: [] })).toBe("unscored");
  });
});

describe("ranges ↔ buckets", () => {
  it("rangesFromConfig zips RISK_RANGES with the scored buckets", () => {
    expect(rangesFromConfig(C)).toEqual([
      { bucket: "b15_30", start: 0, end: 31 },
      { bucket: "b31_50", start: 31, end: 51 },
      { bucket: "b51_70", start: 51, end: 71 },
      { bucket: "b71_90", start: 71, end: 91 },
      { bucket: "b91_100", start: 91, end: 101 },
    ]);
  });
  it("bucketOfRangeStart maps a $ranges startValue, unknown → null", () => {
    expect(bucketOfRangeStart(0, C)).toBe("b15_30");
    expect(bucketOfRangeStart(91, C)).toBe("b91_100");
    expect(bucketOfRangeStart(15, C)).toBeNull();
  });
});

const side = (over: Partial<RiskSideRaw> = {}): RiskSideRaw => ({
  totalCount: 100,
  rangeCounts: [
    { startValue: 0, count: 10 },
    { startValue: 31, count: 5 },
    { startValue: 91, count: 20 },
    { startValue: 999, count: 7 },
  ],
  delayedCount: 15,
  totalValue: 10_000,
  bucketTotals: {
    b15_30: cv(10, 1000),
    b31_50: cv(5, 500),
    b51_70: cv(0, 0),
    b71_90: cv(0, 0),
    b91_100: cv(20, 3000),
    delayed: cv(15, 2500),
  },
  groups: null,
  ...over,
});

describe("riskSideTotals (unscored by subtraction)", () => {
  it("zero-fills missing ranges, ignores unknown starts, unscored = total − Σ ranges − delayed", () => {
    const totals = riskSideTotals(side(), C);
    expect(totals.b51_70).toEqual(cv(0, 0));
    expect(totals.b15_30).toEqual(cv(10, 1000));
    expect(totals.delayed).toEqual(cv(15, 2500));
    // 100 − (10 + 5 + 20) − 15 = 50; value 10000 − (1000 + 500 + 3000) − 2500 = 3000
    expect(totals.unscored).toEqual(cv(50, 3000));
  });
  it("unscored never goes negative", () => {
    expect(riskSideTotals(side({ totalCount: 10, totalValue: 0 }), C).unscored).toEqual(cv(0, 0));
  });
});

const amounts = (entries: Partial<Record<keyof BucketAmounts, { count: number; valueUsd: number }>>): BucketAmounts => ({
  ...emptyBucketAmounts(),
  ...entries,
});

describe("bucketRows (14 rows, spec §9 3.1)", () => {
  it("zero-fills 14 rows in bucket order, worked then not worked", () => {
    const rows = bucketRows(emptyBucketAmounts(), emptyBucketAmounts(), "count");
    expect(rows).toHaveLength(14);
    expect(rows.map((r) => `${r.bucket}:${r.worked}`).slice(0, 4)).toEqual([
      "unscored:true",
      "unscored:false",
      "b15_30:true",
      "b15_30:false",
    ]);
    expect(rows.every((r) => r.count === 0 && r.shareOfBucket === null)).toBe(true);
  });
  it("not worked = all − worked, never negative; shareOfBucket per unit", () => {
    const all = amounts({ b91_100: cv(10, 1000), delayed: cv(4, 100) });
    const worked = amounts({ b91_100: cv(4, 800), delayed: cv(6, 50) });
    const byCount = bucketRows(all, worked, "count");
    const top = byCount.filter((r) => r.bucket === "b91_100");
    expect(top).toEqual([
      { bucket: "b91_100", worked: true, count: 4, valueUsd: 800, shareOfBucket: 0.4 },
      { bucket: "b91_100", worked: false, count: 6, valueUsd: 200, shareOfBucket: 0.6 },
    ]);
    const delayed = byCount.filter((r) => r.bucket === "delayed");
    expect(delayed[1]).toMatchObject({ count: 0, valueUsd: 50 });
    const byValue = bucketRows(all, worked, "valueUsd").filter((r) => r.bucket === "b91_100");
    expect(byValue.map((r) => r.shareOfBucket)).toEqual([0.8, 0.2]);
  });
  it("shareOfBucket is null for a null value in unit valueUsd", () => {
    const rows: BucketRow[] = [
      { bucket: "unscored", worked: true, count: 1, valueUsd: null, shareOfBucket: null },
      { bucket: "unscored", worked: false, count: 3, valueUsd: 30, shareOfBucket: null },
    ];
    expect(shareOfBucket(rows, "valueUsd").map((r) => r.shareOfBucket)).toEqual([null, 1]);
    expect(shareOfBucket(rows, "count").map((r) => r.shareOfBucket)).toEqual([0.25, 0.75]);
  });
});

describe("breakdown helpers", () => {
  const empty = { unscored: [], b15_30: [], b31_50: [], b51_70: [], b71_90: [], b91_100: [], delayed: [] };
  const groups: BucketGroups = {
    ...empty,
    unscored: [{ group: "P1", count: 3, valueUsd: 30 }],
    b91_100: [
      { group: "P1", count: 2, valueUsd: 200 },
      { group: "P2", count: 5, valueUsd: 500 },
    ],
  };
  it("bucketAmountsOfGroup picks a group per bucket, zero when absent", () => {
    const p1 = bucketAmountsOfGroup(groups, "P1");
    expect(p1.unscored).toEqual(cv(3, 30));
    expect(p1.b91_100).toEqual(cv(2, 200));
    expect(p1.delayed).toEqual(cv(0, 0));
  });
  it("bucketAmountsOutside = bucket total − Σ shown groups, clamped", () => {
    const totals = amounts({ unscored: cv(4, 40), b91_100: cv(9, 900) });
    const other = bucketAmountsOutside(totals, groups, ["P1"]);
    expect(other.unscored).toEqual(cv(1, 10));
    expect(other.b91_100).toEqual(cv(7, 700));
    expect(bucketAmountsOutside(emptyBucketAmounts(), groups, ["P1", "P2"]).b91_100).toEqual(cv(0, 0));
  });
  it("groupTotalsAcrossBuckets sums counts over buckets", () => {
    expect(groupTotalsAcrossBuckets(groups)).toEqual([
      { group: "P1", count: 5 },
      { group: "P2", count: 5 },
    ]);
  });
});
