import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { METRICS_CONFIG } from "../../../config/metrics";
import { loadCard, peekCard, precheckCard } from "../loadCard";
import { humanEvents, touchedEventsChain } from "../query/build";
import { EMPTY_FILTERS } from "../selection";
import { clearMetricsCache } from "../shared/cache";
import { createFakeSource } from "../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../source/fake/fixtures";
import type { AgeingBacklog, BucketRow, CalibrationRow, CardData, CompositionResult, DurationResult, FunnelSeries, MetricResult, MovementRow, OutcomeHeadline, RolledMonthRow } from "../types";
import { resolveWindow } from "../window";
import type { MetricsSource } from "../source/MetricsSource";
import { AMER } from "./helpers/loaderDeps";
import { sel } from "./helpers/testKit";

const opts = (source: MetricsSource = createFakeSource()) => ({ source, now: FIXTURE_NOW, config: FIXTURE_CONFIG });

beforeEach(() => {
  clearMetricsCache();
});

describe("loadCard: every card, typed by card id (instructions §7)", () => {
  it("returns the card's T for each first-draft card, inferred from the id", async () => {
    const o = opts();
    const s = sel({ window: 7 });
    const userFunnel = await loadCard("userFunnel", s, null, o);
    const itemFunnel = await loadCard("itemFunnel", s, null, o);
    const risk = await loadCard("riskDistribution", s, null, o);
    const otif = await loadCard("otifOutcome", s, null, o);
    const r2c = await loadCard("raisedToClosed", s, null, o);
    const r2v = await loadCard("raisedToFirstView", s, null, o);
    const v2c = await loadCard("firstViewToClosure", s, null, o);
    const ageing = await loadCard("ageingBacklog", s, null, o);
    const closure = await loadCard("closureComposition", s, null, o);
    expectTypeOf(userFunnel).toEqualTypeOf<MetricResult<CardData<FunnelSeries>>>();
    expectTypeOf(itemFunnel).toEqualTypeOf<MetricResult<CardData<FunnelSeries>>>();
    expectTypeOf(risk).toEqualTypeOf<MetricResult<CardData<readonly BucketRow[]>>>();
    expectTypeOf(otif).toEqualTypeOf<MetricResult<CardData<OutcomeHeadline>>>();
    expectTypeOf(r2c).toEqualTypeOf<MetricResult<CardData<DurationResult>>>();
    expectTypeOf(r2v).toEqualTypeOf<MetricResult<CardData<DurationResult>>>();
    expectTypeOf(v2c).toEqualTypeOf<MetricResult<CardData<DurationResult>>>();
    expectTypeOf(ageing).toEqualTypeOf<MetricResult<CardData<AgeingBacklog>>>();
    expectTypeOf(closure).toEqualTypeOf<MetricResult<CardData<CompositionResult>>>();
    for (const r of [userFunnel, itemFunnel, risk, otif, r2c, r2v, v2c, ageing, closure]) {
      expect(r.status).toBe("ok");
      expect(r.data).toBeDefined();
      expect(r.computedAt).toBe(FIXTURE_NOW.toISOString());
      expect(r.window).toEqual(resolveWindow(7, FIXTURE_NOW));
    }
    // Spot checks against the loader findings (phase2-E3: 4.2 at 7 d → worked 6; 4.6 at 7 d → 9 closed).
    expect(userFunnel.data?.total.view).toBe("user");
    expect(itemFunnel.data?.total.stages.map((st) => st.id)).toEqual(["2.0", "2.1", "2.2", "2.3", "2.4"]);
    expect(risk.data?.total).toHaveLength(14);
    expect(r2c.data?.total.series.find((x) => x.key === "worked")?.n).toBe(6);
    expect(closure.data?.total.closedTotal).toBe(9);
  });

  it("types the stub cards' results", async () => {
    const o = opts();
    const movement = await loadCard("riskMovement", sel(), null, o);
    const calibration = await loadCard("riskCalibration", sel(), null, o);
    const rolled = await loadCard("rolledValue", sel(), null, o);
    expectTypeOf(movement).toEqualTypeOf<MetricResult<CardData<readonly MovementRow[]>>>();
    expectTypeOf(calibration).toEqualTypeOf<MetricResult<CardData<readonly CalibrationRow[]>>>();
    expectTypeOf(rolled).toEqualTypeOf<MetricResult<CardData<readonly RolledMonthRow[]>>>();
  });

  it("unions loader, derive and stage caveats in config order", async () => {
    const r = await loadCard("itemFunnel", sel({ window: 7 }), null, opts());
    // Stage caveats of the item view: 2.0 proxy, 2.3 not-a-conversion, 2.4 low-volume, 2.1 build-stamp (≤ 7 d).
    expect(r.caveats).toEqual(expect.arrayContaining(["proxy", "not-a-conversion", "low-volume", "build-stamp"]));
    expect(new Set(r.caveats).size).toBe(r.caveats.length);
    const stage = r.data?.total.stages.find((st) => st.id === "2.0");
    expect(stage?.caveats).toContain("proxy");
  });
});

