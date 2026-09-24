import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMetricsCache,
  getCached,
  getCacheVersion,
  getOrLoad,
  registerMemo,
  setCached,
  subscribeCacheVersion,
} from "../../shared/cache";
import type { LoaderOutput, OtifOutcomeRaw } from "../../types";
import { resolveWindow } from "../../window";
import { deferred, flush } from "./deferred";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const RAW: OtifOutcomeRaw = {
  window: resolveWindow(30, NOW),
  dimension: null,
  mode: "otif",
  totals: [],
  workedIds: [],
  verdicts: [],
};
const OUT: LoaderOutput<OtifOutcomeRaw> = { raw: RAW, status: "ok", caveats: [] };

describe("metrics cache (D5)", () => {
  beforeEach(() => clearMetricsCache());

  it("set/get per card and key, computedAt from now", () => {
    expect(getCached("otifOutcome", "k")).toBeUndefined();
    const entry = setCached("otifOutcome", "k", OUT, NOW);
    expect(entry).toEqual({ output: OUT, computedAt: "2026-09-24T12:00:00.000Z" });
    expect(getCached("otifOutcome", "k")).toBe(entry);
    expect(getCached("ageingBacklog", "k")).toBeUndefined();
  });

  it("getOrLoad loads once, dedupes concurrent callers and caches", async () => {
    const d = deferred<LoaderOutput<OtifOutcomeRaw>>();
    const load = vi.fn(() => d.promise);
    const a = getOrLoad("otifOutcome", "k", load, NOW);
    const b = getOrLoad("otifOutcome", "k", load, NOW, new AbortController().signal);
    d.resolve(OUT);
    const [ea, eb] = await Promise.all([a, b]);
    expect(ea).toBe(eb);
    expect(ea.computedAt).toBe(NOW.toISOString());
    expect(getCached("otifOutcome", "k")).toBe(ea);
    expect(await getOrLoad("otifOutcome", "k", load, NOW)).toBe(ea);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("evicts a failed load so the next call retries", async () => {
    await expect(getOrLoad("otifOutcome", "k", () => Promise.reject(new Error("x")), NOW)).rejects.toThrow("x");
    expect(getCached("otifOutcome", "k")).toBeUndefined();
    const entry = await getOrLoad("otifOutcome", "k", () => Promise.resolve(OUT), NOW);
    expect(entry.output).toBe(OUT);
  });

  it("one caller aborting leaves the other; all aborting aborts the load", async () => {
    const d = deferred<LoaderOutput<OtifOutcomeRaw>>();
    let internal: AbortSignal | undefined;
    const load = (s: AbortSignal) => {
      internal = s;
      return d.promise;
    };
    const ca = new AbortController();
    const cb = new AbortController();
    const a = getOrLoad("otifOutcome", "k", load, NOW, ca.signal);
    const b = getOrLoad("otifOutcome", "k", load, NOW, cb.signal);
    ca.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(internal?.aborted).toBe(false);
    cb.abort();
    await expect(b).rejects.toMatchObject({ name: "AbortError" });
    expect(internal?.aborted).toBe(true);
    const fresh = vi.fn(() => Promise.resolve(OUT));
    await getOrLoad("otifOutcome", "k", fresh, NOW);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("rejects an already aborted caller on a miss but serves a hit", async () => {
    const load = vi.fn(() => Promise.resolve(OUT));
    await expect(getOrLoad("otifOutcome", "k", load, NOW, AbortSignal.abort())).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(load).not.toHaveBeenCalled();
    setCached("otifOutcome", "k", OUT, NOW);
    expect((await getOrLoad("otifOutcome", "k", load, NOW, AbortSignal.abort())).output).toBe(OUT);
  });

  it("clearMetricsCache clears maps and memos, bumps the version and notifies", async () => {
    setCached("otifOutcome", "k", OUT, NOW);
    const memoClear = vi.fn();
    const unregister = registerMemo(memoClear);
    const cb = vi.fn();
    const unsubscribe = subscribeCacheVersion(cb);
    const v0 = getCacheVersion();
    clearMetricsCache();
    expect(getCached("otifOutcome", "k")).toBeUndefined();
    expect(memoClear).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getCacheVersion()).toBe(v0 + 1);
    unregister();
    unsubscribe();
    clearMetricsCache();
    expect(memoClear).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not store a load that was in flight during a clear", async () => {
    const d = deferred<LoaderOutput<OtifOutcomeRaw>>();
    const pending = getOrLoad("otifOutcome", "k", () => d.promise, NOW);
    clearMetricsCache();
    const second = vi.fn(() => Promise.resolve(OUT));
    const next = getOrLoad("otifOutcome", "k", second, NOW);
    expect(second).toHaveBeenCalledTimes(1);
    d.resolve(OUT);
    await pending;
    await next;
    await flush();
    expect(getCached("otifOutcome", "k")?.output).toBe(OUT);
    clearMetricsCache();
    const d2 = deferred<LoaderOutput<OtifOutcomeRaw>>();
    const stale = getOrLoad("otifOutcome", "k", () => d2.promise, NOW);
    clearMetricsCache();
    d2.resolve(OUT);
    await stale;
    await flush();
    expect(getCached("otifOutcome", "k")).toBeUndefined();
  });
});
