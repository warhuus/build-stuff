# Phase 4 — G3 findings (types.ts MetricResult, loadCard.ts, hooks/**, index.ts, shared/sourceCtx.ts, shared/cache.ts)

All paths are relative to `metrics-data-layer/src/data/metrics/`.

## Per finding

- **TYP-01** (authorised frozen change). In `types.ts:149-205`, `MetricResult<T>` is now a union discriminated on `status`. It has a non-exported base `{ caveats; computedAt; window; progress? }` and four variants:
  - `ok|partial`: `data: T` is required.
  - `loading`: `data?: T`.
  - `blocked`: `blocked: BlockedInfo` is required and there is no data.
  - `error`: `error: string` is required and there is no data.

  Absent fields are typed `?: undefined`, so spec §10 reads such as `r.data?.total` still compile on the whole union. The field names match spec §10 exactly. The producers in my files already built exactly one variant each, so none needed a code change: `precheckCard` and `settle` in `loadCard.ts`, and `loadingResult` in `hooks/useMetric.ts`. `shared/errors.ts toErrorResult` (G2) also still compiles. No compute or loader file references `MetricResult`. Test: `__tests__/loadCardRuntime.test.ts`, "MetricResult narrows on status". Its `expectTypeOf` checks confirm that `data` is `CardData<T>` after ok/partial, `error` is `string` after error and `blocked` is set after blocked. **REVIEW.md** (lead): instructions §10 "discriminated unions" outranks the spec §10 sketch, and the new type has the same shape.
- **SPF-02**. `hooks/useMetric.ts`: `loadingResult` takes `requestedAt`. When there is no previous result, `computedAt = requestedAt.toISOString()`. The request time is memoised per `(rawKey, cache version, env)` (`useMetric.ts:~132`). The same Date is also passed as the load's `now` (`useCardLoad`), so the loading `computedAt`, the loading window and the loaded entry agree. Test: `hooks/useMetric.test.ts` now expects `computedAt: FIXTURE_NOW.toISOString()` in place of `""`.
- **SPF-03**. `index.ts` now also exports these types (types only): `HumanEvent`, `AlertEventRow`, `OpenAlertRow`, `ItemRow`, `VerdictRow`, `AlertAttrs`, `AlertLifecycleRow`, `CountValue`, `GroupCount`, `GroupCountValue`, `RangeCount`, `Paged`, `SourceCtx`, `VerdictTotals`, and `export type * from "./query/specs"`. `query/specs` holds the set and filter types that the `MetricsSource` methods take, so a host can implement or wrap a source. `Progress` was already exported. The value exports are unchanged, and the barrel test still lists exactly the §7 values. Test: `index.test.ts`.
- **SPF-04 / TYP-03**. `index.ts` defines the public `LoadCardOptions`, which is the internal options with `source?` optional. It also defines the public `loadCard(cardId, selection, breakdown, opts = {})`, a thin wrapper that fills `source ?? getDefaultOsdkSource()`. The internal `loadCard.ts loadCard` keeps `source` required and its contract is unchanged, so both entries give the same result and use the same cache. Tests: `index.test.ts` checks the option types, the default-source path (with `defaultSource` mocked to a fake), no options at all (a stub card returns blocked) and cache sharing. **QUESTIONS.md "Assumed"** (G5): "`loadCard` `opts.source` is optional in the public API and defaults to the app OSDK source (instructions §7 signature, §4 'index.ts is the ONLY file the UI imports', §5 rule 1)".
- **MOD-01**. `shared/sourceCtx.ts` gains `callCtx(ctx, onDelta)`, a fresh ctx per port call whose `onProgress` forwards the increase of that call's cumulative `loaded` as a non-negative delta. It also gains `withCallProgress(source, onDelta)`, a `MetricsSource` decorator that gives **every port call** its own `callCtx`. `loadCard.ts` wraps `opts.source` with it and keeps a running `total += delta` (`progressTotal`, which forwards nothing after the caller aborts). The matching heuristic `createProgressSum` and its tests are removed. `sourceCtxOf`'s signature and behaviour are unchanged.
  - Why a decorator and not only `sourceCtxOf`: loaders (G1) and `touchedAlerts`/`notWorkedAlerts` (G2) build one ctx and reuse it for several calls, some of them in parallel. A per-`sourceCtxOf` delta tracker would still mis-sum in those cases. Building the per-call ctx at the port boundary makes the sum exact however loaders reuse contexts, and no G1 or G2 file has to change.
  - The port contract is unchanged: cumulative per call.
  - Tests:
    - `loadCardRuntime.test.ts`: sequential fetches reporting 500, then 1000/2000, give `[500, 1500, 2500]`, total 2500. The phase-3 otifOutcome case, 1000/1500 then 500/1000/2000, totals 3500. A cache hit carries no progress.
    - `shared/sourceCtx.test.ts` (new): delta forwarding, no negative deltas, one reused loader ctx across two calls totals 2500, and results pass through unchanged.