describe("loadCard: cache (spec §11, Appendix A O3)", () => {
  it("serves a repeat from the cache without calls, and peekCard returns it synchronously", async () => {
    const source = createFakeSource();
    expect(peekCard("riskDistribution", sel(), null, FIXTURE_CONFIG, FIXTURE_NOW)).toBeNull();
    const first = await loadCard("riskDistribution", sel(), null, opts(source));
    const calls = source.calls.length;
    expect(calls).toBeGreaterThan(0);
    const again = await loadCard("riskDistribution", sel(), null, opts(source));
    expect(source.calls).toHaveLength(calls);
    expect(again).toEqual(first);
    expect(peekCard("riskDistribution", sel(), null, FIXTURE_CONFIG, FIXTURE_NOW)).toEqual(first);
  });

  it("re-derives unit and threshold changes from the cache without a refetch", async () => {
    const source = createFakeSource();
    const count = await loadCard("itemFunnel", sel(), null, opts(source));
    const ageing30 = await loadCard("ageingBacklog", sel(), null, opts(source));
    const calls = source.calls.length;
    const value = await loadCard("itemFunnel", sel({ unit: "valueUsd" }), null, opts(source));
    const ageing7 = await loadCard("ageingBacklog", sel({ ageingThresholdDays: 7 }), null, opts(source));
    expect(source.calls).toHaveLength(calls);
    expect(count.data?.total.unit).toBe("count");
    expect(value.data?.total.unit).toBe("valueUsd");
    expect(ageing30.data?.total.threshold.days).toBe(30);
    expect(ageing7.data?.total.threshold.days).toBe(7);
    expect(ageing7.data?.total.threshold.alerts).toBeGreaterThan(ageing30.data?.total.threshold.alerts ?? 0);
  });

  it("section 1 ignores item filters: same cache entry, caveat filters-not-applied", async () => {
    const source = createFakeSource();
    const plain = await loadCard("userFunnel", sel(), null, opts(source));
    const calls = source.calls.length;
    const filtered = await loadCard("userFunnel", sel({ filters: AMER }), null, opts(source));
    expect(source.calls).toHaveLength(calls);
    expect(plain.caveats).not.toContain("filters-not-applied");
    expect(filtered.caveats).toContain("filters-not-applied");
    expect(filtered.data?.total.stages).toEqual(plain.data?.total.stages);
  });

  it("shares one L2('now') run between two concurrent cards", async () => {
    const source = createFakeSource();
    const now = resolveWindow("now", FIXTURE_NOW);
    const [a, b] = await Promise.all([
      loadCard("raisedToClosed", sel({ window: 7 }), null, opts(source)),
      loadCard("firstViewToClosure", sel({ window: 7 }), null, opts(source)),
    ]);
    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    const same = (set: unknown) => (c: { args: readonly unknown[] }) => JSON.stringify(c.args[0]) === JSON.stringify(set);
    expect(source.calls.filter(same(touchedEventsChain(now, EMPTY_FILTERS)))).toHaveLength(1);
    expect(source.calls.filter(same(humanEvents(now, EMPTY_FILTERS)))).toHaveLength(1);
  });

  it("clearMetricsCache forces a refetch", async () => {
    const source = createFakeSource();
    await loadCard("closureComposition", sel(), null, opts(source));
    const calls = source.calls.length;
    clearMetricsCache();
    expect(peekCard("closureComposition", sel(), null, FIXTURE_CONFIG, FIXTURE_NOW)).toBeNull();
    await loadCard("closureComposition", sel(), null, opts(source));
    expect(source.calls.length).toBe(2 * calls);
  });
});

describe("loadCard: prechecks without calls (D13, instructions §7, §8 items 8 and 10)", () => {
  it("rejects a breakdown not allowed for (card, view)", async () => {
    const source = createFakeSource();
    const otif = await loadCard("otifOutcome", sel(), "region", opts(source));
    const alertView = await loadCard("itemFunnel", sel({ view: "alert" }), "region", opts(source));
    const stub = await loadCard("riskMovement", sel(), "region", opts(source));
    for (const r of [otif, alertView, stub]) {
      expect(r).toMatchObject({ status: "error", error: "breakdown-not-allowed", caveats: [] });
      expect(r.data).toBeUndefined();
    }
    expect(source.calls).toEqual([]);
  });

  it("blocks the stubs with their reason and caveats", async () => {
    const source = createFakeSource();
    const movement = await loadCard("riskMovement", sel(), null, opts(source));
    const calibration = await loadCard("riskCalibration", sel(), null, opts(source));
    const rolled = await loadCard("rolledValue", sel(), null, opts(source));
    expect(movement).toMatchObject({ status: "blocked", blocked: { reason: "not-captured" }, caveats: ["not-captured"] });
    expect([...calibration.caveats].sort()).toEqual(["delayed-forced-100", "not-captured"]);
    expect(rolled).toMatchObject({ status: "blocked", blocked: { reason: "no-source" }, caveats: ["no-source"] });
    expect(movement.computedAt).toBe(FIXTURE_NOW.toISOString());
    expect(source.calls).toEqual([]);
  });

  it("blocks placeholder cards under METRICS_CONFIG (needs-integration-value)", async () => {
    const source = createFakeSource();
    const o = { source, now: FIXTURE_NOW, config: METRICS_CONFIG };
    for (const card of ["userFunnel", "otifOutcome"] as const) {
      const r = await loadCard(card, sel(), null, o);
      expect(r).toMatchObject({ status: "blocked", caveats: ["needs-integration-value"] });
      expect(r.blocked?.reason).toBe("needs-integration-value");
      expect(r.blocked?.unblockedBy).toMatch(card === "userFunnel" ? /ALERT_APP_ID/ : /VERDICT_DATE_PROPERTY/);
    }
    expect(source.calls).toEqual([]);
  });

  it("precheckCard returns null for a loadable card", () => {
    expect(precheckCard("itemFunnel", sel(), "region", FIXTURE_CONFIG, FIXTURE_NOW)).toBeNull();
  });
});
