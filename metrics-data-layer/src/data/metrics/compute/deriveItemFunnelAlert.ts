/**
 * itemFunnel alert view derive (spec §9 2.1–2.4 alert view; §5 B3, B10; Appendix A F3, F4, F6, O1).
 * Pure. 2.0 is `not-applicable`; 2.1 = lifecycleAlerts + (openAlerts − openWithLifecycleEvent); 2.2–2.4
 * from the L1 human rows (`alertSets`), under "now" restricted to alerts open now; `valueUsd` null.
 */
import { FUNNEL_STAGES } from "../../../config/metrics";
import type { MetricsConfig } from "../../../config/metrics";
import type {
  AlertViewRaw,
  BreakdownDimension,
  CarriedAlertGroupsRaw,
  DeriveOutput,
  FunnelSeries,
  FunnelStageRaw,
  GroupCount,
  ItemStageId,
  OutsidePath,
  Selection,
  StageId,
} from "../types";
import { isAdditive, stagesForDim } from "../breakdowns";
import { countOfGroup, groupRows } from "./breakdown";
import { alertFunnelSets, actionTypeGroups, intersectIds, writebackTypeGroups } from "./alertSets";
import type { AlertFunnelSets } from "./alertSets";
import { mergeCaveats } from "./caveats";
import { caveatsIf, truncationCaveats } from "./deriveCommon";
import { attrsDimValue, openAlertDimValue } from "./dimValues";
import { funnelSeries, okStage, outsidePathOf } from "./funnel";
import { funnelBreakdown, itemStageCaveats, stageCaveatsOf, stagesFor } from "./funnelGroups";
import type { FunnelBreakdownOutput, FunnelBreakdownSpec, FunnelContext } from "./funnelGroups";
import { clampNonNegative, remainder } from "./stats";

/** Alert counts per section-2 stage (2.0 unused: not-applicable in the alert view). */
type StageCounts = Readonly<Record<ItemStageId, number>>;

/** The alert-view stages applicable to the total (2.0 is not-applicable, Appendix A F3). */
const ALERT_STAGES: readonly ItemStageId[] = ["2.1", "2.2", "2.3", "2.4"];

/** 2.1 term sum (spec §9 2.1): a + b with b = open − open-with-lifecycle-event, clamped at 0. */
function carriedCount(lifecycle: number, open: number, openWithLifecycle: number): number {
  return lifecycle + clampNonNegative(open - openWithLifecycle);
}

/** Stage counts from a 2.1 count and the funnel sets. */
function countsOfSets(carried: number, sets: AlertFunnelSets): StageCounts {
  return { ...ZERO_COUNTS, "2.1": carried, "2.2": sets.stage22.size, "2.3": sets.stage23.size, "2.4": sets.stage24.size };
}

/** Zero counts on every stage. */
const ZERO_COUNTS: StageCounts = { "2.0": 0, "2.1": 0, "2.2": 0, "2.3": 0, "2.4": 0 };

/** Outside path of 2.3 / 2.4 from the total's sets (Appendix A F4); null elsewhere and inside groups. */
function outsidePathFor(id: ItemStageId, sets: AlertFunnelSets | null): OutsidePath | null {
  if (sets === null) return null;
  if (id === "2.3") return outsidePathOf("2.3", { count: sets.outside23.size, valueUsd: null });
  if (id === "2.4") return outsidePathOf("2.4", { count: sets.outside24.size, valueUsd: null });
  return null;
}

/**
 * A stage list: `applicable` stages `ok` with counts (valueUsd null, Appendix A F6) and the stage caveats,
 * the rest `not-applicable`. `sets` (total only) adds the outside paths.
 */
function alertStages(
  applicable: readonly StageId[],
  counts: StageCounts,
  raw: AlertViewRaw,
  sets: AlertFunnelSets | null,
): FunnelStageRaw[] {
  return stagesFor(FUNNEL_STAGES.item, applicable, (id) =>
    okStage(id, { count: counts[id], valueUsd: null }, itemStageCaveats(id, raw.window.key), outsidePathFor(id, sets)),
  );
}

/** Alerts open now under "now" (L3 alert ids), else null (no restriction). Spec §9 2.2 alert view. */
function openNowRestriction(raw: AlertViewRaw): ReadonlySet<string> | null {
  if (raw.window.key !== "now") return null;
  return new Set((raw.openAlerts ?? []).map((alert) => alert.riskAlertId));
}

/**
 * Alert ids per group for the additive dims (spec §9 2.2 alert view): alertType / routingPersona /
 * priority from the L2 facts' `attrs`; escalated from the L3 open alerts. Null values → no group.
 */
function alertIdsByGroup(raw: AlertViewRaw, dimension: BreakdownDimension, config: MetricsConfig): Map<string, Set<string>> {
  const grouped =
    dimension === "escalated"
      ? groupRows(raw.openAlerts ?? [], (alert) => openAlertDimValue(alert, dimension, config))
      : groupRows(raw.facts ?? [], (fact) => attrsDimValue(fact.attrs, dimension));
  return new Map([...grouped].map(([group, rows]) => [group, new Set(rows.map((row) => row.riskAlertId))]));
}

/** 2.1 counts per raw value, summing the three grouped terms (spec §9 2.1, B3); zero-count groups dropped. */
function carriedRanking(groups: CarriedAlertGroupsRaw | null): GroupCount[] {
  const terms = groups ?? { lifecycleAlerts: [], openAlerts: [], openWithLifecycleEvent: [] };
  const names = new Set([...terms.lifecycleAlerts, ...terms.openAlerts, ...terms.openWithLifecycleEvent].map((row) => row.group));
  return [...names]
    .map((group) => ({
      group,
      count: carriedCount(
        countOfGroup(terms.lifecycleAlerts, group),
        countOfGroup(terms.openAlerts, group),
        countOfGroup(terms.openWithLifecycleEvent, group),
      ),
    }))
    .filter((entry) => entry.count > 0);
}

