/**
 * itemFunnel alert view derive (spec §9 2.1–2.4 alert view; §5 B3, B10; Appendix A F3, F4, F6, O1).
 * Pure. 2.0 is `not-applicable`; 2.1 = lifecycleAlerts + (openAlerts − openWithLifecycleEvent); 2.2–2.4
 * from the L1 human rows (`alertSets`) of the alerts in the 2.1 population only (nested funnel, Excel 2.2 =
 * 2.1 ∩ …, spec §1; lead decision COR-01); `valueUsd` null.
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
import { ALERT_VIEW_STAGES, stagesForDim, unhandledDimension } from "../breakdowns";
import type { OpenAlertGroupField } from "../query/specs";
import { inWindow } from "../window";
import { countOfGroup, groupRows, nonEmptyGroups } from "./breakdown";
import { alertFunnelSets, actionTypeGroups, writebackTypeGroups } from "./alertSets";
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

/**
 * The 2.1 population (spec §9 2.1 alert view: "distinct alerts open at any point in the window"; §8 = open
 * now OR a closed event ≥ start; lead decision COR-01): ids of the L3 open alerts, plus, under a bounded
 * window, the L2(selected window) facts with `closedAt` in the window. Under "now" only the open alerts.
 * Missing rows (null) contribute nothing.
 */
export function carriedPopulation(raw: AlertViewRaw): ReadonlySet<string> {
  const ids = new Set((raw.openAlerts ?? []).map((alert) => alert.riskAlertId));
  if (raw.window.start === null) return ids;
  for (const fact of raw.facts ?? []) if (fact.closedAt !== null && inWindow(fact.closedAt, raw.window)) ids.add(fact.riskAlertId);
  return ids;
}

/**
 * Group key of a population alert for an additive alert-view dim (lead decision COR-02, spec §9 2.1 term b):
 * an alert open now takes the value of its L3 AlertOrderFulfillment row on every stage; a closed alert takes
 * its L2 `attrs` (latest pipeline event, W6). escalated exists only on open alerts (closed → no group).
 */
function alertKeyOf(raw: AlertViewRaw, dimension: OpenAlertGroupField, config: MetricsConfig): (id: string) => string | null {
  const openById = new Map((raw.openAlerts ?? []).map((alert) => [alert.riskAlertId, alert]));
  const factById = new Map((raw.facts ?? []).map((fact) => [fact.riskAlertId, fact]));
  return (id) => {
    const open = openById.get(id);
    if (open) return openAlertDimValue(open, dimension, config);
    const fact = factById.get(id);
    return fact === undefined || dimension === "escalated" ? null : attrsDimValue(fact.attrs, dimension);
  };
}

/** Population alert ids per group of an additive dim (`alertKeyOf`); null keys → no group (`other`). */
function alertIdsByGroup(population: ReadonlySet<string>, keyOf: (id: string) => string | null): Map<string, Set<string>> {
  return new Map([...groupRows([...population], keyOf)].map(([group, ids]) => [group, new Set(ids)]));
}

/** 2.1 counts per raw value, summing the three grouped terms (spec §9 2.1, B3); zero-count groups dropped. */
function carriedRanking(groups: CarriedAlertGroupsRaw | null): GroupCount[] {
  const terms = groups ?? { lifecycleAlerts: [], openAlerts: [], openWithLifecycleEvent: [] };
  const names = new Set([...terms.lifecycleAlerts, ...terms.openAlerts, ...terms.openWithLifecycleEvent].map((row) => row.group));
  const sums = [...names].map((group) => ({
    group,
    count: carriedCount(
      countOfGroup(terms.lifecycleAlerts, group),
      countOfGroup(terms.openAlerts, group),
      countOfGroup(terms.openWithLifecycleEvent, group),
    ),
  }));
  return nonEmptyGroups(sums);
}

/** What an alert-view breakdown needs from the total: its stage counts, its sets and the 2.1 population. */
interface AlertTotals {
  readonly counts: StageCounts;
  readonly sets: AlertFunnelSets;
  readonly population: ReadonlySet<string>;
}

/**
 * Additive alert-view breakdown (alertType, routingPersona, priority, escalated; spec §9 2.1–2.4): groups
 * chosen on 2.1; 2.2–2.4 per group from the human rows of the group's alerts, which are population alerts
 * keyed by `alertKeyOf` (COR-01, COR-02); `other` per stage = total − Σ shown groups.
 */
