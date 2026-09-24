import { describe, expect, it } from "vitest";
import { deriveClosureComposition } from "../../compute/deriveClosureComposition";
import type { ClosureCompositionRaw } from "../../types";
import { SMALL, daysAgo, fact, sel, win } from "./deriveTestUtils";

const raw: ClosureCompositionRaw = {
  window: win(7),
  dimension: null,
  closedTotal: 6,
  closedTotalByGroup: null,
  facts: [
    fact("a1", { closureGroup: "action" }),
    fact("w1", { closureGroup: "writeBack", attrs: { alertType: "B", routingPersona: "P2", priority: "Low" } }),
    fact("old", { closureGroup: "viewOnly", closedAt: daysAgo(30) }), // closed before the window
    fact("open", { isClosed: false, closureGroup: null }),
  ],
};

describe("deriveClosureComposition (4.6)", () => {
  it("total from touched alerts closed in the window; unit does not matter", () => {
    const out = deriveClosureComposition(raw, sel());
    expect(out.data.total.rows.map((r) => [r.group, r.count])).toEqual([
      ["noHuman", 4],
      ["viewOnly", 0],
      ["action", 1],
      ["writeBack", 1],
    ]);
    expect(out.data.breakdown).toBeNull();
    expect(out.caveats).toEqual(["closure-actor-unknown", "precedence"]);
    expect(deriveClosureComposition(raw, sel({ unit: "valueUsd" }))).toEqual(out);
  });

  it("breakdown by alertType; now-all-time under now", () => {
    const out = deriveClosureComposition(
      {
        ...raw,
        window: win("now"),
        dimension: "alertType",
        closedTotalByGroup: [
          { group: "A", count: 4 },
          { group: "B", count: 1 },
        ],
      },
      sel({ window: "now" }),
    );
    // under now "old" is also in: A = a1 action + old viewOnly
    expect(out.data.breakdown?.groups.map((g) => [g.group, g.data.rows.map((r) => r.count)])).toEqual([
      ["A", [2, 1, 1, 0]],
      ["B", [0, 0, 0, 1]],
    ]);
    expect(out.data.breakdown?.other?.closedTotal).toBe(1);
    expect(out.caveats).toEqual(["now-all-time", "closure-actor-unknown", "precedence"]);
  });

  it("truncated on a MAX_GROUPS hit even without a top-N cut; missing grouped rows → no groups", () => {
    const three = [
      { group: "A", count: 1 },
      { group: "B", count: 1 },
      { group: "C", count: 1 },
    ];
    const capped = deriveClosureComposition({ ...raw, dimension: "priority", closedTotalByGroup: three }, sel(), {
      ...SMALL,
      BREAKDOWN_MAX_GROUPS: 8,
    });
    expect(capped.data.breakdown?.truncated).toBeNull();
    expect(capped.caveats).toContain("truncated");
    const none = deriveClosureComposition({ ...raw, dimension: "priority" }, sel());
    expect(none.data.breakdown?.groups).toEqual([]);
    expect(none.data.breakdown?.other?.closedTotal).toBe(6);
  });
});
