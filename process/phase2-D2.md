# Phase 2 — Agent D2 (shared loaders) findings

## Built
Source (`src/data/metrics/shared/`):
- `sourceCtx.ts` (helper, added file): `sourceCtxOf(deps, signal): SourceCtx` (`{signal, onProgress?, config}`), `depsWithSignal(deps, signal): LoaderDeps`, `sortedDistinct(ids: Iterable<string>): string[]` (UTF-16 order).
- `humanEvents.ts`: `humanEventsKey(window, filters)` = `L1|<w.key>|<filtersKey>`; `loadHumanEvents(window: Window, filters: ItemFilters, deps: LoaderDeps): Promise<Paged<AlertEventRow>>` — one `fetchEvents(humanEvents(w,f))`.
- `touchedAlerts.ts`: `touchedAlertsKey` = `L2|…`; `loadTouchedAlerts(window, filters, deps): Promise<Paged<AlertLifecycleRow>>` — L1 (memo, joined with the L2 run's signal) ∥ `fetchEvents(touchedEventsChain)` ∥ `fetchOpenAlerts(touchedOpenAlerts)`; chain rows filtered to the L1 ids; `alertFactsForIds`; rows sorted by riskAlertId; `capped` = any of the three capped. JSDoc documents the `fetchAlertLifecycles` seam (rule 9).
- `openAlerts.ts`: `loadOpenAlerts(filters, deps): Promise<Paged<OpenAlertRow>>`, `loadOpenAlertOpenedEvents(filters, deps): Promise<Paged<AlertEventRow>>`, `loadOpenAlertItems(filters, deps): Promise<Paged<ItemRow>>` — three memos keyed `L3a|/L3o|/L3i|<filtersKey>`.
- `notWorkedAlerts.ts`: `notWorkedAlertsKey` = `NW|…`; `loadNotWorkedAlerts(window, filters, deps): Promise<Paged<AlertLifecycleRow>>` — `fetchEvents(closedNotOpenNow(w,f))` ∥ `fetchEvents(openedEventsOfItemsOf(that set))`; ids = distinct closed-event ids (sorted); facts via `alertFactsForIds(ids, closed + opened-of-those-ids, ∅ openNow)`. Does NOT exclude L2("now") ids (D2: the 4.2 derive does).
- `itemsById.ts`: `loadItemsByIds(ids: Iterable<string>, deps): Promise<Paged<ItemRow>>` — de-duplicated + sorted, empty → `{rows: [], capped: false}` without a call (D14). Not memoised.
Tests (`__tests__/shared/`): `humanEvents`, `touchedAlerts`, `openAlerts`, `notWorkedAlerts`, `itemsById`, `sharedLoaders` (memo sharing, per-caller abort, all-abort eviction + refetch, pre-aborted caller, clearMetricsCache, row cap, error eviction) + helper `loaderDeps.ts` (`fakeDeps({signal?, config?})`, `win(key)`, `AMER`, `idsOf`, `callCount`). 30 tests; coverage 100% lines/functions on the six files. tsc / eslint clean; layering + structure tests pass.

## Hand-checked fixture values (FIXTURE_NOW 2026-09-01T12:00Z; working in the test comments)
- L1 rows / alerts: 7 d 24 / 18 (`A09 A11 A13 A15 A18 A19 A21 A25 A32 A44 A46 A49 A53 A54 A58 A62 A65 A70`); 14 d 37 / 27; now 66 / 46. AMER: 7 d 10 / 7 (`A21 A25 A44 A46 A53 A62 A65`); 14 d 13 / 9; now 24 / 18.
- L2 = one row per L1 alert. Closed (isClosed): 7 d `A44 A46 A49 A53 A54`; 14 d `A42 A44 A46 A49 A50 A53 A54 A55`; now AMER 9 closed of 18. closureGroup: A44 viewOnly (view at close stamp), A46/A49/A47/A48 action, A50/A51/A52 writeBack, A53/A54 noHuman (human only after closure), A42/A43/A45/A55/A56 viewOnly.
- L2 specifics: A18 (7 d) raisedAt t(50), firstView t(48,9), firstAction t(3,9) (W4 all-time). A29 (14 d, reopened) raisedAt t(30), closedAt t(20), isClosed false. A30 (now) closedAt t(40), isClosed false. A32 raisedAt null, attrs all null. A55 attrs Logistics/LateGI/Medium (closed event). A56 raisedAt null, closedAt t(100), viewOnly. A45/A43 only in L2("now"), not L2(7) (W4). A01, A24, A31, A35 never in L2.
- Not-worked: 7 d `A35 A36 A40 A42 A44 A46 A49 A50 A55` (A31 reopened → out); 14 d 14 (+A37 A41 A47 A53 A54); now 22 (A35–A56); 7 d AMER `A35 A36 A40 A42 A44 A46`. Every row worked=false, closureGroup noHuman, first* null. A35 raisedAt t(10) closedAt t(2) Planner/LateGI/High; A40 raisedAt null; A41 raisedAt = closedAt = t(9). After excluding L2("now") ids (4.2 derive), 7 d not-worked = `A35 A36 A40` (A42 A44 A46 A49 A50 A55 are touched), 14 d = `A35 A36 A37 A40 A41`.
- L3: no filter 48 alerts / 48 opened events (A29–A31 two each, A32–A34 none) / 27 items (I1–I26 + I29). AMER: 12 alerts (`A21–A26, A62–A67`) / 12 opened / 6 items (I21–I26).
(`t(d, h)` = `fixtureTime(d, h)` from fixtureAlerts.ts.)

## Decisions / assumptions (for QUESTIONS.md "Assumed")
1. Memo keys hold only `window.key` and `filtersKey` (spec §11). `now`, `config` and `onProgress` of the FIRST caller are used by the shared run; a later caller with a different config/now joins the memoised value until `clearMetricsCache()`. Tests clear between config overrides.
2. `onProgress` is passed through unchanged to every fetch; L2 and not-worked run their fetches in parallel, so the callback receives interleaved per-fetch cumulative `loaded` values. D24's per-card summing is loadCard's job (Agent F): it cannot tell fetches apart from a single callback. Suggest loadCard report max or sum-of-deltas per call identity; or the lead extends `SourceCtx`/port with a fetch id. Only callers that started the run get progress; a joining caller gets none.
3. L2 fetches L1, the chain and the open ids concurrently (the chain and open-id specs contain the L1 spec server-side; no id list needed), rather than L1 first.
4. L2 and not-worked rows are sorted by riskAlertId (deterministic; OSDK order unspecified).
5. Not-worked `closedAt` = max of the closed events fetched in the window; because the window ends at now, this equals the all-time max closed.
6. itemsById sorts ids (deterministic call args), so callers must not rely on row order = input order.

## Interface change requests
None.

## Notes for other agents
- Loaders: `const w = resolveWindow(sel.window, deps.now)`; call L2 with `resolveWindow("now", deps.now)` for 4.2/4.4/4.6 (D12). Propagate `capped` → `row-cap` + `status: "partial"` (D11).
- 4.2 derive: exclude not-worked rows whose id is in L2("now") rows (every L2 row has a human event).

## Unfinished
Nothing.
