# Phase 2 — Agent F (catalogue, loadCard, hooks, public API)

## Built
Source (`src/data/metrics/`):
- `catalogue.ts` — `CARDS` (= `CARD_META`, `Readonly<Record<CardId, CardMeta>>`, public); `CardImpl<C>` `{ load: Loader<CardRaw[C]>; derive: Derive<CardRaw[C], CardOutput[C]>; stageCaveats(data) }`; `CardImplMap = { readonly [C in CardId]: CardImpl<C> }`; `CARD_IMPL` (not in the barrel); helpers `funnelStageCaveats` (total + groups + other stages), `noStageCaveats`, `loadStub`, `deriveStubRows`. Indexing the mapped type with a generic `C` gives `CardImpl<C>`, so loadCard is cast-free. The three stubs get an inert loader/derive only so the map is total over `CardId`; they are never reached (precheck blocks them first).
- `loadCard.ts` — `CardResult<C>`, `LoadCardOptions`, `precheckCard` (D13 order: breakdown-not-allowed → stub → placeholder; no calls), `peekCard` (sync: precheck or cached raw → derive; derive failure → error result), `createProgressSum` (D24), `loadCard` (normalise → precheck → `getOrLoad(card, cacheKey, (s) => appSemaphore.run(() => load(...), s), now, signal)` → derive → caveats = `mergeCaveats(loader, derive, stage caveats)`; never throws, errors/aborts → `toErrorResult`). The hook and `loadCard` share `precheckCard`/`peekCard`/`loadCard` (no duplicated logic).
- `source/osdk/defaultSource.ts` (added file) — `getDefaultOsdkSource()`: memoised `createOsdkSource({ client, sdk })` (`client` from `src/client.ts`, `* as sdk` from `@app/sdk`).
- `hooks/MetricsSourceContext.ts` — `MetricsEnvironment {source, config, now}`, `MetricsSourceProviderProps`, `MetricsSourceProvider` (built with `createElement`, no JSX), `useMetricsEnvironment()`, `useMetricsSource()`. Defaults (no provider or no overrides): OSDK source, `METRICS_CONFIG`, current time; the default environment object is memoised so hook deps stay stable.
- `hooks/useMetric.ts` — `useMetric(cardId, selection, breakdown = null): CardResult<C>`. Sync cached / blocked / error results via `peekCard`; else `loading` keeping previous data/caveats/computedAt (same card only) with the new window and live progress; `loadCard` in an effect keyed on the raw cache key + cache version (`useSyncExternalStore(subscribeCacheVersion, getCacheVersion)`); per-instance monotonic request id + AbortController (abort on key change / unmount); unit and threshold changes re-derive from the cache synchronously, no refetch.
- `hooks/useMetricsSelection.ts` — `SetSelection`, `useMetricsSelection()`: `useSearchParams` + `parseSelection` / `mergeSelectionParams` (defaults omitted, invalid → defaults, unrelated params kept, functional updater supported, selection object stable while the query string is unchanged).
- `index.ts` — values exactly per instructions §7 (13 names; asserted by `__tests__/index.test.ts`); types: every spec §10 output type plus `ItemFunnelView`, `OtifMode`, `CardData`, `BreakdownResult`, `BreakdownGroup`, `BlockedInfo`, `Window`, `Progress`, `MetricsConfig`, `MetricsSource`, `CardMeta`, `StubMeta`, `CardResult`, `LoadCardOptions`, `MetricsSourceProviderProps`, `SetSelection`.

