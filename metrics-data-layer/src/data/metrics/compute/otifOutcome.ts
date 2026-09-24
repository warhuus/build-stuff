/**
 * 4.1 realised OTIF / CRIT headline, worked vs not worked (spec §9 4.1 step 4; Appendix A P2 a–b, P3).
 * Pure. Gate values and verdict values come from `config` (decision D1).
 */
import type { MetricsConfig } from "../../../config/metrics";
import type { GroupCount, OtifMode, OutcomeHeadline, VerdictRow, Window } from "../types";
import { toDateOnly } from "../window";
import { countOfGroup } from "./breakdown";
import { safeDivide } from "./stats";

/**
 * Whether a verdict row passes the mode's official-exclusion gate (spec §9 4.1 `MODE[m].gate`):
 * otif → `otifExclusion`, crit → `critExclusion`, equal to `config.EXCLUSION_GATE_PASS`. Never swapped.
 */
export function passesGate(row: VerdictRow, mode: OtifMode, config: MetricsConfig): boolean {
  const gate = mode === "otif" ? row.otifExclusion : row.critExclusion;
  return gate === config.EXCLUSION_GATE_PASS;
}

/** The row's verdict for the mode: otif → `otifVerdict`, crit → `critVerdict` (null when absent). */
export function verdictOf(row: VerdictRow, mode: OtifMode): string | null {
  return mode === "otif" ? row.otifVerdict : row.critVerdict;
}

/**
 * Whether a verdict date (`YYYY-MM-DD`; only its first 10 characters are compared) lies in the window on
 * UTC calendar dates, both bounds inclusive (spec §9 4.1 `dateIn`, instructions §8 item 2). Under "now"
 * (`start` null) there is no lower bound. Null date → false.
 */
export function inVerdictWindow(verdictDate: string | null, window: Window): boolean {
  if (verdictDate === null) return false;
  const date = verdictDate.slice(0, 10);
  if (window.start !== null && date < toDateOnly(window.start)) return false;
  return date <= toDateOnly(window.end);
}

/** Inputs of `outcomeHeadline` (from `OtifOutcomeRaw`). */
export interface OutcomeInput {
  readonly mode: OtifMode;
  readonly window: Window;
  /** Gated server totals grouped by the mode's classification. */
  readonly totals: readonly GroupCount[];
  readonly workedIds: readonly string[];
  readonly verdicts: readonly VerdictRow[];
}

/** The headline plus whether a not-worked count had to be clamped at 0 (worked exceeded the totals). */
export interface OutcomeComputation {
  readonly headline: OutcomeHeadline;
  readonly clamped: boolean;
}

/**
 * Spec §9 4.1 step 4 + Appendix A P3: worked = verdict rows passing the mode's gate, dated in the window
 * and with verdict made or not-made; totalN = made + not-made groups of `totals` only; notWorkedN =
 * totalN − workedN and notWorkedMade = totalMade − workedMade, each clamped at 0 (`clamped` reports it);
 * rates = made / n, null at n = 0; missingVerdict = distinct worked ids with no verdict row at all.
 */
export function outcomeHeadline(input: OutcomeInput, config: MetricsConfig): OutcomeComputation {
  const { made, notMade } = config.VERDICT_VALUES[input.mode];
  const worked = input.verdicts.filter((row) => {
    const verdict = verdictOf(row, input.mode);
    return passesGate(row, input.mode, config) && inVerdictWindow(row.verdictDate, input.window) &&
      (verdict === made || verdict === notMade);
  });
  const workedN = worked.length;
  const workedMade = worked.filter((row) => verdictOf(row, input.mode) === made).length;
  const totalMade = countOfGroup(input.totals, made);
  const rawNotWorkedN = totalMade + countOfGroup(input.totals, notMade) - workedN;
  const rawNotWorkedMade = totalMade - workedMade;
  const notWorkedN = Math.max(0, rawNotWorkedN);
  const notWorkedMade = Math.max(0, rawNotWorkedMade);
  const withRow = new Set(input.verdicts.map((row) => row.otifOrderId));
  return {
    headline: {
      mode: input.mode,
      workedRate: safeDivide(workedMade, workedN),
      notWorkedRate: safeDivide(notWorkedMade, notWorkedN),
      workedN,
      notWorkedN,
      workedMade,
      notWorkedMade,
      missingVerdict: new Set(input.workedIds.filter((id) => !withRow.has(id))).size,
    },
    clamped: rawNotWorkedN < 0 || rawNotWorkedMade < 0,
  };
}
