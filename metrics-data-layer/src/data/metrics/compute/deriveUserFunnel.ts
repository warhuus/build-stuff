/**
 * Derive of the userFunnel card, section 1 (spec §9 1.0–1.4; Appendix A F3, F5–F7, O1; spec §5 R3).
 * Pure. Stage 1.0 has no source (`no-source`, not-applicable in every group); `valueUsd` is null on every
 * stage, so unit `valueUsd` falls back to counts with `value-item-view-only`.
 */
import { METRICS_CONFIG } from "../../../config/metrics";
import type { MetricsConfig } from "../../../config/metrics";
import type {
  BreakdownDimension,
  Caveat,
  Derive,
  FunnelSeries,
  FunnelStageRaw,
  GroupCount,
  StageId,
  UserFunnelRaw,
  UserStageId,
  WindowKey,
} from "../types";
import { firstApplicableStage, stagesForDim } from "../breakdowns";
import { hasFilters } from "../selection";
import { countOfGroup } from "./breakdown";
import { mergeCaveats } from "./caveats";
import { caveatsIf, caveatsIfNow, truncationCaveats } from "./deriveCommon";
import { funnelSeries, notApplicableStage, okStage, unavailableStage } from "./funnel";
import { funnelBreakdown, stageCaveatsOf, stageLookup, stagesFor } from "./funnelGroups";
import type { FunnelBreakdownOutput, FunnelBreakdownSpec, FunnelContext } from "./funnelGroups";

/** Queried section 1 stages in funnel order. */
const USER_STAGES: readonly UserStageId[] = ["1.1", "1.2", "1.3", "1.4"];

/** Stage-specific caveats (spec §9 1.1–1.4): queue-filter-persona; 1.2 id-space-differs; 1.4 low-volume. */
const USER_STAGE_CAVEATS: Readonly<Record<UserStageId, readonly Caveat[]>> = {
  "1.1": ["queue-filter-persona"],
  "1.2": ["queue-filter-persona", "id-space-differs"],
  "1.3": ["queue-filter-persona"],
  "1.4": ["queue-filter-persona", "low-volume"],
};

/** Caveats of a queried stage, plus `now-all-time` under "now" (spec §6). */
function userStageCaveats(id: UserStageId, windowKey: WindowKey): readonly Caveat[] {
  return mergeCaveats(USER_STAGE_CAVEATS[id], caveatsIfNow(windowKey, ["now-all-time"]));
}

/** Stage 1.0: no source (spec §9 1.0). */
const STAGE_1_0: FunnelStageRaw = unavailableStage("1.0", "no-source", ["no-source"]);

/**
 * Section 1 breakdown (spec §9 1.1–1.4 and the note after 1.4): non-additive for every dim (Appendix A
 * registry); groups chosen and `overlapRatio` computed on the first applicable stage (queueFilter 1.1;
 * alertType and escalated 1.2; actionType 1.3; writebackType 1.4); every group a full series with 1.0
 * (spec §9 1.0) and the stages the dim does not apply to `not-applicable`.
 */
function userBreakdown(
  raw: UserFunnelRaw,
  dimension: BreakdownDimension,
  context: FunnelContext,
  config: MetricsConfig,
): FunnelBreakdownOutput {
  const users: Partial<Readonly<Record<StageId, number>>> = raw.users;
  const byStage: Partial<Readonly<Record<StageId, readonly GroupCount[]>>> = raw.groups ?? {};
  const applicable = stagesForDim("userFunnel", "item", dimension);
  const first = firstApplicableStage("userFunnel", "item", dimension);
  const groupStages = (group: string): FunnelStageRaw[] => [
    notApplicableStage("1.0"),
    ...stagesFor(USER_STAGES, applicable, (id) =>
      okStage(id, { count: countOfGroup(byStage[id] ?? [], group), valueUsd: null }, userStageCaveats(id, raw.window.key)),
    ),
  ];
  const spec: FunnelBreakdownSpec = {
    dimension,
    additive: false,
    ranking: stageLookup(byStage, first) ?? [],
    groupStages,
    overlapTotal: stageLookup(users, first) ?? null,
  };
  return funnelBreakdown(spec, context, config);
}

/**
 * userFunnel derive: total = 1.0 `no-source` + 1.1–1.4 distinct users (valueUsd null); with a dim, the
 * non-additive `userBreakdown`. Caveats: stage codes (no-source, queue-filter-persona, id-space-differs,
 * low-volume, now-all-time); `filters-not-applied` when any item filter is set (R3); `now-all-time` under
 * "now"; `value-item-view-only` under unit valueUsd; with a dim `overlap`, `escalated-open-only`
 * (escalated) and `truncated` (top-N cut or a grouped call returned `MAX_GROUPS` rows).
 */
export const deriveUserFunnel: Derive<UserFunnelRaw, FunnelSeries> = (raw, selection, config = METRICS_CONFIG) => {
  const context: FunnelContext = {
    section: 1,
    view: "user",
    window: raw.window.key,
    unit: selection.unit,
    generatedAt: raw.generatedAt,
  };
  const stages = [
    STAGE_1_0,
    ...USER_STAGES.map((id) => okStage(id, { count: raw.users[id], valueUsd: null }, userStageCaveats(id, raw.window.key))),
  ];
  const total = funnelSeries({ ...context, stages });
  const dimension = raw.dimension;
  const grouped = dimension === null ? null : userBreakdown(raw, dimension, context, config);
  const breakdown = grouped?.breakdown ?? null;
  return {
    data: { total: total.series, breakdown },
    caveats: mergeCaveats(
      total.caveats,
      stageCaveatsOf(total.series),
      grouped?.caveats ?? [],
      caveatsIf(hasFilters(selection.filters), ["filters-not-applied"]),
      caveatsIfNow(raw.window.key, ["now-all-time"]),
      caveatsIf(breakdown !== null && !breakdown.additive, ["overlap"]),
      caveatsIf(dimension === "escalated", ["escalated-open-only"]),
      truncationCaveats(breakdown, USER_STAGES.map((id) => raw.groups?.[id]), config),
    ),
  };
};