Tests (`__tests__/`): `catalogue.test.ts` (5), `loadCard.test.ts` (12), `loadCardRuntime.test.ts` (8), `index.test.ts` (1), `hooks/useMetric.test.ts` (12), `hooks/useMetricsSelection.test.ts` (4), `hooks/MetricsSourceContext.test.ts` (4), helper `loadCardTestUtils.ts` (`wrapSource` — delay/fail/observe every port call; `gatedUserSource`). No JSX (createElement wrappers).
Covered: every card via loadCard and useMetric with `expectTypeOf` on the inferred T (all 12); cache hit sync with unchanged `fake.calls`; unit/threshold no refetch (loadCard and hook); loading keeps stale data; stale response ignored; abort on key change and unmount (ctx signal aborted); error capture (source and derive); clearMetricsCache clears and mounted hooks refetch; one L2("now") run for raisedToClosed + firstViewToClosure concurrently; breakdown-not-allowed → error with no calls; stubs and placeholders (METRICS_CONFIG) → blocked with no calls; section 1 filters → same cache entry + `filters-not-applied`; app semaphore max in use = 4 with a non-empty queue for 9 concurrent cards; progress (sum + on result + while loading); URL round-trip with MemoryRouter.
Checks: `tsc --noEmit` clean; `eslint src/data/metrics --max-warnings 0` clean; full `vitest run` 74 files / 656 tests green (incl. structure + layering). Coverage: catalogue.ts, index.ts, defaultSource.ts, MetricsSourceContext.ts, useMetricsSelection.ts 100 %; loadCard.ts 100 % lines; useMetric.ts 100 % lines.

## Decisions / assumptions (for QUESTIONS.md "Assumed")
1. `MetricsSourceProvider` is implemented with `createElement(Context.Provider, { value }, children)` in a `.ts` file: instructions §2 says "No UI. No components, no JSX" but §7 requires exporting `MetricsSourceProvider`. It is a data provider (no markup, no styling).
2. The provider also takes optional `config` and `now` (clock) props besides `source`. Needed so hooks can run on fixture data (FIXTURE_CONFIG sets ALERT_APP_ID; FIXTURE_NOW pins windows) and so the host can set integration values without editing config. All optional; defaults = OSDK source, METRICS_CONFIG, current time.
3. The default OSDK source is created in `source/osdk/defaultSource.ts` (hooks may not import `src/client.ts`/`@app/sdk`; layering allows MetricsSourceContext → source/osdk).
4. D24 progress: the port reports cumulative `loaded` per fetch with no fetch id, interleaved for parallel fetches. `createProgressSum` attributes each report to the fetch whose last value is the largest one below it (else a new fetch) and reports the sum of every fetch's last value — exact for monotone per-fetch counters, an approximation in rare ambiguous interleavings. Only the caller that started a shared load gets progress (a caller joining an in-flight load or hitting the cache gets `progress: undefined`). `result.progress` = last total of this load.
5. `window` of a cached result is `resolveWindow(selection.window, computedAt)` — the window the loader actually used — not re-resolved at read time. Blocked / error results use the call's `now`.
6. `CARDS` is `CARD_META` itself (keyed record, readonly), not an array; UI order can use `MOUNT_ORDER`.
7. The hook keeps previous data during `loading` only when the previous result was for the same card id (a hook instance whose card id changes starts with no data). Loading shape: `caveats`/`computedAt` of the previous result, else `[]` / `""`.
8. An error result of a raw key is reused for unit/threshold changes of the same key (errors do not depend on them); any key change or cache clear retries.
9. The stubs' `CARD_IMPL` entries (`loadStub` / `deriveStubRows`) exist only to keep `CARD_IMPL` total over `CardId` without casts; loadCard's precheck always returns their blocked result first.
10. The semaphore queue order follows effect (mount) order of the hooks; no explicit MOUNT_ORDER sort is applied (spec §11 "queue order = mount order").

## eslint-disable used (allowed rule only, with reasons)
`hooks/useMetric.ts`: three `react-hooks/exhaustive-deps` lines — load effect keyed on raw key + version (unit/threshold must not refetch); settled memo keyed on `deriveKey` + version (`req`/`sel` rebuilt each render); loading memo reads the `previous` ref.

## Interface change requests
None.

## Notes for the lead / other agents
- `useMetric`'s settled result after a fresh load carries `progress`; the same key read later from the cache (or via `loadCard` on a hit) does not. Tests compare with that in mind.
- React Router v6 future-flag warnings appear with a plain `MemoryRouter`; tests pass `future: { v7_startTransition, v7_relativeSplatPath }`.

## Unfinished
Nothing.
