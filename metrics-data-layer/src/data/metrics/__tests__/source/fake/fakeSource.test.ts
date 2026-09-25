import { describe, expect, it } from "vitest";
import { PLACEHOLDER } from "../../../../../config/metrics";
import { allItems, allOpenAlerts, eventsWhere, allEvents, openAlertsOfEvents, withItemFilters } from "../../../query/build";
import { riskAll, riskBucket, riskNotDelayed } from "../../../query/buildRisk";
import { createFakeSource } from "../../../source/fake/fakeSource";
import { FIXTURE_CONFIG } from "../../../source/fake/fixtures";
import type { ItemFilters, Window } from "../../../types";
import { fakeCtx } from "../../helpers/testKit";

const NONE: ItemFilters = { businessLine: [], productLine: [], region: [], plant: [] };
const END = "2026-09-01T12:00:00.000Z";
const W7: Window = { key: 7, start: "2026-08-25T12:00:00.000Z", end: END };
const W90: Window = { key: 90, start: "2026-06-03T12:00:00.000Z", end: END };
const NOW: Window = { key: "now", start: null, end: END };

describe("fake source: item aggregates", () => {
  it("drops null group values and sums values ignoring nulls", async () => {
    const src = createFakeSource();
    // BL-A = odd items (20), value Σodd 1..39 × 1000 − I29 (null) = 400000 − 29000; BL-B = even items minus I30 (null).
    expect(await src.countItemsBy(allItems, "businessLine", fakeCtx())).toEqual([
      { group: "BL-A", count: 20, valueUsd: 371000 },
      { group: "BL-B", count: 19, valueUsd: 390000 },
    ]);
  });

  it("truncates to MAX_GROUPS keeping the largest, ties by name", async () => {
    const src = createFakeSource();
    // P100, P200, P300 each have 13 items (I28 has a null plant).
    const groups = await src.countItemsBy(allItems, "plant", fakeCtx({ MAX_GROUPS: 2 }));
    expect(groups.map((g) => [g.group, g.count])).toEqual([
      ["P100", 13],
      ["P200", 13],
    ]);
    const regions = await src.countItemsBy(allItems, "region", fakeCtx({ MAX_GROUPS: 1 }));
    expect(regions.map((g) => [g.group, g.count])).toEqual([["EMEA", 20]]); // AMER has 19 (I29 region null)
  });

  it("returns count 0 and value 0 for an empty set", async () => {
    const empty = withItemFilters(allItems, { ...NONE, region: ["Nowhere"] });
    expect(await createFakeSource().countItems(empty, fakeCtx())).toEqual({ count: 0, valueUsd: 0 });
  });

  it("applies one $in per non-empty filter dimension and ignores empty ones", async () => {
    const f: ItemFilters = { ...NONE, businessLine: ["BL-A"], plant: ["P100", "P300"] };
    // odd items with plant P100 (1,7,13,19,25,31,37) or P300 (3,9,15,21,27,33,39) = 14.
    expect((await createFakeSource().countItems(withItemFilters(allItems, f), fakeCtx())).count).toBe(14);
  });
});

describe("fake source: events and open alerts", () => {
  it("under now has no lower bound (pre-pipeline human events count)", async () => {
    const src = createFakeSource();
    const viewed = (w: Window) => src.countEvents(eventsWhere(allEvents, ["viewed"], w), "alert", fakeCtx());
    // Viewed alerts at any time: 38 vw tokens on 37 alerts (A11 twice) — see fixtureAlerts.ts.
    const all = await viewed(NOW);
    expect(all).toBe(37);
    // A14 (92 d), A32 (120 d), A33 (200 d), A56 (130 d) views are outside 90 d.
    expect(await viewed(W90)).toBe(all - 4);
  });

  it("includes the window start instant (inclusive bounds)", async () => {
    const opened7 = eventsWhere(allEvents, ["opened"], W7);
    const ids = (await createFakeSource().fetchEvents(opened7, fakeCtx())).rows.map((r) => r.riskAlertId);
    expect(ids).toContain("A59");
  });

  it("counts distinct actors and groups by the mapped AlertHistory field", async () => {
    const src = createFakeSource();
    const actions7 = eventsWhere(allEvents, ["action"], W7);
    // 7 d actions: A15 u1, A18 u5, A19 u2 (the `updated` row is not an action), A21 u3, A25 u1 (ac, wb),
    // A32 u1, A46 u2, A49 u5, A54 u2, A70 u4 → u1 u2 u3 u4 u5. status_changed on 9 alerts, A70 deeplink, A25 wb.
    expect(await src.countEvents(actions7, "actor", fakeCtx())).toBe(5);
    const byType = await src.countEventsBy(actions7, "alert", "actionType", fakeCtx());
    expect(byType).toEqual([
      { group: "status_changed", count: 9 },
      { group: "deeplink_clicked", count: 1 },
      { group: "delivery_block_removed", count: 1 },
    ]);
  });

  it("holds only open alerts in AlertOrderFulfillment and maps escalated to labels (nulls dropped)", async () => {
    const src = createFakeSource();
    expect(await src.countOpenAlerts(allOpenAlerts, fakeCtx())).toBe(48);
    expect(await src.countOpenAlertsBy(allOpenAlerts, "escalated", fakeCtx())).toEqual([
      { group: "false", count: 38 },
      { group: "true", count: 9 },
    ]);
  });

  it("resolves the alert pivot only for alerts open now", async () => {
    const src = createFakeSource();
    const closedEvents = eventsWhere(allEvents, ["closed"], null);
    // 25 alerts have a closed event; only the reopened A29, A30, A31 are open now.
    expect(await src.countEvents(closedEvents, "alert", fakeCtx())).toBe(25);
    const rows = (await src.fetchOpenAlerts(openAlertsOfEvents(closedEvents), fakeCtx())).rows;
    expect(rows.map((r) => r.riskAlertId)).toEqual(["A29", "A30", "A31"]);
  });
});

