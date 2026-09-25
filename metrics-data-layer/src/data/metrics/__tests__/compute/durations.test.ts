import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import {
  closedInWindow,
  durationResult,
  durationSeries,
  firstViewToClosureHours,
  firstViewToClosurePopulation,
  notWorkedClosed,
  raisedToClosedHours,
  raisedToClosedPopulation,
  raisedToFirstViewHours,
  raisedToFirstViewPopulation,
} from "../../compute/durations";
import type { DurationPlan } from "../../compute/durations";
import { daysAgo, fact, win } from "../helpers/deriveRows";

const binCount = (bins: readonly { binStart: number; count: number }[], start: number): number =>
  bins.find((b) => b.binStart === start)?.count ?? -1;

describe("durationSeries", () => {
  it("clamps negatives, bins, n, median and p90 (Appendix A O7)", () => {
    const { series, clampedNegative } = durationSeries("worked", [-1, 0.5, 1, 3, 3000], METRICS_CONFIG);
    expect(clampedNegative).toBe(1);
    expect(series.n).toBe(5);
    expect(series.label).toBe("Worked");
    expect(series.bins).toHaveLength(12);
    // [0,1): -1→0 and 0.5; [1,2): 1 (edge value belongs to the bin starting there); [2,4): 3; [2160,∞): 3000
    expect(binCount(series.bins, 0)).toBe(2);
    expect(binCount(series.bins, 1)).toBe(1);
    expect(binCount(series.bins, 2)).toBe(1);
    expect(binCount(series.bins, 2160)).toBe(1);
    expect(series.bins[11].binEnd).toBeNull();
    // median target 2.5: bin [1,2) with c_before 2 → 1 + 0.5/1·1 = 1.5
    expect(series.median).toBe(1.5);
    // p90 target 4.5: open-ended last bin → null
    expect(series.p90).toBeNull();
  });

  it("gives nulls for an empty series", () => {
    const { series, clampedNegative } = durationSeries("all", [], METRICS_CONFIG);
    expect(series).toMatchObject({ key: "all", label: "All", n: 0, median: null, p90: null });
    expect(clampedNegative).toBe(0);
  });
});

describe("measures", () => {
  it("4.2 raised → closed", () => {
    expect(raisedToClosedHours(fact("a", { raisedAt: daysAgo(2), closedAt: daysAgo(1) }))).toBeCloseTo(24);
    expect(raisedToClosedHours(fact("a", { raisedAt: null }))).toBe("noRaise");
  });

  it("4.3 raised → first view", () => {
    expect(raisedToFirstViewHours(fact("a", { raisedAt: daysAgo(1), firstViewAt: daysAgo(0.5) }))).toBeCloseTo(12);
    expect(raisedToFirstViewHours(fact("a", { raisedAt: null, firstViewAt: daysAgo(0.5) }))).toBe("noRaise");
  });

  it("4.4 first view → closure: close before view excluded, tie kept, unparsable excluded", () => {
    expect(firstViewToClosureHours(fact("a", { firstViewAt: daysAgo(2), closedAt: daysAgo(1) }))).toBeCloseTo(24);
    expect(firstViewToClosureHours(fact("a", { firstViewAt: daysAgo(1), closedAt: daysAgo(2) }))).toBe("closeBeforeView");
    expect(firstViewToClosureHours(fact("a", { firstViewAt: daysAgo(1), closedAt: daysAgo(1) }))).toBe(0);
    expect(firstViewToClosureHours(fact("a", { firstViewAt: "garbage", closedAt: daysAgo(1) }))).toBe("closeBeforeView");
  });
});

describe("durationResult", () => {
  it("builds every planned series, counts exclusions (0 included) and sums clampedNegative", () => {
    const plan: DurationPlan = {
      seriesKeys: ["worked", "notWorked"],
      exclusions: ["noRaise", "closeBeforeView"],
      measure: raisedToClosedHours,
    };
    const result = durationResult(
      [
        { fact: fact("a", { raisedAt: daysAgo(1), closedAt: daysAgo(2) }), key: "worked" }, // −24 h → clamped
        { fact: fact("b", { raisedAt: null }), key: "worked" },
        { fact: fact("c", { raisedAt: null }), key: "notWorked" },
        { fact: fact("d"), key: "notWorked" },
        { fact: fact("e"), key: "all" }, // not in the plan → ignored
      ],
      plan,
      METRICS_CONFIG,
    );
    expect(result.series.map((s) => [s.key, s.n])).toEqual([
      ["worked", 1],
      ["notWorked", 1],
    ]);
    expect(result.excluded).toEqual([
      { reason: "noRaise", count: 2 },
      { reason: "closeBeforeView", count: 0 },
    ]);
    expect(result.clampedNegative).toBe(1);
  });
});

describe("populations", () => {
  const w7 = win(7);

  it("closedInWindow keeps closed alerts with closedAt in the window", () => {
    const rows = [
      fact("in"),
      fact("open", { isClosed: false }),
      fact("old", { closedAt: daysAgo(10) }),
      fact("none", { closedAt: null }),
    ];
    expect(closedInWindow(rows, w7).map((f) => f.riskAlertId)).toEqual(["in"]);
  });

  it("4.2 not-worked excludes touched ids, any human event, open now and out-of-window alerts (W5)", () => {
    const notWorked = [
      fact("n1", { worked: false }),
      fact("t1", { worked: false }), // in L2 → excluded
      fact("h1", { worked: true }), // human event ever → excluded
      fact("o1", { worked: false, isClosed: false }), // open now → excluded
      fact("x1", { worked: false, closedAt: daysAgo(20) }), // outside window
    ];
    expect(notWorkedClosed(notWorked, [fact("t1")], w7).map((f) => f.riskAlertId)).toEqual(["n1"]);
  });

  it("4.2 population tags worked and not-worked; null not-worked → worked only", () => {
    // worked w1's only human event may precede the window: it is still worked (W4)
    const facts = [fact("w1", { firstViewAt: daysAgo(30) }), fact("w2", { closedAt: daysAgo(9) })];
    const pop = raisedToClosedPopulation(facts, [fact("n1", { worked: false })], w7);
    expect(pop.map((a) => [a.fact.riskAlertId, a.key])).toEqual([
      ["w1", "worked"],
      ["n1", "notWorked"],
    ]);
    expect(raisedToClosedPopulation(facts, null, w7).map((a) => a.key)).toEqual(["worked"]);
  });

  it("4.3 population = first view in window", () => {
    const facts = [fact("v", { firstViewAt: daysAgo(1) }), fact("old", { firstViewAt: daysAgo(8) }), fact("none")];
    expect(raisedToFirstViewPopulation(facts, w7).map((a) => [a.fact.riskAlertId, a.key])).toEqual([["v", "all"]]);
  });

  it("4.4 population = closed in window and viewed", () => {
    const facts = [fact("v", { firstViewAt: daysAgo(3) }), fact("nv"), fact("open", { isClosed: false, firstViewAt: daysAgo(3) })];
    expect(firstViewToClosurePopulation(facts, w7).map((a) => [a.fact.riskAlertId, a.key])).toEqual([["v", "all"]]);
  });
});
