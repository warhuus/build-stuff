import { describe, expect, it } from "vitest";
import { ITEM_DIMS, RISK_RANGES } from "../../../../config/metrics";
import { deriveRiskDistribution } from "../../compute/deriveRiskDistribution";
import { loadRiskDistribution } from "../../loaders/riskDistribution";
import { itemsOfRisk, riskAll, riskBucket, riskNotDelayed, riskWorked } from "../../query/buildRisk";
import { EMPTY_FILTERS } from "../../selection";
import type { FakeSource } from "../../source/fake/fakeSource";
import type { GroupCountValue, ItemDim, RiskSideRaw } from "../../types";
import { AMER, callCount, fakeDeps, win } from "../helpers/loaderDeps";
import { sel } from "../helpers/testKit";

/*
 * Fixture risk table (fixtures.ts header), open items I1–I30, item In value n × 1000 (I29 null):
 *   unscored I6 I7 I16 I18 I20 I24 I27 I30 · b15_30 I1 I3 I15 I17 I26 · b31_50 I2 I8 I19 I28 ·
 *   b51_70 I9 I10 I21 I29 · b71_90 I11 I12 I23 · b91_100 I5 I13 I25 · delayed I4 I14 I22.
 * Worked open items (a human event on the item in the window; ALERTS table, human tokens vw ac rs es dl wb wt wr):
 *   7 d  I2 I7 I9 I10 I11 I13 I15 I17 I18 I19 I21 I24 I25 (+ closed I32 I36 I40, no evaluation) = 13
 *   30 d the 7 d set + I6 (A69) I12 (A51) I14 (A55) I16 (A16, A28) I22 (A22) I26 (A26) I29 (A29) = 20
 *   now  the 30 d set + I3 (A33 @200) I20 (A20, A30) I23 (A23 @33) = 23 (not worked: I1 I4 I5 I8 I27 I28 I30)
 */

/**
 * Expected side: total count; counts of the 5 score ranges (starts 0, 31, 51, 71, 91; zero ranges omitted);
 * delayed count; total value; [count, value] of b15_30, b31_50, b51_70, b71_90, b91_100, delayed.
 */
function side(total: number, ranges: readonly number[], delayed: number, value: number, b: readonly (readonly [number, number])[]): RiskSideRaw {
  const cv = (i: number) => ({ count: b[i][0], valueUsd: b[i][1] });
  return {
    totalCount: total,
    rangeCounts: RISK_RANGES.map(([start], i) => ({ startValue: start, count: ranges[i] })).filter((r) => r.count > 0),
    delayedCount: delayed,
    totalValue: value,
    bucketTotals: { b15_30: cv(0), b31_50: cv(1), b51_70: cv(2), b71_90: cv(3), b91_100: cv(4), delayed: cv(5) },
    groups: null,
  };
}

// All open items, no filter: b15_30 1+3+15+17+26 = 62k; b31_50 2+8+19+28 = 57k; b51_70 9+10+21 (+I29 null) = 40k;
// b71_90 11+12+23 = 46k; b91_100 5+13+25 = 43k; delayed 4+14+22 = 40k; unscored 6+7+16+18+20+24+27+30 = 148k;
// total 30 items, 148+62+57+40+46+43+40 = 436k.
const ALL = side(30, [5, 4, 4, 3, 3], 3, 436000, [[5, 62000], [4, 57000], [4, 40000], [3, 46000], [3, 43000], [3, 40000]]);

/** Port methods called, with counts. */
const methods = (source: FakeSource): Record<string, number> =>
  Object.fromEntries([...new Set(source.calls.map((c) => c.method))].map((m) => [m, callCount(source, m)]));

/** Groups sorted by name (the port's order is unspecified). */
const byName = (rows: readonly GroupCountValue[]): GroupCountValue[] => [...rows].sort((a, b) => a.group.localeCompare(b.group));
const g = (group: string, count: number, valueUsd: number): GroupCountValue => ({ group, count, valueUsd });

