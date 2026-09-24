import { describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../../config/metrics";
import { inVerdictWindow, outcomeHeadline, passesGate, verdictOf } from "../../compute/otifOutcome";
import type { VerdictRow } from "../../types";
import { win } from "./deriveTestUtils";

const v = (id: string, overrides: Partial<VerdictRow> = {}): VerdictRow => ({
  otifOrderId: id,
  otifVerdict: "OTIF",
  critVerdict: "CRIT",
  otifExclusion: "No",
  critExclusion: "No",
  verdictDate: "2026-09-20",
  ...overrides,
});

describe("otifOutcome helpers", () => {
  it("gates never swapped", () => {
    const row = v("1", { otifExclusion: "Yes", critExclusion: "No" });
    expect(passesGate(row, "otif", METRICS_CONFIG)).toBe(false);
    expect(passesGate(row, "crit", METRICS_CONFIG)).toBe(true);
  });

  it("reads the mode's verdict", () => {
    const row = v("1", { otifVerdict: "Not OTIF", critVerdict: null });
    expect(verdictOf(row, "otif")).toBe("Not OTIF");
    expect(verdictOf(row, "crit")).toBeNull();
  });

  it("date-only window, inclusive; now has no lower bound", () => {
    const w7 = win(7); // 2026-09-17 … 2026-09-24
    expect(inVerdictWindow("2026-09-17", w7)).toBe(true);
    expect(inVerdictWindow("2026-09-16", w7)).toBe(false);
    expect(inVerdictWindow("2026-09-24", w7)).toBe(true);
    expect(inVerdictWindow("2026-09-25", w7)).toBe(false);
    expect(inVerdictWindow(null, w7)).toBe(false);
    expect(inVerdictWindow("2020-01-01", win("now"))).toBe(true);
  });
});

describe("outcomeHeadline", () => {
  const input = {
    mode: "otif" as const,
    window: win(7),
    totals: [
      { group: "OTIF", count: 10 },
      { group: "Not OTIF", count: 10 },
      { group: "Excluded", count: 99 },
    ],
    workedIds: ["1", "2", "3", "4", "5", "6", "7", "7"],
    verdicts: [
      v("1"),
      v("2", { otifVerdict: "Not OTIF" }),
      v("3", { otifExclusion: "Yes" }), // gate fails
      v("4", { verdictDate: "2026-01-01" }), // outside window
      v("5", { otifVerdict: "Other" }), // not made / not-made
    ],
  };

  it("filters worked rows, denominator made + not-made only, not-worked by subtraction", () => {
    const { headline, clamped } = outcomeHeadline(input, METRICS_CONFIG);
    // worked: 1 (made), 2 (not made) → n 2, made 1; totals n 20, made 10 → not worked n 18, made 9
    expect(headline).toEqual({
      mode: "otif",
      workedRate: 0.5,
      notWorkedRate: 0.5,
      workedN: 2,
      notWorkedN: 18,
      workedMade: 1,
      notWorkedMade: 9,
      missingVerdict: 2, // ids 6 and 7 (7 once)
    });
    expect(clamped).toBe(false);
  });

  it("n = 0 → null rates; worked above totals clamps at 0", () => {
    const { headline, clamped } = outcomeHeadline({ ...input, mode: "crit", totals: [] }, METRICS_CONFIG);
    // crit: every row passes the crit gate and says CRIT; row 4 is outside the window → worked 1, 2, 3, 5
    expect(headline.workedN).toBe(4);
    expect(headline.notWorkedN).toBe(0);
    expect(headline.notWorkedMade).toBe(0);
    expect(headline.notWorkedRate).toBeNull();
    expect(clamped).toBe(true);
    expect(outcomeHeadline({ ...input, verdicts: [], totals: [] }, METRICS_CONFIG).headline.workedRate).toBeNull();
  });

  it("clamps when only the made count exceeds", () => {
    const { clamped } = outcomeHeadline({ ...input, totals: [{ group: "Not OTIF", count: 5 }] }, METRICS_CONFIG);
    expect(clamped).toBe(true);
  });
});
