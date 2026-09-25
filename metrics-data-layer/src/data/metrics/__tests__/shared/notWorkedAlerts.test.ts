import { beforeEach, describe, expect, it } from "vitest";
import { closedNotOpenNow, openedEventsOfItemsOf } from "../../query/build";
import { clearMetricsCache } from "../../shared/cache";
import { loadNotWorkedAlerts } from "../../shared/notWorkedAlerts";
import { memoKey } from "../../shared/memo";
import { EMPTY_FILTERS } from "../../selection";
import { fixtureTime as t } from "../../source/fake/fixtureAlerts";
import type { AlertLifecycleRow } from "../../types";
import { AMER, callCount, fakeDeps, win } from "./loaderDeps";

const row = (rows: readonly AlertLifecycleRow[], id: string): AlertLifecycleRow | undefined =>
  rows.find((r) => r.riskAlertId === id);

describe("loadNotWorkedAlerts (decision D2, spec §9 4.2)", () => {
  beforeEach(() => clearMetricsCache());

  it("7 days: closed in the window and not open now, lifecycle facts only", async () => {
    const deps = fakeDeps();
    const res = await loadNotWorkedAlerts(win(7), EMPTY_FILTERS, deps);
    // cl with d < 7: A31 cl@6 (open now → out), A35 @2, A36 @5, A40 @6, A42 @4, A44 @6, A46 @3,
    // A49 @1, A50 @2, A55 @4 → 9 alerts (touched ones included; the 4.2 derive removes L2("now") ids).
    expect(res.rows.map((r) => r.riskAlertId)).toEqual(["A35", "A36", "A40", "A42", "A44", "A46", "A49", "A50", "A55"]);
    expect(res.capped).toBe(false);
    const f = closedNotOpenNow(win(7), EMPTY_FILTERS);
    expect(deps.source.calls).toEqual([
      { method: "fetchEvents", args: [f] },
      { method: "fetchEvents", args: [openedEventsOfItemsOf(f)] },
    ]);
    // A35 "op@10 cl@2": raisedAt op@10, closedAt cl@2; lifecycle only → worked false, noHuman.
    expect(row(res.rows, "A35")).toEqual({
      riskAlertId: "A35", salesOrderId: "1031_10", raisedAt: t(10), closedAt: t(2), isClosed: true,
      firstViewAt: null, firstActionAt: null, firstWritebackAt: null, worked: false, closureGroup: "noHuman",
      attrs: { routingPersona: "Planner", alertType: "LateGI", priority: "High" },
    });
    // A40 "cl@6": no opened event → raisedAt null. A55: attrs from the closed event (Logistics / Medium).
    expect(row(res.rows, "A40")).toMatchObject({ raisedAt: null, closedAt: t(6) });
    expect(row(res.rows, "A55")?.attrs).toEqual({ routingPersona: "Logistics", alertType: "LateGI", priority: "Medium" });
    // A46 was worked (vw ac @5) but only lifecycle events are fetched here → worked false.
    expect(row(res.rows, "A46")).toMatchObject({ worked: false, firstViewAt: null });
  });

  it("14 days: 14 alerts; A41 opened and closed at the same stamp", async () => {
    const res = await loadNotWorkedAlerts(win(14), EMPTY_FILTERS, fakeDeps());
    // + cl@8..13: A37 @12, A41 @9, A47 @11, A53 @8, A54 @13 → 9 + 5 = 14.
    expect(res.rows).toHaveLength(14);
    expect(row(res.rows, "A41")).toMatchObject({ raisedAt: t(9), closedAt: t(9), isClosed: true });
  });

  it('"now" and AMER filter', async () => {
    const deps = fakeDeps();
    // Every closed alert A35–A56 (22); A29 A30 A31 closed then reopened (open now) → out.
    const now = await loadNotWorkedAlerts(win("now"), EMPTY_FILTERS, deps);
    expect(now.rows).toHaveLength(22);
    expect(row(now.rows, "A29")).toBeUndefined();
    // 7 days AMER: A35 (I31) A36 (I32) A40 (I36) A42 (I38) A44 (I40) A46 (I32); A49 A50 A55 are EMEA.
    const amer = await loadNotWorkedAlerts(win(7), AMER, deps);
    expect(amer.rows.map((r) => r.riskAlertId)).toEqual(["A35", "A36", "A40", "A42", "A44", "A46"]);
  });

  it("memoised per window.key | filtersKey; capped propagates", async () => {
    expect(memoKey(win(14), AMER)).toBe("14|bl=;pl=;rg=AMER;pt=");
    const deps = fakeDeps();
    await Promise.all([loadNotWorkedAlerts(win(7), EMPTY_FILTERS, deps), loadNotWorkedAlerts(win(7), EMPTY_FILTERS, deps)]);
    expect(callCount(deps.source, "fetchEvents")).toBe(2);
    clearMetricsCache();
    // 9 closed events ≥ cap 5 → capped.
    const capped = await loadNotWorkedAlerts(win(7), EMPTY_FILTERS, fakeDeps({ config: { ROW_CAP: 5, PAGE_SIZE: 5 } }));
    expect(capped.capped).toBe(true);
  });
});
