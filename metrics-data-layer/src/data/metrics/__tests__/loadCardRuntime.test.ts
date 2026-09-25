import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { CARD_IMPL } from "../catalogue";
import { loadCard, peekCard } from "../loadCard";
import { clearMetricsCache } from "../shared/cache";
import { withCallProgress } from "../shared/sourceCtx";
import { appSemaphore } from "../shared/concurrency";
import { createFakeSource } from "../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../source/fake/fixtures";
import type { MetricsSource } from "../source/MetricsSource";
import type { CardData, FunnelSeries, MetricResult, Progress } from "../types";
import { wrapSource } from "./helpers/wrapSource";
import { sel } from "./helpers/testKit";

const opts = (source: MetricsSource = createFakeSource()) => ({ source, now: FIXTURE_NOW, config: FIXTURE_CONFIG });

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
    // Bounded by the real clock read around the call (TST-12: no dependence on the machine's date).
    const before = Date.now();
    const r = await loadCard("rolledValue", sel(), null, { source });
    const after = Date.now();
    expect(r.status).toBe("blocked");
    expect(Date.parse(r.computedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(r.computedAt)).toBeLessThanOrEqual(after);
    expect(source.calls).toEqual([]);
  });

  it("an aborted signal gives status error aborted (TYP-07)", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await loadCard("riskDistribution", sel(), null, { ...opts(), signal: controller.signal });
    expect(r).toMatchObject({ status: "error", error: "aborted" });
  });

  it("an abort raised by the source with its own message also reads aborted (TYP-07)", async () => {
    const native = wrapSource(createFakeSource(), () => Promise.reject(new DOMException("The operation was aborted.", "AbortError")));
    const r = await loadCard("riskDistribution", sel(), null, opts(native));
    expect(r).toMatchObject({ status: "error", error: "aborted" });
  });

  it("aborting mid-load gives status error aborted", async () => {
    const controller = new AbortController();
    const source = wrapSource(createFakeSource(), () => {
      controller.abort();
    });
    const r = await loadCard("raisedToClosed", sel({ window: 7 }), null, { ...opts(source), signal: controller.signal });
    expect(r).toMatchObject({ status: "error", error: "aborted" });
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
    expect(r.progress).toEqual(seen[seen.length - 1]);
    const loaded = seen.map((p) => p.loaded);
    expect([...loaded].sort((a, b) => a - b)).toEqual(loaded);
    // Rows fetched by 4.2 at 7 d (no item dim, so no itemsById): L2("now") = L1 human events 66 (every human
    // token) + the chain 149 (the 164 events minus 13 on the 8 untouched items I1 I4 I5 I8 I27 I28 I30 I37 minus
    // A19 `up` and A24 `ag`) + touched-and-open 31 (46 touched − 15 closed A42–A56); not-worked closed events in
    // 7 d 9 (A35 A36 A40 A42 A44 A46 A49 A50 A55; A31 is open again) + opened events of their items 13 (A10 A11
    // A14 A35 A36 A42 A44 A45 A46 A49 A50 A53 A55; A40 has none) = 268.
    expect(r.progress).toEqual({ loaded: 268 });
  });
});

describe("loadCard: progress is summed per port call (D24, MOD-01)", () => {
  /** A fake whose own reports are silenced; `before` scripts the reports of the n-th paged call instead. */
  function scripted(script: readonly (readonly number[])[]): MetricsSource {
    const silent = withCallProgress(createFakeSource(), () => undefined);
    let n = 0;
    return wrapSource(silent, (method, _args, ctx) => {
      if (!method.startsWith("fetch")) return;
      for (const loaded of script[n] ?? []) ctx.onProgress?.({ loaded });
      n += 1;
    });
  }

  it("sequential fetches 500, then 1000 / 2000, total 2500 (the MOD-01 repro)", async () => {
    const seen: number[] = [];
    const r = await loadCard("raisedToClosed", sel({ window: 7 }), null, {
      ...opts(scripted([[500], [1000, 2000]])),
      onProgress: (p) => seen.push(p.loaded),
    });
    expect(seen).toEqual([500, 1500, 2500]);
    expect(r.progress).toEqual({ loaded: 2500 });
  });

  it("a fetch 1000 / 1500 then a verdict lookup 500 / 1000 / 2000 totals 3500", async () => {
    const seen: number[] = [];
    await loadCard("raisedToClosed", sel({ window: 7 }), null, {
      ...opts(scripted([[1000, 1500], [500, 1000, 2000]])),
      onProgress: (p) => seen.push(p.loaded),
    });
    expect(seen[seen.length - 1]).toBe(3500);
  });

  it("a cache hit carries no progress", async () => {
    const source = createFakeSource();
    await loadCard("raisedToClosed", sel({ window: 7 }), null, opts(source));
    const seen: Progress[] = [];
    const r = await loadCard("raisedToClosed", sel({ window: 7 }), null, { ...opts(source), onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([]);
    expect(r.progress).toBeUndefined();
  });
});

describe("MetricResult narrows on status (TYP-01)", () => {
  it("data is required after ok/partial, blocked after blocked, error after error", async () => {
    const r = await loadCard("userFunnel", sel({ window: 7 }), null, opts());
    expectTypeOf(r).toEqualTypeOf<MetricResult<CardData<FunnelSeries>>>();
    if (r.status === "ok" || r.status === "partial") {
      expectTypeOf(r.data).toEqualTypeOf<CardData<FunnelSeries>>();
      expectTypeOf(r.blocked).toEqualTypeOf<undefined>();
    } else if (r.status === "blocked") {
      expectTypeOf(r.blocked).toEqualTypeOf<{ readonly reason: typeof r.blocked.reason; readonly unblockedBy: string }>();
      expectTypeOf(r.data).toEqualTypeOf<undefined>();
    } else if (r.status === "error") {
      expectTypeOf(r.error).toEqualTypeOf<string>();
      expectTypeOf(r.data).toEqualTypeOf<undefined>();
    } else {
      expectTypeOf(r.status).toEqualTypeOf<"loading">();
      expectTypeOf(r.data).toEqualTypeOf<CardData<FunnelSeries> | undefined>();
    }
    // Spec §10 optional reads still compile on the whole union.
    expectTypeOf(r.data?.total).toEqualTypeOf<FunnelSeries | undefined>();
    expect(r.status === "ok" || r.status === "blocked").toBe(true);
  });
});
