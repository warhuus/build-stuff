import { describe, expect, it } from "vitest";
import { deriveItemFunnel } from "../../compute/deriveItemFunnel";
import { loadItemFunnel } from "../../loaders/itemFunnel";
import { itemFunnelSets } from "../../query/buildFunnel";
import { DEFAULT_SELECTION, EMPTY_FILTERS } from "../../selection";
import type { BreakdownDimension, CountValue, ItemFilters, ItemViewRaw, Selection, WindowKey } from "../../types";
import { AMER, fakeDeps, win } from "../shared/loaderDeps";

const sel = (window: WindowKey, filters: ItemFilters = EMPTY_FILTERS): Selection => ({ ...DEFAULT_SELECTION, window, view: "item", filters });
const cv = (count: number, k: number): CountValue => ({ count, valueUsd: k * 1000 });
const g = (group: string, count: number, k: number) => ({ group, count, valueUsd: k * 1000 });
type Deps = ReturnType<typeof fakeDeps>;
async function run(window: WindowKey, dim: BreakdownDimension | null, filters = EMPTY_FILTERS, deps: Deps = fakeDeps()) {
  const out = await loadItemFunnel(sel(window, filters), dim, deps);
  if (out.raw.view !== "item") throw new Error("expected item view");
  const raw: ItemViewRaw = out.raw;
  return { out, raw, deps };
}
const methods = (deps: Deps): string[] => deps.source.calls.map((c) => c.method);

// Items In = `${1000+n}_10`, value n × 1000 USD (I29 null). Bounded 2.0 = created ≤ 09-01 AND (open OR GI ≥ start
// date): I1–I26, I28–I30 (I27 created null) + closed I31 (GI 08-30), I32 (08-25) at 7 d; +I33 (08-24) at 14 d;
// +I34, I38 at 30 d; +I35, I39 at 90 d. "now": open I1–I30.
// 2.1 = 2.0 ∩ (open-alert items I1–I26, I29 ∪ items with a closed event in the window).
// Stage sets and outside paths per window (item numbers; values = Σ n, I29 counts 0):
//  7 d: 2.2 {9,10,11,13,15,17,19,21,24,25,32} Σ196; 2.3 {10,13,15,19,21,25,32} Σ135; 2.4 {25};
//       out2.3 = acted {2,7,10,13,15,18,19,21,25,32} − 2.2 = {2,7,18} Σ27; out2.4 = {25} − 2.3 = ∅.
// 14 d: 2.2 7 d + {6,14,16,26,29} (I6 A69@10, I14 A55@8, I16 A16@12, I26 A26@11, I29 A29@9) Σ258;
//       2.3 7 d + {11,16,26} Σ188; 2.4 {11,16,25,26} Σ78; out2.3 {2,7,18} Σ27; out2.4 ∅.
// 30 d: 2.2 14 d + {38} Σ296; 2.3 14 d + {9,17} Σ214; out2.3 {2,7,12,18,22,33} Σ94; wb {9,11,12,16,25,26}:
//       2.4 {9,11,16,25,26} Σ87, out2.4 {12} Σ12.
// 90 d: 2.2 30 d + {12,18,20,31,34,35,39} Σ485; 2.3 30 d + {12,18,20,34,35} Σ333; out2.3 {2,7,22,23,33} Σ87;
//       2.4 {9,11,12,16,25,26,35} Σ134; out2.4 ∅.
// now:  2.1 {1..26,29} Σ351; 2.2 {2,3,6,9..21,24,25,26,29} Σ281; 2.3 {2,9..13,15..21,25,26} Σ234;
//       out2.3 {7,22,23} Σ52; 2.4 {9,11,12,16,25,26} Σ99; out2.4 ∅.
describe("loadItemFunnel item view: totals (spec §9 2.0–2.4 item view)", () => {
  it.each<[WindowKey, CountValue[], [CountValue, CountValue]]>([
    [7, [cv(31, 472), cv(29, 414), cv(11, 196), cv(7, 135), cv(1, 25)], [cv(3, 27), cv(0, 0)]],
    // 14 d: 2.0 7 d + I33 (Σ505); 2.1 7 d + I33 (closed A37@12, A47@11) = 30, Σ447.
    [14, [cv(32, 505), cv(30, 447), cv(16, 258), cv(10, 188), cv(4, 78)], [cv(3, 27), cv(0, 0)]],
    // 30 d: + I34, I38 (both closed in 30 d: A38@25, A42@4) → 34 / 577; 32 / 519.
    [30, [cv(34, 577), cv(32, 519), cv(17, 296), cv(12, 214), cv(5, 87)], [cv(6, 94), cv(1, 12)]],
    // 90 d: + I35, I39 (A39@60 / A52@55, A43@20) → 36 / 651; 34 / 593.
    [90, [cv(36, 651), cv(34, 593), cv(24, 485), cv(17, 333), cv(7, 134)], [cv(5, 87), cv(0, 0)]],
    // now: 2.0 open I1–I30 = 30 / Σ(1..30) − 29 = 436; 2.1 = open-alert items only.
    ["now", [cv(30, 436), cv(27, 351), cv(20, 281), cv(15, 234), cv(6, 99)], [cv(3, 52), cv(0, 0)]],
  ])("window %s: stage totals and outside paths from 7 countItems calls", async (key, stages, outside) => {
    const { out, deps } = await run(key, null);
    expect(out).toEqual({
      raw: {
        view: "item",
        window: win(key),
        dimension: null,
        generatedAt: "2026-09-01T12:00:00.000Z",
        stages: { "2.0": stages[0], "2.1": stages[1], "2.2": stages[2], "2.3": stages[3], "2.4": stages[4] },
        outsidePath: { "2.3": outside[0], "2.4": outside[1] },
        groups: null,
      },
      status: "ok",
      caveats: [],
    });
    const sets = itemFunnelSets(win(key), EMPTY_FILTERS);
    expect(deps.source.calls.map((c) => c.args[0])).toEqual([sets.so20, sets.so21, sets.so22, sets.so23, sets.so24, sets.outside23, sets.outside24]);
  });

  it("AMER (7 d): filters enter through so20", async () => {
    const { raw } = await run(7, null, AMER);
    // AMER = I21–I40 minus I29. 2.0 {21..26,28,30,31,32} Σ262; 2.1 {21..26,31,32} Σ204; 2.2 {21,24,25,32} Σ102;
    // 2.3 {21,25,32} Σ78; 2.4 {25}; outside 2.3: acted AMER {21,25,32} − 2.2 = ∅; 2.4 ∅.
    expect(raw.stages).toEqual({ "2.0": cv(10, 262), "2.1": cv(8, 204), "2.2": cv(4, 102), "2.3": cv(3, 78), "2.4": cv(1, 25) });
    expect(raw.outsidePath).toEqual({ "2.3": cv(0, 0), "2.4": cv(0, 0) });
  });
});

