# Phase 2 — Agent D1 (pure + shared infrastructure)

## Built
- `src/data/metrics/window.ts` — `windowDays`, `resolveWindow`, `toDateOnly`, `inWindow`, `hoursBetween`, `daysBetween` (pure).
- `src/data/metrics/selection.ts` — `EMPTY_FILTERS`, `DEFAULT_SELECTION`, `SelectionInput`, `normalizeFilterValues`, `normalizeFilters`, `toWindowKey`/`toUnit`/`toView`/`toOtifMode`/`toThresholdDays`, `normalizeSelection`, `parseSelection`, `serializeSelection`, `mergeSelectionParams`, `hasFilters`, `filtersKey`, `cacheKey`.
- `src/data/metrics/breakdowns.ts` — `BreakdownRule`, `BreakdownRegistry`, `BREAKDOWN_REGISTRY` (Appendix A table), `breakdownRule`, `allowedBreakdowns`, `isBreakdownAllowed`, `isAdditive`, `stagesForDim`, `firstApplicableStage`, `isItemDim`, `isAlertDim`.
- `src/data/metrics/shared/errors.ts` — `isAbortError`, `abortError`, `throwIfAborted`, `errorMessage`, `toErrorResult`.
- `src/data/metrics/shared/inflight.ts` (added file) — `InFlight<V>`, `startInFlight(run, onAbandon)`: the D7 subscriber-counted shared run used by both memo.ts and cache.ts (separate file avoids a cache ↔ memo import cycle).
- `src/data/metrics/shared/cache.ts` — `CacheEntry<R>`, `getCached`, `setCached`, `getOrLoad`, `registerMemo`, `clearMetricsCache`, `subscribeCacheVersion`, `getCacheVersion`.
- `src/data/metrics/shared/memo.ts` — `SharedMemo<K,V>`, `createSharedMemo<K,V>()`.
- `src/data/metrics/shared/concurrency.ts` — `Release`, `Semaphore`, `createSemaphore`, `appSemaphore`, `runLimited`.
- Tests: `__tests__/{window,selection,breakdowns}.test.ts`, `__tests__/shared/{errors,inflight,cache,memo,concurrency}.test.ts`, helper `__tests__/shared/deferred.ts`. Coverage of these files: 100% lines/functions; one unreachable comparator branch in selection.ts.

## Decisions / assumptions (for QUESTIONS.md "Assumed")
- `cacheKey` format: `card|w=<key>[|v=<view>][|om=<mode>][|f=<filtersKey>]|b=<dim or empty>` (D6; spec §11). Fields are labelled so keys of different cards/fields cannot collide.
- `filtersKey` values are sorted, de-duplicated and `encodeURIComponent`-encoded (so `,`/`;` in a value cannot collide); plain values look exactly like D6's example `bl=a,b;pl=;rg=x;pt=`.
- Filter normalisation drops non-strings and empty strings (`bl=` in a URL means no value); values are not trimmed (raw property values, spec §5 B3). Sort is by UTF-16 code unit (locale-independent, deterministic).
- URL parsing: scalar keys take the first value; `w` accepts `now` or decimal digits; `n` accepts decimal digits only (no sign/fraction/exponent), then must be an integer 1..365; unknown params ignored. `serializeSelection` writes params in `URL_KEYS` order; `mergeSelectionParams` keeps unrelated params (for `useMetricsSelection`).
- `inWindow` is inclusive at both ends (`start ≤ ts ≤ end`); null/unparsable timestamps → false. `resolveWindow` subtracts exact N·24 h (not calendar days).
- Registry: for cards other than itemFunnel the view argument is ignored (same rule list stored for both views). Non-funnel cards have `stages: []`, so `firstApplicableStage` is null for them (B2: top-N chosen on the whole population). `isAlertDim` = every dim that is neither an item dim nor `queueFilter`.
- itemFunnel alert view `escalated` is additive (Appendix A: "alert grain: additive, except actionType and writebackType").
- Cache `getOrLoad(card, key, load, now, signal?)`: `load` receives the shared run's signal; concurrent callers share one run with D7 semantics (a caller's abort rejects only that caller; the run aborts when every signal-carrying caller aborted; a caller without a signal pins the run). A load in flight during `clearMetricsCache()` is not stored; a rejected/abandoned load is evicted. `computedAt` = `now` passed by the caller at request time.
- `abortError()` = `new DOMException(undefined, "AbortError")` (empty message; `errorMessage` reports the name "AbortError").
- `runLimited(tasks, limit = INNER_CONCURRENCY, signal?)`: checks the signal before starting each task; stops starting tasks after the first failure; rejects with the first error or an AbortError.

## Interface change requests
- None blocking. Optional: config has no error-message texts; `errorMessage` falls back to `String(e)` for non-Error values instead of a config text (no literal messages were added).

## Notes for other agents
- loadCard (Agent F): use `getCached` for the synchronous hit, then `getOrLoad(card, key, (s) => appSemaphore.run(() => catalogue.load(sel, bd, {..., signal: s}), s), now, signal)`; `toErrorResult(e, window, computedAt)` for errors; `toErrorResult(BREAKDOWN_NOT_ALLOWED, …)` gives the message verbatim.
- Shared loaders (L1/L2/L3/notWorked): `const memo = createSharedMemo<string, Paged<…>>()` at module level; `memo.get(key, (s) => fetch(..., { ...ctx, signal: s }), deps.signal)`. It registers with `clearMetricsCache` automatically.
- Hooks: `useSyncExternalStore(subscribeCacheVersion, getCacheVersion)`.

## Unfinished
- Nothing.
