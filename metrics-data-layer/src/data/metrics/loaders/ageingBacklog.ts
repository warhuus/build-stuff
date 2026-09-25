/**
 * Loader of card 4.5 `ageingBacklog` (spec §9 4.5, shared loader L3; lead decisions D11, D18 A9). Raw only.
 */
import { loadOpenAlertItems, loadOpenAlertOpenedEvents, loadOpenAlerts } from "../shared/openAlerts";
import type { Loader } from "../source/MetricsSource";
import type { AgeingBacklogRaw } from "../types";
import { resolveWindow } from "../window";
import { loaderOutput } from "./loaderOutput";

/**
 * 4.5 loader: the three L3 fetches in parallel (open alerts, their opened events, their items; item
 * filters by pivot). Every breakdown is client-side from these rows, so the breakdown only goes into the
 * raw. Threshold N is derive's (no refetch).
 * @param selection selection (filters; the window is not a population input, only echoed, A9).
 * @param breakdown validated breakdown or null.
 * @param deps loader dependencies; `asOf` = `deps.now` as ISO.
 * @returns `AgeingBacklogRaw`; `row-cap` + partial when any L3 fetch was capped.
 */
export const loadAgeingBacklog: Loader<AgeingBacklogRaw> = async (selection, breakdown, deps) => {
  const f = selection.filters;
  const [alerts, opened, items] = await Promise.all([
    loadOpenAlerts(f, deps),
    loadOpenAlertOpenedEvents(f, deps),
    loadOpenAlertItems(f, deps),
  ]);
  const raw: AgeingBacklogRaw = {
    window: resolveWindow(selection.window, deps.now),
    dimension: breakdown,
    asOf: deps.now.toISOString(),
    alerts: alerts.rows,
    openedEvents: opened.rows,
    items: items.rows,
  };
  return loaderOutput(raw, [alerts, opened, items]);
};
