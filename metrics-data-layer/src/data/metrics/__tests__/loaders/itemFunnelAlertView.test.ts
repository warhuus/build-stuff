import { beforeEach, describe, expect, it } from "vitest";
import { deriveItemFunnel } from "../../compute/deriveItemFunnel";
import { loadItemFunnel } from "../../loaders/itemFunnel";
import { carriedAlertSets } from "../../query/buildFunnel";
import { humanEvents } from "../../query/build";
import { EMPTY_FILTERS } from "../../selection";
import { clearMetricsCache } from "../../shared/cache";
import type { AlertViewRaw, BreakdownDimension, WindowKey } from "../../types";
import { AMER, fakeDeps, idsOf, win } from "../helpers/loaderDeps";
import { sel } from "../helpers/testKit";
import { OPEN_IDS, TOUCHED_IDS, alertIds } from "../helpers/alertCards";

type Deps = ReturnType<typeof fakeDeps>;
async function run(window: WindowKey, dim: BreakdownDimension | null, filters = EMPTY_FILTERS, deps: Deps = fakeDeps()) {
  const out = await loadItemFunnel(sel({ view: "alert", window: window, filters: filters }), dim, deps);
  if (out.raw.view !== "alert") throw new Error("expected alert view");
  const raw: AlertViewRaw = out.raw;
  return { out, raw, deps };
}
const methods = (deps: Deps): string[] => deps.source.calls.map((c) => c.method).sort();
const gc = (group: string, count: number) => ({ group, count });

