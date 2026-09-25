import { describe, expect, it } from "vitest";
import {
  deriveFirstViewToClosure,
  deriveRaisedToClosed,
  deriveRaisedToFirstView,
} from "../../compute/deriveDurations";
import { allowedBreakdowns, isItemDim } from "../../breakdowns";
import type { DurationRaw, WindowKey } from "../../types";
import { SMALL, daysAgo, fact, item, win } from "../helpers/deriveRows";
import { sel } from "../helpers/testKit";

const raw = (overrides: Partial<DurationRaw> = {}, key: WindowKey = 7): DurationRaw => ({
  window: win(key),
  dimension: null,
  facts: [],
  notWorked: null,
  items: null,
  ...overrides,
});

const attrs = (alertType: string | null) => ({ alertType, routingPersona: "P", priority: "H" });

describe("deriveRaisedToClosed (4.2)", () => {
  const facts = [
    fact("w1", { raisedAt: daysAgo(2), closedAt: daysAgo(1) }), // 24 h
    fact("w2", { raisedAt: null }), // noRaise
    fact("w3", { closedAt: daysAgo(20) }), // closed outside the 7-day window
  ];
  const notWorked = [fact("n1", { worked: false, raisedAt: daysAgo(3), closedAt: daysAgo(1) }), fact("w1", { worked: false })];

  it("worked + notWorked at 7 days; unit does not change the output", () => {
    const r = raw({ facts, notWorked });
    const out = deriveRaisedToClosed(r, sel({ unit: "count" }));
    expect(deriveRaisedToClosed(r, sel({ unit: "valueUsd" }))).toEqual(out);
    const total = out.data.total;
    // worked: w1 (24 h) measured, w2 noRaise; notWorked: n1 (48 h); the not-worked w1 is in L2 → excluded
    expect(total.series.map((s) => [s.key, s.n])).toEqual([
      ["worked", 1],
      ["notWorked", 1],
    ]);
    expect(total.series[0].median).toBe(24 + 0.5 * 24); // [24,48) bin, target 0.5 of 1
    expect(total.excluded).toEqual([{ reason: "noRaise", count: 1 }]);
    expect(total.clampedNegative).toBe(0);
    expect(out.data.breakdown).toBeNull();
    expect(out.caveats).toEqual(["build-stamp", "opened-events-since-pipeline-start"]);
  });

  it("30 days / now: worked series only; now-all-time under now", () => {
    expect(deriveRaisedToClosed(raw({ facts }, 30), sel()).data.total.series.map((s) => s.key)).toEqual(["worked"]);
    const now = deriveRaisedToClosed(raw({ facts }, "now"), sel({ window: "now" }));
    // under now w3 is also closed in the window
    expect(now.data.total.series[0].n).toBe(2);
    expect(now.caveats).toContain("now-all-time");
  });

  it("alert-dim breakdown: top-N by alert count over the whole population, other from the rest", () => {
    const rows = [
      fact("a1", { attrs: attrs("A") }),
      fact("a2", { attrs: attrs("A") }),
      fact("b1", { attrs: attrs("B") }),
      fact("c1", { attrs: attrs("C") }),
      fact("x1", { attrs: attrs(null) }),
    ];
    const out = deriveRaisedToClosed(
      raw({ facts: rows, notWorked: [fact("n1", { worked: false, attrs: attrs("C") })], dimension: "alertType" }),
      sel(),
      SMALL,
    );
    const bd = out.data.breakdown;
    // counts over worked + notWorked: A 2, C 2, B 1 → shown A, C; other = B + null = 2 worked alerts
    expect(bd?.groups.map((g) => [g.group, g.data.series.map((s) => s.n)])).toEqual([
      ["A", [2, 0]],
      ["C", [1, 1]],
    ]);
    expect(bd?.other?.series.map((s) => s.n)).toEqual([2, 0]);
    expect(bd?.additive).toBe(true);
    expect(bd?.truncated).toEqual({ shown: 2, total: 3 });
    expect(out.caveats).toContain("truncated");
  });

  it("every registry dim of 4.2–4.4 groups the population (TST-10: allowedBreakdowns, attrs and items)", () => {
    // Values per dim: a1 → V1 (1 alert), a2 + a3 → V2 (2 alerts), a4 → null attrs and no item → other.
    const V1 = { alertType: "A", routingPersona: "P1", priority: "High", businessLine: "BL1", productLine: "PL1", region: "R1", plant: "P01" };
    const V2 = { alertType: "B", routingPersona: "P2", priority: "Low", businessLine: "BL2", productLine: "PL2", region: "R2", plant: "P02" };
    const at = (v: typeof V1) => ({ alertType: v.alertType, routingPersona: v.routingPersona, priority: v.priority });
    const seen = { firstViewAt: daysAgo(1.5) };
    const facts = [
      fact("a1", { ...seen, salesOrderId: "s1", attrs: at(V1) }),
      fact("a2", { ...seen, salesOrderId: "s2", attrs: at(V2) }),
      fact("a3", { ...seen, salesOrderId: "s2", attrs: at(V2) }),
      fact("a4", { ...seen, salesOrderId: null, attrs: { alertType: null, routingPersona: null, priority: null } }),
    ];
    const items = [item("s1", V1), item("s2", V2)];
    const derives = [
      ["raisedToClosed", deriveRaisedToClosed],
      ["raisedToFirstView", deriveRaisedToFirstView],
      ["firstViewToClosure", deriveFirstViewToClosure],
    ] as const;
    for (const [card, derive] of derives) {
      const dims = allowedBreakdowns(card, "item");
      expect(dims).toHaveLength(7);
      for (const dimension of dims) {
        if (!(dimension in V1)) throw new Error(`unexpected dim ${dimension}`);
        const key = dimension as keyof typeof V1;
        const out = derive(raw({ facts, dimension, items: isItemDim(dimension) ? items : null }), sel());
        expect(out.data.breakdown?.groups.map((g) => [g.group, g.data.series[0].n]), `${card} ${dimension}`).toEqual([
          [V2[key], 2],
          [V1[key], 1],
        ]);
        expect(out.data.breakdown?.other?.series[0].n, `${card} ${dimension}`).toBe(1);
        expect(out.data.breakdown).toMatchObject({ additive: true, truncated: null, overlapRatio: null });
      }
    }
  });
});

