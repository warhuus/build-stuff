import { beforeEach, describe, expect, it } from "vitest";
import { deriveClosureComposition } from "../../compute/deriveClosureComposition";
import { loadClosureComposition } from "../../loaders/closureComposition";
import { closedNotOpenNow } from "../../query/build";
import type { EventGroupField } from "../../query/specs";
import { EMPTY_FILTERS } from "../../selection";
import { clearMetricsCache } from "../../shared/cache";
import type { FakeCall } from "../../source/fake/fakeSource";
import type { GroupCount, ItemFilters, Window } from "../../types";
import { AMER, fakeDeps, idsOf, win } from "../shared/loaderDeps";
import { expectCalls, L2_NOW_AMER_IDS, L2_NOW_IDS, l2Calls, sel } from "./alertCardTestUtils";

const NOW = win("now");
const totalCall = (w: Window, f: ItemFilters): FakeCall => ({
  method: "countEvents",
  args: [closedNotOpenNow(w, f), "alert"],
});
const groupCall = (w: Window, f: ItemFilters, g: EventGroupField): FakeCall => ({
  method: "countEventsBy",
  args: [closedNotOpenNow(w, f), "alert", g],
});
const byGroup = (rows: readonly GroupCount[] | null): GroupCount[] =>
  [...(rows ?? [])].sort((a, b) => (a.group < b.group ? -1 : 1));

