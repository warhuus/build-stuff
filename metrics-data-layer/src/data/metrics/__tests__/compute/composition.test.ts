import { describe, expect, it } from "vitest";
import { compositionBreakdown, compositionOf } from "../../compute/composition";
import { SMALL, fact } from "./deriveTestUtils";

const attrs = (alertType: string | null) => ({ alertType, routingPersona: "P", priority: "H" });

describe("compositionOf", () => {
  it("zero-fills 4 rows in CLOSURE_GROUPS order; noHuman = closedTotal − touched groups", () => {
    const touched = [
      fact("w", { closureGroup: "writeBack" }),
      fact("a", { closureGroup: "action" }),
      fact("v", { closureGroup: "viewOnly" }),
      fact("n", { closureGroup: "noHuman" }), // human events only after closure → in the remainder
    ];
    const out = compositionOf(10, touched);
    expect(out.rows).toEqual([
      { group: "noHuman", count: 7 },
      { group: "viewOnly", count: 1 },
      { group: "action", count: 1 },
      { group: "writeBack", count: 1 },
    ]);
    expect(out.closedTotal).toBe(10);
  });

  it("clamps noHuman at 0 (W7)", () => {
    expect(compositionOf(1, [fact("a", { closureGroup: "action" }), fact("b", { closureGroup: "action" })]).rows[0]).toEqual({
      group: "noHuman",
      count: 0,
    });
  });
});

describe("compositionBreakdown", () => {
  it("top-N by closedTotal(g); other = closedTotal − Σ shown with touched outside", () => {
    const byGroup = [
      { group: "A", count: 5 },
      { group: "B", count: 3 },
      { group: "C", count: 1 },
    ];
    const touched = [
      fact("a1", { attrs: attrs("A"), closureGroup: "action" }),
      fact("b1", { attrs: attrs("B"), closureGroup: "writeBack" }),
      fact("c1", { attrs: attrs("C"), closureGroup: "viewOnly" }),
      fact("x1", { attrs: attrs(null), closureGroup: "viewOnly" }),
    ];
    const bd = compositionBreakdown("alertType", 10, byGroup, touched, SMALL);
    expect(bd.groups.map((g) => [g.group, g.data.closedTotal, g.data.rows.map((r) => r.count)])).toEqual([
      ["A", 5, [4, 0, 1, 0]],
      ["B", 3, [2, 0, 0, 1]],
    ]);
    // other: closedTotal 10 − 8 = 2; touched outside: c1, x1 (viewOnly) → noHuman 0
    expect(bd.other).toEqual({
      closedTotal: 2,
      rows: [
        { group: "noHuman", count: 0 },
        { group: "viewOnly", count: 2 },
        { group: "action", count: 0 },
        { group: "writeBack", count: 0 },
      ],
    });
    expect(bd.truncated).toEqual({ shown: 2, total: 3 });
  });
});
