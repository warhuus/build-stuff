/**
 * itemFunnel item view derive (spec §9 2.0–2.4 item view; §5 B2, B4, B5, B7; Appendix A O1, F3, F4).
 * Pure. Count and value per stage; item dims additive on 2.0–2.4 (`other` = stage total − Σ shown
 * groups); alert dims non-additive on 2.1–2.4 (open alerts only, `overlapRatio` on 2.1).
 */
import { FUNNEL_STAGES } from "../../../config/metrics";
import type { MetricsConfig } from "../../../config/metrics";
import type {
  BreakdownDimension,
  Caveat,
  CountValue,
  DeriveOutput,
  FunnelSeries,
  FunnelStageRaw,
  GroupCountValue,
  ItemStageId,
  ItemViewRaw,
  OutsidePath,
  Selection,
  StageId,
} from "../types";
import { firstApplicableStage, isAdditive, isAlertDim, stagesForDim } from "../breakdowns";
import { mergeCaveats } from "./caveats";
import { caveatsIf, truncationCaveats } from "./deriveCommon";
import { funnelSeries, itemAmounts, okStage, outsidePathOf } from "./funnel";
import {
  countsOf,
  funnelBreakdown,
  groupAmounts,
  itemStageCaveats,
  stageCaveatsOf,
  stageLookup,
  stagesFor,
} from "./funnelGroups";
import type { FunnelBreakdownOutput, FunnelBreakdownSpec, FunnelContext } from "./funnelGroups";
import { remainder } from "./stats";

/** Outside path of a total stage (2.3, 2.4 only; Appendix A F4). */
function outsidePathOfStage(raw: ItemViewRaw, id: ItemStageId): OutsidePath | null {
  return id === "2.3" || id === "2.4" ? outsidePathOf(id, itemAmounts(raw.outsidePath[id])) : null;
}

/**
 * Item-view breakdown (spec §9 2.0–2.4): group list chosen once on the first applicable stage (2.0 for
 * item dims, 2.1 for alert dims); each group a full series (outside paths null, stages the dim does not
 * apply to `not-applicable`); additive `other` per stage = total − Σ shown groups, count and value.
 */
function itemViewBreakdown(
  raw: ItemViewRaw,
  dimension: BreakdownDimension,
  context: FunnelContext,
  config: MetricsConfig,
): FunnelBreakdownOutput {
  const byStage: Partial<Readonly<Record<StageId, readonly GroupCountValue[]>>> = raw.groups ?? {};
  const totals: Partial<Readonly<Record<StageId, CountValue>>> = raw.stages;
  const applicable = stagesForDim("itemFunnel", "item", dimension);
  const first = firstApplicableStage("itemFunnel", "item", dimension);
  const stageCaveats = (id: ItemStageId): readonly Caveat[] => itemStageCaveats(id, raw.window.key);
  const groupStages = (group: string): FunnelStageRaw[] =>
    stagesFor(FUNNEL_STAGES.item, applicable, (id) => okStage(id, groupAmounts(byStage[id], group), stageCaveats(id)));
  const otherStages = (shown: readonly string[]): FunnelStageRaw[] =>
    stagesFor(FUNNEL_STAGES.item, applicable, (id) => {
      const inShown = shown.map((group) => groupAmounts(byStage[id], group));
      const amounts = {
        count: remainder(raw.stages[id].count, inShown.map((entry) => entry.count)),
        valueUsd: remainder(raw.stages[id].valueUsd, inShown.map((entry) => entry.valueUsd)),
      };
      return okStage(id, amounts, stageCaveats(id));
    });
  const ranking = countsOf(stageLookup(byStage, first) ?? []);
  const spec: FunnelBreakdownSpec = isAdditive("itemFunnel", "item", dimension)
    ? { dimension, ranking, groupStages, additive: true, otherStages }
    : { dimension, ranking, groupStages, additive: false, overlapTotal: stageLookup(totals, first)?.count ?? null };
  return funnelBreakdown(spec, context, config);
}

/**
 * itemFunnel item view: total = 2.0–2.4 count and value with outside paths on 2.3 / 2.4 and the stage
 * caveats (`itemStageCaveats`); with a dim, `itemViewBreakdown`. Card caveats: the stage codes; alert dims
 * `breakdown-open-only` and `overlap`; escalated `escalated-open-only`; `truncated` (top-N cut or a
 * grouped call returned `MAX_GROUPS` rows).
 */
export function deriveItemView(raw: ItemViewRaw, selection: Selection, config: MetricsConfig): DeriveOutput<FunnelSeries> {
  const context: FunnelContext = {
    section: 2,
    view: "item",
    window: raw.window.key,
    unit: selection.unit,
    generatedAt: raw.generatedAt,
  };
  const stages = FUNNEL_STAGES.item.map((id) =>
    okStage(id, itemAmounts(raw.stages[id]), itemStageCaveats(id, raw.window.key), outsidePathOfStage(raw, id)),
  );
  const total = funnelSeries({ ...context, stages });
  const dimension = raw.dimension;
  const grouped = dimension === null ? null : itemViewBreakdown(raw, dimension, context, config);
  const breakdown = grouped?.breakdown ?? null;
  const alertDim = dimension !== null && isAlertDim(dimension);
  return {
    data: { total: total.series, breakdown },
    caveats: mergeCaveats(
      total.caveats,
      stageCaveatsOf(total.series),
      grouped?.caveats ?? [],
      caveatsIf(alertDim, ["breakdown-open-only"]),
      caveatsIf(breakdown !== null && !breakdown.additive, ["overlap"]),
      caveatsIf(dimension === "escalated", ["escalated-open-only"]),
      truncationCaveats(breakdown, FUNNEL_STAGES.item.map((id) => raw.groups?.[id]), config),
    ),
  };
}
