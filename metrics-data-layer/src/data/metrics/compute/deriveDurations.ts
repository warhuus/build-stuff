/**
 * Derives of the 4.2 / 4.3 / 4.4 duration cards (spec §9 4.2–4.4; Appendix A O1, O3, W3–W5). Pure.
 * Breakdowns are additive at alert grain, client-side: alert dims from the facts' `attrs`, item dims
 * from the population's items fetched by id; top-N by alert count over the whole population, `other`
 * from the alerts outside the shown groups. Unit does not apply (durations are hours).
 */
import { METRICS_CONFIG } from "../../../config/metrics";
import type { MetricsConfig } from "../../../config/metrics";
import type { BreakdownResult, Caveat, Derive, DeriveOutput, DurationRaw, DurationResult } from "../types";
import { mergeCaveats } from "./caveats";
import { additiveRowBreakdown, caveatsIfNow, truncationCaveats } from "./deriveCommon";
import { factKeyOf } from "./dimValues";
import {
  durationResult,
  firstViewToClosureHours,
  firstViewToClosurePopulation,
  raisedToClosedHours,
  raisedToClosedPopulation,
  raisedToFirstViewHours,
  raisedToFirstViewPopulation,
} from "./durations";
import type { DurationAlert, DurationPlan } from "./durations";

/** Total and optional breakdown of tagged alerts under one plan, plus `truncated` / `now-all-time`. */
function deriveDurationCard(
  raw: DurationRaw,
  alerts: readonly DurationAlert[],
  plan: DurationPlan,
  config: MetricsConfig,
): DeriveOutput<DurationResult> {
  const dataOf = (rows: readonly DurationAlert[]): DurationResult => durationResult(rows, plan, config);
  const dimension = raw.dimension;
  let breakdown: BreakdownResult<DurationResult> | null = null;
  if (dimension !== null) {
    const keyOf = factKeyOf(dimension, raw.items);
    breakdown = additiveRowBreakdown(alerts, dimension, (alert) => keyOf(alert.fact), dataOf, config);
  }
  return {
    data: { total: dataOf(alerts), breakdown },
    caveats: mergeCaveats(truncationCaveats(breakdown, [], config), caveatsIfNow(raw.window.key, ["now-all-time"])),
  };
}

/** Adds card caveats to a derive output. */
function withCaveats(output: DeriveOutput<DurationResult>, caveats: readonly Caveat[]): DeriveOutput<DurationResult> {
  return { data: output.data, caveats: mergeCaveats(output.caveats, caveats) };
}

/**
 * 4.2 raised → closed (spec §9 4.2). Worked = L2("now") facts closed in the window; notWorked (series
 * present only when `raw.notWorked` is not null, i.e. 7 / 14 days) = the not-worked fetch minus alerts in
 * L2 or with any human event, closed in the window. Excluded: `noRaise`. Caveats: `build-stamp`,
 * `opened-events-since-pipeline-start`, `truncated`, `now-all-time` (`not-worked-window-cap` and
 * `row-cap` come from the loader).
 */
export const deriveRaisedToClosed: Derive<DurationRaw, DurationResult> = (raw, _selection, config = METRICS_CONFIG) => {
  const plan: DurationPlan = {
    seriesKeys: raw.notWorked === null ? ["worked"] : ["worked", "notWorked"],
    exclusions: ["noRaise"],
    measure: raisedToClosedHours,
  };
  const alerts = raisedToClosedPopulation(raw.facts, raw.notWorked, raw.window);
  return withCaveats(deriveDurationCard(raw, alerts, plan, config), ["build-stamp", "opened-events-since-pipeline-start"]);
};

/**
 * 4.3 raised → first view (spec §9 4.3): L2(selected window) facts whose first view is in the window;
 * one series `all`; excluded `noRaise`. Caveats: `censored-unviewed`, `build-stamp`,
 * `opened-events-since-pipeline-start`, `truncated`, `now-all-time`.
 */
export const deriveRaisedToFirstView: Derive<DurationRaw, DurationResult> = (
  raw,
  _selection,
  config = METRICS_CONFIG,
) => {
  const plan: DurationPlan = { seriesKeys: ["all"], exclusions: ["noRaise"], measure: raisedToFirstViewHours };
  const alerts = raisedToFirstViewPopulation(raw.facts, raw.window);
  return withCaveats(deriveDurationCard(raw, alerts, plan, config), [
    "censored-unviewed",
    "build-stamp",
    "opened-events-since-pipeline-start",
  ]);
};

/**
 * 4.4 first view → closure (spec §9 4.4): L2("now") facts closed in the window with a first view; alerts
 * closed before their first view are excluded (`closeBeforeView`, counted); equal timestamps kept.
 * Caveats: `excludes-close-before-view`, `build-stamp`, `truncated`, `now-all-time`.
 */
export const deriveFirstViewToClosure: Derive<DurationRaw, DurationResult> = (
  raw,
  _selection,
  config = METRICS_CONFIG,
) => {
  const plan: DurationPlan = { seriesKeys: ["all"], exclusions: ["closeBeforeView"], measure: firstViewToClosureHours };
  const alerts = firstViewToClosurePopulation(raw.facts, raw.window);
  return withCaveats(deriveDurationCard(raw, alerts, plan, config), ["excludes-close-before-view", "build-stamp"]);
};
