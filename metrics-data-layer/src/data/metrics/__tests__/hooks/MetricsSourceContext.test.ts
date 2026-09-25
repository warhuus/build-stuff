import { cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import { MetricsSourceProvider, useMetricsEnvironment, useMetricsSource } from "../../hooks/MetricsSourceContext";
import { createFakeSource } from "../../source/fake/fakeSource";
import { FIXTURE_CONFIG } from "../../source/fake/fixtures";
import { getDefaultOsdkSource } from "../../source/osdk/defaultSource";

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
