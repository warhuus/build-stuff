import { describe, expect, it } from "vitest";
import { CARD_IDS, METRICS_CONFIG, PLACEHOLDER } from "../../../../config/metrics";
import { integrationBlock, stubBlocked } from "../../loaders/blocked";
import { FIXTURE_CONFIG } from "../../source/fake/fixtures";

describe("stubBlocked (spec §9 3.2, 3.3, 4.7)", () => {
  it("3.2 riskMovement: not-captured, S2 score history", () => {
    expect(stubBlocked("riskMovement")).toEqual({
      reason: "not-captured",
      unblockedBy: "S2 OTIF risk score history",
      caveats: ["not-captured"],
    });
  });

  it("3.3 riskCalibration: not-captured, score history and item ↔ verdict link; carries delayed-forced-100", () => {
    expect(stubBlocked("riskCalibration")).toEqual({
      reason: "not-captured",
      unblockedBy: "S2 OTIF risk score history (and the item ↔ verdict link)",
      caveats: ["not-captured", "delayed-forced-100"],
    });
  });

  it("4.7 rolledValue: no-source, S4 rolled-value source", () => {
    expect(stubBlocked("rolledValue")).toEqual({
      reason: "no-source",
      unblockedBy: "S4 rolled-value source",
      caveats: ["no-source"],
    });
  });

  it("first-draft cards are not stubs", () => {
    const stubs = CARD_IDS.filter((id) => stubBlocked(id) !== null);
    expect(stubs).toEqual(["riskMovement", "riskCalibration", "rolledValue"]);
  });
});

describe("integrationBlock (D13)", () => {
  it("userFunnel is blocked while ALERT_APP_ID is the placeholder", () => {
    expect(METRICS_CONFIG.ALERT_APP_ID).toBe(PLACEHOLDER);
    expect(integrationBlock("userFunnel", METRICS_CONFIG)).toEqual({
      reason: "needs-integration-value",
      unblockedBy: "Set ALERT_APP_ID in src/config/metrics.ts at integration",
      caveats: ["needs-integration-value"],
    });
  });

  it("otifOutcome is blocked while VERDICT_DATE_PROPERTY is the placeholder", () => {
    expect(integrationBlock("otifOutcome", { ...FIXTURE_CONFIG, VERDICT_DATE_PROPERTY: PLACEHOLDER })).toEqual({
      reason: "needs-integration-value",
      unblockedBy: "Set VERDICT_DATE_PROPERTY in src/config/metrics.ts at integration",
      caveats: ["needs-integration-value"],
    });
  });

  it("set values → null; cards without requirements → null even with placeholders", () => {
    expect(integrationBlock("userFunnel", FIXTURE_CONFIG)).toBeNull();
    expect(integrationBlock("otifOutcome", FIXTURE_CONFIG)).toBeNull();
    // Only the card's own requirement matters: userFunnel ignores VERDICT_DATE_PROPERTY.
    expect(integrationBlock("userFunnel", { ...FIXTURE_CONFIG, VERDICT_DATE_PROPERTY: PLACEHOLDER })).toBeNull();
    const blocked = CARD_IDS.filter((id) => integrationBlock(id, METRICS_CONFIG) !== null);
    expect(blocked).toEqual(["userFunnel", "otifOutcome"]);
  });

  it("compares against config.PLACEHOLDER (tests may override it)", () => {
    const config = { ...FIXTURE_CONFIG, PLACEHOLDER: "unset", ALERT_APP_ID: "unset" };
    expect(integrationBlock("userFunnel", config)?.reason).toBe("needs-integration-value");
  });
});
