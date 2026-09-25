import { describe, expect, it } from "vitest";
import { BREAKDOWN_DIMENSIONS, CARD_IDS, ITEM_FUNNEL_VIEWS } from "../../../config/metrics";
import {
  allowedBreakdowns,
  BREAKDOWN_REGISTRY,
  breakdownRule,
  firstApplicableStage,
  isAdditive,
  ALERT_VIEW_STAGES,
  eventGroupFieldOf,
  isAlertAttrDim,
  isAlertDim,
  isBreakdownAllowed,
  isItemDim,
  isOpenAlertFilterDim,
  isQueriedUserStage,
  QUERIED_USER_STAGES,
  stagesForDim,
  unhandledDimension,
} from "../breakdowns";
import { fromWire } from "./helpers/testKit";
import type { CardId, ItemFunnelView } from "../types";

type Row = readonly [dim: string, stages: string, additive: boolean];
const ITEM = ["businessLine", "productLine", "region", "plant"];
const ALERT3 = ["alertType", "routingPersona", "priority"];
const flat = (dims: readonly string[]): Row[] => dims.map((d) => [d, "", true] as const);

/** Appendix A "Breakdown registry" table, transcribed independently (stages as "first–last" lists). */
const EXPECTED: Record<CardId, Record<ItemFunnelView, Row[]>> = (() => {
  const same = (rows: Row[]) => ({ item: rows, alert: rows });
  const dur = flat([...ALERT3, ...ITEM]);
  return {
    userFunnel: same([
      ["queueFilter", "1.1,1.2,1.3,1.4", false],
      ["alertType", "1.2,1.3,1.4", false],
      ["escalated", "1.2,1.3,1.4", false],
      ["actionType", "1.3", false],
      ["writebackType", "1.4", false],
    ]),
    itemFunnel: {
      item: [
        ...ITEM.map((d): Row => [d, "2.0,2.1,2.2,2.3,2.4", true]),
        ["routingPersona", "2.1,2.2,2.3,2.4", false],
        ["priority", "2.1,2.2,2.3,2.4", false],
        ["escalated", "2.1,2.2,2.3,2.4", false],
      ],
      alert: [
        ...ALERT3.map((d): Row => [d, "2.1,2.2,2.3,2.4", true]),
        ["escalated", "2.1,2.2,2.3,2.4", true],
        ["actionType", "2.3", false],
        ["writebackType", "2.4", false],
      ],
    },
    riskDistribution: same(flat(ITEM)),
    otifOutcome: same([]),
    raisedToClosed: same(dur),
    raisedToFirstView: same(dur),
    firstViewToClosure: same(dur),
    ageingBacklog: same(flat([...ALERT3, "escalated", ...ITEM])),
    closureComposition: same(flat(ALERT3)),
    riskMovement: same([]),
    riskCalibration: same([]),
    rolledValue: same([]),
  };
})();

