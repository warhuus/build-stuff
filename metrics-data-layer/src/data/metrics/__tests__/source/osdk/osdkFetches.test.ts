// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PLACEHOLDER } from "../../../../../config/metrics";
import { ITEM_SELECT, OPEN_ALERT_SELECT, VERDICT_SELECT } from "../../../source/osdk/rowMapping";
import { chainOf, type WireBody } from "../../helpers/recordingClient";
import { makeCtx, setup } from "../../helpers/osdkHarness";

const tokenOf = (b: WireBody): unknown => b.pageToken;
const inIds = (b: WireBody): unknown => chainOf(b.objectSet)[1];

describe("row fetches (spec §9.0.1)", () => {
  it("fetchOpenAlerts and fetchItems select the row-type columns", async () => {
    const t = setup();
    await t.source.fetchOpenAlerts({ kind: "all" }, makeCtx());
    await t.source.fetchItems({ kind: "openInWindow", window: { key: "now", start: null, end: "2026-09-24T00:00:00.000Z" } }, makeCtx());
    expect(t.requests[0].body.select).toEqual([...OPEN_ALERT_SELECT]);
    expect(t.requests[1].body.select).toEqual([...ITEM_SELECT]);
    expect(chainOf(t.requests[1].body.objectSet)).toEqual([{ base: "SalesOrders" }, { where: { isOpen: { $eq: true } } }]);
  });
});

describe("items by id (spec §9.0 itemsById; D14)", () => {
  it("sends no request for an empty id list", async () => {
    const t = setup();
    expect(await t.source.fetchItemsByIds([], makeCtx())).toEqual({ rows: [], capped: false });
    expect(t.requests).toEqual([]);
  });

  it("chunks by ID_BATCH ($in), de-duplicates and keeps INNER_CONCURRENCY in flight at most", async () => {
    const t = setup();
    t.handlers.load = () => ({ data: [{ salesOrderId: "x", businessLineName: "BL" }] });
    const ids = ["1", "2", "3", "4", "5", "6", "7", "7"];
    const ctx = makeCtx({ ID_BATCH: 2, INNER_CONCURRENCY: 2 });
    const out = await t.source.fetchItemsByIds(ids, ctx);
    expect(t.requests.map((r) => inIds(r.body))).toEqual([
      { where: { salesOrderId: { $in: ["1", "2"] } } },
      { where: { salesOrderId: { $in: ["3", "4"] } } },
      { where: { salesOrderId: { $in: ["5", "6"] } } },
      { where: { salesOrderId: { $in: ["7"] } } },
    ]);
    expect(t.stats.maxInFlight).toBe(2);
    expect(out.rows).toHaveLength(4);
    expect(ctx.progress.at(-1)).toEqual({ loaded: 4 });
  });

  it("caps the merged rows at ROW_CAP", async () => {
    const t = setup();
    t.handlers.load = (b) => ({ data: [{ salesOrderId: JSON.stringify(inIds(b)) }, { salesOrderId: "y" }] });
    const out = await t.source.fetchItemsByIds(["1", "2", "3"], makeCtx({ ID_BATCH: 1, ROW_CAP: 5 }));
    expect(out.rows).toHaveLength(5);
    expect(out.capped).toBe(true);
  });

  it("checks the signal between chunks", async () => {
    const t = setup();
    const ctx = makeCtx({ ID_BATCH: 1, INNER_CONCURRENCY: 1 });
    t.handlers.load = () => {
      ctx.controller.abort();
      return { data: [] };
    };
    await expect(t.source.fetchItemsByIds(["1", "2", "3"], ctx)).rejects.toMatchObject({ name: "AbortError" });
    expect(t.requests).toHaveLength(1);
  });
});

describe("verdicts by id (spec §9 4.1 step 3; VERDICT_ID_LOOKUP)", () => {
  const verdict = { otifOrderId: "o1", initOtifClassification: "OTIF", otifOtShipmentEndDate: "2026-09-20", otifFirstInitialDeliveryDateTarget: "2026-09-02" };

  it('"in": $in chunks of ID_BATCH with PAGE_SIZE pages', async () => {
    const t = setup();
    t.handlers.load = () => ({ data: [verdict] });
    const ctx = makeCtx({ VERDICT_ID_LOOKUP: "in", ID_BATCH: 2 });
    const out = await t.source.fetchVerdictsByIds(["o1", "o2", "o3"], ctx);
    expect(t.requests.map((r) => inIds(r.body))).toEqual([
      { where: { otifOrderId: { $in: ["o1", "o2"] } } },
      { where: { otifOrderId: { $in: ["o3"] } } },
    ]);
    expect(t.requests.every((r) => r.body.pageSize === ctx.config.PAGE_SIZE)).toBe(true);
    expect(t.requests[0].body.select).toEqual([...VERDICT_SELECT]);
    expect(out.rows[0]).toEqual({
      otifOrderId: "o1",
      otifVerdict: "OTIF",
      critVerdict: null,
      otifExclusion: null,
      critExclusion: null,
      verdictDate: "2026-09-20",
    });
  });

  it('"eq": one $eq fetch per id with $pageSize 1, INNER_CONCURRENCY in flight at most', async () => {
    const t = setup();
    t.handlers.load = () => ({ data: [verdict] });
    const ctx = makeCtx({ VERDICT_ID_LOOKUP: "eq", INNER_CONCURRENCY: 3, VERDICT_DATE_PROPERTY: "otifFirstInitialDeliveryDateTarget" });
    const ids = ["o1", "o2", "o3", "o4", "o5", "o6", "o7"];
    const out = await t.source.fetchVerdictsByIds(ids, ctx);
    expect(t.requests.map((r) => inIds(r.body))).toEqual(ids.map((id) => ({ where: { otifOrderId: { $eq: id } } })));
    expect(t.requests.every((r) => r.body.pageSize === 1 && tokenOf(r.body) === undefined)).toBe(true);
    expect(t.stats.maxInFlight).toBe(3);
    expect(out.rows).toHaveLength(7);
    expect(out.rows[0].verdictDate).toBe("2026-09-02");
    expect(ctx.progress.at(-1)).toEqual({ loaded: 7 });
  });

  it("empty ids and a placeholder date property send no request", async () => {
    const t = setup();
    expect(await t.source.fetchVerdictsByIds([], makeCtx())).toEqual({ rows: [], capped: false });
    await expect(t.source.fetchVerdictsByIds(["o1"], makeCtx({ VERDICT_DATE_PROPERTY: PLACEHOLDER }))).rejects.toThrow(
      /VERDICT_DATE_PROPERTY/,
    );
    expect(t.requests).toEqual([]);
  });
});
