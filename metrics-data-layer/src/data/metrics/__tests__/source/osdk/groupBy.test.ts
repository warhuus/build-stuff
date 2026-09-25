// @vitest-environment node
import { describe, expect, it } from "vitest";
import { aggregateRows, escalatedGroupLabel, finiteOrZero, toGroupCounts } from "../../../source/osdk/groupBy";
import { TEST_CONFIG, makeCtx, setup } from "../../helpers/osdkHarness";

// Unit tests of source/osdk/groupBy.ts (defensive reads S7, F6 escalated labels, spec §9 3.1 byRange). The
// grouped aggregate calls themselves are covered through the adapter in osdkAggregates.test.ts.
describe("groupBy read helpers", () => {
  it("finiteOrZero: finite numbers pass, anything else is 0", () => {
    expect([3, 0, -2.5].map(finiteOrZero)).toEqual([3, 0, -2.5]);
    expect([null, undefined, Number.NaN, Number.POSITIVE_INFINITY].map(finiteOrZero)).toEqual([0, 0, 0, 0]);
  });

  it("aggregateRows: an array passes through, a non-array wire reply reads as empty", () => {
    const rows = [{ a: 1 }];
    expect(aggregateRows(rows)).toBe(rows);
    const notAnArray: readonly { a: number }[] = JSON.parse('{"a":1}');
    expect(aggregateRows(notAnArray)).toEqual([]);
  });

  it("toGroupCounts drops null/undefined groups, stringifies the rest, reads counts defensively", () => {
    const rows = [
      { g: "A", n: 2 },
      { g: null, n: 5 },
      { g: undefined, n: 1 },
      { g: true, n: Number.NaN },
      { g: 7, n: 1 },
    ];
    expect(toGroupCounts(rows, (r) => r.g, (r) => r.n)).toEqual([
      { group: "A", count: 2 },
      { group: "true", count: 0 },
      { group: "7", count: 1 },
    ]);
  });

  it("escalatedGroupLabel: booleans and their strings map to the config labels; null drops (F6)", () => {
    const [t, f] = [TEST_CONFIG.ESCALATED_GROUP_LABELS.true, TEST_CONFIG.ESCALATED_GROUP_LABELS.false];
    expect([true, "true", false, "false"].map((v) => escalatedGroupLabel(v, TEST_CONFIG))).toEqual([t, t, f, f]);
    expect(escalatedGroupLabel(null, TEST_CONFIG)).toBeNull();
    expect(escalatedGroupLabel(undefined, TEST_CONFIG)).toBeNull();
  });

  it("riskByRanges (through the adapter) keeps numeric starts with a positive count only", async () => {
    const t = setup();
    t.handlers.aggregate = () => ({
      data: [
        { group: { otifScore: { startValue: 0, endValue: 31 } }, metrics: [{ name: "count", value: 4 }] },
        { group: { otifScore: { startValue: 31, endValue: 51 } }, metrics: [{ name: "count", value: 0 }] },
        { group: { otifScore: { startValue: "x", endValue: 71 } }, metrics: [{ name: "count", value: 2 }] },
      ],
    });
    const out = await t.source.countRiskByScoreRange({ kind: "all" }, [[0, 31], [31, 51], [51, 71]], makeCtx());
    expect(out).toEqual([{ startValue: 0, count: 4 }]);
  });
});
