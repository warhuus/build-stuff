import { beforeEach, describe, expect, it } from "vitest";
import { touchedEventsChain, touchedOpenAlerts } from "../../query/build";
import { clearMetricsCache } from "../../shared/cache";
import { loadTouchedAlerts, touchedAlertsKey } from "../../shared/touchedAlerts";
import { EMPTY_FILTERS } from "../../selection";
import { fixtureTime as t } from "../../source/fake/fixtureAlerts";
import type { AlertLifecycleRow } from "../../types";
import { AMER, fakeDeps, idsOf, win } from "./loaderDeps";

const row = (rows: readonly AlertLifecycleRow[], id: string): AlertLifecycleRow | undefined =>
  rows.find((r) => r.riskAlertId === id);

// Timestamps: t(d, h) = d days before 2026-09-01 at h:00Z (pipeline stamps at 06:00Z).
describe("loadTouchedAlerts (L2, spec §9.0.1 L2, W4, W6)", () => {
  beforeEach(() => clearMetricsCache());

  it("7 days: one row per L1 alert, sorted; three port calls (L1, the chain, open ids)", async () => {
    const deps = fakeDeps();
    const res = await loadTouchedAlerts(win(7), EMPTY_FILTERS, deps);
    // Population = the 18 L1(7) alerts (humanEvents.test.ts).
    expect(res.rows.map((r) => r.riskAlertId)).toEqual(
      ["A09", "A11", "A13", "A15", "A18", "A19", "A21", "A25", "A32", "A44", "A46", "A49", "A53", "A54", "A58", "A62", "A65", "A70"],
    );
    expect(res.capped).toBe(false);
    expect(deps.source.calls.map((c) => c.method).sort()).toEqual(["fetchEvents", "fetchEvents", "fetchOpenAlerts"]);
    expect(deps.source.calls.map((c) => c.args[0])).toContainEqual(touchedEventsChain(win(7), EMPTY_FILTERS));
    expect(deps.source.calls.map((c) => c.args[0])).toContainEqual(touchedOpenAlerts(win(7), EMPTY_FILTERS));
    // Closed (has cl, not in AOF): A44, A46, A49, A53, A54; every row is worked.
    expect(res.rows.filter((r) => r.isClosed).map((r) => r.riskAlertId)).toEqual(["A44", "A46", "A49", "A53", "A54"]);
    expect(res.rows.every((r) => r.worked)).toBe(true);
  });

  it("facts use all-time events (W4): A18 first view precedes the window", async () => {
    const res = await loadTouchedAlerts(win(7), EMPTY_FILTERS, fakeDeps());
    // A18 "op@50 vw:u1@48:09 ac:u5@3:09": touched by ac@3; raisedAt op@50, firstView vw@48, firstAction ac@3.
    expect(row(res.rows, "A18")).toMatchObject({
      raisedAt: t(50), firstViewAt: t(48, 9), firstActionAt: t(3, 9), firstWritebackAt: null,
      isClosed: false, closureGroup: null, salesOrderId: "1018_10",
      attrs: { routingPersona: "Planner", alertType: "LateGI", priority: "Urgent" },
    });
    // A44 "op@8 vw:u3@6 cl@6": view at the close stamp precedes closed (tie rule) → viewOnly.
    expect(row(res.rows, "A44")).toMatchObject({ raisedAt: t(8), closedAt: t(6), firstViewAt: t(6), isClosed: true, closureGroup: "viewOnly" });
    // A53 "op@10 cl@8 vw:u1@5:09": human only after closure → noHuman; A54 likewise with an action.
    expect(row(res.rows, "A53")).toMatchObject({ closedAt: t(8), firstViewAt: t(5, 9), closureGroup: "noHuman" });
    expect(row(res.rows, "A54")).toMatchObject({ closedAt: t(13), firstActionAt: t(3, 9), closureGroup: "noHuman" });
    // A32 "vw:u1@120:09 ac:u1@5:09": no pipeline event → raisedAt null, null attrs.
    expect(row(res.rows, "A32")).toMatchObject({
      raisedAt: null, closedAt: null, firstViewAt: t(120, 9),
      attrs: { routingPersona: null, alertType: null, priority: null },
    });
  });

  it("a reopened alert is not closed (A29 op@30 cl@20 op@10, open now)", async () => {
    const res = await loadTouchedAlerts(win(14), EMPTY_FILTERS, fakeDeps());
    // Touched by vw@9. raisedAt = min opened = op@30; closedAt = max closed = cl@20; in AOF → isClosed false.
    expect(row(res.rows, "A29")).toMatchObject({
      raisedAt: t(30), closedAt: t(20), isClosed: false, closureGroup: null, firstViewAt: t(9, 9),
    });
    // 14-day population: 27 alerts (L1(14)); closed ones A42 A44 A46 A49 A50 A53 A54 A55.
    expect(res.rows).toHaveLength(27);
    expect(res.rows.filter((r) => r.isClosed).map((r) => r.riskAlertId)).toEqual(
      ["A42", "A44", "A46", "A49", "A50", "A53", "A54", "A55"],
    );
    // A55 closed: attrs from the closed event (Logistics / Medium), not the opened one (Planner / High).
    expect(row(res.rows, "A55")?.attrs).toEqual({ routingPersona: "Logistics", alertType: "LateGI", priority: "Medium" });
    // A50 "op@9 vw ac wb @8 cl@2" → writeBack.
    expect(row(res.rows, "A50")).toMatchObject({ firstWritebackAt: t(8, 11), closureGroup: "writeBack" });
  });

  it('an alert whose only human event precedes the window is in L2("now") but not L2(7) (W4)', async () => {
    const deps = fakeDeps();
    const seven = await loadTouchedAlerts(win(7), EMPTY_FILTERS, deps);
    const now = await loadTouchedAlerts(win("now"), EMPTY_FILTERS, deps);
    // A45 "op@70 vw:u4@69:09 cl@50" and A43 "op@30 vw@29 cl@20": human events before the 7-day start.
    expect(row(seven.rows, "A45")).toBeUndefined();
    expect(row(now.rows, "A45")).toMatchObject({ raisedAt: t(70), closedAt: t(50), isClosed: true, closureGroup: "viewOnly" });
    expect(row(now.rows, "A43")).toMatchObject({ closedAt: t(20), isClosed: true });
    // "now" population = the 46 L1("now") alerts; A30 (op@60 vw@59 cl@40 op@3) reopened → not closed.
    expect(now.rows).toHaveLength(46);
    expect(row(now.rows, "A30")).toMatchObject({ raisedAt: t(60), closedAt: t(40), isClosed: false });
    // A56 "vw:u4@130:09 cl@100": raised before the pipeline start → raisedAt null, closed, viewOnly.
    expect(row(now.rows, "A56")).toMatchObject({ raisedAt: null, closedAt: t(100), isClosed: true, closureGroup: "viewOnly" });
    // Untouched alerts never appear: A01 (op only), A24 (agent only), A31 (no human), A35 (closed, no human).
    expect(idsOf(now.rows)).not.toContain("A01");
    expect(idsOf(now.rows)).not.toContain("A24");
    expect(idsOf(now.rows)).not.toContain("A31");
    expect(idsOf(now.rows)).not.toContain("A35");
  });

  it("item filter: 7 days AMER = 7 alerts, 'now' AMER = 18 alerts", async () => {
    const deps = fakeDeps();
    const seven = await loadTouchedAlerts(win(7), AMER, deps);
    expect(idsOf(seven.rows)).toEqual(["A21", "A25", "A44", "A46", "A53", "A62", "A65"]);
    // A62 "op@33 vw:u3@1:09" on I21 (AMER): raised before the window, open.
    expect(row(seven.rows, "A62")).toMatchObject({ raisedAt: t(33), firstViewAt: t(1, 9), isClosed: false });
    const now = await loadTouchedAlerts(win("now"), AMER, deps);
    // AMER L1("now") alerts: A21 A22 A23 A25 A26 A42 A43 A44 A45 A46 A47 A48 A52 A53 A62 A63 A65 A67.
    expect(idsOf(now.rows)).toEqual(
      ["A21", "A22", "A23", "A25", "A26", "A42", "A43", "A44", "A45", "A46", "A47", "A48", "A52", "A53", "A62", "A63", "A65", "A67"],
    );
    expect(now.rows.filter((r) => r.isClosed)).toHaveLength(9);
  });

  it("memo key is window.key | filtersKey", async () => {
    expect(touchedAlertsKey(win("now"), EMPTY_FILTERS)).toBe("L2|now|bl=;pl=;rg=;pt=");
  });
});
