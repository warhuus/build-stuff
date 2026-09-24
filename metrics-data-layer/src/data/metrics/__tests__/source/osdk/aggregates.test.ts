// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PLACEHOLDER } from "../../../../../config/metrics";
import type { EventGroupField, OpenAlertGroupField } from "../../../query/specs";
import { chainOf, isGrouped, type AggregateReply } from "./recordingClient";
import { TEST_CONFIG, W7, WNOW, makeCtx, setup } from "./osdkTestUtils";

const exact = (field: string, max = TEST_CONFIG.MAX_GROUPS) => [{ type: "exact", field, maxGroupCount: max }];
const reply = (rows: [Record<string, unknown>, Record<string, number>][]): AggregateReply => ({
  data: rows.map(([group, m]) => ({ group, metrics: Object.entries(m).map(([name, value]) => ({ name, value })) })),
});

describe("item aggregates (spec §9.0 stageTotal / stageByItemDim)", () => {
  it("countItems selects $count and valueUsd:sum and reads defensively", async () => {
    const t = setup();
    t.handlers.aggregate = () => reply([[{}, { count: 3, "valueUsd.sum": 12.5 }]]);
    expect(await t.source.countItems({ kind: "all" }, makeCtx())).toEqual({ count: 3, valueUsd: 12.5 });
    expect(t.requests[0].body.aggregation).toEqual([
      { type: "count", name: "count" },
      { type: "sum", name: "valueUsd.sum", field: "valueUsd" },
    ]);
    expect(t.requests[0].body.groupBy).toEqual([]);
    t.handlers.aggregate = () => reply([[{}, {}]]);
    expect(await t.source.countItems({ kind: "all" }, makeCtx())).toEqual({ count: 0, valueUsd: 0 });
  });

  it.each([
    ["businessLine", "businessLineName"],
    ["productLine", "productLineName"],
    ["region", "iscRegionName"],
    ["plant", "plantCode"],
  ] as const)("countItemsBy %s groups by %s with $exactWithLimit", async (dim, prop) => {
    const t = setup();
    t.handlers.aggregate = () =>
      reply([
        [{ [prop]: "A" }, { count: 2, "valueUsd.sum": 5 }],
        [{ [prop]: null }, { count: 9, "valueUsd.sum": 1 }],
        [{ [prop]: "B" }, { count: 1 }],
      ]);
    const rows = await t.source.countItemsBy({ kind: "all" }, dim, makeCtx({ MAX_GROUPS: 7 }));
    expect(t.requests[0].body.groupBy).toEqual(exact(prop, 7));
    expect(rows).toEqual([
      { group: "A", count: 2, valueUsd: 5 },
      { group: "B", count: 1, valueUsd: 0 },
    ]);
  });
});

describe("event aggregates (spec §9.0 ahGroupBy)", () => {
  it("countEvents counts distinct actors or alerts", async () => {
    const t = setup();
    t.handlers.aggregate = () => reply([[{}, { "eventActor.exactDistinct": 4, "riskAlertId.exactDistinct": 6 }]]);
    expect(await t.source.countEvents({ kind: "all" }, "actor", makeCtx())).toBe(4);
    expect(await t.source.countEvents({ kind: "all" }, "alert", makeCtx())).toBe(6);
    expect(t.requests.map((r) => r.body.aggregation)).toEqual([
      [{ type: "exactDistinct", name: "eventActor.exactDistinct", field: "eventActor" }],
      [{ type: "exactDistinct", name: "riskAlertId.exactDistinct", field: "riskAlertId" }],
    ]);
  });

  const EVENT_FIELDS: [EventGroupField, string][] = [
    ["queueFilter", "persona"],
    ["routingPersona", "persona"],
    ["alertType", "riskType"],
    ["priority", "priorityAtEvent"],
    ["actionType", "eventType"],
    ["writebackType", "eventType"],
  ];
  it.each(EVENT_FIELDS)("countEventsBy %s groups by %s (actor and alert)", async (g, prop) => {
    const t = setup();
    t.handlers.aggregate = () =>
      reply([[{ [prop]: "x" }, { "eventActor.exactDistinct": 2, "riskAlertId.exactDistinct": 3 }], [{}, { count: 1 }]]);
    expect(await t.source.countEventsBy({ kind: "all" }, "actor", g, makeCtx())).toEqual([{ group: "x", count: 2 }]);
    expect(await t.source.countEventsBy({ kind: "all" }, "alert", g, makeCtx())).toEqual([{ group: "x", count: 3 }]);
    expect(t.requests.map((r) => r.body.groupBy)).toEqual([exact(prop), exact(prop)]);
    expect(t.requests.map((r) => r.body.aggregation)).toEqual([
      [{ type: "exactDistinct", name: "eventActor.exactDistinct", field: "eventActor" }],
      [{ type: "exactDistinct", name: "riskAlertId.exactDistinct", field: "riskAlertId" }],
    ]);
  });
});

