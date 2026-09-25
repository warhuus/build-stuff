// OTIF / CRIT outcome (4.1): gates per mode, denominator, not-worked by subtraction, window on verdict date.
import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import { deriveOtifOutcome } from "../../compute/deriveOtifOutcome";
import { inVerdictWindow, passesGate } from "../../compute/otifOutcome";
import type { OtifOutcomeRaw, VerdictRow } from "../../types";
import { win } from "../helpers/deriveRows";
import { sel } from "../helpers/testKit";

const v = (id: string, overrides: Partial<VerdictRow> = {}): VerdictRow => ({
  otifOrderId: id,
  otifVerdict: "OTIF",
  critVerdict: "CRIT",
  otifExclusion: "No",
  critExclusion: "No",
  verdictDate: "2026-09-20",
  ...overrides,
});

const raw: OtifOutcomeRaw = {
  window: win(7),
  dimension: null,
  mode: "otif",
  totals: [
    { group: "OTIF", count: 10 },
    { group: "Not OTIF", count: 10 },
    { group: "Excluded", count: 99 }, // neither made nor not made → not in the denominator
  ],
  workedIds: ["1", "2", "3", "4", "5", "6", "7", "7"],
  verdicts: [
    v("1"),
    v("2", { otifVerdict: "Not OTIF" }),
    v("3", { otifExclusion: "Yes" }), // fails the OTIF gate
    v("4", { verdictDate: "2026-01-01" }), // outside the window
    v("5", { otifVerdict: "Other" }), // neither made nor not made
  ],
};

describe("gates (never swapped)", () => {
  it.each([
    ["otif", false],
    ["crit", true],
  ] as const)("otifExclusion Yes, critExclusion No: %s gate passes = %s", (mode, passes) => {
    expect(passesGate(v("1", { otifExclusion: "Yes", critExclusion: "No" }), mode, METRICS_CONFIG)).toBe(passes);
  });
});

describe("verdict window (date-only, inclusive; 7 d = 2026-09-17 … 2026-09-24)", () => {
  it.each([
    ["2026-09-17", true],
    ["2026-09-16", false],
    [null, false],
  ])("%s → %s", (date, inside) => {
    expect(inVerdictWindow(date, win(7))).toBe(inside);
  });
});

describe("deriveOtifOutcome (4.1)", () => {
  it("denominator made + not made; not worked = totals − worked; missing verdicts counted", () => {
    // worked: 1 made, 2 not made → n 2, made 1; totals n 20, made 10 → not worked n 18, made 9
    expect(deriveOtifOutcome(raw, sel()).data.total).toEqual({
      mode: "otif",
      workedRate: 0.5,
      notWorkedRate: 0.5,
      workedN: 2,
      notWorkedN: 18,
      workedMade: 1,
      notWorkedMade: 9,
      missingVerdict: 2, // ids 6 and 7 (7 once)
    });
  });

  it("n = 0 → null rate; worked above totals clamps not worked at 0", () => {
    // crit: every row passes the crit gate and says CRIT; row 4 is outside the window → worked 1, 2, 3, 5
    const crit = deriveOtifOutcome({ ...raw, mode: "crit", totals: [] }, sel()).data.total;
    expect(crit).toMatchObject({ workedN: 4, notWorkedN: 0, notWorkedMade: 0, notWorkedRate: null });
    expect(deriveOtifOutcome({ ...raw, verdicts: [], totals: [] }, sel()).data.total.workedRate).toBeNull();
  });
});
