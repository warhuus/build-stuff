import { describe, expect, it } from "vitest";
import {
  createEvalCtx,
  evalItems,
  isOpenInWindow,
  matchesRiskCondition,
  setOp,
} from "../../../source/fake/fakeEval";
import { distinctByGroup, exactDistinct } from "../../../source/fake/fakeGroups";
import { createFakeSource } from "../../../source/fake/fakeSource";
import {
  allEvents,
  allOpenAlerts,
  eventsOfOpenAlerts,
  eventsWhere,
  openAlerts,
  openAlertsWhere,
} from "../../../query/build";
import { itemsOfRisk, riskAll, riskBucket, riskWorked } from "../../../query/buildRisk";
import { FIXTURE_CONFIG, FIXTURES } from "../../../source/fake/fixtures";
import type { FixtureItem } from "../../../source/fake/fakeTypes";
import type { ItemFilters, Window } from "../../../types";

const NONE: ItemFilters = { businessLine: [], productLine: [], region: [], plant: [] };

const W7: Window = { key: 7, start: "2026-08-25T12:00:00.000Z", end: "2026-09-01T12:00:00.000Z" };
const W90: Window = { key: 90, start: "2026-06-03T12:00:00.000Z", end: "2026-09-01T12:00:00.000Z" };
const NOW: Window = { key: "now", start: null, end: "2026-09-01T12:00:00.000Z" };
const item = (over: Partial<FixtureItem>): FixtureItem => ({
  salesOrderId: "x",
  salesOrderItemCreationDate: "2026-03-01",
  actualGiDate: null,
  isOpen: false,
  valueUsd: null,
  businessLine: null,
  productLine: null,
  region: null,
  plant: null,
  ...over,
});

describe("fake eval: date-only 2.0 proxy (spec §9 2.0)", () => {
  it("compares GI and creation dates on the UTC calendar date of the bounds", () => {
    // 7 d start 2026-08-25T12:00Z → date 08-25: a GI on 08-25 (before 12:00 as a timestamp) is still in.
    expect(isOpenInWindow(item({ actualGiDate: "2026-08-25" }), W7)).toBe(true);
    expect(isOpenInWindow(item({ actualGiDate: "2026-08-24" }), W7)).toBe(false);
    expect(isOpenInWindow(item({ isOpen: true, salesOrderItemCreationDate: "2026-09-01" }), W7)).toBe(true);
    expect(isOpenInWindow(item({ isOpen: true, salesOrderItemCreationDate: "2026-09-02" }), W7)).toBe(false);
    expect(isOpenInWindow(item({ isOpen: true, salesOrderItemCreationDate: null }), W7)).toBe(false);
  });

  it("under now is isOpen only", () => {
    expect(isOpenInWindow(item({ isOpen: true, salesOrderItemCreationDate: null }), NOW)).toBe(true);
    expect(isOpenInWindow(item({ isOpen: false, actualGiDate: "2026-09-01" }), NOW)).toBe(false);
    expect(isOpenInWindow(item({ isOpen: null }), NOW)).toBe(false);
  });

  it("evaluates on the fixtures: 29 open + 7 closed in 90 d", () => {
    const ctx = createEvalCtx(FIXTURES, FIXTURE_CONFIG);
    expect(evalItems({ kind: "openInWindow", window: W90 }, ctx).size).toBe(36);
  });
});

describe("fake eval: set operations by primary key", () => {
  const a = new Set(["1", "2", "3"]);
  const b = new Set(["2", "3", "4"]);
  it("intersects, unites and subtracts", () => {
    expect([...setOp("intersect", a, b)]).toEqual(["2", "3"]);
    expect([...setOp("union", a, b)]).toEqual(["1", "2", "3", "4"]);
    expect([...setOp("subtract", a, b)]).toEqual(["1"]);
  });

  it("works on nested item specs", () => {
    const ctx = createEvalCtx(FIXTURES, FIXTURE_CONFIG);
    const open = { kind: "openInWindow", window: NOW } as const;
    const union = evalItems({ kind: "union", a: open, b: { kind: "all" } }, ctx);
    const subtract = evalItems({ kind: "subtract", a: { kind: "all" }, b: open }, ctx);
    expect(union.size).toBe(40);
    expect(subtract.size).toBe(10);
  });
});

describe("fake eval: risk conditions (spec §9 3.1)", () => {
  const risk = (otifStatus: string | null, otifScore: number | null) => ({ salesOrderId: "x", otifStatus, otifScore });
  const bucket = (b: "unscored" | "b15_30" | "b31_50" | "b91_100" | "delayed") => ({ kind: "bucket", bucket: b }) as const;
  it("splits 30 / 31 and keeps Delayed at 100 out of b91_100", () => {
    expect(matchesRiskCondition(risk("At Risk", 30), bucket("b15_30"), FIXTURE_CONFIG)).toBe(true);
    expect(matchesRiskCondition(risk("At Risk", 31), bucket("b31_50"), FIXTURE_CONFIG)).toBe(true);
    expect(matchesRiskCondition(risk("At Risk", 100), bucket("b91_100"), FIXTURE_CONFIG)).toBe(true);
    expect(matchesRiskCondition(risk("Delayed", 100), bucket("b91_100"), FIXTURE_CONFIG)).toBe(false);
    expect(matchesRiskCondition(risk("Delayed", 100), bucket("delayed"), FIXTURE_CONFIG)).toBe(true);
    expect(matchesRiskCondition(risk("Delayed", null), bucket("unscored"), FIXTURE_CONFIG)).toBe(false);
    expect(matchesRiskCondition(risk(null, null), bucket("unscored"), FIXTURE_CONFIG)).toBe(true);
    expect(matchesRiskCondition(risk(null, 50), { kind: "notDelayed" }, FIXTURE_CONFIG)).toBe(true);
  });
});