describe("open-alert aggregates (spec §9.0 aofGroupBy)", () => {
  const FIELDS: [OpenAlertGroupField, string][] = [
    ["routingPersona", "persona"],
    ["priority", "priority"],
    ["alertType", "riskType"],
    ["escalated", "escalated"],
  ];
  it.each(FIELDS)("countOpenAlertsBy %s groups by %s", async (g, prop) => {
    const t = setup();
    await t.source.countOpenAlertsBy({ kind: "all" }, g, makeCtx());
    expect(t.requests[0].body.groupBy).toEqual(exact(prop));
    expect(t.requests[0].body.aggregation).toEqual([{ type: "count", name: "count" }]);
  });

  it("labels escalated groups from config for booleans and strings (F6)", async () => {
    const t = setup();
    t.handlers.aggregate = () =>
      reply([
        [{ escalated: true }, { count: 3 }],
        [{ escalated: "false" }, { count: 2 }],
        [{ escalated: null }, { count: 1 }],
      ]);
    const labels = { true: "true", false: "false" } as const;
    const rows = await t.source.countOpenAlertsBy({ kind: "all" }, "escalated", makeCtx({ ESCALATED_GROUP_LABELS: labels }));
    expect(rows).toEqual([
      { group: "true", count: 3 },
      { group: "false", count: 2 },
    ]);
  });

  it("countOpenAlerts reads $count ?? 0", async () => {
    const t = setup();
    t.handlers.aggregate = () => reply([[{}, { count: 11 }]]);
    expect(await t.source.countOpenAlerts({ kind: "all" }, makeCtx())).toBe(11);
  });
});

describe("risk aggregates (spec §9 3.1)", () => {
  it("countRisk counts; countRiskByScoreRange uses $ranges without $exactWithLimit", async () => {
    const t = setup();
    t.handlers.aggregate = (body) =>
      isGrouped(body)
        ? reply([
            [{ otifScore: { startValue: 0, endValue: 31 } }, { count: 4 }],
            [{ otifScore: { startValue: 31, endValue: 51 } }, { count: 0 }],
            [{ otifScore: { startValue: 91, endValue: 101 } }, { count: 2 }],
          ])
        : reply([[{}, { count: 9 }]]);
    expect(await t.source.countRisk({ kind: "all" }, makeCtx())).toBe(9);
    const notDelayed = { kind: "where", base: { kind: "all" }, condition: { kind: "notDelayed" } } as const;
    const rows = await t.source.countRiskByScoreRange(notDelayed, TEST_CONFIG.RISK_RANGES, makeCtx());
    expect(rows).toEqual([
      { startValue: 0, count: 4 },
      { startValue: 91, count: 2 },
    ]);
    const body = t.requests[1].body;
    expect(body.groupBy).toEqual([
      {
        type: "ranges",
        field: "otifScore",
        ranges: TEST_CONFIG.RISK_RANGES.map(([startValue, endValue]) => ({ startValue, endValue })),
      },
    ]);
    expect(JSON.stringify(body.groupBy)).not.toContain("maxGroupCount");
    expect(chainOf(body.objectSet)).toEqual([
      { base: "SalesOrderOtifEvaluation" },
      { where: { $not: { otifStatus: { $eq: "Delayed" } } } },
    ]);
  });

  it("sends no request for empty ranges", async () => {
    const t = setup();
    expect(await t.source.countRiskByScoreRange({ kind: "all" }, [], makeCtx())).toEqual([]);
    expect(t.requests).toEqual([]);
  });
});

