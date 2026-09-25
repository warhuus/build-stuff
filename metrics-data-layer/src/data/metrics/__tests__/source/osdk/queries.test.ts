// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as B from "../../../query/build";
import { itemFunnelSets } from "../../../query/buildFunnel";
import * as R from "../../../query/buildRisk";
import type { EventPredicate, EventSet } from "../../../query/specs";
import type { MetricsSource, SourceCtx } from "../../../source/MetricsSource";
import type { Window } from "../../../types";
import { NO_FILTERS, SOME_FILTERS, W7, WNOW, makeCtx, setup } from "../../helpers/osdkHarness";
import { chainOf, type Recorded, type Step, whereFieldsOn } from "../../helpers/recordingClient";
import {
  CLOSED, HUMAN, LIFECYCLE, base, events, finalSet, intersect, itemsWith, openInWindow, pivot, SOME_FILTERS_WHERE,
  tsIn, union, where,
} from "../../helpers/specPlans";

// The REAL query builders (query/build, buildFunnel, buildRisk) compiled through createOsdkSource over the
// recording client; each recorded chain must equal the spec §9 plan written out from the spec pseudocode
// (helpers/specPlans.ts). Wire JSON of a request = the compiled OSDK chain.

/** Runs port calls on a fresh recording client; returns its requests. */
async function record(call: (s: MetricsSource, ctx: SourceCtx) => Promise<unknown>): Promise<Recorded[]> {
  const t = setup();
  await call(t.source, makeCtx());
  return t.requests;
}
/** The one chain a port call sends. */
async function chainSent(call: (s: MetricsSource, ctx: SourceCtx) => Promise<unknown>): Promise<Step[]> {
  const reqs = await record(call);
  expect(reqs).toHaveLength(1);
  return chainOf(reqs[0].body.objectSet);
}
const exact = (field: string) => [{ type: "exact", field, maxGroupCount: 10_000 }];
/** Spec §9 2.1 alerted items: open-now items, plus (bounded windows) items with a closed event in w. */
const alerted = (w: Window): Step[] => {
  const openNow: Step[] = [base("AlertOrderFulfillment"), pivot("sourceSalesOrder")];
  return w.start === null ? openNow : union(openNow, itemsWith(CLOSED, w));
};

describe("itemFunnel item view (spec §9 2.0, 2.1)", () => {
  it.each([["7 d", W7], ["now", WNOW]] as const)("2.0 at %s: open or shipped in the window (date-only bounds)", async (_l, w) => {
    expect(await chainSent((s, c) => s.countItems(itemFunnelSets(w, NO_FILTERS).so20, c))).toEqual(openInWindow(w));
  });

  it("2.1 = 2.0 ∩ (open-alert items ∪ items closed in w); item filters stay on 2.0", async () => {
    const so21 = await chainSent((s, c) => s.countItems(itemFunnelSets(W7, SOME_FILTERS).so21, c));
    expect(so21).toEqual(intersect([...openInWindow(W7), where(SOME_FILTERS_WHERE)], alerted(W7)));
    const now = await chainSent((s, c) => s.countItems(itemFunnelSets(WNOW, NO_FILTERS).so21, c));
    expect(now).toEqual(intersect(openInWindow(WNOW), alerted(WNOW)));
  });
});

describe("shared loaders and alert cards (spec §9.0.1, 4.2, 4.6)", () => {
  it("L1 human events, direct and pivoted from filtered items", async () => {
    expect(await chainSent((s, c) => s.fetchEvents(B.humanEvents(W7, NO_FILTERS), c))).toEqual(events(HUMAN, W7, false));
    expect(await chainSent((s, c) => s.fetchEvents(B.humanEvents(WNOW, SOME_FILTERS), c))).toEqual(events(HUMAN, WNOW, true));
  });

  it("L2: events(human).pivotTo(salesOrder_1).pivotTo(alertHistory).where(lifecycle ∨ human); open ids via alert", async () => {
    expect(await chainSent((s, c) => s.fetchEvents(B.touchedEventsChain(W7, NO_FILTERS), c))).toEqual([
      ...events(HUMAN, W7, false), pivot("salesOrder_1"), pivot("alertHistory"), where({ $or: [LIFECYCLE, HUMAN] }),
    ]);
    expect(await chainSent((s, c) => s.fetchOpenAlerts(B.touchedOpenAlerts(W7, NO_FILTERS), c))).toEqual([
      ...events(HUMAN, W7, false), pivot("alert"),
    ]);
  });

  it.each([["no filters", NO_FILTERS, false], ["item filters", SOME_FILTERS, true]] as const)(
    "4.2 / 4.6 closed and not open now: closedSet.subtract(closedSet → alert → historyEvents), %s",
    async (_l, f, filtered) => {
      const closed = B.closedNotOpenNow(W7, f);
      expect(await chainSent((s, c) => s.fetchEvents(closed, c))).toEqual(finalSet(W7, filtered));
      const grouped = await record((s, c) => s.countEventsBy(closed, "alert", "priority", c));
      expect(chainOf(grouped[0].body.objectSet)).toEqual(finalSet(W7, filtered));
      expect(grouped[0].body.groupBy).toEqual(exact("priorityAtEvent"));
    },
  );
});

