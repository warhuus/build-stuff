// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  appUsageWhere,
  buildPredicates,
  eventFilterWhere,
  itemFiltersWhere,
  openAlertWhere,
  openInWindowWhere,
  riskWhere,
  toDateOnly,
  tsIn,
  verdictDateIn,
  verdictGate,
} from "../../../source/osdk/compileWhere";
import { PLACEHOLDER, type MetricsConfig } from "../../../../../config/metrics";
import { NO_FILTERS, SOME_FILTERS, TEST_CONFIG, W7, WNOW } from "./osdkTestUtils";

const PRED = buildPredicates(TEST_CONFIG);
const VIEWED = { eventType: { $eq: "opened_by_user" } };
const ACTION = {
  $and: [
    { $or: [{ eventSource: { $in: ["user", "user action", "action"] } }, { eventType: { $eq: "deeplink_clicked" } }] },
    { $not: { eventType: { $eq: "updated" } } },
  ],
};
const WRITEBACK = {
  eventType: { $in: ["delivery_block_removed", "delivery_tolerance_corrected", "allocation_rejection_lifted"] },
};

describe("predicates (spec §4, §9.0 PRED)", () => {
  it("equal the section-4 clauses exactly", () => {
    expect(PRED.viewed).toEqual(VIEWED);
    expect(PRED.action).toEqual(ACTION);
    expect(PRED.writeback).toEqual(WRITEBACK);
    expect(PRED.human).toEqual({ $or: [VIEWED, ACTION, WRITEBACK] });
    expect(PRED.opened).toEqual({ eventType: { $eq: "opened" } });
    expect(PRED.closed).toEqual({ eventType: { $eq: "closed" } });
    expect(PRED.lifecycle).toEqual({ eventType: { $in: ["opened", "closed"] } });
  });

  it("take their values from config", () => {
    const p = buildPredicates({ ...TEST_CONFIG, EVENT_TYPES: { ...TEST_CONFIG.EVENT_TYPES, viewed: "opened_by_user" } });
    expect(p.viewed).toEqual(VIEWED);
    expect(Object.keys(p).sort()).toEqual(["action", "closed", "human", "lifecycle", "opened", "viewed", "writeback"]);
  });
});

describe("tsIn and event filters (spec §9.0)", () => {
  it("uses $and of two single-operator clauses", () => {
    expect(tsIn(W7)).toEqual({
      $and: [{ eventTimestamp: { $gte: W7.start } }, { eventTimestamp: { $lte: W7.end } }],
    });
  });
  it("drops the lower bound under now", () => {
    expect(tsIn(WNOW)).toEqual({ eventTimestamp: { $lte: WNOW.end } });
  });
  it("a single predicate has no $or wrapper; several are OR-ed; window null → predicates only", () => {
    expect(eventFilterWhere({ predicates: ["viewed"], window: W7 }, PRED)).toEqual({ $and: [VIEWED, tsIn(W7)] });
    expect(eventFilterWhere({ predicates: ["viewed", "action"], window: WNOW }, PRED)).toEqual({
      $and: [{ $or: [VIEWED, ACTION] }, { eventTimestamp: { $lte: WNOW.end } }],
    });
    expect(eventFilterWhere({ predicates: ["lifecycle", "human"], window: null }, PRED)).toEqual({
      $or: [PRED.lifecycle, PRED.human],
    });
  });
});

describe("item clauses", () => {
  it("withItemFilters: none for empty filters, one $in per non-empty dimension", () => {
    expect(itemFiltersWhere(NO_FILTERS)).toBeNull();
    expect(itemFiltersWhere(SOME_FILTERS)).toEqual({
      $and: [{ businessLineName: { $in: ["BL1"] } }, { iscRegionName: { $in: ["EU", "NA"] } }],
    });
    expect(itemFiltersWhere({ businessLine: [], productLine: ["P"], region: [], plant: ["X1"] })).toEqual({
      $and: [{ productLineName: { $in: ["P"] } }, { plantCode: { $in: ["X1"] } }],
    });
  });
  it("2.0 open-in-window uses date-only bounds; now is isOpen only (spec §9 2.0)", () => {
    expect(openInWindowWhere(W7)).toEqual({
      $and: [
        { salesOrderItemCreationDate: { $lte: "2026-09-24" } },
        { $or: [{ isOpen: { $eq: true } }, { actualGiDate: { $gte: "2026-09-17" } }] },
      ],
    });
    expect(openInWindowWhere(WNOW)).toEqual({ isOpen: { $eq: true } });
  });
  it("toDateOnly takes the UTC calendar date", () => {
    expect(toDateOnly("2026-09-24T23:59:59.999Z")).toBe("2026-09-24");
  });
});