describe("app usage and verdict aggregates", () => {
  it("countAppUsers / By filter on ALERT_APP_ID and the window (spec §9 1.1)", async () => {
    const t = setup();
    t.handlers.aggregate = (body) =>
      isGrouped(body)
        ? reply([[{ persona: "Q" }, { "userId.exactDistinct": 5 }]])
        : reply([[{}, { "userId.exactDistinct": 8 }]]);
    expect(await t.source.countAppUsers(W7, makeCtx())).toBe(8);
    expect(await t.source.countAppUsersBy(WNOW, "queueFilter", makeCtx())).toEqual([{ group: "Q", count: 5 }]);
    expect(chainOf(t.requests[0].body.objectSet)).toEqual([
      { base: "AppUsageEvent" },
      {
        where: {
          $and: [
            { appId: { $eq: "alert-app" } },
            { $and: [{ eventTimestamp: { $gte: W7.start } }, { eventTimestamp: { $lte: W7.end } }] },
          ],
        },
      },
    ]);
    expect(t.requests[1].body.groupBy).toEqual(exact("persona"));
  });

  it.each([
    ["otif", "officialExclusionOtif", "initOtifClassification"],
    ["crit", "officialExclusionCrit", "critClassification"],
  ] as const)("countVerdictsBy %s: gate + dateIn, grouped by the classification", async (mode, gate, prop) => {
    const t = setup();
    t.handlers.aggregate = () => reply([[{ [prop]: "OTIF" }, { count: 7 }]]);
    expect(await t.source.countVerdictsBy({ mode, window: W7 }, makeCtx())).toEqual([{ group: "OTIF", count: 7 }]);
    expect(chainOf(t.requests[0].body.objectSet)).toEqual([
      { base: "OtifOrderVerdict" },
      {
        where: {
          $and: [
            { [gate]: { $eq: "No" } },
            { $and: [{ otifOtShipmentEndDate: { $gte: "2026-09-17" } }, { otifOtShipmentEndDate: { $lte: "2026-09-24" } }] },
          ],
        },
      },
    ]);
    expect(t.requests[0].body.groupBy).toEqual(exact(prop));
  });

  it("placeholders reject without a request", async () => {
    const t = setup();
    const ctx = makeCtx({ ALERT_APP_ID: PLACEHOLDER, VERDICT_DATE_PROPERTY: PLACEHOLDER });
    await expect(t.source.countAppUsers(W7, ctx)).rejects.toThrow(/ALERT_APP_ID/);
    await expect(t.source.countVerdictsBy({ mode: "otif", window: W7 }, ctx)).rejects.toThrow(/VERDICT_DATE_PROPERTY/);
    expect(t.requests).toEqual([]);
  });

  it("an aborted signal rejects with AbortError before the call", async () => {
    const t = setup();
    const ctx = makeCtx();
    ctx.controller.abort();
    await expect(t.source.countItems({ kind: "all" }, ctx)).rejects.toMatchObject({ name: "AbortError" });
    await expect(t.source.countAppUsersBy(W7, "queueFilter", ctx)).rejects.toMatchObject({ name: "AbortError" });
    expect(t.requests).toEqual([]);
  });
});
