import { describe, expect, it } from "vitest";
import { itemsWithEvent } from "../../query/build";
import { itemsOfRisk, riskAll, riskBucket, riskNotDelayed, riskWhere, riskWorked } from "../../query/buildRisk";
import type { ItemFilters, Window } from "../../types";

const NONE: ItemFilters = { businessLine: [], productLine: [], region: [], plant: [] };
const BL: ItemFilters = { ...NONE, businessLine: ["BL-A"] };
const W7: Window = { key: 7, start: "2026-08-25T12:00:00.000Z", end: "2026-09-01T12:00:00.000Z" };

describe("risk sets (spec §9 3.1)", () => {
  it("riskAll: every evaluation, or those of the filtered items", () => {
    expect(riskAll(NONE)).toEqual({ kind: "all" });
    expect(riskAll(BL)).toEqual({ kind: "ofItems", items: { kind: "filtered", base: { kind: "all" }, filters: BL } });
  });

  it("riskWorked = riskAll ∩ evaluations of items with a human event in the window", () => {
    expect(riskWorked(W7, BL)).toEqual({
      kind: "intersect",
      a: riskAll(BL),
      b: { kind: "ofItems", items: itemsWithEvent(["human"], W7) },
    });
  });

  it("where / bucket / notDelayed / itemsOfRisk shapes", () => {
    const all = riskAll(NONE);
    expect(riskWhere(all, { kind: "notDelayed" })).toEqual(riskNotDelayed(all));
    expect(riskBucket(all, "b15_30")).toEqual({ kind: "where", base: all, condition: { kind: "bucket", bucket: "b15_30" } });
    expect(itemsOfRisk(all)).toEqual({ kind: "ofRisk", risk: all });
  });
});
