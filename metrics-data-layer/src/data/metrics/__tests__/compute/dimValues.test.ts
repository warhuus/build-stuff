import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import {
  attrsDimValue,
  escalatedLabel,
  factKeyOf,
  itemDimValue,
  itemValueOf,
  itemsById,
  openAlertDimValue,
} from "../../compute/dimValues";
import { fact, item, openAlert } from "./deriveTestUtils";

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
    expect(attrsDimValue(attrs, "escalated")).toBeNull();
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
    expect(openAlertDimValue(row, "plant", METRICS_CONFIG)).toBeNull();
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
  });
});