describe("loadRiskDistribution (spec §9 3.1, D17)", () => {
  it("7 d, no filter: both sides; 6 count + 14 value calls, no row fetches", async () => {
    const deps = fakeDeps();
    const out = await loadRiskDistribution(sel({ window: 7 }), null, deps);
    // Worked 7 d: unscored I7 I18 I24 (7+18+24 = 49k); b15_30 I15 I17 = 32k; b31_50 I2 I19 = 21k;
    // b51_70 I9 I10 I21 = 40k; b71_90 I11 = 11k; b91_100 I13 I25 = 38k; delayed none.
    // total 13 items, 49+32+21+40+11+38 = 191k; ranges 2, 2, 3, 1, 2.
    const worked = side(13, [2, 2, 3, 1, 2], 0, 191000, [[2, 32000], [2, 21000], [3, 40000], [1, 11000], [2, 38000], [0, 0]]);
    expect(out).toEqual({ raw: { window: win(7), dimension: null, all: ALL, worked }, status: "ok", caveats: [] });
    // Per side: countRisk total + delayed, 1 range call, countItems total + 6 buckets.
    expect(methods(deps.source)).toEqual({ countRisk: 4, countRiskByScoreRange: 2, countItems: 14 });
    const all = riskAll(EMPTY_FILTERS);
    const w = riskWorked(win(7), EMPTY_FILTERS);
    expect(deps.source.calls).toContainEqual({ method: "countRiskByScoreRange", args: [riskNotDelayed(all), RISK_RANGES] });
    expect(deps.source.calls).toContainEqual({ method: "countRisk", args: [riskBucket(w, "delayed")] });
    expect(deps.source.calls).toContainEqual({ method: "countItems", args: [itemsOfRisk(riskBucket(w, "b71_90"))] });
  });

  it("30 d: worked grows by I6 I12 I14 I16 I22 I26 I29", async () => {
    const out = await loadRiskDistribution(sel({ window: 30 }), null, fakeDeps());
    // Worked 30 d: unscored I6 I7 I16 I18 I24 = 6+7+16+18+24 = 71k; b15_30 I15 I17 I26 = 58k; b31_50 I2 I19 = 21k;
    // b51_70 I9 I10 I21 I29 = 40k (I29 null value); b71_90 I11 I12 = 23k; b91_100 I13 I25 = 38k;
    // delayed I14 I22 = 36k. Total 20, 71+58+21+40+23+38+36 = 287k; ranges 3, 2, 4, 2, 2.
    const worked = side(20, [3, 2, 4, 2, 2], 2, 287000, [[3, 58000], [2, 21000], [4, 40000], [2, 23000], [2, 38000], [2, 36000]]);
    expect(out.raw).toEqual({ window: win(30), dimension: null, all: ALL, worked });
  });

  it('"now": worked is all-time (W3)', async () => {
    const out = await loadRiskDistribution(sel({ window: "now" }), null, fakeDeps());
    // Worked now: unscored I6 I7 I16 I18 I20 I24 = 91k; b15_30 I3 I15 I17 I26 = 61k; b31_50 I2 I19 = 21k;
    // b51_70 I9 I10 I21 I29 = 40k; b71_90 I11 I12 I23 = 46k; b91_100 I13 I25 = 38k; delayed I14 I22 = 36k.
    // Total 23, 91+61+21+40+46+38+36 = 333k; ranges 4, 2, 4, 3, 2.
    const worked = side(23, [4, 2, 4, 3, 2], 2, 333000, [[4, 61000], [2, 21000], [4, 40000], [3, 46000], [2, 38000], [2, 36000]]);
    expect(out.raw).toEqual({ window: win("now"), dimension: null, all: ALL, worked });
  });

  it("AMER filter applies to both sides", async () => {
    const deps = fakeDeps();
    const out = await loadRiskDistribution(sel({ window: 7, filters: AMER }), null, deps);
    // AMER open items: I21–I28, I30 (I29 null region). unscored I24 I27 I30 = 81k; b15_30 I26; b31_50 I28;
    // b51_70 I21; b71_90 I23; b91_100 I25; delayed I22. Total 9, 81+26+28+21+23+25+22 = 226k.
    const all = side(9, [1, 1, 1, 1, 1], 1, 226000, [[1, 26000], [1, 28000], [1, 21000], [1, 23000], [1, 25000], [1, 22000]]);
    // Worked 7 d ∩ AMER: I21 (b51_70), I24 (unscored), I25 (b91_100) → 3 items, 21+24+25 = 70k.
    const worked = side(3, [0, 0, 1, 0, 1], 0, 70000, [[0, 0], [0, 0], [1, 21000], [0, 0], [1, 25000], [0, 0]]);
    expect(out.raw).toEqual({ window: win(7), dimension: null, all, worked });
    expect(deps.source.calls[0]).toEqual({ method: "countRisk", args: [riskAll(AMER)] });
  });

  /** One grouped check: side, bucket, expected groups. */
  type GroupCase = readonly ["all" | "worked", keyof NonNullable<RiskSideRaw["groups"]>, readonly GroupCountValue[]];
  const cases: Readonly<Record<ItemDim, readonly GroupCase[]>> = {
    // Business line: odd BL-A, even BL-B, I30 null (dropped).
    businessLine: [
      ["all", "unscored", [g("BL-A", 2, 34000), g("BL-B", 5, 84000)]], // A: I7 I27; B: I6 I16 I18 I20 I24
      ["all", "delayed", [g("BL-B", 3, 40000)]], // I4 I14 I22
      ["worked", "unscored", [g("BL-A", 1, 7000), g("BL-B", 2, 42000)]], // A: I7; B: I18 I24
      ["worked", "b51_70", [g("BL-A", 2, 30000), g("BL-B", 1, 10000)]], // A: I9 I21; B: I10
    ],
    // Product line: I1–15 PL-1, I16–30 PL-2, I27 null (dropped).
    productLine: [
      ["all", "unscored", [g("PL-1", 2, 13000), g("PL-2", 5, 108000)]], // PL-1 I6 I7; PL-2 I16 I18 I20 I24 I30
      ["all", "b15_30", [g("PL-1", 3, 19000), g("PL-2", 2, 43000)]], // PL-1 I1 I3 I15; PL-2 I17 I26
      ["worked", "b91_100", [g("PL-1", 1, 13000), g("PL-2", 1, 25000)]], // I13, I25
    ],
    // Region: I1–20 EMEA, I21–40 AMER, I29 null (dropped).
    region: [
      ["all", "unscored", [g("AMER", 3, 81000), g("EMEA", 5, 67000)]], // AMER I24 I27 I30; EMEA I6 I7 I16 I18 I20
      ["all", "b51_70", [g("AMER", 1, 21000), g("EMEA", 2, 19000)]], // AMER I21; EMEA I9 I10; I29 dropped
      ["worked", "unscored", [g("AMER", 1, 24000), g("EMEA", 2, 25000)]], // AMER I24; EMEA I7 I18
      ["worked", "delayed", []],
    ],
    // Plant: n mod 3 = 1 P100, 2 P200, 0 P300; I28 null (dropped).
    plant: [
      ["all", "b31_50", [g("P100", 1, 19000), g("P200", 2, 10000)]], // P100 I19; P200 I2 I8; I28 dropped
      ["all", "delayed", [g("P100", 2, 26000), g("P200", 1, 14000)]], // P100 I4 I22; P200 I14
      ["worked", "b15_30", [g("P200", 1, 17000), g("P300", 1, 15000)]], // P200 I17; P300 I15
    ],
  };

  for (const dim of ITEM_DIMS) {
    it(`7 d, breakdown ${dim}: 14 grouped calls (7 buckets incl. unscored × 2 sides) plus the totals`, async () => {
      const deps = fakeDeps();
      const out = await loadRiskDistribution(sel({ window: 7 }), dim, deps);
      expect(out.raw.dimension).toBe(dim);
      expect(out.caveats).toEqual([]);
      // Totals are unchanged by the breakdown (D17 keeps the per-bucket value calls).
      expect(out.raw.all).toEqual({ ...ALL, groups: out.raw.all.groups });
      for (const [s, bucket, expected] of cases[dim]) expect(byName(out.raw[s].groups?.[bucket] ?? [])).toEqual(expected);
      expect(methods(deps.source)).toEqual({ countRisk: 4, countRiskByScoreRange: 2, countItems: 14, countItemsBy: 14 });
      expect(deps.source.calls).toContainEqual({
        method: "countItemsBy",
        args: [itemsOfRisk(riskBucket(riskWorked(win(7), EMPTY_FILTERS), "unscored")), dim],
      });
    });
  }

  it("a non-item breakdown is treated as none (registry allows item dims only)", async () => {
    const out = await loadRiskDistribution(sel({ window: 7 }), "priority", fakeDeps());
    expect(out.raw.dimension).toBeNull();
    expect(out.raw.all.groups).toBeNull();
  });

  it("truncated when a grouped call returns exactly MAX_GROUPS rows", async () => {
    // MAX_GROUPS 2: all-side unscored by region has exactly 2 groups (AMER, EMEA).
    // The loader adds no caveat (MOD-02); derive decides from the grouped lists in the raw.
    const deps = fakeDeps({ config: { MAX_GROUPS: 2 } });
    const out = await loadRiskDistribution(sel({ window: 7 }), "region", deps);
    expect(out).toMatchObject({ status: "ok", caveats: [] });
    expect(deriveRiskDistribution(out.raw, sel({ window: 7 }), deps.config).caveats).toContain("truncated");
    // MAX_GROUPS 3: no bucket has 3 regions (only 2 non-null values exist).
    const deps3 = fakeDeps({ config: { MAX_GROUPS: 3 } });
    const none = await loadRiskDistribution(sel({ window: 7 }), "region", deps3);
    expect(deriveRiskDistribution(none.raw, sel({ window: 7 }), deps3.config).caveats).not.toContain("truncated");
  });

  it("rejects on abort", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(loadRiskDistribution(sel({ window: 7 }), null, fakeDeps({ signal: ac.signal }))).rejects.toMatchObject({ name: "AbortError" });
  });

  it("end to end with the derive: 14 rows; unscored = total − ranges − delayed", async () => {
    const out = await loadRiskDistribution(sel({ window: 7 }), null, fakeDeps());
    const rows = deriveRiskDistribution(out.raw, sel({ window: 7 })).data.total;
    expect(rows).toHaveLength(14);
    // All unscored 30 − (5+4+4+3+3) − 3 = 8; worked unscored 13 − 10 − 0 = 3; not worked 5.
    expect(rows.filter((r) => r.bucket === "unscored").map((r) => [r.worked, r.count])).toEqual([[true, 3], [false, 5]]);
  });
});
