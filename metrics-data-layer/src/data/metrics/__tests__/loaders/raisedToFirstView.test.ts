import { beforeEach, describe, expect, it } from "vitest";
import { loadRaisedToFirstView } from "../../loaders/raisedToFirstView";
import { EMPTY_FILTERS } from "../../selection";
import { clearMetricsCache } from "../../shared/cache";
import { fixtureTime as t, itemId } from "../../source/fake/fixtureAlerts";
import type { BreakdownDimension } from "../../types";
import { AMER, fakeDeps, idsOf, win } from "../shared/loaderDeps";
import { expectCalls, itemsCall, L2_NOW_IDS, L2_NOW_ITEMS, l2Calls, sel } from "./alertCardTestUtils";

const ALERT_DIMS: readonly BreakdownDimension[] = ["alertType", "routingPersona", "priority"];
const ITEM_DIMS: readonly BreakdownDimension[] = ["businessLine", "productLine", "region", "plant"];

/** L2(7): the 18 alerts with a human event since 08-25 12:00 (phase2-D2 hand-check). */
const L2_7_IDS = [
  "A09", "A11", "A13", "A15", "A18", "A19", "A21", "A25", "A32", "A44", "A46", "A49", "A53", "A54", "A58", "A62",
  "A65", "A70",
];
/**
 * Their items: A09 I9, A11 I11, A13/A54 I13, A15 I15, A18 I18, A19 I19, A21/A62 I21, A25 I25, A32 I2,
 * A44 I40, A46 I32, A49 I10, A53 I36, A58 I17, A65 I24, A70 I7 → 16 distinct.
 */
// 4.3 population at 7 d (raisedToFirstViewPopulation: first view, all-time, in the window; L5): of the 18 L2(7)
// alerts A09 I9, A13 I13, A15 I15, A19 I19, A25 I25, A44 I40, A46 I32, A49 I10, A53 I36, A58 I17, A62 I21,
// A65 I24 (12). Out: A11 (first view @18), A18 (@48), A32 (@120), A21 A54 A70 (never viewed). Items: 12.
const POP_7_ITEMS = [9, 10, 13, 15, 17, 19, 21, 24, 25, 32, 36, 40];