describe("loadItemFunnel item view: item dims (countItemsBy on 2.0–2.4)", () => {
  it.each<[BreakdownDimension, ItemViewRaw["groups"]]>([
    // region 7 d: EMEA = I1–I20 part, AMER = I21+ part (I29 null dropped).
    ["region", {
      "2.0": [g("EMEA", 20, 210), g("AMER", 10, 262)],
      "2.1": [g("EMEA", 20, 210), g("AMER", 8, 204)],
      "2.2": [g("EMEA", 7, 94), g("AMER", 4, 102)], // EMEA {9,10,11,13,15,17,19}
      "2.3": [g("EMEA", 4, 57), g("AMER", 3, 78)], // EMEA {10,13,15,19}
      "2.4": [g("AMER", 1, 25)],
    }],
    // businessLine: odd BL-A, even BL-B, I30 null. 2.0: BL-A odd 1..25 (Σ169) + I29 + I31 = 15 / 200;
    // BL-B even 2..26 (Σ182) + I28 + I32 = 15 / 242. 2.1 drops I28 (no alert): BL-B 14 / 214.
    ["businessLine", {
      "2.0": [g("BL-A", 15, 200), g("BL-B", 15, 242)],
      "2.1": [g("BL-A", 15, 200), g("BL-B", 14, 214)],
      "2.2": [g("BL-A", 8, 130), g("BL-B", 3, 66)], // A {9,11,13,15,17,19,21,25}; B {10,24,32}
      "2.3": [g("BL-A", 5, 93), g("BL-B", 2, 42)], // A {13,15,19,21,25}; B {10,32}
      "2.4": [g("BL-A", 1, 25)],
    }],
    // productLine: I1–15 PL-1, I16–30 PL-2 (I27 null), I31+ PL-3. 2.0 PL-2 {16..26,28,29,30} = 14 / 289.
    ["productLine", {
      "2.0": [g("PL-1", 15, 120), g("PL-2", 14, 289), g("PL-3", 2, 63)],
      "2.1": [g("PL-1", 15, 120), g("PL-2", 12, 231), g("PL-3", 2, 63)],
      "2.2": [g("PL-1", 5, 58), g("PL-2", 5, 106), g("PL-3", 1, 32)], // PL-1 {9,10,11,13,15}; PL-2 {17,19,21,24,25}
      "2.3": [g("PL-1", 3, 38), g("PL-2", 3, 65), g("PL-3", 1, 32)], // PL-1 {10,13,15}; PL-2 {19,21,25}
      "2.4": [g("PL-2", 1, 25)],
    }],
    // plant: n mod 3 = 1 P100, 2 P200, 0 P300; I28 null. 2.0 P100 {1,4,..,25,31} 10 / 148; P200 {2,5,..,29,32}
    // 11 / 158; P300 {3,6,..,24,30} 9 / 138. 2.1 drops I28, I30: P300 8 / 108.
    ["plant", {
      "2.0": [g("P200", 11, 158), g("P100", 10, 148), g("P300", 9, 138)],
      "2.1": [g("P200", 11, 158), g("P100", 10, 148), g("P300", 8, 108)],
      "2.2": [g("P100", 4, 67), g("P300", 4, 69), g("P200", 3, 60)], // P100 {10,13,19,25}; P300 {9,15,21,24}; P200 {11,17,32}
      "2.3": [g("P100", 4, 67), g("P300", 2, 36), g("P200", 1, 32)],
      "2.4": [g("P100", 1, 25)],
    }],
  ])("%s (7 d): every stage grouped", async (dim, groups) => {
    const { raw, deps } = await run(7, dim);
    expect(raw.groups).toEqual(groups);
    expect(methods(deps).filter((m) => m === "countItemsBy")).toHaveLength(5);
    expect(methods(deps).filter((m) => m === "countItems")).toHaveLength(7);
  });

  it("truncated (a countItemsBy returned MAX_GROUPS rows) is decided by derive, not the loader (MOD-02)", async () => {
    const deps = fakeDeps({ config: { MAX_GROUPS: 3 } });
    const { out } = await run(7, "productLine", EMPTY_FILTERS, deps);
    expect(out.caveats).toEqual([]);
    expect(deriveItemFunnel(out.raw, sel(7), deps.config).caveats).toContain("truncated");
  });
});
