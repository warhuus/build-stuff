import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import { MetricsSourceProvider, useMetricsEnvironment, useMetricsSource } from "../../hooks/MetricsSourceContext";
import { useMetric } from "../../hooks/useMetric";
import { DEFAULT_SELECTION } from "../../selection";
import { clearMetricsCache } from "../../shared/cache";
import { createFakeSource } from "../../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../../source/fake/fixtures";
import { getDefaultOsdkSource } from "../../source/osdk/defaultSource";
import type { Selection } from "../../types";
import { wrapSource } from "../loadCardTestUtils";
import { deferred, flush } from "../shared/deferred";

const sel = (over: Partial<Selection> = {}): Selection => ({ ...DEFAULT_SELECTION, ...over });

beforeEach(() => {
  clearMetricsCache();
});
afterEach(() => {
  cleanup();
});

describe("MetricsSourceContext", () => {
  it("defaults to the memoised OSDK source, METRICS_CONFIG and the current time without a provider", () => {
    const { result, rerender } = renderHook(() => useMetricsEnvironment());
    const env = result.current;
    expect(env.source).toBe(getDefaultOsdkSource());
    expect(env.config).toBe(METRICS_CONFIG);
    expect(env.now()).toBeInstanceOf(Date);
    rerender();
    expect(result.current).toBe(env);
  });

  it("uses the defaults under a provider without overrides", () => {
    const wrapper = ({ children }: { children: ReactNode }) => createElement(MetricsSourceProvider, {}, children);
    const { result } = renderHook(() => useMetricsSource(), { wrapper });
    expect(result.current).toBe(getDefaultOsdkSource());
  });

  it("provides the given source and fills the other fields with defaults", () => {
    const source = createFakeSource();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(MetricsSourceProvider, { source }, children);
    const { result } = renderHook(() => useMetricsEnvironment(), { wrapper });
    expect(result.current.source).toBe(source);
    expect(result.current.config).toBe(METRICS_CONFIG);
  });

  it("provides a config override with the default source", () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MetricsSourceProvider, { config: FIXTURE_CONFIG }, children);
    const { result } = renderHook(() => useMetricsEnvironment(), { wrapper });
    expect(result.current.source).toBe(getDefaultOsdkSource());
    expect(result.current.config).toBe(FIXTURE_CONFIG);
  });
});

describe("MetricsSourceProvider memoisation (TYP-06)", () => {
  it("keeps the environment across renders with an inline clock function, reading the latest function", () => {
    const source = createFakeSource();
    let t = FIXTURE_NOW.getTime();
    const { result, rerender } = renderHook(() => useMetricsEnvironment(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(MetricsSourceProvider, { source, config: FIXTURE_CONFIG, now: () => new Date(t) }, children),
    });
    const env = result.current;
    t += 1000;
    rerender();
    expect(result.current).toBe(env);
    expect(result.current.now().getTime()).toBe(FIXTURE_NOW.getTime() + 1000);
  });

  it("keys a pinned Date on its instant", () => {
    const source = createFakeSource();
    let at = new Date(FIXTURE_NOW.getTime());
    const { result, rerender } = renderHook(() => useMetricsEnvironment(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(MetricsSourceProvider, { source, config: FIXTURE_CONFIG, now: at }, children),
    });
    const env = result.current;
    expect(env.now()).toEqual(FIXTURE_NOW);
    at = new Date(FIXTURE_NOW.getTime());
    rerender();
    expect(result.current).toBe(env);
    at = new Date(FIXTURE_NOW.getTime() + 1);
    rerender();
    expect(result.current).not.toBe(env);
    expect(result.current.now().getTime()).toBe(FIXTURE_NOW.getTime() + 1);
  });

  it("rebuilds the environment when the source identity changes", () => {
    let source = createFakeSource();
    const { result, rerender } = renderHook(() => useMetricsEnvironment(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(MetricsSourceProvider, { source, config: FIXTURE_CONFIG }, children),
    });
    const env = result.current;
    source = createFakeSource();
    rerender();
    expect(result.current).not.toBe(env);
    expect(result.current.source).toBe(source);
  });
});

describe("useMetric: provider props (TYP-06)", () => {
  it("an inline now prop re-rendered by the parent does not restart loads", async () => {
    const gate = deferred<void>();
    let calls = 0;
    const source = wrapSource(createFakeSource(), (method) => {
      if (method !== "countRisk") return undefined;
      calls += 1;
      return gate.promise;
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MetricsSourceProvider, { source, config: FIXTURE_CONFIG, now: () => FIXTURE_NOW }, children);
    const { result, rerender } = renderHook(() => useMetric("riskDistribution", sel()), { wrapper });
    await flush();
    const afterMount = calls;
    expect(afterMount).toBeGreaterThan(0);
    rerender();
    rerender();
    await flush();
    expect(calls).toBe(afterMount);
    await act(async () => gate.resolve());
    await waitFor(() => expect(result.current.status).toBe("ok"));
  });

  it("an inline Date now prop with the same instant does not restart loads", async () => {
    const gate = deferred<void>();
    let calls = 0;
    const source = wrapSource(createFakeSource(), (method) => {
      if (method !== "countRisk") return undefined;
      calls += 1;
      return gate.promise;
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MetricsSourceProvider, { source, config: FIXTURE_CONFIG, now: new Date(FIXTURE_NOW.getTime()) }, children);
    const { result, rerender } = renderHook(() => useMetric("riskDistribution", sel()), { wrapper });
    await flush();
    const afterMount = calls;
    rerender();
    await flush();
    expect(calls).toBe(afterMount);
    await act(async () => gate.resolve());
    await waitFor(() => expect(result.current).toMatchObject({ status: "ok", computedAt: FIXTURE_NOW.toISOString() }));
  });
});