// 2.1 terms (spec §9 2.1 alert view): a = alerts with op/cl in the window; open = AOF rows (48; AMER 12);
// b-sub = open alerts among a. Lifecycle alerts per window (fixtureAlerts.ts ALERTS; d < N):
//  7 d (27): A01 A05 A06 A08 A09 A13 A15 A19 A21 A24 A25 A30 A31 A57 A58 A59(op@7:12) A68 A70 (open, 18)
//            + A35 A36 A40 A42 A44 A46 A49 A50 A55 (closed, 9).
// 14 d: + A02 A10 A16 A26 A29 A69 (open, 6) + A37 A41 A47 A53 A54 (closed) → 38 / 24.
// 30 d: + A03 A11 A17 A22 A27 A60 A61 (open, 7) + A38 A43 A51 → 48 / 31.
// 90 d: + A04 A12 A18 A20 A23 A28 A62–A67 (open, 12) + A39 A45 A48 A52 → 64 / 43 (missing: A07 A14 A32–A34 A56).
// now: only the open term (lifecycle terms 0, not queried).
// Since COR-01/COR-02 the alert view always loads L2(selected window) facts and L3 open alerts: L2 = L1 (shared)
// + the chain fetchEvents + the touched-open fetchOpenAlerts; L3 alerts = one more fetchOpenAlerts (48 rows).
const L2_L3 = ["fetchEvents", "fetchEvents", "fetchOpenAlerts", "fetchOpenAlerts"];
describe("loadItemFunnel alert view (spec §9 2.1–2.4 alert view, D12)", () => {
  beforeEach(() => clearMetricsCache());

  it.each<[WindowKey, [number, number, number], number]>([
    [7, [27, 48, 18], 24],
    [14, [38, 48, 24], 37],
    [30, [48, 48, 31], 47],
    [90, [64, 48, 43], 62],
    ["now", [0, 48, 0], 66],
  ])("window %s: carried terms, L1 rows, L2 facts and L3 open alerts (COR-01)", async (key, [life, open, owl], l1Rows) => {
    const { out, raw, deps } = await run(key, null);
    expect(raw.carried).toEqual({ lifecycleAlerts: life, openAlerts: open, openWithLifecycleEvent: owl });
    expect(raw).toMatchObject({ view: "alert", window: win(key), dimension: null, generatedAt: "2026-09-01T12:00:00.000Z", carriedGroups: null });
    // L1 rows and alert ids: see TOUCHED_IDS (helpers/alertCards.ts) for the working.
    expect(raw.humanEvents).toHaveLength(l1Rows);
    expect(idsOf(raw.humanEvents)).toEqual(TOUCHED_IDS[key]);
    expect(out).toMatchObject({ status: "ok", caveats: [] });
    const bounded = key !== "now";
    // Bounded: countEvents(a) + 2 countOpenAlerts + L1/L2/L3. now: 1 countOpenAlerts + L1/L2/L3.
    expect(methods(deps)).toEqual(
      bounded ? ["countEvents", "countOpenAlerts", "countOpenAlerts", ...L2_L3] : ["countOpenAlerts", ...L2_L3],
    );
    // L2(w) has one fact per touched (L1) alert; L3 all 48 open alerts.
    expect(raw.facts?.map((f) => f.riskAlertId).sort()).toEqual(TOUCHED_IDS[key]);
    expect(raw.openAlerts?.map((a) => a.riskAlertId)).toEqual(OPEN_IDS);
    expect(deps.source.calls.find((c) => c.method === "fetchEvents")?.args).toEqual([humanEvents(win(key), EMPTY_FILTERS)]);
  });

  it("AMER (7 d): terms, L1 and grouped priority terms by pivot", async () => {
    const { raw, deps } = await run(7, "priority", AMER);
    // AMER alerts with op/cl in 7 d: A21 Medium, A24 Urgent, A25 High (open) + A35 A40 A42 A46 High, A36 Medium,
    // A44 Low (closed) = 9; open AMER A21–A26, A62–A67 = 12; open among a: A21 A24 A25 = 3.
    expect(raw.carried).toEqual({ lifecycleAlerts: 9, openAlerts: 12, openWithLifecycleEvent: 3 });
    // life by priorityAtEvent: High 5, Medium 2, Low 1, Urgent 1. Open by priority: Medium A21 A26 A62 A66 = 4,
    // High A23 A25 A65 = 3, Low A22 A63 A67 = 3, Unclassified A64, Urgent A24. Open ∩ a: High, Medium, Urgent 1 each.
    expect(raw.carriedGroups).toEqual({
      lifecycleAlerts: [gc("High", 5), gc("Medium", 2), gc("Low", 1), gc("Urgent", 1)],
      openAlerts: [gc("Medium", 4), gc("High", 3), gc("Low", 3), gc("Unclassified", 1), gc("Urgent", 1)],
      openWithLifecycleEvent: [gc("High", 1), gc("Medium", 1), gc("Urgent", 1)],
    });
    // L1 AMER 7 d (items I21–I40 except I29): A21 ac, A25 vw+ac+wb, A44 vw, A46 vw+ac, A53 vw, A62 vw, A65 vw =
    // 10 rows / 7 alerts; L2 = one fact per L1 alert.
    expect(idsOf(raw.humanEvents)).toEqual(["A21", "A25", "A44", "A46", "A53", "A62", "A65"]);
    expect(raw.facts?.map((f) => f.riskAlertId)).toEqual(["A21", "A25", "A44", "A46", "A53", "A62", "A65"]);
    // L3 AMER open alerts: A21–A26, A62–A67 = 12.
    expect(raw.humanEvents).toHaveLength(10);
    expect(raw.openAlerts?.map((a) => a.riskAlertId)).toEqual(alertIds([21, 26], [62, 67]));
    const sets = carriedAlertSets(win(7), AMER);
    expect(deps.source.calls.filter((c) => c.method === "countOpenAlertsBy").map((c) => c.args)).toEqual([
      [sets.open, "priority"],
      [sets.openWithLifecycle, "priority"],
    ]);
  });

  it("alertType (7 d): three grouped terms + L2 facts (selected window)", async () => {
    const { raw, deps } = await run(7, "alertType");
    // a by riskType: LateGI A01 A05 A08 A09 A13 A15 A19 A25 A35 A42 A46 A49 A50 A55 A57 A68 = 16;
    //   Allocation A06 A21 A24 A31 A44 A59 A70 = 7; CreditBlock A30 A36 A40 A58 = 4.
    // open by riskType: LateGI 21, CreditBlock 14, Allocation 13. Open ∩ a: LateGI 10, Allocation 6, CreditBlock 2.
    expect(raw.carriedGroups).toEqual({
      lifecycleAlerts: [gc("LateGI", 16), gc("Allocation", 7), gc("CreditBlock", 4)],
      openAlerts: [gc("LateGI", 21), gc("CreditBlock", 14), gc("Allocation", 13)],
      openWithLifecycleEvent: [gc("LateGI", 10), gc("Allocation", 6), gc("CreditBlock", 2)],
    });
    // L2(7 d) = one fact per L1(7) alert.
    expect(raw.facts?.map((f) => f.riskAlertId)).toEqual(TOUCHED_IDS[7]);
    expect(raw.openAlerts?.map((a) => a.riskAlertId)).toEqual(OPEN_IDS);
    // L1 shared by the card and L2 (one fetch), plus the L2 chain, the touched open ids and L3 alerts.
    expect(methods(deps)).toEqual([
      "countEvents", "countEventsBy", "countOpenAlerts", "countOpenAlerts", "countOpenAlertsBy", "countOpenAlertsBy",
      ...L2_L3,
    ]);
  });

  it("routingPersona (now): only the open grouped term; L2(now) and L3 alerts", async () => {
    const { raw, deps } = await run("now", "routingPersona");
    // Open alerts by persona: Planner 21, Logistics 15, CustomerService 12.
    expect(raw.carriedGroups).toEqual({
      lifecycleAlerts: [],
      openAlerts: [gc("Planner", 21), gc("Logistics", 15), gc("CustomerService", 12)],
      openWithLifecycleEvent: [],
    });
    // L2(now): the 46 L1(now) alerts; L3: the 48 open alerts.
    expect(raw.facts?.map((f) => f.riskAlertId)).toEqual(TOUCHED_IDS.now);
    expect(raw.openAlerts?.map((a) => a.riskAlertId)).toEqual(OPEN_IDS);
    expect(methods(deps).filter((m) => m.startsWith("count"))).toEqual(["countOpenAlerts", "countOpenAlertsBy"]);
  });

  it("escalated (7 d): open alerts only; L2 facts and L3 alerts", async () => {
    const { raw, deps } = await run(7, "escalated");
    // AOF escalated: false 38, true 9, null 1 (A06) dropped.
    expect(raw.carriedGroups).toEqual({ lifecycleAlerts: [], openAlerts: [gc("false", 38), gc("true", 9)], openWithLifecycleEvent: [] });
    expect(raw.facts?.map((f) => f.riskAlertId)).toEqual(TOUCHED_IDS[7]);
    expect(raw.openAlerts?.map((a) => a.riskAlertId)).toEqual(OPEN_IDS);
    expect(methods(deps)).toEqual(["countEvents", "countOpenAlerts", "countOpenAlerts", "countOpenAlertsBy", ...L2_L3]);
  });

  it.each<[BreakdownDimension, WindowKey]>([
    ["actionType", 7],
    ["writebackType", 90],
  ])("%s (%s): no extra call beyond the terms, L1, L2 and L3", async (dim, key) => {
    const { raw, deps } = await run(key, dim);
    expect(raw).toMatchObject({ dimension: dim, carriedGroups: null });
    expect(methods(deps)).toEqual(["countEvents", "countOpenAlerts", "countOpenAlerts", ...L2_L3]);
  });

  it("row cap on L1 → partial + row-cap; truncated (grouped term with MAX_GROUPS rows) decided by derive", async () => {
    // L1 7 d has 24 rows ≥ ROW_CAP 20 → capped. alertType groups: 3 rows each = MAX_GROUPS 3.
    const deps = fakeDeps({ config: { ROW_CAP: 20, PAGE_SIZE: 10, MAX_GROUPS: 3 } });
    const { out } = await run(7, "alertType", EMPTY_FILTERS, deps);
    expect(out.status).toBe("partial");
    expect(out.caveats).toEqual(["row-cap"]); // the loader never adds truncated (MOD-02)
    expect(deriveItemFunnel(out.raw, sel({ view: "alert", window: 7 }), deps.config).caveats).toContain("truncated");
  });
});
