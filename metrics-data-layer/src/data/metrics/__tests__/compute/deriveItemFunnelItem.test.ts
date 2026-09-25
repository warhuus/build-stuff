import { describe, expect, it } from "vitest";
import { deriveItemFunnel } from "../../compute/deriveItemFunnel";
import type { ItemViewRaw } from "../../types";
import { NOW_ISO, SMALL, win } from "../helpers/deriveRows";
import { sel } from "../helpers/testKit";

const cv = (count: number, valueUsd: number) => ({ count, valueUsd });
const raw: ItemViewRaw = {
  window: win(30),
  dimension: null,
  view: "item",
  generatedAt: NOW_ISO,
  stages: { "2.0": cv(100, 10000), "2.1": cv(50, 6000), "2.2": cv(20, 3000), "2.3": cv(10, 1000), "2.4": cv(2, 100) },
  outsidePath: { "2.3": cv(5, 500), "2.4": cv(1, 50) },
  groups: null,
};

describe("deriveItemFunnel item view", () => {
  it("total: count vs value percentages, outside paths, stage caveats", () => {
    const count = deriveItemFunnel(raw, sel());
    const t = count.data.total;
    expect(t).toMatchObject({ section: 2, view: "item", firstStageId: "2.0", window: 30, generatedAt: NOW_ISO });
    expect(t.stages[1]).toMatchObject({ pctPrev: 0.5, pctFirst: 0.5, trackValue: 100 });
    expect(t.stages[3].outsidePath).toEqual({ count: 5, valueUsd: 500, label: "Acted without a view" });
    expect(t.stages[4].outsidePath).toEqual({ count: 1, valueUsd: 50, label: "Written back outside the path" });
    expect(t.stages[0].outsidePath).toBeNull();
    expect(t.stages.map((s) => s.caveats)).toEqual([["proxy"], [], [], ["not-a-conversion"], ["low-volume"]]);
    expect(count.caveats).toEqual(["proxy", "not-a-conversion", "low-volume"]);
    const value = deriveItemFunnel(raw, sel({ unit: "valueUsd" }));
    expect(value.data.total.stages[1]).toMatchObject({ pctPrev: 0.6, pctFirst: 0.6, trackValue: 10000 });
    expect(value.caveats).not.toContain("value-item-view-only");
  });

  it("build-stamp on 2.1 at 7 days; now-open-only / now-all-time under now", () => {
    expect(deriveItemFunnel({ ...raw, window: win(7) }, sel()).data.total.stages[1].caveats).toEqual(["build-stamp"]);
    const now = deriveItemFunnel({ ...raw, window: win("now") }, sel());
    expect(now.data.total.stages[0].caveats).toEqual(["proxy", "now-open-only"]);
    expect(now.data.total.stages[2].caveats).toEqual(["now-all-time", "now-open-only"]);
    expect(now.caveats).toEqual(expect.arrayContaining(["now-all-time", "now-open-only"]));
  });

  it("item-dim breakdown: additive on 2.0–2.4, other = total − shown, truncated", () => {
    const g = (x: number, y: number, z: number) => [
      { group: "X", ...cv(x, x * 100) },
      { group: "Y", ...cv(y, y * 100) },
      { group: "Z", ...cv(z, z * 100) },
    ];
    const groups = { "2.0": g(60, 30, 5), "2.1": g(30, 15, 1), "2.2": g(10, 5, 0), "2.3": g(5, 2, 0), "2.4": g(1, 0, 0) };
    const out = deriveItemFunnel({ ...raw, dimension: "plant", groups }, sel({ unit: "valueUsd" }), SMALL);
    const bd = out.data.breakdown;
    expect(bd?.additive).toBe(true);
    expect(bd?.groups.map((x) => [x.group, x.data.stages.map((s) => s.count)])).toEqual([
      ["X", [60, 30, 10, 5, 1]],
      ["Y", [30, 15, 5, 2, 0]],
    ]);
    expect(bd?.groups[0].data.stages[3].outsidePath).toBeNull();
    // other 2.0: 100 − 90 = 10 items; value 10000 − 9000 = 1000
    expect(bd?.other?.stages[0]).toMatchObject({ count: 10, valueUsd: 1000 });
    expect(bd?.other?.stages[4]).toMatchObject({ count: 1, valueUsd: 0 });
    expect(bd?.overlapRatio).toBeNull();
    expect(out.caveats).toContain("truncated");
    expect(out.caveats).not.toContain("overlap");
  });

  it("alert-dim breakdown: non-additive on 2.1–2.4, chosen on 2.1, breakdown-open-only + overlap", () => {
    const groups = {
      "2.1": [
        { group: "High", ...cv(40, 5000) },
        { group: "Low", ...cv(20, 2000) },
      ],
      "2.2": [{ group: "High", ...cv(15, 2000) }],
    };
    const out = deriveItemFunnel({ ...raw, dimension: "priority", groups }, sel());
    const bd = out.data.breakdown;
    expect(bd?.additive).toBe(false);
    expect(bd?.other).toBeNull();
    expect(bd?.overlapRatio).toBe(60 / 50);
    expect(bd?.groups[0].data.stages.map((s) => [s.availability, s.count])).toEqual([
      ["not-applicable", null],
      ["ok", 40],
      ["ok", 15],
      ["ok", 0],
      ["ok", 0],
    ]);
    expect(bd?.groups[0].data.firstStageId).toBe("2.1");
    expect(out.caveats).toEqual(expect.arrayContaining(["overlap", "breakdown-open-only"]));
    expect(out.caveats).not.toContain("escalated-open-only");
  });

  it("alert dim: zero-count candidates are dropped before top-N (COR-03); truncated only from the 2.1 candidate list", () => {
    const groups = {
      "2.1": [
        { group: "Planner", ...cv(18, 100) },
        { group: "Solo", ...cv(0, 0) },
        { group: "Logistics", ...cv(12, 100) },
      ],
      "2.2": [
        { group: "Planner", ...cv(5, 10) },
        { group: "Logistics", ...cv(4, 10) },
      ],
    };
    const out = deriveItemFunnel({ ...raw, dimension: "routingPersona", groups }, sel(), SMALL);
    expect(out.data.breakdown?.groups.map((g) => g.group)).toEqual(["Planner", "Logistics"]);
    expect(out.data.breakdown?.truncated).toBeNull();
    // the 2.1 list mirrors the candidate call: 3 = MAX_GROUPS (SMALL) → truncated
    expect(out.caveats).toContain("truncated");
    const later = { "2.1": groups["2.1"].slice(0, 1), "2.2": groups["2.2"], "2.3": groups["2.2"], "2.4": groups["2.2"] };
    // 2.2–2.4 lists (ungrouped per-group counts) never set truncated, even with length = MAX_GROUPS = 2
    const noCut = deriveItemFunnel({ ...raw, dimension: "routingPersona", groups: later }, sel(), { ...SMALL, MAX_GROUPS: 2 });
    expect(noCut.caveats).not.toContain("truncated");
  });

  it("escalated adds escalated-open-only; missing grouped rows give no groups", () => {
    const out = deriveItemFunnel({ ...raw, dimension: "escalated" }, sel());
    expect(out.data.breakdown?.groups).toEqual([]);
    expect(out.caveats).toEqual(expect.arrayContaining(["overlap", "breakdown-open-only", "escalated-open-only"]));
  });

  it("a dim outside the item-view registry gives an empty breakdown (loadCard rejects it earlier)", () => {
    const out = deriveItemFunnel({ ...raw, dimension: "actionType", groups: {} }, sel());
    expect(out.data.breakdown?.overlapRatio).toBeNull();
    expect(out.data.breakdown?.groups).toEqual([]);
  });
});