describe("loadRaisedToFirstView (spec §9 4.3; D11, D12)", () => {
  beforeEach(() => clearMetricsCache());

  it("7 days: L2 over the SELECTED window, no not-worked, no items", async () => {
    const deps = fakeDeps();
    const out = await loadRaisedToFirstView(sel(7), null, deps);
    expect(idsOf(out.raw.facts)).toEqual(L2_7_IDS);
    // W4: A18 "op@50 vw:u1@48:09 ac:u5@3:09" is in L2(7) via the action; its first view is all-time t(48, 9).
    expect(out.raw.facts.find((r) => r.riskAlertId === "A18")).toMatchObject({ raisedAt: t(50), firstViewAt: t(48, 9) });
    expect(out.raw).toMatchObject({ window: win(7), dimension: null, notWorked: null, items: null });
    expect(out.status).toBe("ok");
    expect(out.caveats).toEqual([]);
    expectCalls(deps.source, l2Calls(win(7), EMPTY_FILTERS));
  });

  it("30 days: 34 touched alerts", async () => {
    const deps = fakeDeps();
    const out = await loadRaisedToFirstView(sel(30), null, deps);
    // Human token with d ≤ 29: A09 A10 A11 A13 A15–A19 A21 A22 A25–A29 A32 A42 A43 (vw@29:09 is after the
    // 08-02 12:00 start) A44 A46 A47 A49–A51 A53–A55 A58 A60 A62 A65 A69 A70 = 34. Out: A12 @35, A14 @92,
    // A20 @65, A23 @33, A30 @59, A33 @200, A45 @69, A48 @44, A52 @58, A56 @130, A63 @43, A67 @87.
    expect(out.raw.facts).toHaveLength(34);
    expect(idsOf(out.raw.facts)).not.toContain("A23");
    expect(idsOf(out.raw.facts)).toContain("A43");
    expectCalls(deps.source, l2Calls(win(30), EMPTY_FILTERS));
  });

  it("'now': all 46 touched alerts", async () => {
    const deps = fakeDeps();
    const out = await loadRaisedToFirstView(sel("now"), null, deps);
    expect(idsOf(out.raw.facts)).toEqual(L2_NOW_IDS);
    expect(out.status).toBe("ok");
    expectCalls(deps.source, l2Calls(win("now"), EMPTY_FILTERS));
  });

  it.each(ALERT_DIMS)("alert dim %s: no itemsById", async (dim) => {
    const deps = fakeDeps();
    const out = await loadRaisedToFirstView(sel(7), dim, deps);
    expect(out.raw).toMatchObject({ dimension: dim, items: null });
    expectCalls(deps.source, l2Calls(win(7), EMPTY_FILTERS));
  });

  it.each(ITEM_DIMS)("item dim %s at 7 days: items of the 4.3 population only (L5)", async (dim) => {
    const deps = fakeDeps();
    const out = await loadRaisedToFirstView(sel(7), dim, deps);
    expect(out.raw.items?.map((i) => i.salesOrderId)).toEqual(POP_7_ITEMS.map(itemId));
    expectCalls(deps.source, [...l2Calls(win(7), EMPTY_FILTERS), itemsCall(POP_7_ITEMS)]);
  });

  it("item dim at 30 days and 'now'", async () => {
    const deps = fakeDeps();
    const thirty = await loadRaisedToFirstView(sel(30), "productLine", deps);
    // 30 d population (24 alerts, phase3-correctness): A09 I9, A10 I10, A11 I11, A13 I13, A15 I15, A16 I16,
    // A17 I17, A19 I19, A25 I25, A26 I26, A29 I29, A42 I38, A43 (vw@29) I39, A44 I40, A46 I32, A49 I10, A50 I11,
    // A53 I36, A55 I14, A58 I17, A60 I19, A62 I21, A65 I24, A69 I6 → 20 distinct items.
    const items30 = [6, 9, 10, 11, 13, 14, 15, 16, 17, 19, 21, 24, 25, 26, 29, 32, 36, 38, 39, 40];
    expect(thirty.raw.items).toHaveLength(20);
    const now = await loadRaisedToFirstView(sel("now"), "productLine", deps);
    // now: the 46 L2("now") alerts minus the 9 never viewed (A21 A22 A23 A27 A47 A51 A54 A63 A70) = 37; their
    // items = the 32 L2 items minus I7 (A70 only), I22 (A22, A63), I23 (A23), I33 (A47) = 28.
    const itemsNow = L2_NOW_ITEMS.filter((n) => ![7, 22, 23, 33].includes(n));
    expect(now.raw.items).toHaveLength(28);
    expectCalls(deps.source, [
      ...l2Calls(win(30), EMPTY_FILTERS),
      itemsCall(items30),
      ...l2Calls(win("now"), EMPTY_FILTERS),
      itemsCall(itemsNow),
    ]);
  });

  it("AMER at 7 days with plant", async () => {
    const deps = fakeDeps();
    const out = await loadRaisedToFirstView(sel(7, AMER), "plant", deps);
    // L2(7) AMER: A21 A25 A44 A46 A53 A62 A65 (phase2-D2). Items: I21 (A21, A62), I25, I40, I32, I36, I24.
    expect(idsOf(out.raw.facts)).toEqual(["A21", "A25", "A44", "A46", "A53", "A62", "A65"]);
    expectCalls(deps.source, [...l2Calls(win(7), AMER), itemsCall([21, 24, 25, 32, 36, 40])]);
  });

  it("row cap → partial + row-cap", async () => {
    // L1(7) has 24 rows ≥ ROW_CAP 5.
    const out = await loadRaisedToFirstView(sel(7), null, fakeDeps({ config: { ROW_CAP: 5, PAGE_SIZE: 5 } }));
    expect(out.status).toBe("partial");
    expect(out.caveats).toEqual(["row-cap"]);
  });
});
