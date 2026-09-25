// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as B from "../../../query/build";
import * as R from "../../../query/buildRisk";
import type { SourceCtx } from "../../../source/MetricsSource";
import type { MetricsSource } from "../../../source/MetricsSource";
import { NO_FILTERS, SOME_FILTERS, W7, WNOW, makeCtx, setup } from "../../helpers/osdkHarness";
import { chainOf, type Recorded, type Step } from "../../helpers/recordingClient";
import {
  ACTION, HUMAN, LIFECYCLE, OPENED, VIEWED, aofSet, base, events, filteredItems, finalSet, intersect, pivot,
  tsIn, where,
} from "../../helpers/specPlans";

// TST-02 / OSD-03: the REAL spec builders of query/build.ts and query/buildRisk.ts compiled through
// createOsdkSource over the recording client; every recorded chain must equal the spec §9 plan written out from
// the spec's pseudocode (helpers/specPlans.ts). Item-funnel plans: planChainsItemFunnel.test.ts.
const EVENT_SELECT = ["riskAlertId", "salesOrderId", "eventType", "eventSource", "eventTimestamp", "persona", "riskType", "priorityAtEvent"];
const AOF_SELECT = ["riskAlertId", "salesOrderId", "persona", "priority", "riskType", "escalated"];
const ITEM_SELECT = ["salesOrderId", "businessLineName", "productLineName", "iscRegionName", "plantCode", "valueUsd", "isOpen"];

/** Runs one port call on a fresh recording client; returns its requests. */
async function record(call: (s: MetricsSource, ctx: SourceCtx) => Promise<unknown>): Promise<Recorded[]> {
  const t = setup();
  await call(t.source, makeCtx());
  return t.requests;
}
const only = (reqs: readonly Recorded[]): Recorded => {
  expect(reqs).toHaveLength(1);
  return reqs[0];
};
const chain = (r: Recorded): Step[] => chainOf(r.body.objectSet);
const exact = (field: string) => [{ type: "exact", field, maxGroupCount: 10_000 }];

describe.each([
  ["no filters", NO_FILTERS, false],
  ["item filters (pivot)", SOME_FILTERS, true],
] as const)("shared loaders L1–L3 (spec §9.0.1), %s", (_label, f, filtered) => {
  it("L1 human events: events(PRED.human, w, f) with the spec's $select", async () => {
    const r = only(await record((s, c) => s.fetchEvents(B.humanEvents(W7, f), c)));
    expect(r.kind).toBe("loadObjects");
    expect(chain(r)).toEqual(events(HUMAN, W7, filtered));
    expect(r.body.select).toEqual(EVENT_SELECT);
    const now = only(await record((s, c) => s.fetchEvents(B.humanEvents(WNOW, f), c)));
    expect(chain(now)).toEqual(events(HUMAN, WNOW, filtered));
  });

  it("L2 evSet: events(human).pivotTo(salesOrder_1).pivotTo(alertHistory).where($or [lifecycle, human])", async () => {
    const r = only(await record((s, c) => s.fetchEvents(B.touchedEventsChain(W7, f), c)));
    expect(chain(r)).toEqual([
      ...events(HUMAN, W7, filtered), pivot("salesOrder_1"), pivot("alertHistory"), where({ $or: [LIFECYCLE, HUMAN] }),
    ]);
  });

  it("L2 openIds: events(human).pivotTo(alert)", async () => {
    const r = only(await record((s, c) => s.fetchOpenAlerts(B.touchedOpenAlerts(W7, f), c)));
    expect(chain(r)).toEqual([...events(HUMAN, W7, filtered), pivot("alert")]);
    expect(r.body.select).toEqual(AOF_SELECT);
  });

  it("L3 alerts, opened events and items: aofSet(f), .pivotTo(historyEvents).where(opened), .pivotTo(sourceSalesOrder)", async () => {
    expect(chain(only(await record((s, c) => s.fetchOpenAlerts(B.l3OpenAlerts(f), c))))).toEqual(aofSet(filtered));
    expect(chain(only(await record((s, c) => s.fetchEvents(B.l3OpenedEvents(f), c))))).toEqual([
      ...aofSet(filtered), pivot("historyEvents"), where(OPENED),
    ]);
    const items = only(await record((s, c) => s.fetchItems(B.l3Items(f), c)));
    expect(chain(items)).toEqual([...aofSet(filtered), pivot("sourceSalesOrder")]);
    expect(items.body.select).toEqual(ITEM_SELECT);
  });

  it("4.2 not-worked: finalSet rows, then finalSet.pivotTo(salesOrder_1).pivotTo(alertHistory).where(opened)", async () => {
    const closed = only(await record((s, c) => s.fetchEvents(B.closedNotOpenNow(W7, f), c)));
    expect(chain(closed)).toEqual(finalSet(W7, filtered));
    const opened = only(await record((s, c) => s.fetchEvents(B.openedEventsOfItemsOf(B.closedNotOpenNow(W7, f)), c)));
    expect(chain(opened)).toEqual([...finalSet(W7, filtered), pivot("salesOrder_1"), pivot("alertHistory"), where(OPENED)]);
  });

  it("4.6 closedTotal: finalSet aggregate, grouped by priorityAtEvent for priority", async () => {
    const total = only(await record((s, c) => s.countEvents(B.closedNotOpenNow(W7, f), "alert", c)));
    expect(total.kind).toBe("aggregate");
    expect(chain(total)).toEqual(finalSet(W7, filtered));
    const grouped = only(await record((s, c) => s.countEventsBy(B.closedNotOpenNow(W7, f), "alert", "priority", c)));
    expect(chain(grouped)).toEqual(finalSet(W7, filtered));
    expect(grouped.body.groupBy).toEqual(exact("priorityAtEvent"));
  });

  it("3.1 soeAll / soeWorked, byRange pre-filter, bucket value and item-dim split (spec §9 3.1)", async () => {
    const soeAll: Step[] = filtered ? [...filteredItems(true), pivot("otifEvaluation")] : [base("SalesOrderOtifEvaluation")];
    const workedLeg: Step[] = [base("AlertHistory"), where({ $and: [HUMAN, tsIn(W7)] }), pivot("salesOrder_1"), pivot("otifEvaluation")];
    const soeWorked = intersect(soeAll, workedLeg);
    const NOT_DELAYED = { $not: { otifStatus: { $eq: "Delayed" } } };
    expect(chain(only(await record((s, c) => s.countRisk(R.riskAll(f), c))))).toEqual(soeAll);
    expect(chain(only(await record((s, c) => s.countRisk(R.riskWorked(W7, f), c))))).toEqual(soeWorked);
    const ranges = only(await record((s, c) => s.countRiskByScoreRange(R.riskNotDelayed(R.riskWorked(W7, f)), c.config.RISK_RANGES, c)));
    expect(chain(ranges)).toEqual([...soeWorked, where(NOT_DELAYED)]);
    const b51 = only(await record((s, c) => s.countItems(R.itemsOfRisk(R.riskBucket(R.riskWorked(W7, f), "b51_70")), c)));
    const scoreIn = { $and: [NOT_DELAYED, { otifScore: { $gte: 51 } }, { otifScore: { $lt: 71 } }] };
    expect(chain(b51)).toEqual([...soeWorked, where(scoreIn), pivot("salesOrder")]);
    const delayed = only(await record((s, c) => s.countRisk(R.riskBucket(R.riskAll(f), "delayed"), c)));
    expect(chain(delayed)).toEqual([...soeAll, where({ otifStatus: { $eq: "Delayed" } })]);
    const split = only(await record((s, c) => s.countItemsBy(R.itemsOfRisk(R.riskBucket(R.riskAll(f), "unscored")), "plant", c)));
    const UNSCORED = { $and: [NOT_DELAYED, { otifScore: { $isNull: true } }] };
    expect(chain(split)).toEqual([...soeAll, where(UNSCORED), pivot("salesOrder")]);
    expect(split.body.groupBy).toEqual(exact("plantCode"));
  });
});