describe("fake source: risk, app usage, verdicts", () => {
  it("evaluates the bucket where-clauses (spec §9 3.1)", async () => {
    const src = createFakeSource();
    const counts = await Promise.all(
      (["unscored", "b15_30", "b31_50", "b51_70", "b71_90", "b91_100", "delayed"] as const).map((b) =>
        src.countRisk(riskBucket(riskAll(NONE), b), fakeCtx()),
      ),
    );
    expect(counts).toEqual([8, 5, 4, 4, 3, 3, 3]);
  });

  it("groups $ranges by range start, drops nulls, omits empty ranges", async () => {
    const src = createFakeSource();
    const ranges = FIXTURE_CONFIG.RISK_RANGES;
    expect(await src.countRiskByScoreRange(riskNotDelayed(riskAll(NONE)), ranges, fakeCtx())).toEqual([
      { startValue: 0, count: 5 },
      { startValue: 31, count: 4 },
      { startValue: 51, count: 4 },
      { startValue: 71, count: 3 },
      { startValue: 91, count: 3 },
    ]);
    expect(await src.countRiskByScoreRange(riskBucket(riskAll(NONE), "b71_90"), ranges, fakeCtx())).toEqual([
      { startValue: 71, count: 3 },
    ]);
  });

  it("counts app users of ALERT_APP_ID only, groups by queue filter without nulls", async () => {
    const src = createFakeSource();
    expect(await src.countAppUsers(W7, fakeCtx())).toBe(3);
    expect(await src.countAppUsers(NOW, fakeCtx())).toBe(6);
    expect(await src.countAppUsers(NOW, fakeCtx({ ALERT_APP_ID: "other-app" }))).toBe(1);
    expect(await src.countAppUsersBy(W7, "queueFilter", fakeCtx())).toEqual([
      { group: "All", count: 1 },
      { group: "Logistics", count: 1 },
      { group: "Planner", count: 1 },
    ]);
  });

  it("gates verdict totals and compares the chosen verdict date on calendar dates", async () => {
    const src = createFakeSource();
    // Ship end date in [08-25, 09-01], OTIF gate No: OTIF 1009, 1015, 1031 (08-25), 1001, 9001; Not OTIF 1038.
    expect(await src.countVerdictsBy({ mode: "otif", window: W7 }, fakeCtx())).toEqual([
      { group: "OTIF", count: 5 },
      { group: "Not OTIF", count: 1 },
    ]);
    const target = fakeCtx({ VERDICT_DATE_PROPERTY: "otifFirstInitialDeliveryDateTarget" });
    expect(await src.countVerdictsBy({ mode: "otif", window: W7 }, target)).toEqual([
      { group: "OTIF", count: 4 },
      { group: "Not OTIF", count: 2 },
    ]);
    expect(await src.countVerdictsBy({ mode: "crit", window: W7 }, fakeCtx())).toEqual([
      { group: "CRIT", count: 6 },
      { group: "Not CRIT", count: 1 },
    ]);
    expect(await src.countVerdictsBy({ mode: "otif", window: NOW }, fakeCtx())).toEqual([
      { group: "OTIF", count: 7 },
      { group: "Not OTIF", count: 3 },
    ]);
  });

  it("returns no verdict totals while the date property is a placeholder", async () => {
    const placeholder = fakeCtx({ VERDICT_DATE_PROPERTY: PLACEHOLDER });
    expect(await createFakeSource().countVerdictsBy({ mode: "otif", window: NOW }, placeholder)).toEqual([]);
  });

  it("records every call with its arguments", async () => {
    const src = createFakeSource();
    await src.countItemsBy(allItems, "plant", fakeCtx());
    await src.fetchItemsByIds([], fakeCtx());
    expect(src.calls).toEqual([
      { method: "countItemsBy", args: [allItems, "plant"] },
      { method: "fetchItemsByIds", args: [[]] },
    ]);
  });
});
