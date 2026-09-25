import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MetricsSourceProvider } from "../hooks/MetricsSourceContext";
import { useMetric } from "../hooks/useMetric";
import { loadCard, peekCard } from "../loadCard";
import { DEFAULT_SELECTION, EMPTY_FILTERS } from "../selection";
import { clearMetricsCache } from "../shared/cache";
import { createFakeSource } from "../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../source/fake/fixtures";
import type { MetricsSource } from "../source/MetricsSource";
import type { Selection } from "../types";

// Behaviour guards of loadCard / useMetric on the fake source (spec §11, Appendix A O3, V2, D2, D13).
const sel = (over: Partial<Selection> = {}): Selection => ({ ...DEFAULT_SELECTION, ...over });
const opts = (source: MetricsSource, config = FIXTURE_CONFIG) => ({ source, now: FIXTURE_NOW, config });
/** Region = AMER: items I21–I40 except I29. */
const AMER = { ...EMPTY_FILTERS, region: ["AMER"] };

beforeEach(() => clearMetricsCache());
afterEach(() => cleanup());

describe("loadCard guards", () => {
  it("unit and threshold changes re-derive from the cache without a refetch", async () => {
    const fake = createFakeSource();
    await loadCard("itemFunnel", sel(), null, opts(fake));
    await loadCard("ageingBacklog", sel(), null, opts(fake));
    const calls = fake.calls.length;
    const value = await loadCard("itemFunnel", sel({ unit: "valueUsd" }), null, opts(fake));
    const ageing7 = await loadCard("ageingBacklog", sel({ ageingThresholdDays: 7 }), null, opts(fake));
    expect(fake.calls).toHaveLength(calls);
    expect(value.data?.total.unit).toBe("valueUsd");
    // Age > 7 d: 29 open alerts (A59 is exactly 7.0 d old and not counted; working in cards.test.ts, 4.5).
    expect(ageing7.data?.total.threshold).toMatchObject({ days: 7, alerts: 29 });
  });

  it("a breakdown not allowed for (card, view) is an error with no call", async () => {
    const fake = createFakeSource();
    const otif = await loadCard("otifOutcome", sel(), "region", opts(fake));
    const alertView = await loadCard("itemFunnel", sel({ view: "alert" }), "region", opts(fake));
    for (const r of [otif, alertView]) expect(r).toMatchObject({ status: "error", error: "breakdown-not-allowed", caveats: [] });
    expect(fake.calls).toEqual([]);
  });

  it("a capped row fetch makes the card partial with row-cap", async () => {
    // ROW_CAP 20: the L1 human events of L2("now") alone are 66 rows.
    const r = await loadCard("raisedToClosed", sel({ window: 7 }), null, opts(createFakeSource(), { ...FIXTURE_CONFIG, ROW_CAP: 20, PAGE_SIZE: 10 }));
    expect(r.status).toBe("partial");
    expect(r.caveats).toContain("row-cap");
  });

  it("4.2 at 30 d has no not-worked side: partial with not-worked-window-cap", async () => {
    const r = await loadCard("raisedToClosed", sel({ window: 30 }), null, opts(createFakeSource()));
    expect(r.status).toBe("partial");
    expect(r.caveats).toContain("not-worked-window-cap");
    expect(r.caveats).not.toContain("row-cap");
  });

  it("section 1 ignores item filters: same cache entry and result, caveat filters-not-applied", async () => {
    const fake = createFakeSource();
    const plain = await loadCard("userFunnel", sel(), null, opts(fake));
    const calls = fake.calls.length;
    const filtered = await loadCard("userFunnel", sel({ filters: AMER }), null, opts(fake));
    expect(fake.calls).toHaveLength(calls);
    expect(plain.caveats).not.toContain("filters-not-applied");
    expect(filtered.caveats).toContain("filters-not-applied");
    expect(filtered.data?.total.stages).toEqual(plain.data?.total.stages);
  });

  it("a cache hit returns the same result without a fetch, and peekCard serves it synchronously", async () => {
    const fake = createFakeSource();
    expect(peekCard("riskDistribution", sel(), null, FIXTURE_CONFIG, FIXTURE_NOW)).toBeNull();
    const first = await loadCard("riskDistribution", sel(), null, opts(fake));
    const calls = fake.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(await loadCard("riskDistribution", sel(), null, opts(fake))).toEqual(first);
    expect(peekCard("riskDistribution", sel(), null, FIXTURE_CONFIG, FIXTURE_NOW)).toEqual(first);
    expect(fake.calls).toHaveLength(calls);
  });
});

describe("useMetric", () => {
  it("returns the card's data through the provider", async () => {
    const source = createFakeSource();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MetricsSourceProvider, { source, config: FIXTURE_CONFIG, now: () => FIXTURE_NOW }, children);
    const { result } = renderHook(() => useMetric("closureComposition", sel({ window: 7 })), { wrapper });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const direct = await loadCard("closureComposition", sel({ window: 7 }), null, opts(source));
    expect(result.current.data).toEqual(direct.data);
    expect(result.current.data?.total.closedTotal).toBe(9);
  });
});
