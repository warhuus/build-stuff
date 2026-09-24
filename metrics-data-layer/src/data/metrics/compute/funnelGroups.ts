/**
 * Funnel breakdown assembly shared by the userFunnel and itemFunnel derives (spec §9.0 "Funnel
 * derivation", §5 B1–B5, B10; Appendix A O1, F2–F6): stage lists with `not-applicable` stages, one full
 * `FunnelSeries` per group, stage caveats of section 2, and the group list chosen once (B2). Pure.
 */
import { BUILD_STAMP_MAX_WINDOW_DAYS } from "../../../config/metrics";
import type { MetricsConfig } from "../../../config/metrics";
import type {
  BreakdownDimension,
  BreakdownResult,
  Caveat,
  CountValue,
  FunnelSeries,
  FunnelStageRaw,
  GroupCount,
  GroupCountValue,
  ItemStageId,
  StageId,
  Unit,
  View,
  WindowKey,
} from "../types";
import { windowDays } from "../window";
import { buildBreakdown } from "./breakdown";
import { mergeCaveats } from "./caveats";
import { caveatsIf, caveatsIfNow } from "./deriveCommon";
import { funnelSeries, notApplicableStage } from "./funnel";

/** Everything of a `FunnelSeries` except its stages (from raw and selection). */
export interface FunnelContext {
  readonly section: 1 | 2;
  readonly view: View;
  readonly window: WindowKey;
  readonly unit: Unit;
  readonly generatedAt: string;
}

/**
 * The stage list in funnel order: `stageOf(id)` for stages in `applicable`, `not-applicable` (count null)
 * for the rest (spec §5 B1, §9.0).
 */
export function stagesFor<S extends StageId>(
  ids: readonly S[],
  applicable: readonly StageId[],
  stageOf: (id: S) => FunnelStageRaw,
): FunnelStageRaw[] {
  return ids.map((id) => (applicable.includes(id) ? stageOf(id) : notApplicableStage(id)));
}

/** `record[id]`, or undefined when `id` is null (no applicable stage) or the stage has no entry. */
export function stageLookup<V>(record: Partial<Readonly<Record<StageId, V>>>, id: StageId | null): V | undefined {
  return id === null ? undefined : record[id];
}

/** Count and value of `group` in grouped item rows (absent rows or group → 0, 0). Spec §9 2.0–2.4. */
export function groupAmounts(rows: readonly GroupCountValue[] | undefined, group: string): CountValue {
  const row = rows?.find((entry) => entry.group === group);
  return { count: row?.count ?? 0, valueUsd: row?.valueUsd ?? 0 };
}

/** `GroupCountValue[]` → `GroupCount[]` (the ranking uses counts, spec §5 B2). */
export function countsOf(rows: readonly GroupCountValue[]): GroupCount[] {
  return rows.map((row) => ({ group: row.group, count: row.count }));
}

/**
 * Stage-specific caveats of section 2 (spec §6, §9 2.0–2.4), kept on the stage (instructions §5 rule 5):
 * 2.0 `proxy`; 2.1 `build-stamp` when the window is at most `BUILD_STAMP_MAX_WINDOW_DAYS` days; 2.3
 * `not-a-conversion`; 2.4 `low-volume`; under "now" `now-open-only` on 2.0–2.4 and `now-all-time` on
 * 2.2–2.4.
 */
export function itemStageCaveats(id: ItemStageId, windowKey: WindowKey): readonly Caveat[] {
  const days = windowDays(windowKey);
  return mergeCaveats(
    caveatsIf(id === "2.0", ["proxy"]),
    caveatsIf(id === "2.1" && days !== null && days <= BUILD_STAMP_MAX_WINDOW_DAYS, ["build-stamp"]),
    caveatsIf(id === "2.3", ["not-a-conversion"]),
    caveatsIf(id === "2.4", ["low-volume"]),
    caveatsIfNow(windowKey, ["now-open-only"]),
    caveatsIfNow(windowKey, id === "2.0" || id === "2.1" ? [] : ["now-all-time"]),
  );
}

/** Group list, ranking and data sources of a funnel breakdown; `other` for additive dims only. */
interface FunnelBreakdownBase {
  readonly dimension: BreakdownDimension;
  /** Every group with its count on the first applicable stage (spec §5 B2). */
  readonly ranking: readonly GroupCount[];
  /** Full stage list of one group (not-applicable stages included; outside paths null). */
  readonly groupStages: (group: string) => readonly FunnelStageRaw[];
}

/** Additive funnel breakdown: `otherStages(shown)` = the stages of everything outside the shown groups. */
interface AdditiveFunnelBreakdown extends FunnelBreakdownBase {
  readonly additive: true;
  readonly otherStages: (shown: readonly string[]) => readonly FunnelStageRaw[];
}

/** Non-additive funnel breakdown: `overlapTotal` = the total on the first applicable stage (spec §5 B5). */
interface NonAdditiveFunnelBreakdown extends FunnelBreakdownBase {
  readonly additive: false;
  readonly overlapTotal: number | null;
}

/** Input of `funnelBreakdown`, discriminated by `additive`. */
export type FunnelBreakdownSpec = AdditiveFunnelBreakdown | NonAdditiveFunnelBreakdown;

/** A funnel breakdown plus the caveats its group series derivation added (`value-item-view-only`). */
export interface FunnelBreakdownOutput {
  readonly breakdown: BreakdownResult<FunnelSeries>;
  readonly caveats: readonly Caveat[];
}

/**
 * Builds `BreakdownResult<FunnelSeries>` (Appendix A O1): each shown group's data is a full
 * `FunnelSeries` in `context`; `other` for additive dims; `overlapRatio` for non-additive dims; top-N and
 * `truncated` per `buildBreakdown`.
 */
export function funnelBreakdown(
  spec: FunnelBreakdownSpec,
  context: FunnelContext,
  config: MetricsConfig,
): FunnelBreakdownOutput {
  const caveats: Caveat[] = [];
  const seriesOf = (stages: readonly FunnelStageRaw[]): FunnelSeries => {
    const result = funnelSeries({ ...context, stages });
    caveats.push(...result.caveats);
    return result.series;
  };
  const base = { dimension: spec.dimension, ranking: spec.ranking, dataOf: (group: string) => seriesOf(spec.groupStages(group)) };
  const breakdown = spec.additive
    ? buildBreakdown({ ...base, additive: true, otherOf: (shown) => seriesOf(spec.otherStages(shown)) }, config)
    : buildBreakdown({ ...base, additive: false, overlapTotal: spec.overlapTotal }, config);
  return { breakdown, caveats: mergeCaveats(caveats) };
}

/** Union of the stage caveats of a series (the total's stage codes, reported with the card caveats). */
export function stageCaveatsOf(series: FunnelSeries): readonly Caveat[] {
  return mergeCaveats(...series.stages.map((stage) => stage.caveats));
}
