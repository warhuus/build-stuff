# Phase 2 — Agent E3 (section-4 alert card loaders: 4.2–4.6)

## Built
Source (`src/data/metrics/loaders/`):
- `alertCardWiring.ts` (helper, added file): `loaderEnvelope(raw, fetches, flags)` (row-cap + partial when any `Paged` capped; `truncated`; `not-worked-window-cap` + partial; caveats via `mergeCaveats`, config order), `salesOrderIdsOf(...lists)`, `itemsForDim(breakdown, ids, deps)` (itemsById only for an item dim, else `null` without a call), `loadFactsDuration(factsWindow, window, filters, breakdown, deps)` (shared 4.3/4.4 body).
- `raisedToClosed.ts` → `loadRaisedToClosed`: L2("now") ∥ (window key ∈ `config.NOT_WORKED_WINDOW_KEYS` ? `loadNotWorkedAlerts(w, f)` : null); then item dim → `loadItemsByIds` of every fact + not-worked salesOrderId. 30 / 90 / now → `notWorked: null`, partial + `not-worked-window-cap`.
- `raisedToFirstView.ts` → `loadRaisedToFirstView`: L2(selected window) (D12), notWorked null, items for item dims.
- `firstViewToClosure.ts` → `loadFirstViewToClosure`: L2("now") (D12), notWorked null, items for item dims; raw `window` = selected window.
- `ageingBacklog.ts` → `loadAgeingBacklog`: `loadOpenAlerts` ∥ `loadOpenAlertOpenedEvents` ∥ `loadOpenAlertItems`; `asOf = deps.now.toISOString()`; `window` = resolved selection window (A9). Breakdown only echoed (client-side).
- `closureComposition.ts` → `loadClosureComposition`: `countEvents(closedNotOpenNow(w,f), "alert")` ∥ (dim ? `countEventsBy(…, "alert", alertType|routingPersona|priority)` : null) ∥ L2("now"). `truncated` via `isTruncatedByCap` on the grouped rows; row-cap from L2.
All loaders ≤ 55 lines; no arithmetic beyond id collection; independent calls in `Promise.all`; itemsById necessarily runs after the facts it needs.

Tests (`__tests__/loaders/`): `alertCardTestUtils.ts` (helper: `sel`, `l2Calls`, `notWorkedCalls`, `itemsCall`, `expectCalls` multiset comparison of `fake.calls`, hand-listed L2("now") ids/items), `raisedToClosed.test.ts` (16), `raisedToFirstView.test.ts` (13), `firstViewToClosure.test.ts` (13), `ageingBacklog.test.ts` (13), `closureComposition.test.ts` (8), `alertCardWiring.test.ts` (5), `alertCardsEndToEnd.test.ts` (5, loader → A2's derives). Every test asserts the exact port-call multiset (only L2 / notWorked / L3 / itemsById / the two 4.6 aggregates). Windows: 4.2 at 7, 14, 30, 90, now; 4.3 7, 30, now; 4.4 7, 30, now; 4.5 30, now (± AMER); 4.6 7, 30, now. Every registry dim per card; AMER filter on every card; row-cap on every card; truncated (MAX_GROUPS 3 vs 4) on 4.6.
tsc / eslint clean on my files; loaders + structure + layering tests pass (134 in the run).

## Hand-checked fixture values (working in the test comments)
- L2("now"): 46 alerts (every alert with a human token), 32 distinct items (I2 I3 I6 I7, I9–I26, I29, I31–I36, I38–I40). AMER: 18 alerts / 15 items.
- L2(7): 18 alerts / 16 items; L2(30): 34 alerts / 26 items; L2(7) AMER: 7 alerts / items I21 I24 I25 I32 I36 I40.
- 4.2 items at 14 d with an item dim: 33 ids (not-worked A41 adds I37 — the only item carrying no touched alert).
- 4.6 closedTotal: 7 d 9, 30 d 17, now 22; AMER 7 d 6, 30 d 12. By alertType 7/30/now: LateGI 6/8/11, CreditBlock 2/5/6, Allocation 1/4/5. By routingPersona 7: Planner 3, Logistics 4 (A55 closes as Logistics), CS 2; 30: 7/7/3. By priority 7: High 5, Medium 2, Low 2; now: High 6, Medium 8, Low 5, Urgent 2, Unclassified 1.
- L3: 48 alerts / 48 opened / 27 items; AMER 12 / 12 / 6 (matches phase2-D2).
- End to end (7 d): 4.2 n worked 6 / not worked 2; 4.3 n 12; 4.4 n 6; 4.5 (30) openAlerts 48, unknownAge 3; 4.6 writeBack 1, action 2, viewOnly 3, noHuman 3.

## Decisions / assumptions (for QUESTIONS.md "Assumed")
1. 4.2 (and 4.4) item dims: itemsById is fetched for ALL fact salesOrderIds (L2("now"), all-time touched) plus all not-worked ids, not only for the population closed in the window (spec §9 4.2 "fetch the population's items with itemsById"). Choosing by `closedAt` in window would be population selection in the loader; keeping loaders arithmetic-free (instructions §5 rule 3) costs a larger id list (all-time touched alerts' items; at prod scale ~ tens of thousands of ids → ID_BATCH chunks). Alternative if cost matters: filter ids by `inWindow(closedAt, w)` in the loader (pure wiring) — lead's call.
2. 4.2 under 30 / 90 / now: the not-worked fetch is not issued at all; `notWorked: null`, status partial + `not-worked-window-cap` (spec §9 4.2).
3. 4.6 `truncated` is set by the loader when the grouped call returns exactly `MAX_GROUPS` rows (LOADER_BRIEF). The derive (A2's `truncationCaveats`) may add it too; `mergeCaveats` de-duplicates.
4. 4.6 without a breakdown makes no grouped call; `closedTotalByGroup: null`. The dim → AlertHistory field is the identity on `EventGroupField` ("alertType"/"routingPersona"/"priority"); the OSDK adapter maps them to riskType/persona/priorityAtEvent of the closed event (D16 concerns only where clauses).
5. 4.5 ignores the window for fetching (L3 is keyed by filters only); raw `window` echoes the resolved selection window (A9). The card cache key still contains the window (D6), so a window change reuses the L3 memo, not the card cache.
6. `truncated` alone keeps status `ok` (only row-cap and not-worked-window-cap make a loader partial, LOADER_BRIEF).

## Interface change requests
None.

## Notes
- Other agents' in-progress loaders (userFunnel, itemFunnelItemView) briefly failed tsc during my run (missing `funnelLoaderOutput`); not mine. At finish, remaining tsc errors are only in another agent's in-progress `__tests__/loaders/itemFunnelItemView.test.ts` (unused imports).
- The structure test's `any` regex matches prose like `"… : any …"` in test names; avoid `: any` in strings.

## Unfinished
Nothing.
