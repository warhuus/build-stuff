import { describe, expect, it } from "vitest";
import { deriveRiskDistribution } from "../../compute/deriveRiskDistribution";
import type { GroupCountValue, RiskBucketId, RiskDistributionRaw, RiskSideRaw } from "../../types";
import { SMALL, win } from "../helpers/deriveRows";
import { sel } from "../helpers/testKit";

const cv = (count: number, valueUsd: number) => ({ count, valueUsd });
const noGroups = (): Record<RiskBucketId, GroupCountValue[]> => ({
  unscored: [], b15_30: [], b31_50: [], b51_70: [], b71_90: [], b91_100: [], delayed: [],
});

// all: 10 items, value 1000: b15_30 4 (400), delayed 2 (200), unscored 4 (400)
const all: RiskSideRaw = {
  totalCount: 10,
  rangeCounts: [{ startValue: 0, count: 4 }],
  delayedCount: 2,
  totalValue: 1000,
  bucketTotals: { b15_30: cv(4, 400), b31_50: cv(0, 0), b51_70: cv(0, 0), b71_90: cv(0, 0), b91_100: cv(0, 0), delayed: cv(2, 200) },
  groups: null,
};
// worked: b15_30 1 (300)
const worked: RiskSideRaw = {
  totalCount: 1,
  rangeCounts: [{ startValue: 0, count: 1 }],
  delayedCount: 0,
  totalValue: 300,
  bucketTotals: { b15_30: cv(1, 300), b31_50: cv(0, 0), b51_70: cv(0, 0), b71_90: cv(0, 0), b91_100: cv(0, 0), delayed: cv(0, 0) },
  groups: null,
};
const raw: RiskDistributionRaw = { window: win(30), dimension: null, all, worked };

describe("deriveRiskDistribution (3.1)", () => {
  it("14 rows, shareOfBucket per unit", () => {
    const byCount = deriveRiskDistribution(raw, sel({ unit: "count" }));
    const rows = byCount.data.total;
    expect(rows).toHaveLength(14);
    const b1530 = rows.filter((r) => r.bucket === "b15_30");
    expect(b1530.map((r) => [r.worked, r.count, r.valueUsd, r.shareOfBucket])).toEqual([
      [true, 1, 300, 0.25],
      [false, 3, 100, 0.75],
    ]);
    const byValue = deriveRiskDistribution(raw, sel({ unit: "valueUsd" })).data.total.filter((r) => r.bucket === "b15_30");
    expect(byValue.map((r) => r.shareOfBucket)).toEqual([0.75, 0.25]);
    expect(rows.find((r) => r.bucket === "unscored" && !r.worked)?.count).toBe(4);
    expect(byCount.data.breakdown).toBeNull();
    expect(byCount.caveats).toEqual(["delayed-forced-100", "unscored-largest"]);
  });

  it("item-dim breakdown: top-N by total count over buckets, other per bucket, truncated", () => {
    const allGroups = noGroups();
    allGroups.b15_30 = [
      { group: "X", count: 2, valueUsd: 200 },
      { group: "Y", count: 1, valueUsd: 100 },
      { group: "Z", count: 1, valueUsd: 50 },
    ];
    allGroups.delayed = [{ group: "Y", count: 2, valueUsd: 200 }];
    const workedGroups = noGroups();
    workedGroups.b15_30 = [{ group: "X", count: 1, valueUsd: 300 }];
    const out = deriveRiskDistribution(
      { ...raw, dimension: "plant", all: { ...all, groups: allGroups }, worked: { ...worked, groups: workedGroups } },
      sel(),
      SMALL,
    );
    const bd = out.data.breakdown;
    // totals across buckets: X 2, Y 3, Z 1 → shown Y, X
    expect(bd?.groups.map((g) => g.group)).toEqual(["Y", "X"]);
    const x = bd?.groups[1].data.filter((r) => r.bucket === "b15_30");
    expect(x?.map((r) => [r.worked, r.count])).toEqual([
      [true, 1],
      [false, 1],
    ]);
    // other b15_30: all 4 − (2 + 1) = 1 (Z); worked 1 − 1 = 0
    const other = bd?.other?.filter((r) => r.bucket === "b15_30");
    expect(other?.map((r) => [r.worked, r.count])).toEqual([
      [true, 0],
      [false, 1],
    ]);
    expect(bd?.truncated).toEqual({ shown: 2, total: 3 });
    // b15_30 all side returned 3 = MAX_GROUPS rows as well
    expect(out.caveats).toEqual(["delayed-forced-100", "unscored-largest", "truncated"]);
  });

  it("dimension without grouped rows → no breakdown; now-all-time under now", () => {
    const out = deriveRiskDistribution({ ...raw, window: win("now"), dimension: "region" }, sel());
    expect(out.data.breakdown).toBeNull();
    expect(out.caveats).toContain("now-all-time");
    const half = deriveRiskDistribution({ ...raw, dimension: "region", all: { ...all, groups: noGroups() } }, sel());
    expect(half.data.breakdown).toBeNull();
  });
});
