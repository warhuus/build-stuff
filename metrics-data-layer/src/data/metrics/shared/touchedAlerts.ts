/**
 * Shared loader L2 `loadTouchedAlerts` (spec §9.0.1 L2, Appendix A W4, W6): per-alert facts for every
 * alert with a human event in the window, built from ALL of those alerts' events (all-time). Memoised per
 * `window.key | filtersKey(filters)` (lead decision D7); never acquires the app semaphore (X3).
 */
import { alertFactsForIds } from "../compute/alertLifecycle";
import { sortedDistinct } from "../compute/stats";
import { touchedEventsChain, touchedOpenAlerts } from "../query/build";
import type { LoaderDeps } from "../source/MetricsSource";
import type { AlertLifecycleRow, ItemFilters, Paged, Window } from "../types";
import { loadHumanEvents } from "./humanEvents";
import { createSharedMemo, memoKey } from "./memo";
import { depsWithSignal, sourceCtxOf } from "./sourceCtx";

const memo = createSharedMemo<string, Paged<AlertLifecycleRow>>();

/** The L2 fetch and pure mapping, run once per key inside the memo. */
async function fetchTouchedAlerts(
  window: Window,
  filters: ItemFilters,
  deps: LoaderDeps,
  signal: AbortSignal,
): Promise<Paged<AlertLifecycleRow>> {
  const ctx = sourceCtxOf(deps, signal);
  const [human, chain, open] = await Promise.all([
    loadHumanEvents(window, filters, depsWithSignal(deps, signal)),
    deps.source.fetchEvents(touchedEventsChain(window, filters), ctx),
    deps.source.fetchOpenAlerts(touchedOpenAlerts(window, filters), ctx),
  ]);
  const touchedIds = sortedDistinct(human.rows.map((e) => e.riskAlertId));
  const openNow = new Set(open.rows.map((a) => a.riskAlertId));
  return {
    rows: alertFactsForIds(touchedIds, chain.rows, openNow, deps.config),
    capped: human.capped || chain.capped || open.capped,
  };
}

/**
 * L2: `AlertLifecycleRow` for every alert with a human event in `window` (all-time under `"now"`).
 * Population = distinct `riskAlertId` of L1(window, filters). Facts use the all-time opened, closed and
 * human events of those alerts, fetched through ONE server-side chain (`touchedEventsChain`: human events →
 * items → all their events, lifecycle OR human); `alertFactsForIds` keeps only the touched ids' events; open-now ids come from
 * `touchedOpenAlerts`; facts from `compute/alertLifecycle.alertFactsForIds` (`isClosed` = has `closed` AND
 * not open now; attrs from the latest pipeline event, W6). An alert whose only human events precede a
 * window is in L2("now") (W4); callers pick the window per lead decision D12.
 *
 * Second-draft seam (instructions §5 rule 9, spec §12.1): when the AlertLifecycle object exists, a single
 * port call `fetchAlertLifecycles({ touchedIn: window, closedIn: null, filters }, ctx)` replaces this
 * function's body (the three fetches and `alertFactsForIds`); the signature and the row type stay.
 * @param window resolved window.
 * @param filters item filters (pivot).
 * @param deps loader dependencies; `deps.signal` rejects only this caller (D7).
 * @returns `{ rows, capped }`: one row per touched alert, sorted by `riskAlertId`; `capped` when any of
 * the three fetches hit ROW_CAP (D11). Rejects on source error or abort.
 */
export function loadTouchedAlerts(
  window: Window,
  filters: ItemFilters,
  deps: LoaderDeps,
): Promise<Paged<AlertLifecycleRow>> {
  return memo.get(
    memoKey(window, filters),
    (signal) => fetchTouchedAlerts(window, filters, deps, signal),
    deps.signal,
  );
}
