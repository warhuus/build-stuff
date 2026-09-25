import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { METRICS_CONFIG, type MetricsConfig } from "../../../../config/metrics";
import { MetricsSourceProvider } from "../../hooks/MetricsSourceContext";
import { useMetric } from "../../hooks/useMetric";
import { loadCard } from "../../loadCard";
import { DEFAULT_SELECTION } from "../../selection";
import { clearMetricsCache } from "../../shared/cache";
import { createFakeSource } from "../../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../../source/fake/fixtures";
import type { MetricsSource } from "../../source/MetricsSource";
import type {
  AgeingBacklog,
  BucketRow,
  CalibrationRow,
  CardData,
  CompositionResult,
  DurationResult,
  FunnelSeries,
  MetricResult,
  MovementRow,
  OutcomeHeadline,
  RolledMonthRow,
  Selection,
} from "../../types";
import { gatedUserSource, wrapSource } from "../loadCardTestUtils";
import { deferred, flush } from "../shared/deferred";

const clock = (): Date => FIXTURE_NOW;
const sel = (over: Partial<Selection> = {}): Selection => ({ ...DEFAULT_SELECTION, ...over });

function wrapperFor(source: MetricsSource, config: MetricsConfig = FIXTURE_CONFIG) {
  return ({ children }: { children: ReactNode }) =>
    createElement(MetricsSourceProvider, { source, config, now: clock }, children);
}

beforeEach(() => {
  clearMetricsCache();
});
afterEach(() => {
  cleanup();
});

describe("useMetric: every card, typed by card id (instructions §7)", () => {
  it("returns each card's T without casts and settles every card", async () => {
    const wrapper = wrapperFor(createFakeSource());
    const s = sel({ window: 7 });
    const { result } = renderHook(
      () => ({
        userFunnel: useMetric("userFunnel", s),
        itemFunnel: useMetric("itemFunnel", s),
        risk: useMetric("riskDistribution", s),
        otif: useMetric("otifOutcome", s),
        r2c: useMetric("raisedToClosed", s),
        r2v: useMetric("raisedToFirstView", s),
        v2c: useMetric("firstViewToClosure", s),
        ageing: useMetric("ageingBacklog", s),
        closure: useMetric("closureComposition", s),
        movement: useMetric("riskMovement", s),
        calibration: useMetric("riskCalibration", s),
        rolled: useMetric("rolledValue", s),
      }),
      { wrapper },
    );
    const r = result.current;
    expectTypeOf(r.userFunnel).toEqualTypeOf<MetricResult<CardData<FunnelSeries>>>();
    expectTypeOf(r.itemFunnel).toEqualTypeOf<MetricResult<CardData<FunnelSeries>>>();
    expectTypeOf(r.risk).toEqualTypeOf<MetricResult<CardData<readonly BucketRow[]>>>();
    expectTypeOf(r.otif).toEqualTypeOf<MetricResult<CardData<OutcomeHeadline>>>();
    expectTypeOf(r.r2c).toEqualTypeOf<MetricResult<CardData<DurationResult>>>();
    expectTypeOf(r.r2v).toEqualTypeOf<MetricResult<CardData<DurationResult>>>();
    expectTypeOf(r.v2c).toEqualTypeOf<MetricResult<CardData<DurationResult>>>();
    expectTypeOf(r.ageing).toEqualTypeOf<MetricResult<CardData<AgeingBacklog>>>();
    expectTypeOf(r.closure).toEqualTypeOf<MetricResult<CardData<CompositionResult>>>();
    expectTypeOf(r.movement).toEqualTypeOf<MetricResult<CardData<readonly MovementRow[]>>>();
    expectTypeOf(r.calibration).toEqualTypeOf<MetricResult<CardData<readonly CalibrationRow[]>>>();
    expectTypeOf(r.rolled).toEqualTypeOf<MetricResult<CardData<readonly RolledMonthRow[]>>>();
    // Blocked stubs are settled synchronously, on the first render.
    expect(r.movement.status).toBe("blocked");
    // No previous result: computedAt is the request time (SPF-02).
    expect(r.itemFunnel).toMatchObject({ status: "loading", caveats: [], computedAt: FIXTURE_NOW.toISOString() });
    await waitFor(() => {
      const statuses = Object.values(result.current).map((x) => x.status);
      expect(statuses.filter((st) => st === "loading")).toEqual([]);
    });
    expect(result.current.r2c.data?.total.series.find((x) => x.key === "worked")?.n).toBe(6);
    expect(result.current.closure.data?.total.closedTotal).toBe(9);
    expect(result.current.itemFunnel.status).toBe("ok");
  });

  it("gives the same result as loadCard", async () => {
    const source = createFakeSource();
    const { result } = renderHook(() => useMetric("ageingBacklog", sel()), { wrapper: wrapperFor(source) });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const direct = await loadCard("ageingBacklog", sel(), null, { source, now: FIXTURE_NOW, config: FIXTURE_CONFIG });
    // Identical except `progress`, which only the load that fetched carries (D24).
    expect(result.current).toEqual({ ...direct, progress: result.current.progress });
  });
});