describe("open-alert, risk, verdict and app-usage clauses", () => {
  it("open-alert conditions map to exact AOF properties", () => {
    expect(openAlertWhere({ field: "routingPersona", value: "Planner" })).toEqual({ persona: { $eq: "Planner" } });
    expect(openAlertWhere({ field: "priority", value: "High" })).toEqual({ priority: { $eq: "High" } });
    expect(openAlertWhere({ field: "escalated", value: false })).toEqual({ escalated: { $eq: false } });
  });
  it("risk conditions per spec §9 3.1", () => {
    const NOT_DELAYED = { $not: { otifStatus: { $eq: "Delayed" } } };
    expect(riskWhere({ kind: "notDelayed" }, TEST_CONFIG)).toEqual(NOT_DELAYED);
    expect(riskWhere({ kind: "bucket", bucket: "delayed" }, TEST_CONFIG)).toEqual({ otifStatus: { $eq: "Delayed" } });
    expect(riskWhere({ kind: "bucket", bucket: "unscored" }, TEST_CONFIG)).toEqual({
      $and: [NOT_DELAYED, { otifScore: { $isNull: true } }],
    });
    expect(riskWhere({ kind: "bucket", bucket: "b15_30" }, TEST_CONFIG)).toEqual({
      $and: [NOT_DELAYED, { otifScore: { $gte: 0 } }, { otifScore: { $lt: 31 } }],
    });
    expect(riskWhere({ kind: "bucket", bucket: "b91_100" }, TEST_CONFIG)).toEqual({
      $and: [NOT_DELAYED, { otifScore: { $gte: 91 } }, { otifScore: { $lt: 101 } }],
    });
  });
  it("verdict gates are never swapped", () => {
    expect(verdictGate("otif", TEST_CONFIG)).toEqual({ officialExclusionOtif: { $eq: "No" } });
    expect(verdictGate("crit", TEST_CONFIG)).toEqual({ officialExclusionCrit: { $eq: "No" } });
  });
  it("dateIn uses VERDICT_DATE_PROPERTY with date-only bounds", () => {
    expect(verdictDateIn(W7, TEST_CONFIG)).toEqual({
      $and: [{ otifOtShipmentEndDate: { $gte: "2026-09-17" } }, { otifOtShipmentEndDate: { $lte: "2026-09-24" } }],
    });
    const other = { ...TEST_CONFIG, VERDICT_DATE_PROPERTY: "otifFirstInitialDeliveryDateTarget" as const };
    expect(verdictDateIn(WNOW, other)).toEqual({ otifFirstInitialDeliveryDateTarget: { $lte: "2026-09-24" } });
    expect(verdictDateIn(W7, other)).toEqual({
      $and: [
        { otifFirstInitialDeliveryDateTarget: { $gte: "2026-09-17" } },
        { otifFirstInitialDeliveryDateTarget: { $lte: "2026-09-24" } },
      ],
    });
  });
  it("placeholders throw instead of compiling", () => {
    const placeholder: MetricsConfig = { ...TEST_CONFIG, VERDICT_DATE_PROPERTY: PLACEHOLDER, ALERT_APP_ID: PLACEHOLDER };
    expect(() => verdictDateIn(W7, placeholder)).toThrow(/VERDICT_DATE_PROPERTY/);
    expect(() => appUsageWhere(W7, placeholder)).toThrow(/ALERT_APP_ID/);
  });
  it("app usage: appId AND full-timestamp window", () => {
    expect(appUsageWhere(W7, TEST_CONFIG)).toEqual({
      $and: [
        { appId: { $eq: "alert-app" } },
        { $and: [{ eventTimestamp: { $gte: W7.start } }, { eventTimestamp: { $lte: W7.end } }] },
      ],
    });
    expect(appUsageWhere(WNOW, TEST_CONFIG)).toEqual({
      $and: [{ appId: { $eq: "alert-app" } }, { eventTimestamp: { $lte: WNOW.end } }],
    });
  });
});