describe("deriveRaisedToFirstView (4.3)", () => {
  it("population by first view in window, one series, caveats", () => {
    const facts = [
      fact("v1", { raisedAt: daysAgo(1), firstViewAt: daysAgo(0.5) }),
      fact("v2", { raisedAt: null, firstViewAt: daysAgo(0.5) }),
      fact("v3", { firstViewAt: daysAgo(10) }),
    ];
    const out = deriveRaisedToFirstView(raw({ facts }), sel({ unit: "valueUsd" }));
    expect(out.data.total.series.map((s) => [s.key, s.n])).toEqual([["all", 1]]);
    expect(out.data.total.excluded).toEqual([{ reason: "noRaise", count: 1 }]);
    expect(out.caveats).toEqual(["build-stamp", "censored-unviewed", "opened-events-since-pipeline-start"]);
    expect(deriveRaisedToFirstView(raw({ facts }), sel({ unit: "count" }))).toEqual(out);
  });

  it("breakdown by priority", () => {
    const facts = [fact("v1", { firstViewAt: daysAgo(1) })];
    const out = deriveRaisedToFirstView(raw({ facts, dimension: "priority" }, "now"), sel());
    expect(out.data.breakdown?.groups.map((g) => g.group)).toEqual(["High"]);
    expect(out.caveats).toContain("now-all-time");
  });
});

describe("deriveFirstViewToClosure (4.4)", () => {
  it("excludes close-before-view with its count; keeps ties", () => {
    const facts = [
      fact("k1", { firstViewAt: daysAgo(2), closedAt: daysAgo(1) }),
      fact("tie", { firstViewAt: daysAgo(1), closedAt: daysAgo(1) }),
      fact("cbv", { firstViewAt: daysAgo(0.5), closedAt: daysAgo(1) }),
      fact("nv", { firstViewAt: null }),
    ];
    const out = deriveFirstViewToClosure(raw({ facts, dimension: "routingPersona" }), sel());
    expect(out.data.total.series[0].n).toBe(2);
    expect(out.data.total.excluded).toEqual([{ reason: "closeBeforeView", count: 1 }]);
    expect(out.caveats).toEqual(["build-stamp", "excludes-close-before-view"]);
    expect(out.data.breakdown?.groups[0].data.excluded).toEqual([{ reason: "closeBeforeView", count: 1 }]);
    expect(deriveFirstViewToClosure(raw({ facts, dimension: "routingPersona" }), sel({ unit: "valueUsd" }))).toEqual(out);
  });
});
