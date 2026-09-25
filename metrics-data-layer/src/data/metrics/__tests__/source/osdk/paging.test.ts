// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fetchAllPages, fetchFirstPage, fetchMapped } from "../../../source/osdk/paging";
import { EVENT_SELECT } from "../../../source/osdk/rowMapping";
import type { WireBody } from "../../helpers/recordingClient";
import { makeCtx, setup } from "../../helpers/osdkHarness";

// Tests of source/osdk/paging.ts (spec §9.0 fetchAllPages; instructions §5 rule 6; lead note L1).
const event = (i: number) => ({ riskAlertId: `a${i}`, eventType: "closed", eventTimestamp: "2026-09-01T00:00:00Z" });
const tokenOf = (b: WireBody): unknown => b.pageToken;

/** A server with `pages` pages of `per` events each, linked by tokens p1, p2, … */
function pagedEvents(pages: number, per: number) {
  return (b: WireBody) => {
    const n = typeof b.pageToken === "string" ? Number(b.pageToken.slice(1)) : 0;
    const data = Array.from({ length: per }, (_, i) => event(n * per + i));
    return { data, nextPageToken: n + 1 < pages ? `p${n + 1}` : undefined };
  };
}

/** A page function over fixed pages of numbers. */
const pagesOf = (pages: readonly (readonly number[])[]) => (token: string | undefined) => {
  const n = token === undefined ? 0 : Number(token);
  return Promise.resolve({ data: [...pages[n]], nextPageToken: n + 1 < pages.length ? String(n + 1) : undefined, totalCount: "0" });
};
const live = (): AbortSignal => new AbortController().signal;

describe("paged fetches (spec §9.0 fetchAllPages)", () => {
  it("follows nextPageToken with PAGE_SIZE and a literal $select, reporting progress", async () => {
    const t = setup();
    t.handlers.load = pagedEvents(3, 2);
    const ctx = makeCtx({ PAGE_SIZE: 2 });
    const out = await t.source.fetchEvents({ kind: "all" }, ctx);
    expect(out.capped).toBe(false);
    expect(out.rows.map((r) => r.riskAlertId)).toEqual(["a0", "a1", "a2", "a3", "a4", "a5"]);
    expect(t.requests.map((r) => tokenOf(r.body))).toEqual([undefined, "p1", "p2"]);
    expect(t.requests.every((r) => r.body.pageSize === 2)).toBe(true);
    expect(t.requests[0].body.select).toEqual([...EVENT_SELECT]);
    expect(ctx.progress).toEqual([{ loaded: 2 }, { loaded: 4 }, { loaded: 6 }]);
  });

  it("stops at ROW_CAP with capped", async () => {
    const t = setup();
    t.handlers.load = pagedEvents(100, 2);
    const out = await t.source.fetchEvents({ kind: "all" }, makeCtx({ PAGE_SIZE: 2, ROW_CAP: 5 }));
    expect(out.rows).toHaveLength(5);
    expect(out.capped).toBe(true);
    expect(t.requests).toHaveLength(3);
  });

  it("is capped when the rows reach ROW_CAP exactly, even on the last page (spec §9.0 rows.length >= ROW_CAP; L1)", async () => {
    const t = setup();
    t.handlers.load = pagedEvents(2, 2);
    const out = await t.source.fetchEvents({ kind: "all" }, makeCtx({ PAGE_SIZE: 2, ROW_CAP: 4 }));
    expect(out).toMatchObject({ capped: true });
    expect(out.rows).toHaveLength(4);
    expect(t.requests).toHaveLength(2);
  });

  it("is not capped below ROW_CAP", async () => {
    const t = setup();
    t.handlers.load = pagedEvents(2, 2);
    const out = await t.source.fetchEvents({ kind: "all" }, makeCtx({ PAGE_SIZE: 2, ROW_CAP: 5 }));
    expect(out).toMatchObject({ capped: false });
    expect(out.rows).toHaveLength(4);
  });

  it("checks the signal between pages and rejects with AbortError", async () => {
    const t = setup();
    const ctx = makeCtx({ PAGE_SIZE: 2 });
    const serve = pagedEvents(5, 2);
    t.handlers.load = (b) => {
      ctx.controller.abort();
      return serve(b);
    };
    await expect(t.source.fetchEvents({ kind: "all" }, ctx)).rejects.toMatchObject({ name: "AbortError" });
    expect(t.requests).toHaveLength(1);
  });

});

describe("paging helpers (unit)", () => {
  it("fetchAllPages tolerates a missing data array and a null token", async () => {
    const page = () => Promise.resolve({ data: [], nextPageToken: undefined, totalCount: "0" });
    expect(await fetchAllPages(page, live(), 10, () => undefined)).toEqual({ rows: [], capped: false });
  });

  it("fetchAllPages reports capped when the rows reach the cap exactly (spec §9.0, lead note L1)", async () => {
    const page = () => Promise.resolve({ data: [1, 2], nextPageToken: undefined, totalCount: "2" });
    expect(await fetchAllPages(page, live(), 2, () => undefined)).toEqual({ rows: [1, 2], capped: true });
  });

  it("fetchAllPages slices the page that crosses the cap and reports only the kept rows", async () => {
    const kept: number[] = [];
    // pages [1,2,3] [4,5,6] [7,8]; cap 5 → 3 kept, then 2 of the second page; the third is never requested.
    const out = await fetchAllPages(pagesOf([[1, 2, 3], [4, 5, 6], [7, 8]]), live(), 5, (n) => kept.push(n));
    expect(out).toEqual({ rows: [1, 2, 3, 4, 5], capped: true });
    expect(kept).toEqual([3, 2]);
  });

  it("fetchAllPages rejects before the first page when the signal is already aborted", async () => {
    const c = new AbortController();
    c.abort();
    let calls = 0;
    const page = () => {
      calls += 1;
      return Promise.resolve({ data: [1], nextPageToken: undefined, totalCount: "1" });
    };
    await expect(fetchAllPages(page, c.signal, 10, () => undefined)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
  });

  it("fetchMapped drops rows the mapper rejects (D15) and keeps capped", async () => {
    const ctx = { signal: live(), config: { ROW_CAP: 3 } };
    const out = await fetchMapped(pagesOf([[1, 2], [3, 4]]), (n) => (n % 2 === 0 ? `r${n}` : null), ctx, () => undefined);
    expect(out).toEqual({ rows: ["r2"], capped: true });
  });

  it("fetchFirstPage requests one page, keeps `limit` rows, never caps, and checks abort first", async () => {
    const tokens: (string | undefined)[] = [];
    const page = (token: string | undefined) => {
      tokens.push(token);
      return Promise.resolve({ data: [1, 2, 3], nextPageToken: "more", totalCount: "3" });
    };
    const kept: number[] = [];
    const out = await fetchFirstPage(page, (n) => (n === 2 ? null : n * 10), live(), 2, (n) => kept.push(n));
    expect(out).toEqual({ rows: [10], capped: false });
    expect(tokens).toEqual([undefined]);
    expect(kept).toEqual([2]);
    const c = new AbortController();
    c.abort();
    await expect(fetchFirstPage(page, (n) => n, c.signal, 1, () => undefined)).rejects.toMatchObject({ name: "AbortError" });
    expect(tokens).toHaveLength(1);
  });
});
