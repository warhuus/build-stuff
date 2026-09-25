/**
 * The `SourceCtx` a loader hands to the port (instructions §6, spec §9.0.1): the memo run's signal (lead
 * decision D7), the caller's progress sink and config. Also the per-port-call progress context (D24, MOD-01):
 * `withCallProgress` gives every port call its own ctx whose `onProgress` turns that call's cumulative
 * `loaded` into deltas, so a card's total is an exact sum however loaders reuse or interleave contexts.
 */
import type { LoaderDeps, MetricsSource, SourceCtx } from "../source/MetricsSource";
import type { Progress } from "../types";

/**
 * Builds the per-call source context of a shared loader.
 * @param deps loader dependencies (`onProgress` and `config` are passed through unchanged).
 * @param signal the shared memo run's internal signal (aborts only when every subscriber aborted, D7).
 * @returns `{ signal, onProgress, config }`; `onProgress` omitted when the caller gave none.
 */
export function sourceCtxOf(deps: LoaderDeps, signal: AbortSignal): SourceCtx {
  return deps.onProgress === undefined
    ? { signal, config: deps.config }
    : { signal, onProgress: deps.onProgress, config: deps.config };
}

/**
 * A fresh ctx for ONE port call: same signal and config; `onProgress` forwards the increase of this call's
 * cumulative `loaded` (port contract, spec §9.0 `fetchAllPages`) as a delta. The delta is never negative (a
 * report below the previous one adds 0). Any `onProgress` already on `ctx` is replaced.
 * @param ctx the ctx the loader passed to the call.
 * @param onDelta receives the rows added since this call's previous report.
 * @returns the call's own ctx.
 */
export function callCtx(ctx: SourceCtx, onDelta: (rows: number) => void): SourceCtx {
  let previous = 0;
  const onProgress = (p: Progress): void => {
    const delta = Math.max(0, p.loaded - previous);
    previous = Math.max(previous, p.loaded);
    if (delta > 0) onDelta(delta);
  };
  return { signal: ctx.signal, config: ctx.config, onProgress };
}

/**
 * Decorates a source so that every port call gets its own `callCtx` (MOD-01). Results, errors and the
 * loader's signal and config are passed through unchanged.
 * @param source the source to decorate.
 * @param onDelta receives rows added by any call (deltas; the caller keeps the running total).
 * @returns a `MetricsSource` with the same behaviour plus per-call progress deltas.
 */
export function withCallProgress(source: MetricsSource, onDelta: (rows: number) => void): MetricsSource {
  const c = (ctx: SourceCtx): SourceCtx => callCtx(ctx, onDelta);
  return {
    countItems: (s, x) => source.countItems(s, c(x)),
    countItemsBy: (s, g, x) => source.countItemsBy(s, g, c(x)),
    countEvents: (s, d, x) => source.countEvents(s, d, c(x)),
    countEventsBy: (s, d, g, x) => source.countEventsBy(s, d, g, c(x)),
    countOpenAlerts: (s, x) => source.countOpenAlerts(s, c(x)),
    countOpenAlertsBy: (s, g, x) => source.countOpenAlertsBy(s, g, c(x)),
    countRisk: (s, x) => source.countRisk(s, c(x)),
    countRiskByScoreRange: (s, r, x) => source.countRiskByScoreRange(s, r, c(x)),
    countAppUsers: (w, x) => source.countAppUsers(w, c(x)),
    countAppUsersBy: (w, g, x) => source.countAppUsersBy(w, g, c(x)),
    countVerdictsBy: (f, x) => source.countVerdictsBy(f, c(x)),
    fetchEvents: (s, x) => source.fetchEvents(s, c(x)),
    fetchOpenAlerts: (s, x) => source.fetchOpenAlerts(s, c(x)),
    fetchItems: (s, x) => source.fetchItems(s, c(x)),
    fetchItemsByIds: (ids, x) => source.fetchItemsByIds(ids, c(x)),
    fetchVerdictsByIds: (ids, x) => source.fetchVerdictsByIds(ids, c(x)),
  };
}

/**
 * The deps a nested shared loader receives from an outer memo run: identical except for the signal.
 * @param deps the outer caller's deps.
 * @param signal the outer memo run's signal.
 * @returns deps carrying `signal`.
 */
export function depsWithSignal(deps: LoaderDeps, signal: AbortSignal): LoaderDeps {
  return { ...deps, signal };
}

/**
 * Distinct ids, sorted by UTF-16 code unit (locale-independent), for deterministic output and id lookups.
 * @param ids ids in any order, duplicates allowed.
 * @returns a new sorted array without duplicates; empty input → empty array.
 */
export function sortedDistinct(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
