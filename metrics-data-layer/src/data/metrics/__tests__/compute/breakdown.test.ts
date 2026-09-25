import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import type { MetricsConfig } from "../../../../config/metrics";
import {
  buildBreakdown,
  compareGroupCounts,
  countOfGroup,
  groupCountsOf,
  groupRows,
  isTruncatedByCap,
  rowsOutside,
  sortGroupCounts,
  nonEmptyGroups,
  topGroups,
} from "../../compute/breakdown";
import { remainder } from "../../compute/stats";

const C: MetricsConfig = { ...METRICS_CONFIG, BREAKDOWN_MAX_GROUPS: 3, MAX_GROUPS: 4 };
const g = (group: string, count: number) => ({ group, count });

describe("topGroups / sorting (spec §5 B2)", () => {
  const counts = [g("b", 5), g("a", 5), g("c", 9), g("d", 1), g("e", 2)];
  it("largest first, ties by name ascending", () => {
    expect(topGroups(counts, 3)).toEqual([g("c", 9), g("a", 5), g("b", 5)]);
    expect(sortGroupCounts(counts).map((x) => x.group)).toEqual(["c", "a", "b", "e", "d"]);
  });
  it("max ≤ 0 → none; max above length → all", () => {
    expect(topGroups(counts, 0)).toEqual([]);
    expect(topGroups(counts, -1)).toEqual([]);
    expect(topGroups(counts, 10)).toHaveLength(5);
  });
  it("comparator returns 0 on identical entries", () => {
    expect(compareGroupCounts(g("a", 1), g("a", 1))).toBe(0);
    expect(compareGroupCounts(g("b", 1), g("a", 1))).toBe(1);
  });
});

describe("isTruncatedByCap", () => {
  it("true only when exactly MAX_GROUPS rows came back", () => {
    expect(isTruncatedByCap([1, 2, 3, 4], C)).toBe(true);
    expect(isTruncatedByCap([1, 2, 3], C)).toBe(false);
  });
});

describe("buildBreakdown (Appendix A O1, spec §5 B4–B5)", () => {
  const ranking = [g("x", 10), g("y", 6), g("z", 4), g("w", 2)];
  const totalCount = 25; // 3 rows have a null dimension value

  it("additive: other = total − Σ shown, truncated when cut, no overlapRatio", () => {
    const result = buildBreakdown(
      {
        dimension: "plant",
        additive: true,
        ranking,
        dataOf: (group) => countOfGroup(ranking, group),
        otherOf: (shown) => remainder(totalCount, shown.map((name) => countOfGroup(ranking, name))),
      },
      C,
    );
    expect(result).toEqual({
      dimension: "plant",
      additive: true,
      groups: [
        { group: "x", data: 10 },
        { group: "y", data: 6 },
        { group: "z", data: 4 },
      ],
      other: 5,
      truncated: { shown: 3, total: 4 },
      overlapRatio: null,
    });
  });

  it("additive without a cut: truncated null, other still computed", () => {
    const result = buildBreakdown(
      { dimension: "region", additive: true, ranking: ranking.slice(0, 2), dataOf: () => 0, otherOf: (shown) => shown.length },
      C,
    );
    expect(result.truncated).toBeNull();
    expect(result.other).toBe(2);
  });

  it("non-additive: other null, overlapRatio over ALL groups before truncation", () => {
    const result = buildBreakdown(
      { dimension: "routingPersona", additive: false, ranking, dataOf: (group) => group.toUpperCase(), overlapTotal: 16 },
      C,
    );
    expect(result.other).toBeNull();
    expect(result.groups.map((entry) => entry.data)).toEqual(["X", "Y", "Z"]);
    expect(result.overlapRatio).toBe(22 / 16);
    expect(result.truncated).toEqual({ shown: 3, total: 4 });
  });

  it("non-additive with a zero or null total → overlapRatio null", () => {
    const base = { dimension: "escalated" as const, additive: false as const, ranking, dataOf: () => 0 };
    expect(buildBreakdown({ ...base, overlapTotal: 0 }, C).overlapRatio).toBeNull();
    expect(buildBreakdown({ ...base, overlapTotal: null }, C).overlapRatio).toBeNull();
  });

  it("uses BREAKDOWN_MAX_GROUPS from config (8 by default)", () => {
    const many = Array.from({ length: 10 }, (_, i) => g(`g${i}`, i));
    const result = buildBreakdown({ dimension: "plant", additive: false, ranking: many, dataOf: () => 1, overlapTotal: 45 }, METRICS_CONFIG);
    expect(result.groups).toHaveLength(8);
    expect(result.truncated).toEqual({ shown: 8, total: 10 });
    expect(result.overlapRatio).toBe(1);
  });
});

describe("client-side grouping (4.2–4.6)", () => {
  const rows = [
    { id: 1, k: "a" },
    { id: 2, k: null },
    { id: 3, k: "b" },
    { id: 4, k: "a" },
  ];
  const keyOf = (row: { k: string | null }) => row.k;
  it("groupRows drops null keys and keeps first-appearance order", () => {
    const groups = groupRows(rows, keyOf);
    expect([...groups.keys()]).toEqual(["a", "b"]);
    expect(groups.get("a")?.map((row) => row.id)).toEqual([1, 4]);
  });
  it("groupCountsOf gives sorted counts", () => {
    expect(groupCountsOf(groupRows(rows, keyOf))).toEqual([g("a", 2), g("b", 1)]);
  });
  it("rowsOutside returns null-key rows and rows of groups not shown", () => {
    expect(rowsOutside(rows, keyOf, ["a"]).map((row) => row.id)).toEqual([2, 3]);
    expect(rowsOutside(rows, keyOf, []).map((row) => row.id)).toEqual([1, 2, 3, 4]);
  });
  it("countOfGroup returns 0 for an absent group", () => {
    expect(countOfGroup([g("a", 3)], "a")).toBe(3);
    expect(countOfGroup([g("a", 3)], "b")).toBe(0);
  });
});

describe("nonEmptyGroups (COR-03)", () => {
  it("drops zero-count groups and keeps the order", () => {
    expect(nonEmptyGroups([g("a", 0), g("b", 2), g("c", 0), g("d", 1)])).toEqual([g("b", 2), g("d", 1)]);
  });
});
