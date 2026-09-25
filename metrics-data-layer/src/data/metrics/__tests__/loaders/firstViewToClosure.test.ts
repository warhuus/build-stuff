import { beforeEach, describe, expect, it } from "vitest";
import { loadFirstViewToClosure } from "../../loaders/firstViewToClosure";
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
  sel,
} from "./alertCardTestUtils";

const NOW = win("now");
const ALERT_DIMS: readonly BreakdownDimension[] = ["alertType", "routingPersona", "priority"];
const ITEM_DIMS: readonly BreakdownDimension[] = ["businessLine", "productLine", "region", "plant"];

describe("loadFirstViewToClosure (spec §9 4.4; D11, D12)", () => {
  beforeEach(() => clearMetricsCache());

  it.each([7, 30, "now"] as const)("%s: L2('now') facts whatever the window; raw window = selection", async (key) => {
    const deps = fakeDeps();
    const out = await loadFirstViewToClosure(sel(key), null, deps);
    // D12: the derive filters closedAt in the selected window; the loader always loads the 46 L2("now") alerts.
    expect(idsOf(out.raw.facts)).toEqual(L2_NOW_IDS);
    expect(out.raw).toMatchObject({ window: win(key), dimension: null, notWorked: null, items: null });
    expect(out.status).toBe("ok");
    expect(out.caveats).toEqual([]);
    expectCalls(deps.source, l2Calls(NOW, EMPTY_FILTERS));
  });

  it("facts carry first view and closure: A44 view at the close stamp, A43 closed 20 days ago", async () => {
    const out = await loadFirstViewToClosure(sel(30), null, fakeDeps());
    // A44 "op@8 vw:u3@6 cl@6": firstViewAt = closedAt = t(6). A43 "op@30 vw:u2@29:09 cl@20".
    expect(out.raw.facts.find((r) => r.riskAlertId === "A44")).toMatchObject({ firstViewAt: t(6), closedAt: t(6) });
    expect(out.raw.facts.find((r) => r.riskAlertId === "A43")).toMatchObject({
      firstViewAt: t(29, 9),
      closedAt: t(20),
      isClosed: true,
    });
  });

  it.each(ALERT_DIMS)("alert dim %s: no itemsById", async (dim) => {
    const deps = fakeDeps();
    const out = await loadFirstViewToClosure(sel(7), dim, deps);
    expect(out.raw).toMatchObject({ dimension: dim, items: null });
    expectCalls(deps.source, l2Calls(NOW, EMPTY_FILTERS));
  });

  it.each(ITEM_DIMS)("item dim %s: items of every L2('now') fact (32)", async (dim) => {
    const deps = fakeDeps();
    const out = await loadFirstViewToClosure(sel(30), dim, deps);
    expect(out.raw.items?.map((i) => i.salesOrderId)).toEqual(L2_NOW_ITEMS.map(itemId));
    expectCalls(deps.source, [...l2Calls(NOW, EMPTY_FILTERS), itemsCall(L2_NOW_ITEMS)]);
  });

  it("AMER at 7 days with businessLine", async () => {
    const deps = fakeDeps();
    const out = await loadFirstViewToClosure(sel(7, AMER), "businessLine", deps);
    expect(idsOf(out.raw.facts)).toEqual(L2_NOW_AMER_IDS);
    expect(out.raw.items).toHaveLength(15);
    expectCalls(deps.source, [...l2Calls(NOW, AMER), itemsCall(L2_NOW_AMER_ITEMS)]);
  });

  it("row cap with an item dim → partial + row-cap", async () => {
    // ROW_CAP 30: L1("now") has 66 rows ≥ 30 → capped.
    const out = await loadFirstViewToClosure(sel(7), "region", fakeDeps({ config: { ROW_CAP: 30, PAGE_SIZE: 10 } }));
    expect(out.status).toBe("partial");
    expect(out.caveats).toEqual(["row-cap"]);
  });
});
