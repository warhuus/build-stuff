import { describe, expect, it } from "vitest";
import { allEvents, allItems } from "../../../query/build";
import { createFakeSource } from "../../../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURES } from "../../../source/fake/fixtures";
import { fakeCtx } from "../../helpers/testKit";

const TOTAL_EVENTS = FIXTURES.events.length;
const ITEM_IDS = FIXTURES.items.map((i) => i.salesOrderId);

describe("fake source: paging (spec §9.0 fetchAllPages)", () => {
  it("pages by PAGE_SIZE and reports cumulative progress after each page", async () => {
    const progress: number[] = [];
    const src = createFakeSource();
    const res = await src.fetchItems(allItems, fakeCtx({ PAGE_SIZE: 15 }, (p) => progress.push(p.loaded)));
    expect(res).toMatchObject({ capped: false });
    expect(res.rows).toHaveLength(40);
    expect(progress).toEqual([15, 30, 40]);
    expect(src.stats.pages).toBe(3);
  });

  it("stops at ROW_CAP with capped true and rows truncated to the cap", async () => {
    const progress: number[] = [];
    const res = await createFakeSource().fetchEvents(allEvents, fakeCtx({ PAGE_SIZE: 10, ROW_CAP: 25 }, (p) => progress.push(p.loaded)));
    expect(res.capped).toBe(true);
    expect(res.rows).toHaveLength(25);
    expect(progress).toEqual([10, 20, 30]);
  });

  it("is not capped below the cap", async () => {
    const res = await createFakeSource().fetchEvents(allEvents, fakeCtx({ PAGE_SIZE: 100, ROW_CAP: TOTAL_EVENTS + 1 }));
    expect(res).toMatchObject({ capped: false });
    expect(res.rows).toHaveLength(TOTAL_EVENTS);
  });

  it("checks abort between pages and rejects with an AbortError", async () => {
    const controller = new AbortController();
    const src = createFakeSource();
    const run = src.fetchEvents(allEvents, fakeCtx({ PAGE_SIZE: 10 }, () => controller.abort(), controller.signal));
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(src.stats.pages).toBe(1);
  });

  it("rejects an already aborted aggregate", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createFakeSource().countItems(allItems, fakeCtx({}, undefined, controller.signal))).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("fake source: id lookups (spec §9.0 itemsById, §9 4.1)", () => {
  it("returns nothing and makes no batch for zero ids (decision D14)", async () => {
    const src = createFakeSource();
    expect(await src.fetchItemsByIds([], fakeCtx({}))).toEqual({ rows: [], capped: false });
    expect(await src.fetchVerdictsByIds([], fakeCtx({}))).toEqual({ rows: [], capped: false });
    expect(src.stats.idBatches).toBe(0);
  });

  it("chunks by ID_BATCH with at most INNER_CONCURRENCY in flight; missing ids are absent", async () => {
    const src = createFakeSource();
    const ids = [...ITEM_IDS, "9999_10"];
    const res = await src.fetchItemsByIds(ids, fakeCtx({ ID_BATCH: 3, INNER_CONCURRENCY: 2 }));
    expect(res.rows.map((r) => r.salesOrderId)).toEqual(ITEM_IDS);
    expect(src.stats.idBatches).toBe(14);
    expect(src.stats.maxInFlight).toBe(2);
    expect(src.stats.inFlight).toBe(0);
  });

  it("never exceeds the default INNER_CONCURRENCY", async () => {
    const src = createFakeSource();
    await src.fetchItemsByIds(ITEM_IDS, fakeCtx({ ID_BATCH: 1 }));
    expect(src.stats.maxInFlight).toBe(FIXTURE_CONFIG.INNER_CONCURRENCY);
  });

  it("caps id lookups at ROW_CAP across chunks", async () => {
    const res = await createFakeSource().fetchItemsByIds(ITEM_IDS, fakeCtx({ ID_BATCH: 10, ROW_CAP: 25 }));
    expect(res.capped).toBe(true);
    expect(res.rows).toHaveLength(25);
  });

  it("checks abort between chunks", async () => {
    const controller = new AbortController();
    const src = createFakeSource();
    const run = src.fetchItemsByIds(ITEM_IDS, fakeCtx({ ID_BATCH: 5, INNER_CONCURRENCY: 1 }, () => controller.abort(), controller.signal));
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(src.stats.idBatches).toBe(1);
  });

  it("looks verdicts up per VERDICT_ID_LOOKUP and maps the chosen verdict date", async () => {
    const ids = ["1009_10", "1011_10", "7777_10"];
    const byIn = createFakeSource();
    const rows = (await byIn.fetchVerdictsByIds(ids, fakeCtx({ VERDICT_ID_LOOKUP: "in" }))).rows;
    expect(byIn.stats.idBatches).toBe(1);
    expect(rows.map((r) => [r.otifOrderId, r.verdictDate])).toEqual([
      ["1009_10", "2026-08-30"],
      ["1011_10", "2026-08-20"],
    ]);
    const byEq = createFakeSource();
    const target = fakeCtx({ VERDICT_ID_LOOKUP: "eq", VERDICT_DATE_PROPERTY: "otifFirstInitialDeliveryDateTarget" });
    const eqRows = (await byEq.fetchVerdictsByIds(ids, target)).rows;
    expect(byEq.stats.idBatches).toBe(3);
    expect(eqRows.map((r) => r.verdictDate)).toEqual(["2026-08-28", "2026-08-29"]);
  });
});