describe("section 1 and 4.1 plans (spec §9 1.1–1.4, 4.1)", () => {
  it("1.2–1.4 use events(pred, w, NO_FILTERS); escalated groups pivot from AOF.where(escalated)", async () => {
    const viewed = only(await record((s, c) => s.countEvents(B.events(["viewed"], W7, NO_FILTERS), "actor", c)));
    expect(chain(viewed)).toEqual(events(VIEWED, W7, false));
    const actedNow = only(await record((s, c) => s.countEvents(B.events(["action"], WNOW, NO_FILTERS), "actor", c)));
    expect(chain(actedNow)).toEqual(events(ACTION, WNOW, false));
    for (const v of [true, false]) {
      const esc = only(await record((s, c) => s.countEvents(B.escalatedEvents(v, ["viewed"], W7), "actor", c)));
      expect(chain(esc)).toEqual([
        base("AlertOrderFulfillment"), where({ escalated: { $eq: v } }), pivot("historyEvents"), where({ $and: [VIEWED, tsIn(W7)] }),
      ]);
    }
  });

  it("1.1 AppUsageEvent.where($and [appId, inWin]) grouped by persona", async () => {
    const r = only(await record((s, c) => s.countAppUsersBy(W7, "queueFilter", c)));
    expect(chain(r)).toEqual([base("AppUsageEvent"), where({ $and: [{ appId: { $eq: "alert-app" } }, tsIn(W7)] })]);
    expect(r.body.groupBy).toEqual(exact("persona"));
  });

  it("4.1 worked ids = AlertHistory.where(human ∧ tsIn).pivotTo(salesOrder_1); totals gate ∧ dateIn", async () => {
    const worked = only(await record((s, c) => s.fetchItems(B.workedItems(W7), c)));
    expect(chain(worked)).toEqual([base("AlertHistory"), where({ $and: [HUMAN, tsIn(W7)] }), pivot("salesOrder_1")]);
    const crit = only(await record((s, c) => s.countVerdictsBy({ mode: "crit", window: W7 }, c)));
    const dateIn = { $and: [{ otifOtShipmentEndDate: { $gte: "2026-09-17" } }, { otifOtShipmentEndDate: { $lte: "2026-09-24" } }] };
    expect(chain(crit)).toEqual([base("OtifOrderVerdict"), where({ $and: [{ officialExclusionCrit: { $eq: "No" } }, dateIn] })]);
    expect(crit.body.groupBy).toEqual(exact("critClassification"));
    const otifNow = only(await record((s, c) => s.countVerdictsBy({ mode: "otif", window: WNOW }, c)));
    expect(chain(otifNow)).toEqual([
      base("OtifOrderVerdict"),
      where({ $and: [{ officialExclusionOtif: { $eq: "No" } }, { otifOtShipmentEndDate: { $lte: "2026-09-24" } }] }),
    ]);
    expect(otifNow.body.groupBy).toEqual(exact("initOtifClassification"));
  });

  it("itemsById: SalesOrders.where(salesOrderId $in chunk) with the spec's $select", async () => {
    const r = only(await record((s, c) => s.fetchItemsByIds(["a", "b"], c)));
    expect(chain(r)).toEqual([base("SalesOrders"), where({ salesOrderId: { $in: ["a", "b"] } })]);
    expect(r.body.select).toEqual(ITEM_SELECT);
  });
});
