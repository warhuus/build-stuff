import { describe, expect, it } from "vitest";
import { deriveItemFunnel } from "../../compute/deriveItemFunnel";
import { loadItemFunnel } from "../../loaders/itemFunnel";
import { openAlerts } from "../../query/build";
import { itemFunnelSets, stageWithOpenAlertWhere } from "../../query/buildFunnel";
import { DEFAULT_SELECTION, EMPTY_FILTERS } from "../../selection";
import type { BreakdownDimension, ItemFilters, ItemViewRaw, Selection, WindowKey } from "../../types";
import { AMER, fakeDeps, win } from "../shared/loaderDeps";

const sel = (window: WindowKey, filters: ItemFilters = EMPTY_FILTERS): Selection => ({ ...DEFAULT_SELECTION, window, view: "item", filters });
const g = (group: string, count: number, k: number) => ({ group, count, valueUsd: k * 1000 });
type Deps = ReturnType<typeof fakeDeps>;
async function run(window: WindowKey, dim: BreakdownDimension, filters = EMPTY_FILTERS, deps: Deps = fakeDeps()) {
  const out = await loadItemFunnel(sel(window, filters), dim, deps);
  if (out.raw.view !== "item") throw new Error("expected item view");
  const raw: ItemViewRaw = out.raw;
  return { out, raw, deps };
}
const count = (deps: Deps, method: string): number => deps.source.calls.filter((c) => c.method === method).length;