describe("useMetric: cache (spec §11)", () => {
  it("returns a cached key synchronously, without calls", async () => {
    const source = createFakeSource();
    await loadCard("riskDistribution", sel(), null, { source, now: FIXTURE_NOW, config: FIXTURE_CONFIG });
    const calls = source.calls.length;
    const { result } = renderHook(() => useMetric("riskDistribution", sel()), { wrapper: wrapperFor(source) });
    expect(result.current.status).toBe("ok");
    expect(result.current.data?.total).toHaveLength(14);
    await flush();
    expect(source.calls).toHaveLength(calls);
  });

  it("re-derives unit and threshold changes synchronously, without a refetch", async () => {
    const source = createFakeSource();
    const { result, rerender } = renderHook(({ s }) => useMetric("ageingBacklog", s), {
      wrapper: wrapperFor(source),
      initialProps: { s: sel() },
    });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const calls = source.calls.length;
    rerender({ s: sel({ ageingThresholdDays: 7, unit: "valueUsd" }) });
    expect(result.current.status).toBe("ok");
    expect(result.current.data?.total.threshold.days).toBe(7);
    await flush();
    expect(source.calls).toHaveLength(calls);
  });

  it("refetches when clearMetricsCache bumps the version, keeping the data while loading", async () => {
    const source = createFakeSource();
    const { result } = renderHook(() => useMetric("riskDistribution", sel()), { wrapper: wrapperFor(source) });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const before = result.current;
    const calls = source.calls.length;
    act(() => clearMetricsCache());
    expect(result.current).toMatchObject({ status: "loading", data: before.data, computedAt: before.computedAt });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(source.calls.length).toBe(2 * calls);
  });
});

describe("useMetric: loading, stale responses, abort", () => {
  it("keeps the previous data while loading a new key", async () => {
    const gate30 = deferred<void>();
    const { source } = gatedUserSource({ "30": gate30 });
    const { result, rerender } = renderHook(({ s }) => useMetric("userFunnel", s), {
      wrapper: wrapperFor(source),
      initialProps: { s: sel({ window: 7 }) },
    });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const seven = result.current;
    rerender({ s: sel({ window: 30 }) });
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBe(seven.data);
    expect(result.current.caveats).toEqual(seven.caveats);
    expect(result.current.computedAt).toBe(seven.computedAt);
    expect(result.current.window.key).toBe(30);
    await act(async () => gate30.resolve());
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.total.window).toBe(30);
  });

  it("aborts on key change and ignores the stale response", async () => {
    const gate7 = deferred<void>();
    const gate30 = deferred<void>();
    const { source, signals } = gatedUserSource({ "7": gate7, "30": gate30 });
    const { result, rerender } = renderHook(({ s }) => useMetric("userFunnel", s), {
      wrapper: wrapperFor(source),
      initialProps: { s: sel({ window: 7 }) },
    });
    await waitFor(() => expect(signals).toHaveLength(1));
    rerender({ s: sel({ window: 30 }) });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    await act(async () => gate30.resolve());
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await act(async () => {
      gate7.resolve();
      await flush();
    });
    expect(result.current.status).toBe("ok");
    expect(result.current.window.key).toBe(30);
    expect(result.current.data?.total.window).toBe(30);
  });

  it("aborts on unmount", async () => {
    const { source, signals } = gatedUserSource({ "30": deferred<void>() });
    const { unmount } = renderHook(() => useMetric("userFunnel", sel()), { wrapper: wrapperFor(source) });
    await waitFor(() => expect(signals).toHaveLength(1));
    unmount();
    expect(signals[0].aborted).toBe(true);
  });
});

describe("useMetric: errors and blocked cards never throw", () => {
  it("captures a source error as status error", async () => {
    const failing = wrapSource(createFakeSource(), () => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => useMetric("closureComposition", sel()), { wrapper: wrapperFor(failing) });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ error: "boom", caveats: [] });
  });

  it("returns breakdown-not-allowed and placeholder blocks synchronously, with no calls", async () => {
    const source = createFakeSource();
    const { result } = renderHook(
      () => ({
        notAllowed: useMetric("closureComposition", sel(), "region"),
        user: useMetric("userFunnel", sel()),
        otif: useMetric("otifOutcome", sel()),
      }),
      { wrapper: wrapperFor(source, METRICS_CONFIG) },
    );
    expect(result.current.notAllowed).toMatchObject({ status: "error", error: "breakdown-not-allowed" });
    expect(result.current.user).toMatchObject({ status: "blocked", caveats: ["needs-integration-value"] });
    expect(result.current.otif.blocked?.reason).toBe("needs-integration-value");
    await flush();
    expect(source.calls).toEqual([]);
  });

  it("reports progress while loading", async () => {
    const gate = deferred<void>();
    const source = wrapSource(createFakeSource(), (method) => (method === "fetchOpenAlerts" ? gate.promise : undefined));
    const { result } = renderHook(() => useMetric("raisedToClosed", sel({ window: 7 })), { wrapper: wrapperFor(source) });
    await waitFor(() => expect(result.current.progress?.loaded).toBeGreaterThan(0));
    expect(result.current.status).toBe("loading");
    await act(async () => gate.resolve());
    await waitFor(() => expect(result.current.status).toBe("ok"));
  });

  it("puts the load's progress on the settled result", async () => {
    const { result } = renderHook(() => useMetric("raisedToClosed", sel({ window: 7 })), {
      wrapper: wrapperFor(createFakeSource()),
    });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.progress?.loaded).toBeGreaterThan(0);
  });
});
