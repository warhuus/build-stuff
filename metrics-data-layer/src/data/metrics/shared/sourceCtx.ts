/**
 * The `SourceCtx` a shared loader hands to the port (instructions §6, spec §9.0.1): the memo run's signal
 * (lead decision D7), the caller's progress sink and config. Shared by every shared loader.
 */
import type { LoaderDeps, SourceCtx } from "../source/MetricsSource";

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
