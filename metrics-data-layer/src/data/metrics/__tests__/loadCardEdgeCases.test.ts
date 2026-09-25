import { beforeEach, describe, expect, it } from "vitest";
import { loadCard } from "../loadCard";
import { clearMetricsCache } from "../shared/cache";
import { fixtureTime, itemId } from "../source/fake/fixtureAlerts";
import { createFakeSource } from "../source/fake/fakeSource";
import type { FixtureEvent, MetricsFixtures } from "../source/fake/fakeTypes";
import { FIXTURE_CONFIG, FIXTURE_NOW, FIXTURES } from "../source/fake/fixtures";
import type { BreakdownDimension, CardId, Selection } from "../types";
import { sel } from "./helpers/testKit";

// TST-11: fixture paths the shared dataset never exercises, covered on a COPY of the fixtures with a few extra
// events (the delivered fixture data is unchanged). Expected values extend the hand-derived fixture outputs
// (process/phase3-correctness.md; loadCardDurations / loadCardAlertView tests).

/** One extra AlertHistory row (human by default: source "user", actor = user, persona = queue filter). */
const extra = (id: string, alert: string, item: number, over: Partial<FixtureEvent>): FixtureEvent => ({
  historyEventId: id, riskAlertId: alert, salesOrderId: itemId(item), eventType: "opened_by_user", eventSource: "user view",
  eventActor: "u1", eventTimestamp: fixtureTime(1, 9), persona: "Planner", riskType: "LateGI", priorityAtEvent: "High", ...over,
});
const withEvents = (...events: FixtureEvent[]): MetricsFixtures => ({ ...FIXTURES, events: [...FIXTURES.events, ...events] });
const load = <C extends CardId>(data: MetricsFixtures, card: C, s: Selection, bd: BreakdownDimension | null = null) =>
  loadCard(card, s, bd, { source: createFakeSource(data), now: FIXTURE_NOW, config: FIXTURE_CONFIG });

beforeEach(() => clearMetricsCache());

describe("one user with two queue-filter personas on alert events (instructions §11)", () => {
  it("userFunnel 7 d queueFilter: u1 viewing as Logistics too counts in both groups; overlap on 1.2", async () => {
    // Base 7 d 1.2 groups (on the 1.1 list All, Logistics, Planner): All 2 (u2, u4), Logistics 1 (u5), Planner 1
    // (u1). Extra: u1 views A13 at @1:09 with queue filter Logistics → Logistics 1.2 = {u5, u1} = 2; 1.2 total
    // stays 5 distinct users; Σ groups 1.2 = 2 + 2 + 1 = 5 (u3 CustomerService is outside the 1.1 list).
    const data = withEvents(extra("X1", "A13", 13, { persona: "Logistics", riskType: "LateGI" }));
    const r = await load(data, "userFunnel", sel({ window: 7 }), "queueFilter");
    const at12 = r.data?.breakdown?.groups.map((g) => [g.group, g.data.stages[2].count]);
    expect(at12).toEqual([["All", 2], ["Logistics", 2], ["Planner", 1]]);
    expect(r.data?.total.stages[2].count).toBe(5);
    expect(r.data?.breakdown?.additive).toBe(false);
  });
});

describe("negative durations clamp to 0 and are counted (spec §9 4.2; build-stamp ordering)", () => {
  it("4.3 at 7 d: a first view one day before the raise stamp", async () => {
    // A09 "op@3 vw:u1@2:09": extra view by u1 at @4 (06:00) → first view precedes raisedAt @3 by 24 h → 0 h,
    // clampedNegative 1. A09 moves from [24,48) to [0,1); n stays 12 (7 d population, loadCard.test.ts).
    const r = await load(withEvents(extra("X2", "A09", 9, { eventTimestamp: fixtureTime(4) })), "raisedToFirstView", sel({ window: 7 }));
    const [all] = r.data?.total.series ?? [];
    expect(all.n).toBe(12);
    expect(all.bins[0]).toEqual({ binStart: 0, binEnd: 1, count: 2 });
    expect(r.data?.total.clampedNegative).toBe(1);
  });

  it("4.2 at 7 d: a closed alert whose opened stamp is after its closed stamp", async () => {
    // New alert Z1 on I37: cl@5 then op@4 (a later build), viewed @5:09; not in AlertOrderFulfillment → closed.
    // raisedAt @4 > closedAt @5 → −24 h → 0 h; worked n 6 → 7, clampedNegative 1.
    const pipeline = { eventSource: "pipeline", eventActor: "pipeline", persona: "Planner" };
    const data = withEvents(
      extra("Z1-E1", "Z1", 37, { ...pipeline, eventType: "closed", eventTimestamp: fixtureTime(5) }),
      extra("Z1-E2", "Z1", 37, { ...pipeline, eventType: "opened", eventTimestamp: fixtureTime(4) }),
      extra("Z1-E3", "Z1", 37, { eventTimestamp: fixtureTime(5, 9) }),
    );
    const r = await load(data, "raisedToClosed", sel({ window: 7 }));
    const worked = r.data?.total.series.find((s) => s.key === "worked");
    expect(worked?.n).toBe(7);
    expect(worked?.bins[0].count).toBe(1);
    expect(r.data?.total.clampedNegative).toBe(1);
  });
});

describe("two write-back types on one alert (alert view writebackType overlap)", () => {
  it("A25 also corrects a tolerance: 2.4 stays 1 alert, groups 1 + 1, overlapRatio 2", async () => {
    // A25 "wb:u1@4:11" plus an extra delivery_tolerance_corrected by u1 at @4:12 (source user: also an action).
    const data = withEvents(extra("X3", "A25", 25, { eventType: "delivery_tolerance_corrected", eventSource: "user", eventTimestamp: fixtureTime(4, 12) }));
    const r = await load(data, "itemFunnel", sel({ window: 7, view: "alert" }), "writebackType");
    expect(r.data?.total.stages[4].count).toBe(1);
    expect(r.data?.breakdown?.groups.map((g) => [g.group, g.data.stages[4].count])).toEqual([
      ["delivery_block_removed", 1],
      ["delivery_tolerance_corrected", 1],
    ]);
    expect(r.data?.breakdown?.overlapRatio).toBe(2);
    expect(r.caveats).toContain("overlap");
  });
});
