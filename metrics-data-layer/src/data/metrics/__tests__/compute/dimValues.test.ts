import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import {
  attrsDimValue,
  escalatedLabel,
  escalatedValueOf,
  factKeyOf,
  itemDimValue,
  itemValueOf,
  itemsById,
  openAlertDimValue,
  openAlertKeyOf,
} from "../../compute/dimValues";
import { fact, item, openAlert } from "../helpers/deriveRows";

describe("dimValues", () => {
  it("reads item dims", () => {
    const row = item("s1", { businessLine: "BL", productLine: null, region: "EU", plant: "X" });
    expect(itemDimValue(row, "businessLine")).toBe("BL");
    expect(itemDimValue(row, "productLine")).toBeNull();
    expect(itemDimValue(row, "region")).toBe("EU");
    expect(itemDimValue(row, "plant")).toBe("X");
  });

  it("reads attrs dims; other dims null", () => {
    const attrs = { alertType: "T", routingPersona: "R", priority: "P" };
    expect(attrsDimValue(attrs, "alertType")).toBe("T");
    expect(attrsDimValue(attrs, "routingPersona")).toBe("R");
    expect(attrsDimValue(attrs, "priority")).toBe("P");
  });

  it("labels escalated", () => {
    expect(escalatedLabel(true, METRICS_CONFIG)).toBe("true");
    expect(escalatedLabel(false, METRICS_CONFIG)).toBe("false");
    expect(escalatedLabel(null, METRICS_CONFIG)).toBeNull();
  });

  it("reads open-alert dims", () => {
    const row = openAlert("a", { persona: "Pe", priority: "Lo", riskType: "T", escalated: true });
    expect(openAlertDimValue(row, "routingPersona", METRICS_CONFIG)).toBe("Pe");
    expect(openAlertDimValue(row, "priority", METRICS_CONFIG)).toBe("Lo");
    expect(openAlertDimValue(row, "alertType", METRICS_CONFIG)).toBe("T");
    expect(openAlertDimValue(row, "escalated", METRICS_CONFIG)).toBe("true");
  });

  it("keys open alerts by alert dims or their item; dims outside the 4.5 row key nothing (TYP-05)", () => {
    const row = openAlert("a", { salesOrderId: "s1", persona: "Pe", escalated: false });
    const items = itemsById([item("s1", { plant: "Z" })]);
    expect(openAlertKeyOf("routingPersona", items, METRICS_CONFIG)(row)).toBe("Pe");
    expect(openAlertKeyOf("escalated", items, METRICS_CONFIG)(row)).toBe("false");
    expect(openAlertKeyOf("plant", items, METRICS_CONFIG)(row)).toBe("Z");
    expect(openAlertKeyOf("actionType", items, METRICS_CONFIG)(row)).toBeNull();
  });

  it("maps a group label back to the escalated flag", () => {
    expect(escalatedValueOf("true", METRICS_CONFIG)).toBe(true);
    expect(escalatedValueOf("false", METRICS_CONFIG)).toBe(false);
  });

  it("looks items up by id", () => {
    const map = itemsById([item("s1", { plant: "A" }), item("s2", { plant: "B" })]);
    expect(itemValueOf("s2", map, "plant")).toBe("B");
    expect(itemValueOf("s9", map, "plant")).toBeNull();
    expect(itemValueOf(null, map, "plant")).toBeNull();
  });

  it("keys facts by attrs or by their item", () => {
    const f = fact("a1", { salesOrderId: "s1" });
    expect(factKeyOf("alertType", null)(f)).toBe("A");
    expect(factKeyOf("plant", [item("s1", { plant: "Z" })])(f)).toBe("Z");
    expect(factKeyOf("plant", null)(f)).toBeNull();
    expect(factKeyOf("escalated", null)(f)).toBeNull();
  });
});
