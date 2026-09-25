import { beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_IMPL } from "../catalogue";
import { createProgressSum, loadCard, peekCard } from "../loadCard";
import { DEFAULT_SELECTION } from "../selection";
import { clearMetricsCache } from "../shared/cache";
import { appSemaphore } from "../shared/concurrency";
import { createFakeSource } from "../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../source/fake/fixtures";
import type { MetricsSource } from "../source/MetricsSource";
import type { Progress, Selection } from "../types";
import { wrapSource } from "./loadCardTestUtils";

const opts = (source: MetricsSource = createFakeSource()) => ({ source, now: FIXTURE_NOW, config: FIXTURE_CONFIG });
const sel = (over: Partial<Selection> = {}): Selection => ({ ...DEFAULT_SELECTION, ...over });

beforeEach(() => {
  clearMetricsCache();
});

describe("loadCard: errors, abort, concurrency, progress", () => {
  it("never throws: a failing source becomes status error with its message", async () => {
    const failing = wrapSource(createFakeSource(), () => Promise.reject(new Error("source down")));
    const r = await loadCard("riskDistribution", sel(), null, opts(failing));
    expect(r).toMatchObject({ status: "error", error: "source down", caveats: [] });
    expect(peekCard("riskDistribution", sel(), null, FIXTURE_CONFIG, FIXTURE_NOW)).toBeNull();
  });

  it("defaults config and now (a stub is blocked at the current time, no calls)", async () => {
    const source = createFakeSource();
    const r = await loadCard("rolledValue", sel(), null, { source });
    expect(r.status).toBe("blocked");
    expect(Date.parse(r.computedAt)).toBeGreaterThan(FIXTURE_NOW.getTime());
    expect(source.calls).toEqual([]);
  });

  it("an aborted signal gives status error AbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await loadCard("riskDistribution", sel(), null, { ...opts(), signal: controller.signal });
    expect(r).toMatchObject({ status: "error", error: "AbortError" });
  });

  it("a failing derive becomes status error (loadCard and peekCard)", async () => {
    const source = createFakeSource();
    await loadCard("otifOutcome", sel(), null, opts(source));
    const spy = vi.spyOn(CARD_IMPL.otifOutcome, "derive").mockImplementation(() => {
      throw new Error("derive failed");
    });
    try {
      expect(peekCard("otifOutcome", sel(), null, FIXTURE_CONFIG, FIXTURE_NOW)).toMatchObject({ status: "error", error: "derive failed" });
      expect(await loadCard("otifOutcome", sel(), null, opts(source))).toMatchObject({ status: "error" });
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps at most 4 card loads in flight (app semaphore) and queues the rest", async () => {
    let maxInUse = 0;
    let maxWaiting = 0;
    const source = wrapSource(createFakeSource(), async () => {
      maxInUse = Math.max(maxInUse, appSemaphore.inUse());
      maxWaiting = Math.max(maxWaiting, appSemaphore.waiting());
      await new Promise((r) => setTimeout(r, 1));
    });
    const cards = ["userFunnel", "itemFunnel", "riskDistribution", "otifOutcome", "raisedToClosed",
      "raisedToFirstView", "firstViewToClosure", "ageingBacklog", "closureComposition"] as const;
    const results = await Promise.all(cards.map((c) => loadCard(c, sel({ window: 14 }), null, opts(source))));
    expect(results.map((r) => r.status).every((s) => s === "ok" || s === "partial")).toBe(true);
    expect(maxInUse).toBe(4);
    expect(maxWaiting).toBeGreaterThan(0);
    expect(appSemaphore.inUse()).toBe(0);
  });

  it("reports cumulative progress across fetches and puts the last value on the result", async () => {
    const seen: Progress[] = [];
    const r = await loadCard("raisedToClosed", sel({ window: 7 }), null, { ...opts(), onProgress: (p) => seen.push(p) });
    expect(seen.length).toBeGreaterThan(0);
    expect(r.progress).toEqual(seen[seen.length - 1]);
    const loaded = seen.map((p) => p.loaded);
    expect([...loaded].sort((a, b) => a - b)).toEqual(loaded);
  });
});

describe("createProgressSum (D24)", () => {
  it("sums interleaved per-fetch cumulative counts", () => {
    const totals: number[] = [];
    const sum = createProgressSum((p) => totals.push(p.loaded));
    expect(sum.last()).toBeUndefined();
    // Fetch A: 1000, 2000; fetch B (parallel): 1000, 1500; fetch C starts after: 300.
    for (const loaded of [1000, 1000, 2000, 1500, 300]) sum.report({ loaded });
    expect(totals).toEqual([1000, 2000, 3000, 3500, 3800]);
    expect(sum.last()).toEqual({ loaded: 3800 });
  });

  it("works without a sink", () => {
    const sum = createProgressSum(undefined);
    sum.report({ loaded: 5 });
    expect(sum.last()).toEqual({ loaded: 5 });
  });
});
