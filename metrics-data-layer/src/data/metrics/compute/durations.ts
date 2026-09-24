/**
 * 4.2–4.4 duration distributions (spec §9 4.2–4.4, §10 `DurationResult`; Appendix A V1, O7, W3–W5):
 * populations from AlertLifecycleRow facts, per-alert durations in hours (negative → 0, counted in
 * `clampedNegative`), bins on `config.DURATION_EDGES_HOURS`, n, median and p90. Pure.
 */
import { DURATION_QUANTILES, DURATION_SERIES_LABELS } from "../../../config/metrics";
import type { MetricsConfig } from "../../../config/metrics";
import type {
  AlertLifecycleRow,
  DurationExclusion,
  DurationResult,
  DurationSeries,
  DurationSeriesKey,
  Window,
} from "../types";
import { hoursBetween, inWindow } from "../window";
import { countBins, quantileFromBins } from "./bins";

/** A series with the number of its durations that were negative and clamped to 0. */
export interface ClampedSeries {
  readonly series: DurationSeries;
  readonly clampedNegative: number;
}

/**
 * One `DurationSeries` from per-alert durations in hours (spec §9 4.2, Appendix A O7): negative values
 * are clamped to 0 and counted; bins on `config.DURATION_EDGES_HOURS` (zero-filled); n = number of
 * values; median / p90 from the bins (null at n = 0 or in the open-ended bin). Label from config text.
 */
export function durationSeries(key: DurationSeriesKey, hours: readonly number[], config: MetricsConfig): ClampedSeries {
  const clampedNegative = hours.filter((value) => value < 0).length;
  const bins = countBins(hours.map((value) => Math.max(0, value)), config.DURATION_EDGES_HOURS);
  return {
    series: {
      key,
      label: DURATION_SERIES_LABELS[key],
      n: hours.length,
      bins,
      median: quantileFromBins(bins, DURATION_QUANTILES.median),
      p90: quantileFromBins(bins, DURATION_QUANTILES.p90),
    },
    clampedNegative,
  };
}

/** A population alert tagged with the series it belongs to (4.2: worked / notWorked; 4.3, 4.4: all). */
export interface DurationAlert {
  readonly fact: AlertLifecycleRow;
  readonly key: DurationSeriesKey;
}

/** How a card measures one alert: hours, or the reason it is excluded. */
export type DurationMeasure = (fact: AlertLifecycleRow) => number | DurationExclusion;

/** A card's duration plan: its series (in output order), its exclusion reasons and its measure. */
export interface DurationPlan {
  readonly seriesKeys: readonly DurationSeriesKey[];
  readonly exclusions: readonly DurationExclusion[];
  readonly measure: DurationMeasure;
}

/**
 * `DurationResult` of tagged alerts (spec §10): one series per `plan.seriesKeys` (present even when
 * empty), `excluded` = every `plan.exclusions` reason with its count (0 included), `clampedNegative`
 * summed over the series.
 */
export function durationResult(
  alerts: readonly DurationAlert[],
  plan: DurationPlan,
  config: MetricsConfig,
): DurationResult {
  const excludedCounts = new Map<DurationExclusion, number>();
  const built = plan.seriesKeys.map((key) => {
    const hours: number[] = [];
    for (const alert of alerts.filter((entry) => entry.key === key)) {
      const measured = plan.measure(alert.fact);
      if (typeof measured === "number") hours.push(measured);
      else excludedCounts.set(measured, (excludedCounts.get(measured) ?? 0) + 1);
    }
    return durationSeries(key, hours, config);
  });
  return {
    series: built.map((entry) => entry.series),
    excluded: plan.exclusions.map((reason) => ({ reason, count: excludedCounts.get(reason) ?? 0 })),
    clampedNegative: built.reduce((total, entry) => total + entry.clampedNegative, 0),
  };
}

/** 4.2 measure: hours from `raisedAt` to `closedAt`; no raise time → `noRaise` (spec §9 4.2). */
export const raisedToClosedHours: DurationMeasure = (fact) => hoursBetween(fact.raisedAt, fact.closedAt) ?? "noRaise";

/** 4.3 measure: hours from `raisedAt` to `firstViewAt`; no raise time → `noRaise` (spec §9 4.3). */
export const raisedToFirstViewHours: DurationMeasure = (fact) =>
  hoursBetween(fact.raisedAt, fact.firstViewAt) ?? "noRaise";

/**
 * 4.4 measure: hours from `firstViewAt` to `closedAt`. Closure before the first view (or an unparsable
 * stamp) → `closeBeforeView`; equal timestamps are kept (0 h; tie rule: a view precedes `closed`, spec §4).
 */
export const firstViewToClosureHours: DurationMeasure = (fact) => {
  const hours = hoursBetween(fact.firstViewAt, fact.closedAt);
  return hours === null || hours < 0 ? "closeBeforeView" : hours;
};

/** Closed alerts (`alert_is_closed`) whose `closedAt` is in the window (spec §9 4.2, 4.4, 4.6; W4). */
export function closedInWindow(facts: readonly AlertLifecycleRow[], window: Window): AlertLifecycleRow[] {
  return facts.filter((fact) => fact.isClosed && inWindow(fact.closedAt, window));
}

/**
 * 4.2 not-worked population (spec §9 4.2, Appendix A W5, decision D2): rows of the not-worked fetch
 * that are closed with `closedAt` in the window, have no human event ever (`worked` false) and are not
 * in the L2("now") touched population (`touched`, matched by `riskAlertId`).
 */
export function notWorkedClosed(
  notWorked: readonly AlertLifecycleRow[],
  touched: readonly AlertLifecycleRow[],
  window: Window,
): AlertLifecycleRow[] {
  const touchedIds = new Set(touched.map((fact) => fact.riskAlertId));
  return closedInWindow(notWorked, window).filter((fact) => !fact.worked && !touchedIds.has(fact.riskAlertId));
}

/**
 * 4.2 population (spec §9 4.2): worked = L2("now") facts closed in the window (every L2 row is worked,
 * so an alert whose only human event precedes the window still counts, W4); notWorked (only when the
 * not-worked fetch ran, else null → no notWorked alerts) = `notWorkedClosed`.
 */
export function raisedToClosedPopulation(
  facts: readonly AlertLifecycleRow[],
  notWorked: readonly AlertLifecycleRow[] | null,
  window: Window,
): DurationAlert[] {
  const worked = closedInWindow(facts, window).map((fact): DurationAlert => ({ fact, key: "worked" }));
  const others = notWorked === null ? [] : notWorkedClosed(notWorked, facts, window);
  return [...worked, ...others.map((fact): DurationAlert => ({ fact, key: "notWorked" }))];
}

/** 4.3 population (spec §9 4.3): alerts whose first view (all-time) falls in the window; key `all`. */
export function raisedToFirstViewPopulation(facts: readonly AlertLifecycleRow[], window: Window): DurationAlert[] {
  return facts.filter((fact) => inWindow(fact.firstViewAt, window)).map((fact) => ({ fact, key: "all" }));
}

/** 4.4 population (spec §9 4.4): closed alerts with `closedAt` in the window and a first view; key `all`. */
export function firstViewToClosurePopulation(facts: readonly AlertLifecycleRow[], window: Window): DurationAlert[] {
  return closedInWindow(facts, window)
    .filter((fact) => fact.firstViewAt !== null)
    .map((fact) => ({ fact, key: "all" }));
}
