import { beforeEach, describe, expect, it } from "vitest";
import { loadRaisedToClosed } from "../../loaders/raisedToClosed";
import { EMPTY_FILTERS } from "../../selection";
import { clearMetricsCache } from "../../shared/cache";
import { fixtureTime as t, itemId } from "../../source/fake/fixtureAlerts";
import type { BreakdownDimension } from "../../types";
import { AMER, fakeDeps, idsOf, win } from "../shared/loaderDeps";
import {
  expectCalls,
  itemsCall,
  L2_NOW_AMER_IDS,
  L2_NOW_AMER_ITEMS,
  L2_NOW_IDS,
  L2_NOW_ITEMS,
  l2Calls,
  notWorkedCalls,
  sel,
} from "./alertCardTestUtils";

const NOW = win("now");
const ALERT_DIMS: readonly BreakdownDimension[] = ["alertType", "routingPersona", "priority"];
const ITEM_DIMS: readonly BreakdownDimension[] = ["businessLine", "productLine", "region", "plant"];

describe("loadRaisedToClosed (spec §9 4.2; D2, D11, D12)", () => {
  beforeEach(() => clearMetricsCache());

  it("7 days: L2('now') facts + not-worked(7), status ok, no item fetch", async () => {
    const deps = fakeDeps();
    const out = await loadRaisedToClosed(sel(7), null, deps);
    // Facts: L2 over "now" (D12), not the 7-day L2: all 46 touched alerts (A43/A45 closed long ago included).
    expect(idsOf(out.raw.facts)).toEqual(L2_NOW_IDS);
    // Not-worked(7): cl with d < 7 and not open now: A35 @2, A36 @5, A40 @6, A42 @4, A44 @6, A46 @3, A49 @1,
    // A50 @2, A55 @4 (A31 cl@6 reopened → out). Touched ones stay; the derive drops L2 ids (D2).
    expect(out.raw.notWorked?.map((r) => r.riskAlertId)).toEqual(
      ["A35", "A36", "A40", "A42", "A44", "A46", "A49", "A50", "A55"],
    );
    // A35 "op@10 cl@2": raisedAt t(10), closedAt t(2), worked false.
    expect(out.raw.notWorked?.[0]).toMatchObject({ raisedAt: t(10), closedAt: t(2), worked: false });
    expect(out.raw).toMatchObject({ window: win(7), dimension: null, items: null });
    expect(out.status).toBe("ok");
    expect(out.caveats).toEqual([]);
    // X2: only L2("now") (3 calls) and the two not-worked fetches.
    expectCalls(deps.source, [...l2Calls(NOW, EMPTY_FILTERS), ...notWorkedCalls(win(7), EMPTY_FILTERS)]);
  });

  it("14 days: not-worked present (14 alerts)", async () => {
    const deps = fakeDeps();
    const out = await loadRaisedToClosed(sel(14), null, deps);
    // 9 of the 7-day set + cl@8..13: A37 @12, A41 @9, A47 @11, A53 @8, A54 @13 → 14.
    expect(out.raw.notWorked?.map((r) => r.riskAlertId)).toEqual(
      ["A35", "A36", "A37", "A40", "A41", "A42", "A44", "A46", "A47", "A49", "A50", "A53", "A54", "A55"],
    );
    expect(out.raw.facts).toHaveLength(46);
    expect(out.status).toBe("ok");
    expectCalls(deps.source, [...l2Calls(NOW, EMPTY_FILTERS), ...notWorkedCalls(win(14), EMPTY_FILTERS)]);
  });

  it.each([30, 90, "now"] as const)("%s: worked side only, partial + not-worked-window-cap", async (key) => {
    const deps = fakeDeps();
    const out = await loadRaisedToClosed(sel(key), null, deps);
    // NOT_WORKED_WINDOW_KEYS = [7, 14] → no not-worked fetch; facts are still the 46 L2("now") alerts.
    expect(out.raw.notWorked).toBeNull();
    expect(out.raw.facts).toHaveLength(46);
    expect(out.raw.window).toEqual(win(key));
    expect(out.status).toBe("partial");
    expect(out.caveats).toEqual(["not-worked-window-cap"]);
    expectCalls(deps.source, l2Calls(NOW, EMPTY_FILTERS));
  });

  it.each(ALERT_DIMS)("alert dim %s: no itemsById (attrs are on the facts)", async (dim) => {
    const deps = fakeDeps();
    const out = await loadRaisedToClosed(sel(7), dim, deps);
    expect(out.raw.dimension).toBe(dim);
    expect(out.raw.items).toBeNull();
    expectCalls(deps.source, [...l2Calls(NOW, EMPTY_FILTERS), ...notWorkedCalls(win(7), EMPTY_FILTERS)]);
  });

  it.each(ITEM_DIMS)("item dim %s at 7 days: items of every fact + not-worked salesOrderId", async (dim) => {
    const deps = fakeDeps();
    const out = await loadRaisedToClosed(sel(7), dim, deps);
    // Fact items: the 32 of L2_NOW_ITEMS. Not-worked(7) items: A35 I31, A36/A46 I32, A40 I36, A42 I38,
    // A44 I40, A49 I10, A50 I11, A55 I14 — all already among them → 32 ids, one call.
    expect(out.raw.items?.map((i) => i.salesOrderId)).toEqual(L2_NOW_ITEMS.map(itemId));
    // I29 (A29): value null, region null (fixtures.ts).
    expect(out.raw.items?.find((i) => i.salesOrderId === itemId(29))).toMatchObject({ valueUsd: null, region: null });
    expect(out.status).toBe("ok");
    expectCalls(deps.source, [
      ...l2Calls(NOW, EMPTY_FILTERS),
      ...notWorkedCalls(win(7), EMPTY_FILTERS),
      itemsCall(L2_NOW_ITEMS),
    ]);
  });

  it("item dim at 14 days adds A41's item I37 (only a not-worked alert sits on it)", async () => {
    const deps = fakeDeps();
    const out = await loadRaisedToClosed(sel(14), "plant", deps);
    // Not-worked(14) adds A37 I33, A41 I37, A47 I33, A53 I36, A54 I13; only I37 is new → 33 ids.
    const expected = [...L2_NOW_ITEMS, 37];
    expect(out.raw.items).toHaveLength(33);
    expectCalls(deps.source, [
      ...l2Calls(NOW, EMPTY_FILTERS),
      ...notWorkedCalls(win(14), EMPTY_FILTERS),
      itemsCall(expected),
    ]);
  });

  it("item dim under 'now': items of the facts only (no not-worked fetch)", async () => {
    const deps = fakeDeps();
    const out = await loadRaisedToClosed(sel("now"), "businessLine", deps);
    expect(out.raw.items).toHaveLength(32);
    expect(out.caveats).toEqual(["not-worked-window-cap"]);
    expectCalls(deps.source, [...l2Calls(NOW, EMPTY_FILTERS), itemsCall(L2_NOW_ITEMS)]);
  });

  it("AMER filter at 7 days with region: filters reach every fetch", async () => {
    const deps = fakeDeps();
    const out = await loadRaisedToClosed(sel(7, AMER), "region", deps);
    // L2("now") AMER: the 18 touched alerts on I21–I40 (not I29).
    expect(idsOf(out.raw.facts)).toEqual(L2_NOW_AMER_IDS);
    // Not-worked(7) AMER: A35 (I31) A36 (I32) A40 (I36) A42 (I38) A44 (I40) A46 (I32); A49 A50 A55 are EMEA.
    expect(out.raw.notWorked?.map((r) => r.riskAlertId)).toEqual(["A35", "A36", "A40", "A42", "A44", "A46"]);
    // Items: 15 fact items; not-worked items I31 I32 I36 I38 I40 already included.
    expect(out.raw.items?.every((i) => i.region === "AMER")).toBe(true);
    expectCalls(deps.source, [
      ...l2Calls(NOW, AMER),
      ...notWorkedCalls(win(7), AMER),
      itemsCall(L2_NOW_AMER_ITEMS),
    ]);
  });

  it("row cap: any capped fetch → partial + row-cap (with not-worked-window-cap at 30)", async () => {
    // ROW_CAP 5: L1("now") has 66 rows → capped.
    const config = { ROW_CAP: 5, PAGE_SIZE: 5 };
    const seven = await loadRaisedToClosed(sel(7), null, fakeDeps({ config }));
    expect(seven.status).toBe("partial");
    expect(seven.caveats).toEqual(["row-cap"]);
    clearMetricsCache();
    const thirty = await loadRaisedToClosed(sel(30), null, fakeDeps({ config }));
    expect(thirty.caveats).toEqual(["not-worked-window-cap", "row-cap"]);
  });
});
