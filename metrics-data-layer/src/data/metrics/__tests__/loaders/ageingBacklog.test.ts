import { beforeEach, describe, expect, it } from "vitest";
import { loadAgeingBacklog } from "../../loaders/ageingBacklog";
import { l3Items, l3OpenAlerts, l3OpenedEvents } from "../../query/build";
import { EMPTY_FILTERS } from "../../selection";
import { clearMetricsCache } from "../../shared/cache";
import { fixtureTime as t, itemId } from "../../source/fake/fixtureAlerts";
import type { FakeCall } from "../../source/fake/fakeSource";
import type { BreakdownDimension, ItemFilters } from "../../types";
import { AMER, fakeDeps, idsOf, win } from "../helpers/loaderDeps";
import { expectCalls, range } from "../helpers/alertCards";
import { sel } from "../helpers/testKit";

const DIMS: readonly BreakdownDimension[] = [
  "alertType", "routingPersona", "priority", "escalated", "businessLine", "productLine", "region", "plant",
];
const l3Calls = (f: ItemFilters): FakeCall[] => [
  { method: "fetchOpenAlerts", args: [l3OpenAlerts(f)] },
  { method: "fetchEvents", args: [l3OpenedEvents(f)] },
  { method: "fetchItems", args: [l3Items(f)] },
];
/** Open alerts (status O): A01–A34 and A57–A70 = 34 + 14 = 48. */
const OPEN_IDS = [...range(1, 34), ...range(57, 70)].map((n) => `A${String(n).padStart(2, "0")}`);

describe("loadAgeingBacklog (spec §9 4.5, L3; D11, D18 A9)", () => {
  beforeEach(() => clearMetricsCache());

  it.each([30, "now"] as const)("%s: the three L3 fetches; window echoed, asOf = now", async (key) => {
    const deps = fakeDeps();
    const out = await loadAgeingBacklog(sel({ window: key }), null, deps);
    expect(idsOf(out.raw.alerts)).toEqual(OPEN_IDS);
    // Opened events: one op each for A01–A28 and A57–A70 (42), two for A29–A31 (6), none for A32–A34 → 48.
    expect(out.raw.openedEvents).toHaveLength(48);
    expect(out.raw.openedEvents.filter((e) => e.riskAlertId === "A29").map((e) => e.eventTimestamp).sort()).toEqual(
      [t(10), t(30)].sort(),
    );
    // Items of open alerts: I1–I26 (A01–A26; A27 I9, A28 I16, A30 I20, A31 I1, A32–A34 I2–I4, A57–A70 on
    // I5–I7, I16–I26 repeat) + I29 (A29) = 27.
    expect(out.raw.items.map((i) => i.salesOrderId).sort()).toEqual([...range(1, 26), 29].map(itemId));
    expect(out.raw).toMatchObject({ window: win(key), dimension: null, asOf: "2026-09-01T12:00:00.000Z" });
    expect(out.status).toBe("ok");
    expect(out.caveats).toEqual([]);
    expectCalls(deps.source, l3Calls(EMPTY_FILTERS));
  });

  it.each(DIMS)("dim %s: same three fetches (client-side breakdown), no itemsById", async (dim) => {
    const deps = fakeDeps();
    const out = await loadAgeingBacklog(sel({ window: 30 }), dim, deps);
    expect(out.raw.dimension).toBe(dim);
    expect(out.raw.alerts).toHaveLength(48);
    expectCalls(deps.source, l3Calls(EMPTY_FILTERS));
  });

  it.each([30, "now"] as const)("AMER at %s: 12 alerts / 12 opened / 6 items", async (key) => {
    const deps = fakeDeps();
    const out = await loadAgeingBacklog(sel({ window: key, filters: AMER }), "escalated", deps);
    // Open alerts on I21–I40 (not I29): A21–A26 (I21–I26) and A62–A67 (I21–I26); each has one op.
    expect(idsOf(out.raw.alerts)).toEqual([...range(21, 26), ...range(62, 67)].map((n) => `A${n}`));
    expect(out.raw.openedEvents).toHaveLength(12);
    expect(out.raw.items.map((i) => i.salesOrderId).sort()).toEqual(range(21, 26).map(itemId));
    expectCalls(deps.source, l3Calls(AMER));
  });

  it("row cap → partial + row-cap", async () => {
    // 48 open alerts ≥ ROW_CAP 10.
    const out = await loadAgeingBacklog(sel({ window: 30 }), null, fakeDeps({ config: { ROW_CAP: 10, PAGE_SIZE: 10 } }));
    expect(out.status).toBe("partial");
    expect(out.caveats).toEqual(["row-cap"]);
  });
});
