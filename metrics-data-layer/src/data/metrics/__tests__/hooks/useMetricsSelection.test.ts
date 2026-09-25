import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { useMetricsSelection } from "../../hooks/useMetricsSelection";
import { DEFAULT_SELECTION } from "../../selection";

const routerAt = (url: string) =>
  function Router({ children }: { children: ReactNode }) {
    return createElement(
      MemoryRouter,
      { initialEntries: [url], future: { v7_startTransition: true, v7_relativeSplatPath: true } },
      children,
    );
  };

const render = (url: string) =>
  renderHook(() => ({ state: useMetricsSelection(), location: useLocation() }), { wrapper: routerAt(url) });

afterEach(() => {
  cleanup();
});

describe("useMetricsSelection (instructions §7)", () => {
  it("reads the selection from the URL", () => {
    const { result } = render("/metrics?w=7&u=valueUsd&v=alert&bl=b&bl=a&om=crit&n=14&tab=x");
    expect(result.current.state[0]).toEqual({
      window: 7,
      unit: "valueUsd",
      view: "alert",
      filters: { businessLine: ["a", "b"], productLine: [], region: [], plant: [] },
      otifMode: "crit",
      ageingThresholdDays: 14,
    });
  });

  it("falls back to defaults on missing or invalid values", () => {
    const { result } = render("/metrics?w=5&u=euro&v=user&om=x&n=0");
    expect(result.current.state[0]).toEqual(DEFAULT_SELECTION);
  });

  it("writes changes to the URL, omitting defaults and keeping unrelated params", () => {
    const { result } = render("/metrics?tab=x&w=7");
    const first = result.current.state[0];
    act(() => result.current.state[1]((prev) => ({ ...prev, unit: "valueUsd", filters: { ...prev.filters, region: ["EMEA", "AMER"] } })));
    expect(result.current.location.pathname).toBe("/metrics");
    expect(result.current.location.search).toBe("?tab=x&w=7&u=valueUsd&rg=AMER&rg=EMEA");
    expect(result.current.state[0]).toMatchObject({ window: 7, unit: "valueUsd" });
    expect(result.current.state[0]).not.toBe(first);
    act(() => result.current.state[1](DEFAULT_SELECTION));
    expect(result.current.location.search).toBe("?tab=x");
    expect(result.current.state[0]).toEqual(DEFAULT_SELECTION);
  });

  it("round-trips a selection and keeps the object stable while the URL is unchanged", () => {
    const { result, rerender } = render("/");
    const next = { ...DEFAULT_SELECTION, window: "now" as const, otifMode: "crit" as const, ageingThresholdDays: 90 };
    act(() => result.current.state[1](next));
    expect(result.current.state[0]).toEqual(next);
    const kept = result.current.state[0];
    rerender();
    expect(result.current.state[0]).toBe(kept);
  });
});

describe("useMetricsSelection: updaters queue (TYP-02)", () => {
  it("two updaters in one act keep both changes", () => {
    const { result } = render("/metrics?tab=x&w=30");
    act(() => {
      result.current.state[1]((s) => ({ ...s, window: 7 }));
      result.current.state[1]((s) => ({ ...s, unit: "valueUsd" }));
    });
    expect(result.current.state[0]).toMatchObject({ window: 7, unit: "valueUsd" });
    expect(result.current.location.search).toBe("?tab=x&w=7&u=valueUsd");
  });

  it("an updater after a full selection sees that selection", () => {
    const { result } = render("/");
    act(() => {
      result.current.state[1]({ ...DEFAULT_SELECTION, otifMode: "crit" });
      result.current.state[1]((s) => ({ ...s, ageingThresholdDays: 14 }));
    });
    expect(result.current.state[0]).toMatchObject({ otifMode: "crit", ageingThresholdDays: 14 });
  });

  it("follows URL changes made elsewhere", () => {
    const { result } = render("/?w=7");
    act(() => result.current.state[1]((s) => ({ ...s, unit: "valueUsd" })));
    act(() => result.current.state[1](DEFAULT_SELECTION));
    act(() => result.current.state[1]((s) => ({ ...s, window: 14 })));
    expect(result.current.state[0]).toEqual({ ...DEFAULT_SELECTION, window: 14 });
  });
});