describe("3.1 and 4.1 (spec §9 3.1, 4.1)", () => {
  it("3.1 worked set: soeAll ∩ AlertHistory.where(human ∧ tsIn).pivotTo(salesOrder_1).pivotTo(otifEvaluation)", async () => {
    const soeAll: Step[] = [base("SalesOrderOtifEvaluation")];
    const workedLeg: Step[] = [base("AlertHistory"), where({ $and: [HUMAN, tsIn(W7)] }), pivot("salesOrder_1"), pivot("otifEvaluation")];
    expect(await chainSent((s, c) => s.countRisk(R.riskWorked(W7, NO_FILTERS), c))).toEqual(intersect(soeAll, workedLeg));
    const b51 = await chainSent((s, c) => s.countItems(R.itemsOfRisk(R.riskBucket(R.riskWorked(W7, NO_FILTERS), "b51_70")), c));
    const scoreIn = { $and: [{ $not: { otifStatus: { $eq: "Delayed" } } }, { otifScore: { $gte: 51 } }, { otifScore: { $lt: 71 } }] };
    expect(b51).toEqual([...intersect(soeAll, workedLeg), where(scoreIn), pivot("salesOrder")]);
  });

  it("4.1 worked ids = AlertHistory.where(human ∧ tsIn).pivotTo(salesOrder_1)", async () => {
    expect(await chainSent((s, c) => s.fetchItems(B.workedItems(W7), c))).toEqual(itemsWith(HUMAN, W7));
  });

  it("4.1 totals: exclusion gate ∧ verdict date in the window, grouped by the mode's classification", async () => {
    const crit = await record((s, c) => s.countVerdictsBy({ mode: "crit", window: W7 }, c));
    const dateIn = { $and: [{ otifOtShipmentEndDate: { $gte: "2026-09-17" } }, { otifOtShipmentEndDate: { $lte: "2026-09-24" } }] };
    expect(chainOf(crit[0].body.objectSet)).toEqual([base("OtifOrderVerdict"), where({ $and: [{ officialExclusionCrit: { $eq: "No" } }, dateIn] })]);
    expect(crit[0].body.groupBy).toEqual(exact("critClassification"));
    const otifNow = await record((s, c) => s.countVerdictsBy({ mode: "otif", window: WNOW }, c));
    expect(chainOf(otifNow[0].body.objectSet)).toEqual([
      base("OtifOrderVerdict"),
      where({ $and: [{ officialExclusionOtif: { $eq: "No" } }, { otifOtShipmentEndDate: { $lte: "2026-09-24" } }] }),
    ]);
    expect(otifNow[0].body.groupBy).toEqual(exact("initOtifClassification"));
  });
});

describe("guards", () => {
  it("no AlertHistory / OtifOrderVerdict where clause filters a group-by-only property (D16)", async () => {
    const PREDICATES: EventPredicate[] = ["viewed", "action", "writeback", "human", "opened", "closed", "lifecycle"];
    const byItems: EventSet = { kind: "ofItems", items: { kind: "filtered", base: { kind: "all" }, filters: SOME_FILTERS } };
    const sets: EventSet[] = PREDICATES.flatMap((p) =>
      [W7, WNOW, null].map((window): EventSet => ({ kind: "where", base: byItems, filter: { predicates: [p], window } })),
    );
    const requests = await record(async (s, c) => {
      for (const set of sets) {
        await s.fetchEvents(set, c);
        for (const g of ["queueFilter", "routingPersona", "alertType", "priority", "actionType", "writebackType"] as const) {
          await s.countEventsBy(set, "alert", g, c);
        }
      }
      for (const mode of ["otif", "crit"] as const) for (const window of [W7, WNOW]) await s.countVerdictsBy({ mode, window }, c);
      await s.fetchVerdictsByIds(["o1", "o2"], c);
      await s.fetchEvents(B.closedNotOpenNow(W7, SOME_FILTERS), c);
      await s.countRisk(R.riskWorked(W7, SOME_FILTERS), c);
    });
    const fieldsOn = (type: string) => new Set(requests.flatMap((r) => whereFieldsOn(r.body.objectSet, type)));
    const ah = fieldsOn("AlertHistory");
    const oov = fieldsOn("OtifOrderVerdict");
    expect(["persona", "riskType", "priorityAtEvent"].filter((f) => ah.has(f))).toEqual([]);
    expect(oov.has("critClassification")).toBe(false);
    // Anti-vacuity: the walker sees the fields that are filtered, and the forbidden ones are grouped on.
    expect([...ah].sort()).toEqual(["eventSource", "eventTimestamp", "eventType"]);
    expect(oov.has("officialExclusionCrit") && oov.has("otifOrderId")).toBe(true);
    const grouped = new Set(requests.flatMap((r) => (Array.isArray(r.body.groupBy) ? r.body.groupBy.map((g: { field?: string }) => g.field) : [])));
    for (const f of ["persona", "riskType", "priorityAtEvent", "critClassification"]) expect(grouped.has(f)).toBe(true);
  });

  it("an empty id list sends no request", async () => {
    const t = setup();
    expect(await t.source.fetchItemsByIds([], makeCtx())).toEqual({ rows: [], capped: false });
    expect(await t.source.fetchVerdictsByIds([], makeCtx())).toEqual({ rows: [], capped: false });
    expect(t.requests).toEqual([]);
  });
});
