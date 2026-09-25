// @vitest-environment node
import { describe, expect, it } from "vitest";
import { allEvents, allOpenAlerts, eventsWhere, openAlertsWhere } from "../../../query/build";
import { carriedAlertSets, itemFunnelSets, stageWithOpenAlertWhere } from "../../../query/buildFunnel";
import type { EventSet, ItemSet, OpenAlertSet } from "../../../query/specs";
import type { SourceCtx } from "../../../source/MetricsSource";
import type { MetricsSource } from "../../../source/MetricsSource";
import type { Window } from "../../../types";
import { NO_FILTERS, SOME_FILTERS, W7, WNOW, makeCtx, setup } from "../../helpers/osdkHarness";
import { chainOf, type Step } from "../../helpers/recordingClient";
import {
  ACTION, CLOSED, LIFECYCLE, VIEWED, WRITEBACK, aofSet, base, events, intersect, itemsWith, openInWindow, pivot,
  SOME_FILTERS_WHERE, subtract, union, where,
} from "../../helpers/specPlans";

// TST-02 / OSD-03 (item funnel) and TST-06: the real query/buildFunnel.ts builders compiled through the OSDK
// adapter over the recording client, against the spec §9 2.0–2.4 plans written out from the spec pseudocode.

/** The one chain a port call sends. */
async function chainSent(call: (s: MetricsSource, ctx: SourceCtx) => Promise<unknown>): Promise<Step[]> {
  const t = setup();
  await call(t.source, makeCtx());
  expect(t.requests).toHaveLength(1);
  return chainOf(t.requests[0].body.objectSet);
}
const itemChain = (set: ItemSet) => chainSent((s, c) => s.countItems(set, c));

/** Spec §9 2.0–2.4 item-view plan for window `w` (so20 carries the filters, the event legs do not). */
function itemPlan(w: Window, filtered: boolean) {
  const so20: Step[] = filtered ? [...openInWindow(w), where(SOME_FILTERS_WHERE)] : openInWindow(w);
  const openNow: Step[] = [base("AlertOrderFulfillment"), pivot("sourceSalesOrder")];
  const alerted = w.start === null ? openNow : union(openNow, itemsWith(CLOSED, w));
  const so21 = intersect(so20, alerted);
  const so22 = intersect(so21, itemsWith(VIEWED, w));
  const acted = itemsWith(ACTION, w);
  const wb = itemsWith(WRITEBACK, w);
  const so23 = intersect(so22, acted);
  return {
    so20, so21, so22, so23, so24: intersect(so23, wb),
    outside23: subtract(intersect(so21, acted), so22),
    outside24: subtract(intersect(so21, wb), so23),
  };
}

describe.each([
  ["no filters", NO_FILTERS, false],
  ["item filters", SOME_FILTERS, true],
] as const)("itemFunnel item view (spec §9 2.0–2.4), %s", (_label, f, filtered) => {
  it.each([["7 d", W7], ["now", WNOW]] as const)("every stage set and both outside paths at %s", async (_w, w) => {
    const sets = itemFunnelSets(w, f);
    const plan = itemPlan(w, filtered);
    for (const k of ["so20", "so21", "so22", "so23", "so24", "outside23", "outside24"] as const) {
      expect(await itemChain(sets[k]), k).toEqual(plan[k]);
    }
  });

  it("2.1 perGroup: soX.intersect(aofSet(f).where(aofWhere(d, g)).pivotTo(sourceSalesOrder))", async () => {
    const sets = itemFunnelSets(W7, f);
    const esc = await itemChain(stageWithOpenAlertWhere(sets.so22, f, { field: "escalated", value: true }));
    expect(esc).toEqual(intersect(itemPlan(W7, filtered).so22, [...aofSet(filtered), where({ escalated: { $eq: true } }), pivot("sourceSalesOrder")]));
    const persona = await itemChain(stageWithOpenAlertWhere(sets.so21, f, { field: "routingPersona", value: "Planner" }));
    expect(persona).toEqual(intersect(itemPlan(W7, filtered).so21, [...aofSet(filtered), where({ persona: { $eq: "Planner" } }), pivot("sourceSalesOrder")]));
  });

  it("2.1 alert view terms: life = events(lifecycle, w, f); open = aofSet(f); openWithLifecycle = life.pivotTo(alert)", async () => {
    const t = carriedAlertSets(W7, f);
    const life = events(LIFECYCLE, W7, filtered);
    expect(await chainSent((s, c) => s.countEvents(t.life, "alert", c))).toEqual(life);
    expect(await chainSent((s, c) => s.countOpenAlerts(t.open, c))).toEqual(aofSet(filtered));
    expect(await chainSent((s, c) => s.countOpenAlerts(t.openWithLifecycle, c))).toEqual([...life, pivot("alert")]);
  });
});

describe("set operations the plans do not build yet (TST-06: every spec kind compiles)", () => {
  const viewedIn7 = eventsWhere(allEvents, ["viewed"], W7);
  const closedIn7 = eventsWhere(allEvents, ["closed"], W7);

  it("EventSet intersect", async () => {
    const set: EventSet = { kind: "intersect", a: viewedIn7, b: closedIn7 };
    expect(await chainSent((s, c) => s.countEvents(set, "alert", c))).toEqual(
      intersect(events(VIEWED, W7, false), events(CLOSED, W7, false)),
    );
  });

  it("OpenAlertSet union and subtract", async () => {
    const esc = openAlertsWhere(allOpenAlerts, { field: "escalated", value: true });
    const high = openAlertsWhere(allOpenAlerts, { field: "priority", value: "High" });
    const escChain: Step[] = [base("AlertOrderFulfillment"), where({ escalated: { $eq: true } })];
    const highChain: Step[] = [base("AlertOrderFulfillment"), where({ priority: { $eq: "High" } })];
    const u: OpenAlertSet = { kind: "union", a: esc, b: high };
    const d: OpenAlertSet = { kind: "subtract", a: esc, b: high };
    expect(await chainSent((s, c) => s.countOpenAlerts(u, c))).toEqual(union(escChain, highChain));
    expect(await chainSent((s, c) => s.countOpenAlerts(d, c))).toEqual(subtract(escChain, highChain));
  });
});
