import { beforeEach, describe, expect, it } from "vitest";
import { clearMetricsCache } from "../../shared/cache";
import { loadHumanEvents } from "../../shared/humanEvents";
import { loadNotWorkedAlerts } from "../../shared/notWorkedAlerts";
import { loadOpenAlerts } from "../../shared/openAlerts";
import { loadTouchedAlerts } from "../../shared/touchedAlerts";
import { EMPTY_FILTERS } from "../../selection";
import { flush } from "../helpers/deferred";
import { callCount, fakeDeps, win } from "../helpers/loaderDeps";

// Memo behaviour shared by every shared loader (lead decision D7, spec §11 "Shared loaders").
describe("shared loader memos", () => {
  beforeEach(() => clearMetricsCache());

  it("two concurrent cards share one fetch; L2 reuses a concurrent L1", async () => {
    const deps = fakeDeps();
    const [l1, a, b] = await Promise.all([
      loadHumanEvents(win(7), EMPTY_FILTERS, deps),
      loadTouchedAlerts(win(7), EMPTY_FILTERS, deps),
      loadTouchedAlerts(win(7), EMPTY_FILTERS, deps),
    ]);
    // One L1 fetchEvents + one chain fetchEvents + one open-ids fetch.
    expect(callCount(deps.source, "fetchEvents")).toBe(2);
    expect(callCount(deps.source, "fetchOpenAlerts")).toBe(1);
    expect(a).toBe(b);
    expect(l1.rows).toHaveLength(24);
    expect(a.rows).toHaveLength(18);
  });

  it("one caller aborting does not abort the other", async () => {
    const deps = fakeDeps();
    const ca = new AbortController();
    const pa = loadTouchedAlerts(win(7), EMPTY_FILTERS, { ...deps, signal: ca.signal });
    const pb = loadTouchedAlerts(win(7), EMPTY_FILTERS, deps);
    ca.abort();
    await expect(pa).rejects.toMatchObject({ name: "AbortError" });
    expect((await pb).rows).toHaveLength(18);
    expect(deps.source.calls).toHaveLength(3);
  });

  it("when every caller aborts the run aborts and is evicted; the next caller refetches", async () => {
    const base = fakeDeps();
    const seen: AbortSignal[] = [];
    const source = {
      ...base.source,
      fetchEvents: (...args: Parameters<typeof base.source.fetchEvents>) => {
        seen.push(args[1].signal);
        return base.source.fetchEvents(...args);
      },
    };
    const deps = { ...base, source };
    const ca = new AbortController();
    const cb = new AbortController();
    const pa = loadNotWorkedAlerts(win(7), EMPTY_FILTERS, { ...deps, signal: ca.signal });
    const pb = loadNotWorkedAlerts(win(7), EMPTY_FILTERS, { ...deps, signal: cb.signal });
    ca.abort();
    cb.abort();
    await expect(pa).rejects.toMatchObject({ name: "AbortError" });
    await expect(pb).rejects.toMatchObject({ name: "AbortError" });
    await flush();
    // The source got the memo's internal signal (not a caller's), aborted once both callers left.
    expect(seen).toHaveLength(2);
    expect(seen.every((s) => s.aborted && s !== ca.signal && s !== cb.signal)).toBe(true);
    const again = await loadNotWorkedAlerts(win(7), EMPTY_FILTERS, deps);
    expect(again.rows).toHaveLength(9);
    expect(callCount(base.source, "fetchEvents")).toBe(4);
  });

  it("an already aborted caller is rejected without a fetch", async () => {
    const ac = new AbortController();
    ac.abort();
    const deps = fakeDeps({ signal: ac.signal });
    await expect(loadOpenAlerts(EMPTY_FILTERS, deps)).rejects.toMatchObject({ name: "AbortError" });
    expect(deps.source.calls).toHaveLength(0);
  });

  it("clearMetricsCache clears every memo: the next call refetches", async () => {
    const deps = fakeDeps();
    await loadTouchedAlerts(win("now"), EMPTY_FILTERS, deps);
    await loadNotWorkedAlerts(win("now"), EMPTY_FILTERS, deps);
    await loadOpenAlerts(EMPTY_FILTERS, deps);
    expect(deps.source.calls).toHaveLength(6);
    await loadTouchedAlerts(win("now"), EMPTY_FILTERS, deps);
    expect(deps.source.calls).toHaveLength(6);
    clearMetricsCache();
    await loadTouchedAlerts(win("now"), EMPTY_FILTERS, deps);
    await loadNotWorkedAlerts(win("now"), EMPTY_FILTERS, deps);
    await loadOpenAlerts(EMPTY_FILTERS, deps);
    expect(deps.source.calls).toHaveLength(12);
  });

  it("row cap: L2 is capped when L1 or the chain is capped (D11)", async () => {
    // ROW_CAP 20: L1(7) has 24 rows → capped, so L2 is capped.
    const small = await loadTouchedAlerts(win(7), EMPTY_FILTERS, fakeDeps({ config: { ROW_CAP: 20, PAGE_SIZE: 10 } }));
    expect(small.capped).toBe(true);
    clearMetricsCache();
    // ROW_CAP 30: L1 (24) is not capped; the chain (≥ 24 human + 17 opened events) is.
    const deps = fakeDeps({ config: { ROW_CAP: 30, PAGE_SIZE: 10 } });
    const [l1, l2] = await Promise.all([
      loadHumanEvents(win(7), EMPTY_FILTERS, deps),
      loadTouchedAlerts(win(7), EMPTY_FILTERS, deps),
    ]);
    expect(l1.capped).toBe(false);
    expect(l2.capped).toBe(true);
  });

  it("a source error rejects every caller and is evicted", async () => {
    const deps = fakeDeps();
    const failing = { ...deps, source: { ...deps.source, fetchOpenAlerts: () => Promise.reject(new Error("boom")) } };
    await expect(loadOpenAlerts(EMPTY_FILTERS, failing)).rejects.toThrow("boom");
    expect((await loadOpenAlerts(EMPTY_FILTERS, deps)).rows).toHaveLength(48);
  });
});
