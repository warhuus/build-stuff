import { describe, expect, it } from "vitest";
import { okStage } from "../../compute/funnel";
import {
  countsOf,
  funnelBreakdown,
  groupAmounts,
  itemStageCaveats,
  stageCaveatsOf,
  stageLookup,
  stagesFor,
} from "../../compute/funnelGroups";
import type { FunnelContext } from "../../compute/funnelGroups";
import { NOW_ISO, SMALL } from "../helpers/deriveRows";

const ctx: FunnelContext = { section: 2, view: "item", window: 30, unit: "count", generatedAt: NOW_ISO };

describe("funnelGroups helpers", () => {
  it("stagesFor marks non-applicable stages", () => {
    const stages = stagesFor(["2.0", "2.1"], ["2.1"], (id) => okStage(id, { count: 1, valueUsd: 2 }));
    expect(stages.map((s) => [s.id, s.availability, s.count])).toEqual([
      ["2.0", "not-applicable", null],
      ["2.1", "ok", 1],
    ]);
  });

  it("stageLookup, groupAmounts, countsOf", () => {
    expect(stageLookup({ "2.1": 5 }, "2.1")).toBe(5);
    expect(stageLookup({ "2.1": 5 }, null)).toBeUndefined();
    const rows = [{ group: "g", count: 2, valueUsd: 30 }];
    expect(groupAmounts(rows, "g")).toEqual({ count: 2, valueUsd: 30 });
    expect(groupAmounts(rows, "h")).toEqual({ count: 0, valueUsd: 0 });
    expect(groupAmounts(undefined, "g")).toEqual({ count: 0, valueUsd: 0 });
    expect(countsOf(rows)).toEqual([{ group: "g", count: 2 }]);
  });

  it("itemStageCaveats per stage and window", () => {
    expect(itemStageCaveats("2.0", 30)).toEqual(["proxy"]);
    expect(itemStageCaveats("2.1", 7)).toEqual(["build-stamp"]);
    expect(itemStageCaveats("2.1", 14)).toEqual([]);
    expect(itemStageCaveats("2.1", "now")).toEqual(["now-open-only"]);
    expect(itemStageCaveats("2.2", "now")).toEqual(["now-all-time", "now-open-only"]);
    expect(itemStageCaveats("2.3", 30)).toEqual(["not-a-conversion"]);
    expect(itemStageCaveats("2.4", 90)).toEqual(["low-volume"]);
  });

  it("funnelBreakdown: additive other, non-additive overlap, derivation caveats collected", () => {
    const stagesOf = (count: number) => [okStage("2.1", { count, valueUsd: null })];
    const ranking = [
      { group: "a", count: 3 },
      { group: "b", count: 2 },
      { group: "c", count: 1 },
    ];
    const add = funnelBreakdown(
      { dimension: "plant", additive: true, ranking, groupStages: () => stagesOf(1), otherStages: () => stagesOf(9) },
      { ...ctx, unit: "valueUsd" },
      SMALL,
    );
    expect(add.breakdown.groups).toHaveLength(2);
    expect(add.breakdown.other?.stages[0].count).toBe(9);
    expect(add.caveats).toEqual(["value-item-view-only"]);
    const non = funnelBreakdown(
      { dimension: "priority", additive: false, ranking, groupStages: () => stagesOf(1), overlapTotal: 4 },
      ctx,
      SMALL,
    );
    expect(non.breakdown.other).toBeNull();
    expect(non.breakdown.overlapRatio).toBe(6 / 4);
    expect(non.caveats).toEqual([]);
  });

  it("stageCaveatsOf unions stage caveats", () => {
    const series = {
      ...ctx,
      firstStageId: "2.0" as const,
      stages: [
        { ...okStage("2.0", { count: 1, valueUsd: 1 }, ["proxy"]), pctPrev: null, pctFirst: null, trackValue: null },
        { ...okStage("2.3", { count: 1, valueUsd: 1 }, ["not-a-conversion", "proxy"]), pctPrev: null, pctFirst: null, trackValue: null },
      ],
    };
    expect(stageCaveatsOf(series)).toEqual(["proxy", "not-a-conversion"]);
  });
});
