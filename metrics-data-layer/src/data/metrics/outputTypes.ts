/**
 * Card output types `T` (spec §10, Appendix A O1–O7). Types only. Re-exported by `types.ts`.
 * Counts are plain numbers; values are USD; durations hours; ages days; percentages fractions 0..1.
 */
import type { CLOSURE_GROUPS, DURATION_EXCLUSIONS, DURATION_SERIES_KEYS } from "../../config/metrics";
import type { Availability, Caveat, OtifMode, RiskBucketId, StageId, Unit, View, WindowKey } from "./types";

/** Segment of 2.3 / 2.4 outside the funnel path. Spec §9 2.3, 2.4; Appendix A F4. */
export interface OutsidePath {
  readonly count: number;
  /** Null in the alert view (Appendix A F6). */
  readonly valueUsd: number | null;
  readonly label: string;
}
/**
 * A funnel stage before derive. `count`/`valueUsd` null unless availability `ok`; `valueUsd` null in
 * section 1 and the alert view. `outsidePath` only on 2.3/2.4 totals, null inside breakdown groups. Spec §10.
 */
export interface FunnelStageRaw {
  readonly id: StageId;
  readonly label: string;
  readonly count: number | null;
  readonly valueUsd: number | null;
  readonly availability: Availability;
  readonly caveats: readonly Caveat[];
  readonly outsidePath: OutsidePath | null;
}
/**
 * A derived stage. `pctPrev`/`pctFirst` fractions 0..1 on the active unit (null on zero/null denominator);
 * `trackValue` = previous applicable stage's value in the active unit, null on the first. Spec §9.0, Appendix A F2–F3.
 */
export interface FunnelStage extends FunnelStageRaw {
  readonly pctPrev: number | null;
  readonly pctFirst: number | null;
  readonly trackValue: number | null;
}
/** A full funnel. `firstStageId` = first stage with availability `ok` (from data). Spec §10, §12.2 S1. */
export interface FunnelSeries {
  readonly section: 1 | 2;
  readonly view: View;
  readonly window: WindowKey;
  readonly unit: Unit;
  readonly firstStageId: StageId;
  readonly stages: readonly FunnelStage[];
  readonly generatedAt: string;
}

/**
 * 3.1 row: one per bucket × worked (14 rows, zero-filled). `shareOfBucket` = this row's share of the
 * bucket total in the selected unit (null on zero). No `group` field (Appendix A O1, O5).
 */
export interface BucketRow {
  readonly bucket: RiskBucketId;
  readonly worked: boolean;
  readonly count: number;
  readonly valueUsd: number | null;
  readonly shareOfBucket: number | null;
}
/** 3.2 movement outcome (reserved). Spec §10. */
export type Movement = "improved" | "same" | "worsened" | "closed" | "scored";
/** 3.2 row (reserved; card blocked). Spec §10. */
export interface MovementRow {
  readonly startBucket: RiskBucketId;
  readonly worked: boolean;
  readonly outcome: Movement;
  readonly count: number;
  readonly valueUsd: number | null;
}
/** 3.3 row (reserved; card blocked). Spec §10. */
export interface CalibrationRow {
  readonly bucket: RiskBucketId;
  readonly n: number;
  readonly missed: number;
  readonly meanScore: number | null;
}

/**
 * 4.1 headline (first draft). Rates = made / n, null when n = 0; n counts made + not-made rows only
 * (Appendix A P3). `missingVerdict` = worked item ids with no verdict row. Spec §10.
 */
export interface OutcomeHeadline {
  readonly mode: OtifMode;
  readonly workedRate: number | null;
  readonly notWorkedRate: number | null;
  readonly workedN: number;
  readonly notWorkedN: number;
  readonly workedMade: number;
  readonly notWorkedMade: number;
  readonly missingVerdict: number;
}
/** 4.1 stratum row (reserved for the second draft). Spec §10. */
export interface StratumRow {
  readonly verdictMode: OtifMode;
  readonly alertType: string;
  readonly priorityAtEvent: string;
  readonly worked: boolean;
  readonly n: number;
  readonly made: number;
  readonly valueUsd: number | null;
  readonly madeValueUsd: number | null;
}

/** Duration bin, hours `[binStart, binEnd)`; last bin `binEnd: null`. Spec §10, Appendix A V1. */
export interface DurationBin {
  readonly binStart: number;
  readonly binEnd: number | null;
  readonly count: number;
}
/** Duration series key. Spec §10. */
export type DurationSeriesKey = (typeof DURATION_SERIES_KEYS)[number];
/** A duration distribution; median/p90 in hours per Appendix A O7 (null if n = 0 or open-ended bin). */
export interface DurationSeries {
  readonly key: DurationSeriesKey;
  readonly label: string;
  readonly n: number;
  readonly bins: readonly DurationBin[];
  readonly median: number | null;
  readonly p90: number | null;
}
/** Why an alert was left out of a duration series. Spec §10. */
export type DurationExclusion = (typeof DURATION_EXCLUSIONS)[number];
/** 4.2–4.4 output. `clampedNegative` = durations below 0 clamped to 0. Spec §10, §9 4.2. */
export interface DurationResult {
  readonly series: readonly DurationSeries[];
  readonly excluded: readonly { readonly reason: DurationExclusion; readonly count: number }[];
  readonly clampedNegative: number;
}

/** Alert age bin, days; last bin `binEnd: null`. Spec §10. */
export interface AgeBin {
  readonly binStart: number;
  readonly binEnd: number | null;
  readonly alertCount: number;
}
/** Item age bin (item placed by its oldest open alert); value summed once per item. Spec §10, §9 4.5. */
export interface ItemAgeBin {
  readonly binStart: number;
  readonly binEnd: number | null;
  readonly itemCount: number;
  readonly valueUsd: number;
}
/** Threshold tiles for N days, set by derive; `pct` over open alerts with known age (Appendix A O6). */
export interface AgeingThreshold {
  readonly days: number;
  readonly alerts: number;
  readonly valueUsd: number;
  readonly pct: number | null;
}
/** 4.5 output. `itemBins` always present, may be empty. `asOf` ISO. Spec §10, Appendix A O6. */
export interface AgeingBacklog {
  readonly alertBins: readonly AgeBin[];
  readonly itemBins: readonly ItemAgeBin[];
  readonly openAlerts: number;
  readonly unknownAge: number;
  readonly asOf: string;
  readonly threshold: AgeingThreshold;
}
/** 4.6 closure group. Spec §10. */
export type ClosureGroup = (typeof CLOSURE_GROUPS)[number];
/** One 4.6 row. Spec §10. */
export interface CompositionRow {
  readonly group: ClosureGroup;
  readonly count: number;
}
/** 4.6 output: 4 rows, zero-filled, summing to `closedTotal`. Spec §10. */
export interface CompositionResult {
  readonly rows: readonly CompositionRow[];
  readonly closedTotal: number;
}
/** 4.7 row (reserved; card blocked). `month` = `YYYY-MM`. Spec §10. */
export interface RolledMonthRow {
  readonly month: string;
  readonly dueCount: number;
  readonly dueValueUsd: number;
  readonly rolledCount: number;
  readonly rolledValueUsd: number;
  readonly isPartial: boolean;
}
