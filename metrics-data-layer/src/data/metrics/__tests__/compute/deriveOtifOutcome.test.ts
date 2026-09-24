import { describe, expect, it } from "vitest";
import { deriveOtifOutcome } from "../../compute/deriveOtifOutcome";
import { EMPTY_FILTERS } from "../../selection";
import type { OtifOutcomeRaw, VerdictRow } from "../../types";
import { sel, win } from "./deriveTestUtils";

const v = (id: string, overrides: Partial<VerdictRow> = {}): VerdictRow => ({
  otifOrderId: id,
  otifVerdict: "OTIF",
  critVerdict: "CRIT",
  otifExclusion: "No",
  critExclusion: "No",
  verdictDate: "2026-09-20",
  ...overrides,
});

describe("deriveOtifOutcome (4.1)", () => {
  const raw: OtifOutcomeRaw = {
    window: win(30),
    dimension: null,
    mode: "otif",
    totals: [{ group: "OTIF", count: 3 }],
    workedIds: ["1"],
    verdicts: [v("1")],
  };

  it("headline, no breakdown, always-on caveats; unit does not matter", () => {
    const out = deriveOtifOutcome(raw, sel());
    expect(out.data.breakdown).toBeNull();
    expect(out.data.total).toMatchObject({ workedN: 1, workedMade: 1, notWorkedN: 2, notWorkedMade: 2 });
    expect(out.caveats).toEqual(["gate-differs", "unstratified", "not-worked-includes-unalerted"]);
    expect(deriveOtifOutcome(raw, sel({ unit: "valueUsd" }))).toEqual(out);
  });

  it("filters-not-applied with any item filter; now-all-time under now", () => {
    const out = deriveOtifOutcome({ ...raw, window: win("now") }, sel({ filters: { ...EMPTY_FILTERS, plant: ["X"] } }));
    expect(out.caveats).toContain("filters-not-applied");
    expect(out.caveats).toContain("now-all-time");
  });
});
