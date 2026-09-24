/**
 * Shared loader for the 4.2 not-worked series (lead decision D2, spec §9 4.2): facts of the alerts with a
 * `closed` event in the window that are not open now, from their lifecycle events only. Memoised per
 * `window.key | filtersKey(filters)` (D7); never acquires the app semaphore (Appendix A X3).
 */
import { alertFactsForIds } from "../compute/alertLifecycle";
import { closedNotOpenNow, openedEventsOfItemsOf } from "../query/build";
import { filtersKey } from "../selection";
import type { LoaderDeps } from "../source/MetricsSource";
import type { AlertLifecycleRow, ItemFilters, Paged, Window } from "../types";
import { createSharedMemo } from "./memo";
import { sortedDistinct, sourceCtxOf } from "./sourceCtx";

const memo = createSharedMemo<string, Paged<AlertLifecycleRow>>();
const NOT_OPEN_NOW: ReadonlySet<string> = new Set<string>();

/**
 * Not-worked memo key.
 * @param window resolved window (only its key is used).
 * @param filters item filters.
 * @returns `NW|<window.key>|<filtersKey>`.
 */
export const notWorkedAlertsKey = (window: Window, filters: ItemFilters): string =>
  `NW|${window.key}|${filtersKey(filters)}`;

/** The two 4.2 fetches and the pure mapping, run once per key inside the memo. */
async function fetchNotWorked(
  window: Window,
  filters: ItemFilters,
  deps: LoaderDeps,
  signal: AbortSignal,
): Promise<Paged<AlertLifecycleRow>> {
  const ctx = sourceCtxOf(deps, signal);
  const finalSet = closedNotOpenNow(window, filters);
  const [closed, opened] = await Promise.all([
    deps.source.fetchEvents(finalSet, ctx),
    deps.source.fetchEvents(openedEventsOfItemsOf(finalSet), ctx),
  ]);
  const ids = sortedDistinct(closed.rows.map((e) => e.riskAlertId));
  const keep = new Set(ids);
  const events = [...closed.rows, ...opened.rows.filter((e) => keep.has(e.riskAlertId))];
  return { rows: alertFactsForIds(ids, events, NOT_OPEN_NOW, deps.config), capped: closed.capped || opened.capped };
}

/**
 * 4.2 not-worked candidates (D2): `closedNotOpenNow(window, filters)` closed events plus the all-time
 * `opened` events of the alerts on their items (`openedEventsOfItemsOf`, a superset joined by alert id).
 * Every row is closed and not open now by construction (`isOpenNow` false): `raisedAt` = min opened (null
 * when none: raised before PIPELINE_EVENTS_START), `closedAt` = max closed (all-time among the fetched
 * closed events in the window), attrs from the latest closed event (W6). Only lifecycle events are fetched,
 * so `worked` is false, first-* stamps are null and `closureGroup` is `noHuman` even for alerts that were
 * touched: this loader does NOT exclude them. The 4.2 derive drops alerts present in the L2("now") facts
 * (spec §9 4.2 "skip if id ∈ L2('now') ids").
 * Second-draft seam (instructions §5 rule 9): `fetchAlertLifecycles({ touchedIn: null, closedIn: window,
 * filters }, ctx)` replaces this body.
 * @param window resolved window (the card calls it for 7 and 14 days only).
 * @param filters item filters (pivot).
 * @param deps loader dependencies; `deps.signal` rejects only this caller (D7).
 * @returns `{ rows, capped }` sorted by `riskAlertId`; `capped` when either fetch hit ROW_CAP (D11).
 */
export function loadNotWorkedAlerts(
  window: Window,
  filters: ItemFilters,
  deps: LoaderDeps,
): Promise<Paged<AlertLifecycleRow>> {
  return memo.get(
    notWorkedAlertsKey(window, filters),
    (signal) => fetchNotWorked(window, filters, deps, signal),
    deps.signal,
  );
}
