import { describe, expect, it } from "vitest";
import { itemsForDim, salesOrderIdsOf } from "../../loaders/alertCardWiring";
import type { AlertLifecycleRow } from "../../types";
import { fakeDeps } from "../helpers/loaderDeps";

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
