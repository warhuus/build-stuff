import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import * as api from "../index";
import type {
  AlertEventRow,
  AlertLifecycleRow,
  EventSet,
  HumanEvent,
  ItemRow,
  LoadCardOptions,
  MetricsSource,
  OpenAlertRow,
  Paged,
  Progress,
  SourceCtx,
  VerdictRow,
} from "../index";
import { DEFAULT_SELECTION } from "../selection";
import { createFakeSource } from "../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../source/fake/fixtures";

const fake = vi.hoisted(() => ({ source: null as MetricsSource | null }));
vi.mock("../source/osdk/defaultSource", () => ({
  getDefaultOsdkSource: (): MetricsSource => {
    fake.source ??= createFakeSource();
    return fake.source;
  },
}));

beforeEach(() => {
  api.clearMetricsCache();
});

describe("public barrel (instructions §7)", () => {
  it("exports exactly the listed values", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "CARDS",
        "CAVEAT_TEXT",
        "DEFAULT_SELECTION",
        "MetricsSourceProvider",
        "allowedBreakdowns",
        "clearMetricsCache",
        "isAdditive",
        "isBreakdownAllowed",
        "loadCard",
        "parseSelection",
        "serializeSelection",
        "useMetric",
        "useMetricsSelection",
      ].sort(),
    );
  });

  it("exports the spec §10 row types, Paged, SourceCtx and Progress (SPF-03)", () => {
    expectTypeOf<HumanEvent>().toHaveProperty("riskAlertId");
    expectTypeOf<AlertEventRow>().toHaveProperty("eventTimestamp");
    expectTypeOf<OpenAlertRow>().toHaveProperty("salesOrderId");
    expectTypeOf<ItemRow>().toHaveProperty("salesOrderId");
    expectTypeOf<VerdictRow>().not.toBeAny();
    expectTypeOf<AlertLifecycleRow>().not.toBeAny();
    expectTypeOf<Paged<ItemRow>>().toHaveProperty("rows");
    expectTypeOf<SourceCtx>().toHaveProperty("signal");
    expectTypeOf<Progress>().toHaveProperty("loaded");
    expectTypeOf<EventSet>().not.toBeAny();
    expectTypeOf<Parameters<MetricsSource["fetchEvents"]>[1]>().toEqualTypeOf<SourceCtx>();
  });
});

describe("public loadCard (SPF-04, TYP-03)", () => {
  it("takes an optional source", () => {
    expectTypeOf<LoadCardOptions["source"]>().toEqualTypeOf<MetricsSource | undefined>();
    expectTypeOf(api.loadCard).parameter(3).toEqualTypeOf<LoadCardOptions | undefined>();
  });

  it("defaults the source to the app's OSDK source", async () => {
    const r = await api.loadCard("riskDistribution", DEFAULT_SELECTION, null, { now: FIXTURE_NOW, config: FIXTURE_CONFIG });
    expect(r.status).toBe("ok");
    expect(fake.source).not.toBeNull();
  });

  it("works with no options at all (stub card: blocked, no calls)", async () => {
    const r = await api.loadCard("rolledValue", DEFAULT_SELECTION, null);
    expect(r.status).toBe("blocked");
  });

  it("uses a given source and shares the cache with the internal entry", async () => {
    const source = createFakeSource();
    const a = await api.loadCard("closureComposition", DEFAULT_SELECTION, null, { source, now: FIXTURE_NOW, config: FIXTURE_CONFIG });
    const calls = source.calls.length;
    expect(calls).toBeGreaterThan(0);
    const b = await api.loadCard("closureComposition", DEFAULT_SELECTION, null, { source, now: FIXTURE_NOW, config: FIXTURE_CONFIG });
    expect(source.calls).toHaveLength(calls);
    expect(b).toEqual({ ...a, progress: undefined });
  });
});
