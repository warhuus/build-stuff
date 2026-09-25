import { beforeEach, describe, expect, it } from "vitest";
import { l3Items, l3OpenAlerts, l3OpenedEvents } from "../../query/build";
import { clearMetricsCache } from "../../shared/cache";
import { loadOpenAlertItems, loadOpenAlertOpenedEvents, loadOpenAlerts } from "../../shared/openAlerts";
import { EMPTY_FILTERS } from "../../selection";
import { AMER, callCount, fakeDeps, idsOf } from "../helpers/loaderDeps";

describe("L3 open alerts (spec §9.0.1 L3)", () => {
  beforeEach(() => clearMetricsCache());

  it("no filter: 48 open alerts, 48 opened events, 27 items", async () => {
    const deps = fakeDeps();
    // Status O: A01–A34 (34) + A57–A70 (14) = 48.
    const alerts = await loadOpenAlerts(EMPTY_FILTERS, deps);
    expect(alerts).toMatchObject({ capped: false });
    expect(alerts.rows).toHaveLength(48);
    // opened events: A01–A31 one each (31) + reopened A29 A30 A31 one more (3) + A32–A34 none
    // + A57–A70 one each (14) = 48.
    const opened = await loadOpenAlertOpenedEvents(EMPTY_FILTERS, deps);
    expect(opened.rows).toHaveLength(48);
    expect(opened.rows.filter((e) => e.riskAlertId === "A29")).toHaveLength(2);
    expect(idsOf(opened.rows)).not.toContain("A32");
    // Items of open alerts: I1–I26 (A01–A26, A27→I9, A28→I16, A30→I20, A31→I1, A32–A34→I2–I4,
    // A57–A70→I16–I26, I5–I7) plus I29 (A29) = 27.
    const items = await loadOpenAlertItems(EMPTY_FILTERS, deps);
    expect(items.rows).toHaveLength(27);
    expect(items.rows.map((i) => i.salesOrderId)).toContain("1029_10");
    expect(deps.source.calls).toEqual([
      { method: "fetchOpenAlerts", args: [l3OpenAlerts(EMPTY_FILTERS)] },
      { method: "fetchEvents", args: [l3OpenedEvents(EMPTY_FILTERS)] },
      { method: "fetchItems", args: [l3Items(EMPTY_FILTERS)] },
    ]);
  });

  it("region AMER: open alerts on I21–I26 only (I29 has a null region)", async () => {
    const deps = fakeDeps();
    // A21–A26 and A62–A67 = 12 alerts, one opened event each; items I21–I26.
    const alerts = await loadOpenAlerts(AMER, deps);
    expect(idsOf(alerts.rows)).toEqual(
      ["A21", "A22", "A23", "A24", "A25", "A26", "A62", "A63", "A64", "A65", "A66", "A67"],
    );
    expect((await loadOpenAlertOpenedEvents(AMER, deps)).rows).toHaveLength(12);
    const items = await loadOpenAlertItems(AMER, deps);
    expect(items.rows.map((i) => i.salesOrderId)).toEqual(["1021_10", "1022_10", "1023_10", "1024_10", "1025_10", "1026_10"]);
  });

  it("three separate memos keyed by filters only", async () => {
    const deps = fakeDeps();
    await Promise.all([loadOpenAlerts(AMER, deps), loadOpenAlerts({ ...AMER, region: ["AMER", "AMER"] }, deps)]);
    await loadOpenAlerts(AMER, deps);
    expect(deps.source.calls).toHaveLength(1);
    await loadOpenAlertItems(AMER, deps);
    await loadOpenAlertOpenedEvents(AMER, deps);
    expect(callCount(deps.source, "fetchItems")).toBe(1);
    expect(callCount(deps.source, "fetchEvents")).toBe(1);
    await loadOpenAlerts(EMPTY_FILTERS, deps);
    expect(callCount(deps.source, "fetchOpenAlerts")).toBe(2);
  });

  it("propagates capped from the source", async () => {
    const deps = fakeDeps({ config: { ROW_CAP: 5, PAGE_SIZE: 5 } });
    const [alerts, items] = await Promise.all([loadOpenAlerts(EMPTY_FILTERS, deps), loadOpenAlertItems(EMPTY_FILTERS, deps)]);
    expect(alerts).toMatchObject({ capped: true });
    expect(alerts.rows).toHaveLength(5);
    expect(items.capped).toBe(true);
  });
});
