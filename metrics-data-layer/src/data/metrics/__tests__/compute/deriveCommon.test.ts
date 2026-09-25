import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import { additiveRowBreakdown, caveatsIf, caveatsIfNow, truncationCaveats } from "../../compute/deriveCommon";
import type { BreakdownResult } from "../../types";
import { SMALL } from "../helpers/deriveRows";

const bd = (truncated: BreakdownResult<number>["truncated"]): BreakdownResult<number> => ({
  dimension: "plant",
  additive: true,
  groups: [],
  other: 0,
  truncated,
  overlapRatio: null,
});

describe("deriveCommon", () => {
  it("adds caveats conditionally", () => {
    expect(caveatsIf(true, ["proxy"])).toEqual(["proxy"]);
    expect(caveatsIf(false, ["proxy"])).toEqual([]);
    expect(caveatsIfNow("now", ["now-all-time"])).toEqual(["now-all-time"]);
    expect(caveatsIfNow(7, ["now-all-time"])).toEqual([]);
  });

  it("emits truncated on a top-N cut or a MAX_GROUPS hit only", () => {
    expect(truncationCaveats(null, [], METRICS_CONFIG)).toEqual([]);
    expect(truncationCaveats(bd(null), [null, undefined, [1, 2]], SMALL)).toEqual([]);
    expect(truncationCaveats(bd({ shown: 2, total: 5 }), [], SMALL)).toEqual(["truncated"]);
    expect(truncationCaveats(null, [[1, 2, 3]], SMALL)).toEqual(["truncated"]);
  });

  it("builds an additive row breakdown with other from rows outside the shown groups", () => {
    const rows = [
      { k: "a", v: 1 },
      { k: "a", v: 2 },
      { k: "b", v: 4 },
      { k: "c", v: 8 },
      { k: null, v: 16 },
    ];
    const result = additiveRowBreakdown(rows, "plant", (r) => r.k, (rs) => rs.reduce((t, r) => t + r.v, 0), SMALL);
    // counts a 2, b 1, c 1 → top-2 = a, b (tie b/c by name); other = c + null = 24
    expect(result.groups).toEqual([
      { group: "a", data: 3 },
      { group: "b", data: 4 },
    ]);
    expect(result.other).toBe(24);
    expect(result.truncated).toEqual({ shown: 2, total: 3 });
    expect(result.overlapRatio).toBeNull();
    expect(result.additive).toBe(true);
  });
});
