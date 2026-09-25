// Shared breakdown maths (spec §5 B2–B5, O1): top-N order, additive other, overlapRatio before truncation.
import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import { buildBreakdown, countOfGroup, topGroups } from "../../compute/breakdown";

const C = { ...METRICS_CONFIG, BREAKDOWN_MAX_GROUPS: 3, MAX_GROUPS: 4 };
const g = (group: string, count: number) => ({ group, count });
const ranking = [g("x", 10), g("y", 6), g("z", 4), g("w", 2)];

describe("buildBreakdown", () => {
  it("top-N: count descending, ties by name ascending", () => {
    expect(topGroups([g("b", 5), g("a", 5), g("c", 9), g("d", 1)], 3)).toEqual([g("c", 9), g("a", 5), g("b", 5)]);
  });

  it.each([
    // total 25 (3 rows with a null value): other = 25 − (10 + 6 + 4) = 5
    ["additive", { additive: true as const, otherOf: (shown: readonly string[]) => 25 - shown.reduce((s, n) => s + countOfGroup(ranking, n), 0) }, 5, null],
    // (10 + 6 + 4 + 2) / 16 over all four groups, not only the three shown
    ["non-additive", { additive: false as const, overlapTotal: 16 }, null, 22 / 16],
  ])("%s: other, overlapRatio, truncated {shown, total}", (_, spec, other, overlapRatio) => {
    const result = buildBreakdown({ dimension: "plant", ranking, dataOf: (group) => countOfGroup(ranking, group), ...spec }, C);
    expect(result.groups.map((entry) => [entry.group, entry.data])).toEqual([["x", 10], ["y", 6], ["z", 4]]);
    expect(result).toMatchObject({ other, overlapRatio, truncated: { shown: 3, total: 4 } });
  });
});
