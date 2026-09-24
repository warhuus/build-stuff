// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EventSet, ItemSet, OpenAlertSet, RiskSet } from "../../../query/specs";
import { buildPredicates, tsIn } from "../../../source/osdk/compileWhere";
import { isAllItems } from "../../../source/osdk/compileSpec";
import { chainOf, type Step } from "./recordingClient";
import { NO_FILTERS, SOME_FILTERS, TEST_CONFIG, W7, WNOW, makeCtx, setup } from "./osdkTestUtils";

const PRED = buildPredicates(TEST_CONFIG);
const FILTER_WHERE = { $and: [{ businessLineName: { $in: ["BL1"] } }, { iscRegionName: { $in: ["EU", "NA"] } }] };
const HUMAN_W7 = { $and: [PRED.human, tsIn(W7)] };
const SO: Step = { base: "SalesOrders" };
const AH: Step = { base: "AlertHistory" };
const AOF: Step = { base: "AlertOrderFulfillment" };
const SOE: Step = { base: "SalesOrderOtifEvaluation" };

const humanEvents: EventSet = { kind: "where", base: { kind: "all" }, filter: { predicates: ["human"], window: W7 } };
const filteredItems: ItemSet = { kind: "filtered", base: { kind: "all" }, filters: SOME_FILTERS };

async function itemChain(s: ItemSet): Promise<Step[]> {
  const t = setup();
  await t.source.countItems(s, makeCtx());
  return chainOf(t.requests[0].body.objectSet);
}
async function eventChain(s: EventSet): Promise<Step[]> {
  const t = setup();
  await t.source.countEvents(s, "alert", makeCtx());
  return chainOf(t.requests[0].body.objectSet);
}
async function openAlertChain(s: OpenAlertSet): Promise<Step[]> {
  const t = setup();
  await t.source.countOpenAlerts(s, makeCtx());
  return chainOf(t.requests[0].body.objectSet);
}
async function riskChain(s: RiskSet): Promise<Step[]> {
  const t = setup();
  await t.source.countRisk(s, makeCtx());
  return chainOf(t.requests[0].body.objectSet);
}

describe("ItemSet chains (spec §9.0, §9 2.0)", () => {
  it("all, openInWindow (window and now), filtered", async () => {
    expect(await itemChain({ kind: "all" })).toEqual([SO]);
    expect(await itemChain({ kind: "openInWindow", window: WNOW })).toEqual([SO, { where: { isOpen: { $eq: true } } }]);
    expect(await itemChain({ kind: "openInWindow", window: W7 })).toEqual([
      SO,
      {
        where: {
          $and: [
            { salesOrderItemCreationDate: { $lte: "2026-09-24" } },
            { $or: [{ isOpen: { $eq: true } }, { actualGiDate: { $gte: "2026-09-17" } }] },
          ],
        },
      },
    ]);
    expect(await itemChain(filteredItems)).toEqual([SO, { where: FILTER_WHERE }]);
    expect(await itemChain({ kind: "filtered", base: { kind: "all" }, filters: NO_FILTERS })).toEqual([SO]);
  });

  it("pivots with literal link names", async () => {
    expect(await itemChain({ kind: "ofEvents", events: humanEvents })).toEqual([
      AH,
      { where: HUMAN_W7 },
      { pivotTo: "salesOrder_1" },
    ]);
    expect(await itemChain({ kind: "ofOpenAlerts", alerts: { kind: "all" } })).toEqual([AOF, { pivotTo: "sourceSalesOrder" }]);
    expect(await itemChain({ kind: "ofRisk", risk: { kind: "all" } })).toEqual([SOE, { pivotTo: "salesOrder" }]);
  });

  it("intersect / union / subtract", async () => {
    const acted: ItemSet = { kind: "ofEvents", events: humanEvents };
    const actedChain = [AH, { where: HUMAN_W7 }, { pivotTo: "salesOrder_1" }];
    expect(await itemChain({ kind: "intersect", a: filteredItems, b: acted })).toEqual([
      { intersect: [[SO, { where: FILTER_WHERE }], actedChain] },
    ]);
    expect(await itemChain({ kind: "union", a: { kind: "all" }, b: acted })).toEqual([{ union: [[SO], actedChain] }]);
    expect(
      await itemChain({ kind: "subtract", a: { kind: "intersect", a: filteredItems, b: acted }, b: { kind: "all" } }),
    ).toEqual([{ subtract: [[{ intersect: [[SO, { where: FILTER_WHERE }], actedChain] }], [SO]] }]);
  });
});

