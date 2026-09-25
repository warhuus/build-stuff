import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearMetricsCache } from "../../shared/cache";
import { createSharedMemo, memoKey } from "../../shared/memo";
import { EMPTY_FILTERS } from "../../selection";
import { deferred, flush } from "../helpers/deferred";

describe("createSharedMemo (D7)", () => {
  beforeEach(() => clearMetricsCache());

  it("shares one in-flight run between concurrent callers and keeps the value", async () => {
    const memo = createSharedMemo<string, number>();
    const d = deferred<number>();
    const run = vi.fn(() => d.promise);
    const a = memo.get("k", run);
    const b = memo.get("k", run, new AbortController().signal);
    expect(memo.peek("k")).toBeUndefined();
    d.resolve(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(await memo.get("k", run)).toBe(7);
    expect(run).toHaveBeenCalledTimes(1);
    expect(memo.peek("k")).toBe(7);
    expect(memo.size()).toBe(1);
  });

  it("one caller aborting does not abort the other", async () => {
    const memo = createSharedMemo<string, number>();
    const d = deferred<number>();
    let internal: AbortSignal | undefined;
    const run = (s: AbortSignal) => {
      internal = s;
      return d.promise;
    };
    const ca = new AbortController();
    const cb = new AbortController();
    const a = memo.get("k", run, ca.signal);
    const b = memo.get("k", run, cb.signal);
    ca.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(internal?.aborted).toBe(false);
    d.resolve(3);
    expect(await b).toBe(3);
    expect(memo.peek("k")).toBe(3);
  });

  it("aborts the run when every caller aborted and evicts it", async () => {
    const memo = createSharedMemo<string, number>();
    const signals: AbortSignal[] = [];
    const run = vi.fn((s: AbortSignal) => {
      signals.push(s);
      return new Promise<number>((_, reject) => s.addEventListener("abort", () => reject(s.reason)));
    });
    const ca = new AbortController();
    const cb = new AbortController();
    const a = memo.get("k", run, ca.signal);
    const b = memo.get("k", run, cb.signal);
    ca.abort();
    cb.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    await expect(b).rejects.toMatchObject({ name: "AbortError" });
    expect(signals[0].aborted).toBe(true);
    expect(memo.size()).toBe(0);
    const retry = memo.get("k", () => Promise.resolve(9));
    expect(await retry).toBe(9);
  });

  it("a caller without signal keeps the run alive", async () => {
    const memo = createSharedMemo<string, number>();
    const d = deferred<number>();
    let internal: AbortSignal | undefined;
    const c = new AbortController();
    const pinned = memo.get("k", (s) => {
      internal = s;
      return d.promise;
    });
    const a = memo.get("k", () => d.promise, c.signal);
    c.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(internal?.aborted).toBe(false);
    d.resolve(1);
    expect(await pinned).toBe(1);
  });

  it("evicts a rejected entry so the next caller retries", async () => {
    const memo = createSharedMemo<string, number>();
    await expect(memo.get("k", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(memo.size()).toBe(0);
    expect(await memo.get("k", () => Promise.resolve(2))).toBe(2);
  });

  it("turns a synchronous throw into a rejection", async () => {
    const memo = createSharedMemo<string, number>();
    const run = (): Promise<number> => {
      throw new Error("sync");
    };
    await expect(memo.get("k", run)).rejects.toThrow("sync");
    expect(memo.size()).toBe(0);
  });

  it("rejects an already aborted caller without starting a run", async () => {
    const memo = createSharedMemo<string, number>();
    const run = vi.fn(() => Promise.resolve(1));
    await expect(memo.get("k", run, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(run).not.toHaveBeenCalled();
    await memo.get("k", run);
    expect(await memo.get("k", run, AbortSignal.abort())).toBe(1);
  });

  it("an aborted caller joining an unshared run abandons it", async () => {
    const memo = createSharedMemo<string, number>();
    const d = deferred<number>();
    let internal: AbortSignal | undefined;
    const c = new AbortController();
    const a = memo.get("k", (s) => {
      internal = s;
      return d.promise;
    }, c.signal);
    c.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(internal?.aborted).toBe(true);
    d.resolve(5);
    await flush();
    expect(memo.peek("k")).toBeUndefined();
  });

  it("is cleared by clearMetricsCache and does not store runs started before the clear", async () => {
    const memo = createSharedMemo<string, number>();
    await memo.get("a", () => Promise.resolve(1));
    const d = deferred<number>();
    const pending = memo.get("b", () => d.promise);
    clearMetricsCache();
    expect(memo.size()).toBe(0);
    d.resolve(2);
    expect(await pending).toBe(2);
    expect(memo.peek("b")).toBeUndefined();
    const run = vi.fn(() => Promise.resolve(3));
    expect(await memo.get("a", run)).toBe(3);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("clear() alone empties the memo", async () => {
    const memo = createSharedMemo<string, number>();
    await memo.get("a", () => Promise.resolve(1));
    memo.clear();
    expect(memo.peek("a")).toBeUndefined();
  });

  it("memoKey is window.key | filtersKey, or filtersKey alone without a window (spec §11)", () => {
    const w = { key: 7, start: "2026-09-17T00:00:00.000Z", end: "2026-09-24T00:00:00.000Z" } as const;
    expect(memoKey(w, { ...EMPTY_FILTERS, region: ["EMEA", "AMER", "AMER"] })).toBe("7|bl=;pl=;rg=AMER,EMEA;pt=");
    expect(memoKey(null, EMPTY_FILTERS)).toBe("bl=;pl=;rg=;pt=");
  });
});