describe("fake groups: nulls", () => {
  it("exactDistinct ignores nulls; groups drop null keys", () => {
    const rows = [
      { g: "a", v: "u1" },
      { g: "a", v: null },
      { g: null, v: "u2" },
      { g: "b", v: "u1" },
      { g: "b", v: "u3" },
    ];
    expect(exactDistinct(rows, (r) => r.v)).toBe(3);
    expect(distinctByGroup(rows, (r) => r.g, (r) => r.v, 10)).toEqual([
      { group: "b", count: 2 },
      { group: "a", count: 1 },
    ]);
  });
});

describe("fake eval: pivots and set ops of every spec kind (fixture counts)", () => {
  const src = createFakeSource();
  const ctx = { signal: new AbortController().signal, config: FIXTURE_CONFIG };
  const BL: ItemFilters = { businessLine: ["BL-A"], productLine: [], region: [], plant: [] };
  const planner = openAlertsWhere(allOpenAlerts, { field: "routingPersona", value: "Planner" });
  const high = openAlertsWhere(allOpenAlerts, { field: "priority", value: "High" });

  it("risk → items and items → risk", async () => {
    expect((await src.countItems(itemsOfRisk(riskBucket(riskAll(NONE), "delayed")), ctx)).count).toBe(3);
    // open BL-A items: odd I1–I29 = 15.
    expect(await src.countRisk(riskAll(BL), ctx)).toBe(15);
    // open items with a human event in 7 d: I2, I7, I9, I10, I11, I13, I15, I17, I18, I19, I21, I24, I25.
    expect(await src.countRisk(riskWorked(W7, NONE), ctx)).toBe(13);
  });

  it("open-alert conditions and set ops", async () => {
    expect(await src.countOpenAlerts(planner, ctx)).toBe(21);
    expect(await src.countOpenAlerts(high, ctx)).toBe(14);
    expect(await src.countOpenAlerts({ kind: "intersect", a: planner, b: high }, ctx)).toBe(10);
    expect(await src.countOpenAlerts({ kind: "union", a: planner, b: high }, ctx)).toBe(25);
    expect(await src.countOpenAlerts({ kind: "subtract", a: planner, b: high }, ctx)).toBe(11);
    // open alerts of odd (BL-A) items: 24.
    expect(await src.countOpenAlerts(openAlerts(BL), ctx)).toBe(24);
  });

  it("event set ops: human-in-7d alerts open now vs closed", async () => {
    const human7 = eventsWhere(allEvents, ["human"], W7);
    const ofOpen = eventsOfOpenAlerts(allOpenAlerts);
    expect(await src.countEvents({ kind: "intersect", a: human7, b: ofOpen }, "alert", ctx)).toBe(13);
    expect(await src.countEvents({ kind: "subtract", a: human7, b: ofOpen }, "alert", ctx)).toBe(5);
    expect(await src.countEvents({ kind: "union", a: human7, b: ofOpen }, "alert", ctx)).toBe(53);
  });

  it("groups events by queue filter, alert type and priority", async () => {
    const human7 = eventsWhere(allEvents, ["human"], W7);
    expect(await src.countEventsBy(human7, "actor", "queueFilter", ctx)).toEqual([
      { group: "All", count: 2 },
      { group: "CustomerService", count: 1 },
      { group: "Logistics", count: 1 },
      { group: "Planner", count: 1 },
    ]);
    const closed7 = eventsWhere(allEvents, ["closed"], W7);
    expect(await src.countEventsBy(closed7, "alert", "alertType", ctx)).toEqual([
      { group: "LateGI", count: 6 },
      { group: "Allocation", count: 2 },
      { group: "CreditBlock", count: 2 },
    ]);
    expect(await src.countEventsBy(closed7, "alert", "priority", ctx)).toEqual([
      { group: "High", count: 5 },
      { group: "Low", count: 3 },
      { group: "Medium", count: 2 },
    ]);
  });

  it("groups open alerts by routing persona, priority and alert type", async () => {
    const sum = (gs: readonly { count: number }[]) => gs.reduce((s, g) => s + g.count, 0);
    const persona = await src.countOpenAlertsBy(allOpenAlerts, "routingPersona", ctx);
    expect(persona[0]).toEqual({ group: "Planner", count: 21 });
    expect(sum(persona)).toBe(48);
    expect((await src.countOpenAlertsBy(allOpenAlerts, "priority", ctx))[0]).toEqual({ group: "High", count: 14 });
    expect(sum(await src.countOpenAlertsBy(allOpenAlerts, "alertType", ctx))).toBe(48);
  });
});
