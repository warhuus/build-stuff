/**
 * Shared loader L1 `loadHumanEvents` (spec §9.0.1 L1, §11 "Shared loaders"): the human AlertHistory rows
 * in the window (all-time up to now under `"now"`), item filters by pivot. Memoised per
 * `window.key | filtersKey(filters)` with `createSharedMemo` (lead decision D7); never acquires the app
 * semaphore (Appendix A X3). Cleared by `clearMetricsCache()`.
 */
import { humanEvents } from "../query/build";
import { filtersKey } from "../selection";
import type { LoaderDeps } from "../source/MetricsSource";
import type { AlertEventRow, ItemFilters, Paged, Window } from "../types";
import { createSharedMemo } from "./memo";
import { sourceCtxOf } from "./sourceCtx";

const memo = createSharedMemo<string, Paged<AlertEventRow>>();

/**
 * L1 memo key. Spec §11: `window.key | hash(filters)`.
 * @param window resolved window (only its key is used).
 * @param filters item filters.
 * @returns `L1|<window.key>|<filtersKey>`.
 */
export const humanEventsKey = (window: Window, filters: ItemFilters): string =>
  `L1|${window.key}|${filtersKey(filters)}`;

/**
 * L1: human events (viewed OR action OR write-back, spec §4) with `eventTimestamp` in `window`.
 * Concurrent callers with the same key share one `fetchEvents` call; each caller's `deps.signal` only
 * rejects that caller (D7). The run uses the first caller's `onProgress` and `config`.
 * @param window resolved window (`start` null = all-time up to `end`).
 * @param filters item filters (pivot from the filtered items when any is set).
 * @param deps loader dependencies.
 * @returns `{ rows, capped }`: `AlertEventRow`s in source order; `capped` when ROW_CAP stopped the fetch
 * (D11). Rejects on source error or abort.
 */
export function loadHumanEvents(window: Window, filters: ItemFilters, deps: LoaderDeps): Promise<Paged<AlertEventRow>> {
  return memo.get(
    humanEventsKey(window, filters),
    (signal) => deps.source.fetchEvents(humanEvents(window, filters), sourceCtxOf(deps, signal)),
    deps.signal,
  );
}
