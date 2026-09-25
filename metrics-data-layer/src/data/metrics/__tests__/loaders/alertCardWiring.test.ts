import { describe, expect, it } from "vitest";
import { itemsForDim, loaderEnvelope, salesOrderIdsOf } from "../../loaders/alertCardWiring";
import type { AlertLifecycleRow } from "../../types";
import { fakeDeps } from "../shared/loaderDeps";

const ok = { rows: [], capped: false };
const capped = { rows: [], capped: true };

describe("loaderEnvelope (D11, instructions §5 rule 5)", () => {
  it("ok without flags; null fetches skipped", () => {
    expect(loaderEnvelope(1, [ok, null])).toEqual({ raw: 1, status: "ok", caveats: [] });
  });
  it("any capped fetch → partial + row-cap (e.g. only itemsById)", () => {
    expect(loaderEnvelope(1, [ok, null, capped])).toEqual({ raw: 1, status: "partial", caveats: ["row-cap"] });
  });
  it("truncated alone keeps status ok; not-worked-window-cap → partial; config order", () => {
    expect(loaderEnvelope(1, [ok], { truncated: true })).toEqual({ raw: 1, status: "ok", caveats: ["truncated"] });
    expect(loaderEnvelope(1, [capped], { truncated: true, notWorkedWindowCap: true }).caveats).toEqual([
      "not-worked-window-cap",
      "truncated",
      "row-cap",
    ]);
  });
});

describe("salesOrderIdsOf / itemsForDim", () => {
  it("collects non-null ids of every list", () => {
    const row = (salesOrderId: string | null): AlertLifecycleRow => ({
      riskAlertId: "A",
      salesOrderId,
      raisedAt: null,
      closedAt: null,
      isClosed: false,
      firstViewAt: null,
      firstActionAt: null,
      firstWritebackAt: null,
      worked: false,
      closureGroup: null,
      attrs: { routingPersona: null, alertType: null, priority: null },
    });
    expect(salesOrderIdsOf([row("x"), row(null)], [row("x"), row("y")])).toEqual(["x", "x", "y"]);
  });
  it("no call for null / alert dims or zero ids (D14)", async () => {
    const deps = fakeDeps();
    expect(await itemsForDim(null, ["1001_10"], deps)).toBeNull();
    expect(await itemsForDim("priority", ["1001_10"], deps)).toBeNull();
    expect(await itemsForDim("region", [], deps)).toEqual({ rows: [], capped: false });
    expect(deps.source.calls).toEqual([]);
  });
});
