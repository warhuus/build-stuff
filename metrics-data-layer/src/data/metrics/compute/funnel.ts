/**
 * Funnel derivation (spec §9.0 "Funnel derivation"; Appendix A F2, F3, F5, F6; §5 B8): percentages,
 * `trackValue`, first `ok` stage, and `FunnelSeries` assembly. Pure. Stage labels are static texts.
 */
import { FUNNEL_STAGES, OUTSIDE_PATH_LABELS, STAGE_LABELS } from "../../../config/metrics";
import type {
  Availability,
  Caveat,
  CountValue,
  FunnelSeries,
  FunnelStage,
  FunnelStageRaw,
  OutsidePath,
  StageId,
  Unit,
  View,
  WindowKey,
} from "../types";
import { safeDivide } from "./stats";

/** Derived stages plus the caveats derivation adds (`value-item-view-only` on the count fallback). */
export interface DerivedStages {
  readonly stages: readonly FunnelStage[];
  readonly caveats: readonly Caveat[];
}

/** Count and value of a stage; value null in section 1 and the alert view (Appendix A F6). */
export interface StageAmounts {
  readonly count: number;
  readonly valueUsd: number | null;
}

/**
 * True when unit `valueUsd` must fall back to counts: some `ok` stage has `valueUsd: null` (section 1,
 * alert view). Appendix A F6; never mixes units within one funnel.
 */
export function usesCountFallback(stages: readonly FunnelStageRaw[], unit: Unit): boolean {
  return unit === "valueUsd" && stages.some((stage) => stage.availability === "ok" && stage.valueUsd === null);
}

/** Id of the first stage with availability `ok` (Appendix A F3), or null when none is ok. */
export function firstOkStageId(stages: readonly FunnelStageRaw[]): StageId | null {
  return stages.find((stage) => stage.availability === "ok")?.id ?? null;
}

/**
 * Sets `pctPrev`, `pctFirst` and `trackValue` on each stage in `unit` (spec §9.0, Appendix A F2–F3):
 * - only `ok` stages are applicable; others get null for all three and are skipped as "previous";
 * - trackValue = previous applicable stage's value, null on the first applicable stage;
 * - pctPrev = value / previous applicable value (null on the first); pctFirst = value / first ok value;
 * - division by zero or null → null. Unit `valueUsd` with null values falls back to counts and reports
 *   `value-item-view-only` (Appendix A F6). Count vs value give different percentages (B8).
 */
export function deriveFunnel(stages: readonly FunnelStageRaw[], unit: Unit): DerivedStages {
  const fallback = usesCountFallback(stages, unit);
  const valueOf = (stage: FunnelStageRaw): number | null =>
    unit === "count" || fallback ? stage.count : stage.valueUsd;
  const first = stages.find((stage) => stage.availability === "ok");
  const firstValue = first ? valueOf(first) : null;
  let previous: number | null | undefined;
  const derived = stages.map((stage): FunnelStage => {
    if (stage.availability !== "ok") return { ...stage, pctPrev: null, pctFirst: null, trackValue: null };
    const value = valueOf(stage);
    const trackValue = previous ?? null;
    const pctPrev = previous === undefined ? null : safeDivide(value, previous);
    previous = value;
    return { ...stage, pctPrev, pctFirst: safeDivide(value, firstValue), trackValue };
  });
  return { stages: derived, caveats: fallback ? ["value-item-view-only"] : [] };
}

/**
 * A stage with no data: count and value null, the given availability (`not-applicable` for stages a
 * breakdown dim does not apply to, `no-source` for 1.0), label from `STAGE_LABELS`, no outside path.
 * Spec §9.0, Appendix A O4, F5.
 */
export function unavailableStage(
  id: StageId,
  availability: Exclude<Availability, "ok">,
  caveats: readonly Caveat[] = [],
): FunnelStageRaw {
  return { id, label: STAGE_LABELS[id], count: null, valueUsd: null, availability, caveats, outsidePath: null };
}

/** `unavailableStage(id, "not-applicable")`: a stage the breakdown dim does not apply to (Appendix A B1). */
export function notApplicableStage(id: StageId): FunnelStageRaw {
  return unavailableStage(id, "not-applicable");
}

/**
 * An `ok` stage with its amounts (`valueUsd` null in section 1 / alert view), label from `STAGE_LABELS`,
 * stage caveats and outside path (2.3 / 2.4 totals only; null inside breakdown groups). Spec §10.
 */
export function okStage(
  id: StageId,
  amounts: StageAmounts,
  caveats: readonly Caveat[] = [],
  outsidePath: OutsidePath | null = null,
): FunnelStageRaw {
  return { id, label: STAGE_LABELS[id], count: amounts.count, valueUsd: amounts.valueUsd, availability: "ok", caveats, outsidePath };
}

/**
 * Outside-path segment (spec §9 2.3 / 2.4, Appendix A F4): count and value (null in the alert view)
 * with the label from `OUTSIDE_PATH_LABELS`.
 */
export function outsidePathOf(stageId: "2.3" | "2.4", amounts: StageAmounts): OutsidePath {
  return { count: amounts.count, valueUsd: amounts.valueUsd, label: OUTSIDE_PATH_LABELS[stageId] };
}

/** `CountValue` → `StageAmounts` (item view: value always present). */
export function itemAmounts(total: CountValue): StageAmounts {
  return { count: total.count, valueUsd: total.valueUsd };
}

/** Input of `funnelSeries`. `stages` in funnel order; `generatedAt` ISO. */
export interface FunnelSeriesInput {
  readonly section: 1 | 2;
  readonly view: View;
  readonly window: WindowKey;
  readonly unit: Unit;
  readonly generatedAt: string;
  readonly stages: readonly FunnelStageRaw[];
}

/** A `FunnelSeries` plus the derivation caveats (`deriveFunnel`). */
export interface FunnelSeriesResult {
  readonly series: FunnelSeries;
  readonly caveats: readonly Caveat[];
}

/**
 * Builds a `FunnelSeries` (spec §10): derives the stages in `unit`; `firstStageId` = first `ok` stage
 * (§12.2 S1: from data), or the section's first stage id when no stage is ok. `unit` = the unit the numbers
 * are in: `"count"` under the count fallback (Appendix A F6; SPF-01), else the selected unit. Caveats: see
 * `deriveFunnel`.
 */
export function funnelSeries(input: FunnelSeriesInput): FunnelSeriesResult {
  const derived = deriveFunnel(input.stages, input.unit);
  const sectionFirst = input.section === 1 ? FUNNEL_STAGES.user[0] : FUNNEL_STAGES.item[0];
  return {
    series: {
      section: input.section,
      view: input.view,
      window: input.window,
      unit: usesCountFallback(input.stages, input.unit) ? "count" : input.unit,
      firstStageId: firstOkStageId(input.stages) ?? sectionFirst,
      stages: derived.stages,
      generatedAt: input.generatedAt,
    },
    caveats: derived.caveats,
  };
}