function additiveSpec(raw: AlertViewRaw, dimension: OpenAlertGroupField, totals: AlertTotals, config: MetricsConfig): FunnelBreakdownSpec {
  const applicable = stagesForDim("itemFunnel", "alert", dimension);
  const ranking = carriedRanking(raw.carriedGroups);
  const idsByGroup = alertIdsByGroup(totals.population, alertKeyOf(raw, dimension, config));
  const countsOf = (group: string): StageCounts =>
    countsOfSets(countOfGroup(ranking, group), alertFunnelSets(raw.humanEvents, config, idsByGroup.get(group) ?? new Set<string>()));
  const otherStages = (shown: readonly string[]): FunnelStageRaw[] => {
    const shownCounts = shown.map(countsOf);
    const other = (id: ItemStageId): number => remainder(totals.counts[id], shownCounts.map((counts) => counts[id]));
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
function eventTypeSpec(
  dimension: "actionType" | "writebackType",
  sets: AlertFunnelSets,
  raw: AlertViewRaw,
  config: MetricsConfig,
): FunnelBreakdownSpec {
  const onWriteback = dimension === "writebackType";
  const stage: ItemStageId = onWriteback ? "2.4" : "2.3";
  const ranking = onWriteback ? writebackTypeGroups(raw.humanEvents, sets, config) : actionTypeGroups(raw.humanEvents, sets, config);
  const groupStages = (group: string): FunnelStageRaw[] => {
    return alertStages([stage], { ...ZERO_COUNTS, [stage]: countOfGroup(ranking, group) }, raw, null);
  };
  return { dimension, ranking, groupStages, additive: false, overlapTotal: (onWriteback ? sets.stage24 : sets.stage23).size };
}

/**
 * The alert-view breakdown of `dimension` (Appendix A registry, alert view): alert attributes and escalated
 * additive, actionType / writebackType per event type. Item dims and queueFilter are not in the alert-view
 * registry row (loadCard rejects them with `breakdown-not-allowed`); reaching here with one throws `RangeError`.
 */
function alertViewBreakdown(
  raw: AlertViewRaw,
  dimension: BreakdownDimension,
  context: FunnelContext,
  totals: AlertTotals,
  config: MetricsConfig,
): FunnelBreakdownOutput {
  switch (dimension) {
    case "alertType":
    case "routingPersona":
    case "priority":
    case "escalated":
      return funnelBreakdown(additiveSpec(raw, dimension, totals, config), context, config);
    case "actionType":
    case "writebackType":
      return funnelBreakdown(eventTypeSpec(dimension, totals.sets, raw, config), context, config);
    case "businessLine":
    case "productLine":
    case "region":
    case "plant":
    case "queueFilter":
      throw new RangeError(`${dimension} is not an itemFunnel alert-view breakdown`);
    default:
      return unhandledDimension(dimension);
  }
}

/**
 * itemFunnel alert view (spec §9 2.1–2.4 alert view): total = 2.0 not-applicable, 2.1–2.4 alert counts
 * (valueUsd null) with outside paths on 2.3 / 2.4, 2.2–2.4 and outside paths over the 2.1 population only
 * (`carriedPopulation`, COR-01); with a dim, `alertViewBreakdown`. Card caveats: the stage codes;
 * `value-item-view-only` under unit valueUsd; escalated `escalated-open-only`; actionType / writebackType
 * `overlap`; `truncated` (top-N cut or a grouped 2.1 call returned `MAX_GROUPS` rows).
 */
export function deriveAlertView(raw: AlertViewRaw, selection: Selection, config: MetricsConfig): DeriveOutput<FunnelSeries> {
  const context: FunnelContext = { section: 2, view: "alert", window: raw.window.key, unit: selection.unit, generatedAt: raw.generatedAt };
  const population = carriedPopulation(raw);
  const sets = alertFunnelSets(raw.humanEvents, config, population);
  const counts = countsOfSets(carriedCount(raw.carried.lifecycleAlerts, raw.carried.openAlerts, raw.carried.openWithLifecycleEvent), sets);
  const total = funnelSeries({ ...context, stages: alertStages(ALERT_VIEW_STAGES, counts, raw, sets) });
  const dimension = raw.dimension;
  const grouped = dimension === null ? null : alertViewBreakdown(raw, dimension, context, { counts, sets, population }, config);
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