describe("EventSet chains", () => {
  it("events() pivots from filtered SalesOrders when filters are set (spec §9.0 events)", async () => {
    const s: EventSet = { kind: "where", base: { kind: "ofItems", items: filteredItems }, filter: { predicates: ["human"], window: W7 } };
    expect(await eventChain(s)).toEqual([SO, { where: FILTER_WHERE }, { pivotTo: "alertHistory" }, { where: HUMAN_W7 }]);
  });
  it("filters AlertHistory directly without filters", async () => {
    const s: EventSet = {
      kind: "where",
      base: { kind: "ofItems", items: { kind: "filtered", base: { kind: "all" }, filters: NO_FILTERS } },
      filter: { predicates: ["viewed"], window: WNOW },
    };
    expect(await eventChain(s)).toEqual([AH, { where: { $and: [PRED.viewed, { eventTimestamp: { $lte: WNOW.end } }] } }]);
  });
  it("ofItems of a non-trivial set, ofOpenAlerts, set ops", async () => {
    expect(await eventChain({ kind: "ofItems", items: { kind: "openInWindow", window: WNOW } })).toEqual([
      SO,
      { where: { isOpen: { $eq: true } } },
      { pivotTo: "alertHistory" },
    ]);
    expect(await eventChain({ kind: "ofOpenAlerts", alerts: { kind: "all" } })).toEqual([AOF, { pivotTo: "historyEvents" }]);
    const closedNotOpen: EventSet = {
      kind: "subtract",
      a: humanEvents,
      b: { kind: "ofOpenAlerts", alerts: { kind: "ofEvents", events: humanEvents } },
    };
    expect(await eventChain(closedNotOpen)).toEqual([
      {
        subtract: [
          [AH, { where: HUMAN_W7 }],
          [AH, { where: HUMAN_W7 }, { pivotTo: "alert" }, { pivotTo: "historyEvents" }],
        ],
      },
    ]);
    expect(await eventChain({ kind: "union", a: { kind: "all" }, b: humanEvents })).toEqual([
      { union: [[AH], [AH, { where: HUMAN_W7 }]] },
    ]);
  });
  it("L2 chain: human events → items → all their lifecycle/human events (spec §9.0.1 L2)", async () => {
    const s: EventSet = {
      kind: "where",
      base: { kind: "ofItems", items: { kind: "ofEvents", events: humanEvents } },
      filter: { predicates: ["lifecycle", "human"], window: null },
    };
    expect(await eventChain(s)).toEqual([
      AH,
      { where: HUMAN_W7 },
      { pivotTo: "salesOrder_1" },
      { pivotTo: "alertHistory" },
      { where: { $or: [PRED.lifecycle, PRED.human] } },
    ]);
  });
});

describe("OpenAlertSet chains", () => {
  it("all, ofItems (filtered / all), ofEvents, where", async () => {
    expect(await openAlertChain({ kind: "all" })).toEqual([AOF]);
    expect(await openAlertChain({ kind: "ofItems", items: filteredItems })).toEqual([
      SO,
      { where: FILTER_WHERE },
      { pivotTo: "orderFulfillmentAlerts" },
    ]);
    expect(await openAlertChain({ kind: "ofItems", items: { kind: "all" } })).toEqual([AOF]);
    expect(await openAlertChain({ kind: "ofEvents", events: humanEvents })).toEqual([AH, { where: HUMAN_W7 }, { pivotTo: "alert" }]);
    const esc: OpenAlertSet = { kind: "where", base: { kind: "all" }, condition: { field: "escalated", value: true } };
    expect(await openAlertChain(esc)).toEqual([AOF, { where: { escalated: { $eq: true } } }]);
    const pers: OpenAlertSet = { kind: "where", base: { kind: "all" }, condition: { field: "routingPersona", value: "P" } };
    expect(await openAlertChain({ kind: "intersect", a: pers, b: { kind: "all" } })).toEqual([
      { intersect: [[AOF, { where: { persona: { $eq: "P" } } }], [AOF]] },
    ]);
  });
});

describe("RiskSet chains (spec §9 3.1)", () => {
  it("soeAll, worked intersection and bucket where", async () => {
    expect(await riskChain({ kind: "ofItems", items: filteredItems })).toEqual([
      SO,
      { where: FILTER_WHERE },
      { pivotTo: "otifEvaluation" },
    ]);
    const worked: RiskSet = {
      kind: "intersect",
      a: { kind: "ofItems", items: { kind: "all" } },
      b: { kind: "ofItems", items: { kind: "ofEvents", events: humanEvents } },
    };
    expect(await riskChain(worked)).toEqual([
      { intersect: [[SOE], [AH, { where: HUMAN_W7 }, { pivotTo: "salesOrder_1" }, { pivotTo: "otifEvaluation" }]] },
    ]);
    const delayed: RiskSet = { kind: "where", base: { kind: "all" }, condition: { kind: "bucket", bucket: "delayed" } };
    expect(await riskChain(delayed)).toEqual([SOE, { where: { otifStatus: { $eq: "Delayed" } } }]);
    expect(await riskChain({ kind: "subtract", a: { kind: "all" }, b: delayed })).toEqual([
      { subtract: [[SOE], [SOE, { where: { otifStatus: { $eq: "Delayed" } } }]] },
    ]);
    expect(await riskChain({ kind: "union", a: { kind: "all" }, b: { kind: "all" } })).toEqual([{ union: [[SOE], [SOE]] }]);
  });
});

describe("isAllItems", () => {
  it("is true only for all / empty-filtered all", () => {
    expect(isAllItems({ kind: "all" })).toBe(true);
    expect(isAllItems({ kind: "filtered", base: { kind: "all" }, filters: NO_FILTERS })).toBe(true);
    expect(isAllItems(filteredItems)).toBe(false);
    expect(isAllItems({ kind: "openInWindow", window: WNOW })).toBe(false);
  });
});

describe("source/osdk code rules", () => {
  const dir = fileURLToPath(new URL("../../../source/osdk/", import.meta.url));
  const sources = readdirSync(dir).map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }));
  it("uses no withProperties (derived properties), no async iterator and only literal pivots", () => {
    const bad = sources.flatMap(({ f, text }) => [
      ...(/withProperties/.test(text) ? [`${f}: withProperties`] : []),
      ...(/asyncIter/.test(text) ? [`${f}: asyncIter`] : []),
      ...[...text.matchAll(/pivotTo\(([^)]*)\)/g)].filter((m) => !/^"[A-Za-z_0-9]+"$/.test(m[1])).map((m) => `${f}: ${m[0]}`),
    ]);
    expect(bad).toEqual([]);
  });
});