// Closed and not open now (closed-event attrs; A55 closes as Logistics / Medium):
//  7 d: A35 P/LateGI/High, A36 Lg/CreditBlock/Medium, A40 CS/CreditBlock/High, A42 P/LateGI/High,
//       A44 CS/Allocation/Low, A46 Lg/LateGI/High, A49 Lg/LateGI/Low, A50 P/LateGI/High, A55 Lg/LateGI/Medium
//       (A31 cl@6 is open again → out) = 9.
// 30 d: + A37 @12 CS/Allocation/Low, A38 @25 P/LateGI/Urgent, A41 @9 P/Allocation/Medium, A43 @20
//       Lg/CreditBlock/Medium, A47 @11 P/CreditBlock/Urgent, A51 @15 Lg/Allocation/Medium, A53 @8 P/LateGI/Medium,
//       A54 @13 Lg/CreditBlock/High = 17.
// now: + A39 @60 Lg/LateGI/Unclassified, A45 @50 P/LateGI/Low, A48 @32 CS/Allocation/Medium,
//       A52 @55 CS/CreditBlock/Low, A56 @100 CS/LateGI/Medium = 22.
describe("loadClosureComposition (spec §9 4.6; D11, D12)", () => {
  beforeEach(() => clearMetricsCache());

  it.each([
    [7, 9],
    [30, 17],
    ["now", 22],
  ] as const)("%s: closedTotal %i, facts = L2('now'), no grouped call", async (key, total) => {
    const deps = fakeDeps();
    const out = await loadClosureComposition(sel(key), null, deps);
    expect(out.raw.closedTotal).toBe(total);
    expect(out.raw.closedTotalByGroup).toBeNull();
    expect(idsOf(out.raw.facts)).toEqual(L2_NOW_IDS);
    expect(out.raw).toMatchObject({ window: win(key), dimension: null });
    expect(out.status).toBe("ok");
    expect(out.caveats).toEqual([]);
    expectCalls(deps.source, [totalCall(win(key), EMPTY_FILTERS), ...l2Calls(NOW, EMPTY_FILTERS)]);
  });

  it("alertType at 7 / 30 / now", async () => {
    const deps = fakeDeps();
    // 7: LateGI A35 A42 A46 A49 A50 A55 = 6, CreditBlock A36 A40 = 2, Allocation A44 = 1.
    const seven = await loadClosureComposition(sel(7), "alertType", deps);
    expect(byGroup(seven.raw.closedTotalByGroup)).toEqual([
      { group: "Allocation", count: 1 }, { group: "CreditBlock", count: 2 }, { group: "LateGI", count: 6 },
    ]);
    // 30: LateGI + A38 A53 = 8, CreditBlock + A43 A47 A54 = 5, Allocation + A37 A41 A51 = 4.
    const thirty = await loadClosureComposition(sel(30), "alertType", deps);
    expect(byGroup(thirty.raw.closedTotalByGroup)).toEqual([
      { group: "Allocation", count: 4 }, { group: "CreditBlock", count: 5 }, { group: "LateGI", count: 8 },
    ]);
    // now: LateGI + A39 A45 A56 = 11, CreditBlock + A52 = 6, Allocation + A48 = 5.
    const now = await loadClosureComposition(sel("now"), "alertType", deps);
    expect(byGroup(now.raw.closedTotalByGroup)).toEqual([
      { group: "Allocation", count: 5 }, { group: "CreditBlock", count: 6 }, { group: "LateGI", count: 11 },
    ]);
    expect(now.caveats).toEqual([]);
    expectCalls(deps.source, [
      totalCall(win(7), EMPTY_FILTERS), groupCall(win(7), EMPTY_FILTERS, "alertType"),
      totalCall(win(30), EMPTY_FILTERS), groupCall(win(30), EMPTY_FILTERS, "alertType"),
      totalCall(NOW, EMPTY_FILTERS), groupCall(NOW, EMPTY_FILTERS, "alertType"),
      ...l2Calls(NOW, EMPTY_FILTERS), // L2("now") memoised: fetched once for the three loads
    ]);
  });

  it("routingPersona uses the closed event's persona (A55 → Logistics)", async () => {
    const deps = fakeDeps();
    // 7: Planner A35 A42 A50 = 3, Logistics A36 A46 A49 A55 = 4, CustomerService A40 A44 = 2.
    const seven = await loadClosureComposition(sel(7), "routingPersona", deps);
    expect(byGroup(seven.raw.closedTotalByGroup)).toEqual([
      { group: "CustomerService", count: 2 }, { group: "Logistics", count: 4 }, { group: "Planner", count: 3 },
    ]);
    // 30: Planner + A38 A41 A47 A53 = 7, Logistics + A43 A51 A54 = 7, CustomerService + A37 = 3.
    const thirty = await loadClosureComposition(sel(30), "routingPersona", deps);
    expect(byGroup(thirty.raw.closedTotalByGroup)).toEqual([
      { group: "CustomerService", count: 3 }, { group: "Logistics", count: 7 }, { group: "Planner", count: 7 },
    ]);
    expect(deps.source.calls).toContainEqual(groupCall(win(30), EMPTY_FILTERS, "routingPersona"));
  });

  it("priority uses priorityAtEvent of the closed event (A55 → Medium)", async () => {
    const deps = fakeDeps();
    // 7: High A35 A40 A42 A46 A50 = 5, Medium A36 A55 = 2, Low A44 A49 = 2.
    const seven = await loadClosureComposition(sel(7), "priority", deps);
    expect(byGroup(seven.raw.closedTotalByGroup)).toEqual([
      { group: "High", count: 5 }, { group: "Low", count: 2 }, { group: "Medium", count: 2 },
    ]);
    // now: High A35 A40 A42 A46 A50 A54 = 6; Medium A36 A41 A43 A48 A51 A53 A55 A56 = 8; Low A37 A44 A45 A49
    // A52 = 5; Urgent A38 A47 = 2; Unclassified A39 = 1 (Σ 22).
    const now = await loadClosureComposition(sel("now"), "priority", deps);
    expect(byGroup(now.raw.closedTotalByGroup)).toEqual([
      { group: "High", count: 6 }, { group: "Low", count: 5 }, { group: "Medium", count: 8 },
      { group: "Unclassified", count: 1 }, { group: "Urgent", count: 2 },
    ]);
  });

  it("AMER filter: closed alerts on AMER items; facts = the 18 AMER L2('now') alerts", async () => {
    const deps = fakeDeps();
    // 7 d AMER: A35 (I31) A36 (I32) A40 (I36) A42 (I38) A44 (I40) A46 (I32) = 6; A49 A50 A55 are EMEA.
    const seven = await loadClosureComposition(sel(7, AMER), null, deps);
    expect(seven.raw.closedTotal).toBe(6);
    expect(idsOf(seven.raw.facts)).toEqual(L2_NOW_AMER_IDS);
    // 30 d AMER: 17 minus EMEA A49 A50 A51 A54 A55 = 12.
    const thirty = await loadClosureComposition(sel(30, AMER), null, deps);
    expect(thirty.raw.closedTotal).toBe(12);
    expectCalls(deps.source, [totalCall(win(7), AMER), totalCall(win(30), AMER), ...l2Calls(NOW, AMER)]);
  });

  it("truncated when the grouped call returns MAX_GROUPS rows; row-cap from L2", async () => {
    // MAX_GROUPS 3: routingPersona at 7 has exactly 3 groups → truncated (status stays ok).
    // The loader adds no caveat (MOD-02); derive decides from `closedTotalByGroup`.
    const deps3 = fakeDeps({ config: { MAX_GROUPS: 3 } });
    const out = await loadClosureComposition(sel(7), "routingPersona", deps3);
    expect(out).toMatchObject({ status: "ok", caveats: [] });
    expect(deriveClosureComposition(out.raw, sel(7), deps3.config).caveats).toContain("truncated");
    clearMetricsCache();
    // MAX_GROUPS 4 → 3 groups < 4 → not truncated.
    const deps4 = fakeDeps({ config: { MAX_GROUPS: 4 } });
    const four = await loadClosureComposition(sel(7), "routingPersona", deps4);
    expect(deriveClosureComposition(four.raw, sel(7), deps4.config).caveats).not.toContain("truncated");
    clearMetricsCache();
    // ROW_CAP 5: L1("now") 66 rows → capped.
    const capped = await loadClosureComposition(sel(7), null, fakeDeps({ config: { ROW_CAP: 5, PAGE_SIZE: 5 } }));
    expect(capped).toMatchObject({ status: "partial", caveats: ["row-cap"] });
  });
});