// Alert dims at item grain (spec §9 2.1): candidates = open alerts grouped by the dim; a group on stage X = items of
// X with ≥ 1 open alert of that value. Stage sets from itemFunnelItemView.test.ts:
//  7 d: 2.1 {1..26,29}+{31,32}; 2.2 {9,10,11,13,15,17,19,21,24,25,32}; 2.3 {10,13,15,19,21,25,32}; 2.4 {25}.
//  now: 2.1 {1..26,29}; 2.2 {2,3,6,9..21,24,25,26,29}; 2.3 {2,9..13,15..21,25,26}; 2.4 {9,11,12,16,25,26}.
describe("loadItemFunnel item view: alert dims (spec §9 2.1 perGroup, top-N on 2.1)", () => {
  it("routingPersona (7 d): every candidate on 2.1, top groups on 2.2–2.4, 2.0 absent", async () => {
    const { raw, deps, out } = await run(7, "routingPersona");
    // Open alerts by persona: Planner 21, Logistics 15, CustomerService 12 (48).
    // Planner items {1,2,4,5,6,8,9,12,14,15,16,18,19,20,22,24,25,29} = 18, Σ220;
    // Logistics {2,3,5,7,10,13,16,17,19,20,23,26} = 12, Σ161; CustomerService {1,3,4,6,7,9,11,17,18,21,24} = 11, Σ121.
    // 2.2: Planner {9,15,19,24,25} Σ92; Logistics {10,13,17,19} Σ59; CS {9,11,17,21,24} Σ82.
    // 2.3: Planner {15,19,25} Σ59; Logistics {10,13,19} Σ42; CS {21}.  2.4 ({25}): Planner only.
    expect(raw.groups).toEqual({
      "2.1": [g("Planner", 18, 220), g("Logistics", 12, 161), g("CustomerService", 11, 121)],
      "2.2": [g("Planner", 5, 92), g("Logistics", 4, 59), g("CustomerService", 5, 82)],
      "2.3": [g("Planner", 3, 59), g("Logistics", 3, 42), g("CustomerService", 1, 21)],
      "2.4": [g("Planner", 1, 25), g("Logistics", 0, 0), g("CustomerService", 0, 0)],
    });
    // 7 totals + 3 candidates × 4 stages; one grouped call.
    expect(count(deps, "countItems")).toBe(19);
    expect(count(deps, "countOpenAlertsBy")).toBe(1);
    expect(deps.source.calls.find((c) => c.method === "countOpenAlertsBy")?.args).toEqual([openAlerts(EMPTY_FILTERS), "routingPersona"]);
    const so22 = itemFunnelSets(win(7), EMPTY_FILTERS).so22;
    expect(deps.source.calls.map((c) => c.args[0])).toContainEqual(
      stageWithOpenAlertWhere(so22, EMPTY_FILTERS, { field: "routingPersona", value: "Logistics" }),
    );
    expect(out.caveats).toEqual([]);
  });

  // Open alerts by priority: High 14, Medium 13, Low 11, Urgent 7, Unclassified 3.
  // Items: High {1,2,5,6,9,13,15,16,20,23,24,25,29} = 13, Σ159; Medium {2,3,6,7,10,14,16,17,20,21,25,26} = 12, Σ167;
  // Low {1,3,4,8,9,11,17,18,22,26} = 10, Σ119; Urgent {4,7,12,16,18,19,24} = 7, Σ100; Unclassified {5,19,23} Σ47.
  const priorityNow21 = [g("High", 13, 159), g("Medium", 12, 167), g("Low", 10, 119), g("Urgent", 7, 100), g("Unclassified", 3, 47)];
  it("priority (now): all 5 groups on every stage 2.1–2.4", async () => {
    const { raw } = await run("now", "priority");
    // 2.2 now: High {2,6,9,13,15,16,20,24,25,29} Σ130; Medium {2,3,6,10,14,16,17,20,21,25,26} Σ160;
    //   Low {3,9,11,17,18,26} Σ84; Urgent {12,16,18,19,24} Σ89; Unclassified {19}.
    // 2.3 now: High {2,9,13,15,16,20,25} Σ100; Medium {2,10,16,17,20,21,25,26} Σ137; Low {9,11,17,18,26} Σ81;
    //   Urgent {12,16,18,19} Σ65; Unclassified {19}.
    // 2.4 now: High {9,16,25} Σ50; Medium {16,25,26} Σ67; Low {9,11,26} Σ46; Urgent {12,16} Σ28; Unclassified ∅.
    expect(raw.groups).toEqual({
      "2.1": priorityNow21,
      "2.2": [g("High", 10, 130), g("Medium", 11, 160), g("Low", 6, 84), g("Urgent", 5, 89), g("Unclassified", 1, 19)],
      "2.3": [g("High", 7, 100), g("Medium", 8, 137), g("Low", 5, 81), g("Urgent", 4, 65), g("Unclassified", 1, 19)],
      "2.4": [g("High", 3, 50), g("Medium", 3, 67), g("Low", 3, 46), g("Urgent", 2, 28), g("Unclassified", 0, 0)],
    });
  });

  it("top-N (BREAKDOWN_MAX_GROUPS = 2): only High and Medium are queried on 2.2–2.4", async () => {
    const { raw, deps } = await run("now", "priority", EMPTY_FILTERS, fakeDeps({ config: { BREAKDOWN_MAX_GROUPS: 2 } }));
    expect(raw.groups?.["2.1"]).toEqual(priorityNow21);
    expect(raw.groups?.["2.4"]).toEqual([g("High", 3, 50), g("Medium", 3, 67)]);
    // 7 totals + 5 on 2.1 + 2 × 3.
    expect(count(deps, "countItems")).toBe(18);
  });

  it("escalated (7 d, AMER): boolean conditions from the group labels", async () => {
    const { raw, deps } = await run(7, "escalated", AMER);
    // AMER open alerts A21–A26, A62–A67: true A22 A26 A65 (3), false 9. Items: true {22,24,26} Σ72;
    // false {21..26} Σ141. AMER 2.2 {21,24,25,32}: false {21,24,25} Σ70, true {24}; 2.3 {21,25,32}: false
    // {21,25} Σ46, true ∅; 2.4 {25}: false {25}, true ∅.
    expect(raw.groups).toEqual({
      "2.1": [g("false", 6, 141), g("true", 3, 72)],
      "2.2": [g("false", 3, 70), g("true", 1, 24)],
      "2.3": [g("false", 2, 46), g("true", 0, 0)],
      "2.4": [g("false", 1, 25), g("true", 0, 0)],
    });
    const so21 = itemFunnelSets(win(7), AMER).so21;
    expect(deps.source.calls.map((c) => c.args[0])).toContainEqual(stageWithOpenAlertWhere(so21, AMER, { field: "escalated", value: true }));
    expect(deps.source.calls.find((c) => c.method === "countOpenAlertsBy")?.args).toEqual([openAlerts(AMER), "escalated"]);
  });

  it("truncated when the candidate call returns MAX_GROUPS rows", async () => {
    const { out } = await run(7, "routingPersona", EMPTY_FILTERS, fakeDeps({ config: { MAX_GROUPS: 3 } }));
    expect(out.caveats).toEqual(["truncated"]);
    expect(out.status).toBe("ok");
  });

  it("end to end with deriveItemFunnel: 2.1 total and breakdown groups", async () => {
    const { out } = await run(7, "routingPersona");
    const data = deriveItemFunnel(out.raw, sel(7)).data;
    expect(data.total.stages.map((s) => s.count)).toEqual([31, 29, 11, 7, 1]);
    expect(data.breakdown?.groups.map((b) => b.group)).toEqual(["Planner", "Logistics", "CustomerService"]);
  });
});
