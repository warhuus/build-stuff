// Closure composition (4.6): four groups, noHuman by subtraction, one breakdown.
import { describe, expect, it } from "vitest";
import { compositionOf } from "../../compute/composition";
import { deriveClosureComposition } from "../../compute/deriveClosureComposition";
import type { ClosureCompositionRaw } from "../../types";
import { daysAgo, fact, win } from "../helpers/deriveRows";
import { sel } from "../helpers/testKit";

const B = { alertType: "B", routingPersona: "P2", priority: "Low" };

describe("compositionOf", () => {
  it.each([
    // touched: one per group; the noHuman one (human events only after closure) stays in the remainder
    ["noHuman = closedTotal − touched groups", 10, ["writeBack", "action", "viewOnly", "noHuman"], [7, 1, 1, 1]],
    ["noHuman clamped at 0 (W7)", 1, ["action", "action"], [0, 0, 2, 0]],
  ] as const)("%s", (_, closedTotal, groups, counts) => {
    const out = compositionOf(closedTotal, groups.map((g, i) => fact(`a${i}`, { closureGroup: g })));
    expect(out.rows).toEqual([
      { group: "noHuman", count: counts[0] },
      { group: "viewOnly", count: counts[1] },
      { group: "action", count: counts[2] },
      { group: "writeBack", count: counts[3] },
    ]);
  });
});

describe("deriveClosureComposition (4.6)", () => {
  const raw: ClosureCompositionRaw = {
    window: win(7),
    dimension: null,
    closedTotal: 6,
    closedTotalByGroup: null,
    facts: [
      fact("a1", { closureGroup: "action" }),
      fact("w1", { closureGroup: "writeBack", attrs: B }),
      fact("old", { closureGroup: "viewOnly", closedAt: daysAgo(30) }), // closed before the window
      fact("open", { isClosed: false, closureGroup: null }),
    ],
  };

  it("only touched alerts closed in the window; groups sum to closedTotal", () => {
    const rows = deriveClosureComposition(raw, sel()).data.total.rows;
    expect(rows.map((r) => [r.group, r.count])).toEqual([["noHuman", 4], ["viewOnly", 0], ["action", 1], ["writeBack", 1]]);
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(6);
  });

  it("breakdown by alertType: groups from closedTotalByGroup, other = closedTotal − Σ shown", () => {
    const out = deriveClosureComposition(
      { ...raw, window: win("now"), dimension: "alertType", closedTotalByGroup: [{ group: "A", count: 4 }, { group: "B", count: 1 }] },
      sel({ window: "now" }),
    );
    // under now "old" is in too: A = a1 action + old viewOnly → noHuman 4 − 2 = 2; B = w1 writeBack
    expect(out.data.breakdown?.groups.map((g) => [g.group, g.data.rows.map((r) => r.count)])).toEqual([
      ["A", [2, 1, 1, 0]],
      ["B", [0, 0, 0, 1]],
    ]);
    expect(out.data.breakdown?.other?.closedTotal).toBe(1); // 6 − (4 + 1)
  });
});