- **TYP-02**. In `hooks/useMetricsSelection.ts`, a ref holds `{ query, selection }`, the latest selection whether pending or rendered. It resets during render whenever the URL query changes. The setter resolves the updater against the ref, updates the ref synchronously and then calls `setParams`. The `SetSelection` JSDoc now says that updaters queue. Tests in `hooks/useMetricsSelection.test.ts`:
  - two updaters in one `act` keep both changes (`?tab=x&w=7&u=valueUsd`)
  - a full value followed by an updater
  - the setter follows URL changes made elsewhere
- **TYP-06**. `hooks/MetricsSourceContext.ts`: the environment is memoised on `[source, config, nowKey]`. `nowKey` is `"clock"` when `now` is absent, `now.getTime()` for a pinned `Date`, and `"function"` for a clock function. The `now` prop now accepts `Date | (() => Date)`, which is a superset. A clock function is read through a ref (`env.now = () => readClock(nowRef.current)`), so an inline `() => date` does not rebuild the environment. A pinned `Date` is copied on each read. The props JSDoc now says that `source` and `config` are keyed on identity. Tests in `hooks/MetricsSourceContext.test.ts`:
  - an inline clock function keeps the environment and reads the latest function
  - a Date is keyed on its instant
  - the environment is rebuilt when the source changes
  - `useMetric` under an inline function `now` or an inline Date `now` does not restart loads on parent re-renders (the port call count is unchanged)
- **TYP-07**. Every failure in `loadCard.ts` now goes through a new helper, `failed(e, sel, now)`. If `isAbortError(e)`, it substitutes `abortError()`, imported from `shared/errors.ts` (G2's `compute/abort.ts` message is `"aborted"`). So every abort reads `error: "aborted"`, whether it came from the caller's signal, from the port's own `DOMException("The operation was aborted.", "AbortError")` or from a mid-load abort. Error strings otherwise stay strings (spec §10). Tests: three cases in `loadCardRuntime.test.ts`. Note: `"aborted"` depends on G2's new `abortError()` message. Against the HEAD `errors.ts`, whose message is empty, it would read `"AbortError"`.
- **TYP-05**. None of my files dispatches on `CardId` or `BreakdownDimension` (no `switch` / `default:`). `CARD_IMPL[cardId]` is a total `Record` table. Nothing to change.
- **STR-10**. In `shared/cache.ts` `getOrLoad`, the `@param signal` doc now says what happens when the signal is absent: the caller never aborts and pins the run. The new exports (`callCtx`, `withCallProgress`, the public `loadCard`/`LoadCardOptions`) and the `MetricResult` variants all have JSDoc, with spec and decision references. `useMetric`, `loadCard` and the provider props JSDocs are updated.

## Checks
- `npx eslint` on all my source and test files with `--max-warnings 0`: clean.
- `npx tsc --noEmit`: none of the errors are in my files. The remaining errors come from in-progress G1 (`loaders/*`: `funnelLoaderOutput`/`loaderEnvelope`) and G2 (`source/osdk/paging`, shared memo `*Key` exports) work.
- `npx vitest run`: the live tree cannot load loaders right now because of G1's in-progress work. To verify my work in isolation, I made a temporary git worktree at HEAD (since removed) and overlaid it with my files plus G2's `compute/abort.ts` and `shared/errors.ts`.
  - `tsc`: 0 errors.
  - `vitest`: 677/678 passed. The one failure is `shared/errors.test.ts`, only because the worktree held the HEAD test next to G2's new `errors.ts`. It passes in the live tree.
  - Every loadCard, hook, index, cache, sourceCtx, structure and layering test passed. `hooks/useMetric.test.ts` was cut to 240 lines by moving the TYP-06 tests into `MetricsSourceContext.test.ts`.

## Notes for other fixers / lead
- `sortedDistinct` still lives in `shared/sourceCtx.ts`. G1 and G2 import it from there. The MOD minors plan to move it to compute/stats or dimValues. If G1 or G2 move it, they should update the imports. I left it in place so their files would not break.
- Shared-loader memos (D7) run with the first caller's deps, so that caller's `withCallProgress` source reports the progress. A card that joins an in-flight shared run or card load gets no progress for it. This is the same as before and documented on `LoadCardOptions.onProgress`.
- **QUESTIONS.md "Assumed"** (G5):
  - (a) `MetricsSourceProvider` `now` accepts `Date | (() => Date)`. The environment is memoised on source and config identity plus the pinned instant (TYP-06).
  - (b) Without a previous result, the loading `computedAt` is the request time, which is also the load's `now` (SPF-02; spec §10, instructions §5 rule 11).
  - (c) Any abort surfaces as `status: "error"`, `error: "aborted"` (TYP-07).
  - (d) Progress is the sum of per-port-call deltas. A joined load reports nothing (MOD-01, D24).

## Interface change requests
None. TYP-01 was the authorised `types.ts` change.