describe("breakdown registry (Appendix A)", () => {
  it("matches the Appendix A table exactly", () => {
    for (const card of CARD_IDS) {
      for (const view of ITEM_FUNNEL_VIEWS) {
        const actual = BREAKDOWN_REGISTRY[card][view].map((r): Row => [r.dim, r.stages.join(","), r.additive]);
        expect({ card, view, rows: actual }).toEqual({ card, view, rows: EXPECTED[card][view] });
      }
    }
  });

  it("returns false / empty for every dim outside a row", () => {
    for (const card of CARD_IDS) {
      for (const view of ITEM_FUNNEL_VIEWS) {
        const allowed = EXPECTED[card][view].map((r) => r[0]);
        for (const dim of BREAKDOWN_DIMENSIONS) {
          const inRow = allowed.includes(dim);
          expect(isBreakdownAllowed(card, view, dim)).toBe(inRow);
          if (!inRow) {
            expect(isAdditive(card, view, dim)).toBe(false);
            expect(stagesForDim(card, view, dim)).toEqual([]);
            expect(firstApplicableStage(card, view, dim)).toBeNull();
            expect(breakdownRule(card, view, dim)).toBeNull();
          }
        }
      }
    }
  });

  it("allowedBreakdowns lists the row dims in order", () => {
    expect(allowedBreakdowns("closureComposition", "item")).toEqual(ALERT3);
    expect(allowedBreakdowns("otifOutcome", "item")).toEqual([]);
    expect(allowedBreakdowns("itemFunnel", "alert")).not.toContain("businessLine");
  });

  it("B1: allowed if any stage accepts; the other stages are not applicable", () => {
    expect(isBreakdownAllowed("userFunnel", "item", "actionType")).toBe(true);
    expect(stagesForDim("userFunnel", "item", "actionType")).toEqual(["1.3"]);
    expect(stagesForDim("itemFunnel", "alert", "writebackType")).toEqual(["2.4"]);
    expect(stagesForDim("itemFunnel", "item", "priority")).not.toContain("2.0");
  });

  it("firstApplicableStage", () => {
    expect(firstApplicableStage("userFunnel", "item", "queueFilter")).toBe("1.1");
    expect(firstApplicableStage("userFunnel", "item", "alertType")).toBe("1.2");
    expect(firstApplicableStage("itemFunnel", "item", "region")).toBe("2.0");
    expect(firstApplicableStage("itemFunnel", "item", "escalated")).toBe("2.1");
    expect(firstApplicableStage("itemFunnel", "alert", "actionType")).toBe("2.3");
    expect(firstApplicableStage("ageingBacklog", "item", "region")).toBeNull();
  });

  it("additive flags: B10 and item-view alert dims", () => {
    expect(isAdditive("itemFunnel", "alert", "actionType")).toBe(false);
    expect(isAdditive("itemFunnel", "alert", "writebackType")).toBe(false);
    expect(isAdditive("itemFunnel", "alert", "alertType")).toBe(true);
    expect(isAdditive("itemFunnel", "item", "routingPersona")).toBe(false);
    expect(isAdditive("itemFunnel", "item", "plant")).toBe(true);
    expect(isAdditive("userFunnel", "alert", "queueFilter")).toBe(false);
    expect(isAdditive("ageingBacklog", "alert", "escalated")).toBe(true);
  });

  it("view is ignored by every card except itemFunnel", () => {
    for (const card of CARD_IDS.filter((c) => c !== "itemFunnel")) {
      expect(BREAKDOWN_REGISTRY[card].item).toEqual(BREAKDOWN_REGISTRY[card].alert);
    }
  });
});

describe("dimension kinds", () => {
  it("item dims", () => {
    expect(BREAKDOWN_DIMENSIONS.filter(isItemDim)).toEqual(ITEM);
  });

  it("alert dims", () => {
    expect(BREAKDOWN_DIMENSIONS.filter(isAlertDim)).toEqual([
      "routingPersona",
      "priority",
      "escalated",
      "alertType",
      "actionType",
      "writebackType",
    ]);
  });
});

describe("registry guards (MOD-04, TYP-05)", () => {
  it("alert attributes, open-alert filter dims", () => {
    expect(BREAKDOWN_DIMENSIONS.filter(isAlertAttrDim)).toEqual(["routingPersona", "priority", "alertType"]);
    expect(isAlertAttrDim(null)).toBe(false);
    expect(BREAKDOWN_DIMENSIONS.filter(isOpenAlertFilterDim)).toEqual(["routingPersona", "priority", "escalated"]);
  });

  it("AlertHistory group field per dim (spec §9.0 ahGroupBy); null for item dims and escalated", () => {
    expect(BREAKDOWN_DIMENSIONS.map((d) => [d, eventGroupFieldOf(d)])).toEqual([
      ["businessLine", null],
      ["productLine", null],
      ["region", null],
      ["plant", null],
      ["routingPersona", "routingPersona"],
      ["priority", "priority"],
      ["escalated", null],
      ["alertType", "alertType"],
      ["actionType", "actionType"],
      ["writebackType", "writebackType"],
      ["queueFilter", "queueFilter"],
    ]);
  });

  it("stage lists come from config FUNNEL_STAGES", () => {
    expect(QUERIED_USER_STAGES).toEqual(["1.1", "1.2", "1.3", "1.4"]);
    expect(isQueriedUserStage("1.0")).toBe(false);
    expect(ALERT_VIEW_STAGES).toEqual(["2.1", "2.2", "2.3", "2.4"]);
  });

  it("the never arm throws at run time for an unknown value", () => {
    const unknown = "userRole" as never;
    expect(() => unhandledDimension(unknown)).toThrow(TypeError);
  });

  it("eventGroupFieldOf rejects a dimension from outside the type system", () => {
    expect(() => eventGroupFieldOf(fromWire<"plant">('"userRole"'))).toThrow(TypeError);
  });
});
