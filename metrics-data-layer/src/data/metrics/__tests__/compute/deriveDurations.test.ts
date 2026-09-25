import { describe, expect, it } from "vitest";
import {
  deriveFirstViewToClosure,
  deriveRaisedToClosed,
  deriveRaisedToFirstView,
} from "../../compute/deriveDurations";
import type { BreakdownDimension, DurationRaw, WindowKey } from "../../types";
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

  it("item-dim breakdown via the items fetched by id", () => {
    const rows = [fact("a1", { salesOrderId: "s1" }), fact("a2", { salesOrderId: "s2" }), fact("a3", { salesOrderId: null })];
    const dims: BreakdownDimension[] = ["plant"];
    for (const dimension of dims) {
      const out = deriveRaisedToClosed(raw({ facts: rows, dimension, items: [item("s1", { plant: "X" }), item("s2", { plant: "X" })] }), sel());
      expect(out.data.breakdown?.groups.map((g) => [g.group, g.data.series[0].n])).toEqual([["X", 2]]);
      expect(out.data.breakdown?.other?.series[0].n).toBe(1);
      expect(out.caveats).not.toContain("truncated");
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