/**
 * Additive alert-view breakdown (alertType, routingPersona, priority, escalated; spec §9 2.1–2.4): groups
 * chosen on 2.1; 2.2–2.4 per group from the human rows of the group's alerts (∩ open now under "now");
 * `other` per stage = total − Σ shown groups.
 */
function additiveSpec(
  raw: AlertViewRaw,
  dimension: BreakdownDimension,
  total: StageCounts,
  config: MetricsConfig,
): FunnelBreakdownSpec {
  const applicable = stagesForDim("itemFunnel", "alert", dimension);
  const ranking = carriedRanking(raw.carriedGroups);
  const idsByGroup = alertIdsByGroup(raw, dimension, config);
  const keep = openNowRestriction(raw);
  const countsOf = (group: string): StageCounts => {
    const ids = idsByGroup.get(group) ?? new Set<string>();
    const sets = alertFunnelSets(raw.humanEvents, config, keep === null ? ids : intersectIds(ids, keep));
    return countsOfSets(countOfGroup(ranking, group), sets);
  };
  const otherStages = (shown: readonly string[]): FunnelStageRaw[] => {
    const shownCounts = shown.map(countsOf);
    const other = (id: ItemStageId): number => remainder(total[id], shownCounts.map((counts) => counts[id]));
    const counts: StageCounts = { ...ZERO_COUNTS, "2.1": other("2.1"), "2.2": other("2.2"), "2.3": other("2.3"), "2.4": other("2.4") };
    return alertStages(applicable, counts, raw, null);
  };
  const groupStages = (group: string): FunnelStageRaw[] => alertStages(applicable, countsOf(group), raw, null);
  return { dimension, ranking, groupStages, additive: true, otherStages };
}

/**
 * Non-additive alert-view breakdown (actionType on 2.3, writebackType on 2.4; spec §5 B10): alerts of the
 * stage per `eventType`, one alert in every type it has; `overlapRatio` on that stage; other stages
 * `not-applicable`.
 */
function eventTypeSpec(dimension: BreakdownDimension, sets: AlertFunnelSets, raw: AlertViewRaw, config: MetricsConfig): FunnelBreakdownSpec {
  const onWriteback = dimension === "writebackType";
  const stage: ItemStageId = onWriteback ? "2.4" : "2.3";
  const ranking = onWriteback ? writebackTypeGroups(raw.humanEvents, sets, config) : actionTypeGroups(raw.humanEvents, sets, config);
  const groupStages = (group: string): FunnelStageRaw[] => {
    return alertStages([stage], { ...ZERO_COUNTS, [stage]: countOfGroup(ranking, group) }, raw, null);
  };
  return { dimension, ranking, groupStages, additive: false, overlapTotal: (onWriteback ? sets.stage24 : sets.stage23).size };
}

/** The alert-view breakdown of `dimension`: additive per the registry, else the event-type spec. */
function alertViewBreakdown(
  raw: AlertViewRaw,
  dimension: BreakdownDimension,
  context: FunnelContext,
  totals: { readonly counts: StageCounts; readonly sets: AlertFunnelSets },
  config: MetricsConfig,
): FunnelBreakdownOutput {
  const spec = isAdditive("itemFunnel", "alert", dimension)
    ? additiveSpec(raw, dimension, totals.counts, config)
    : eventTypeSpec(dimension, totals.sets, raw, config);
  return funnelBreakdown(spec, context, config);
}

/**
 * itemFunnel alert view: total = 2.0 not-applicable, 2.1–2.4 alert counts (valueUsd null) with outside
 * paths on 2.3 / 2.4; with a dim, `alertViewBreakdown`. Card caveats: the stage codes;
 * `value-item-view-only` under unit valueUsd; escalated `escalated-open-only`; actionType / writebackType
 * `overlap`; `truncated` (top-N cut or a grouped 2.1 call returned `MAX_GROUPS` rows).
 */
export function deriveAlertView(raw: AlertViewRaw, selection: Selection, config: MetricsConfig): DeriveOutput<FunnelSeries> {
  const context: FunnelContext = { section: 2, view: "alert", window: raw.window.key, unit: selection.unit, generatedAt: raw.generatedAt };
  const sets = alertFunnelSets(raw.humanEvents, config, openNowRestriction(raw));
  const counts = countsOfSets(carriedCount(raw.carried.lifecycleAlerts, raw.carried.openAlerts, raw.carried.openWithLifecycleEvent), sets);
  const total = funnelSeries({ ...context, stages: alertStages(ALERT_STAGES, counts, raw, sets) });
  const dimension = raw.dimension;
  const grouped = dimension === null ? null : alertViewBreakdown(raw, dimension, context, { counts, sets }, config);
  const breakdown = grouped?.breakdown ?? null;
  const cg = raw.carriedGroups;
  return {
    data: { total: total.series, breakdown },
    caveats: mergeCaveats(
      total.caveats,
      stageCaveatsOf(total.series),
      grouped?.caveats ?? [],
      caveatsIf(dimension === "escalated", ["escalated-open-only"]),
      caveatsIf(breakdown !== null && !breakdown.additive, ["overlap"]),
      truncationCaveats(breakdown, cg === null ? [] : [cg.lifecycleAlerts, cg.openAlerts, cg.openWithLifecycleEvent], config),
    ),
  };
}
