# Phase 2 — Agent A2 (card compute + derives) findings

## Built
Source (pure, `src/data/metrics/compute/`): `dimValues.ts`, `deriveCommon.ts`, `durations.ts`, `ageing.ts`, `otifOutcome.ts`, `composition.ts`, `funnelGroups.ts`, `deriveUserFunnel.ts`, `deriveItemFunnel.ts` (dispatch) + `deriveItemFunnelItem.ts` + `deriveItemFunnelAlert.ts`, `deriveRiskDistribution.ts`, `deriveOtifOutcome.ts`, `deriveDurations.ts`, `deriveAgeingBacklog.ts`, `deriveClosureComposition.ts`.
Tests (`__tests__/compute/`): one `*.test.ts` per file above (item funnel: `deriveItemFunnelItem.test.ts`, `deriveItemFunnelAlert.test.ts`), helper `deriveTestUtils.ts` (hand-built rows, no fixtures).
Checks: compute/ coverage 100% statements / branches / functions / lines (all 24 compute files, incl. A1's); eslint clean; no tsc errors in my files (tsc errors exist in `loaders/*` of another agent: `Loader` not exported from `../types` — it lives in `source/MetricsSource.ts`); layering + structure tests green (≤ 40-line functions, ≤ 250-line files; largest file 194 lines).
A1's files: unchanged (no bug found).

## Exported API
- dimValues: `itemDimValue(item, dim: ItemDim)`, `attrsDimValue(attrs, dim)`, `escalatedLabel(flag, config)`, `openAlertDimValue(alert, dim, config)`, `itemsById(items): Map`, `itemValueOf(salesOrderId|null, items, dim)`, `factKeyOf(dim, items|null): (fact) => string|null`.
- deriveCommon: `caveatsIf(cond, caveats)`, `caveatsIfNow(windowKey, caveats)`, `truncationCaveats(breakdown|null, groupedLists, config)` (top-N cut OR any list of exactly MAX_GROUPS rows via `isTruncatedByCap`), `additiveRowBreakdown<R,T>(rows, dim, keyOf, dataOf, config): BreakdownResult<T>`.
- durations: `durationSeries(key, hours, config): {series, clampedNegative}`, types `DurationAlert {fact, key}`, `DurationMeasure`, `DurationPlan {seriesKeys, exclusions, measure}`, `durationResult(alerts, plan, config): DurationResult`, measures `raisedToClosedHours`, `raisedToFirstViewHours`, `firstViewToClosureHours`, populations `closedInWindow(facts, w)`, `notWorkedClosed(notWorked, touched, w)`, `raisedToClosedPopulation(facts, notWorked|null, w)`, `raisedToFirstViewPopulation(facts, w)`, `firstViewToClosurePopulation(facts, w)`.
- ageing: `raisedAtByAlert(openedEvents): Map`, `AgedAlert`, `agedAlerts(alerts, raisedAt, asOf)`, `alertAgeBins(aged, config)`, `oldestAgeByItem(aged)`, `itemAgeBins(aged, items, config)`, `thresholdTiles(aged, items, days)`, `AgeingInput`, `ageingBacklog(input, config): AgeingBacklog`.
- otifOutcome: `passesGate(row, mode, config)`, `verdictOf(row, mode)`, `inVerdictWindow(date|null, w)`, `OutcomeInput`, `OutcomeComputation {headline, clamped}`, `outcomeHeadline(input, config)`.
- composition: `compositionOf(closedTotal, touched): CompositionResult`, `compositionBreakdown(dim, closedTotal, byGroup, touched, config)`.
- funnelGroups: `FunnelContext`, `stagesFor(ids, applicable, stageOf)`, `stageLookup(record, id|null)`, `groupAmounts(rows|undefined, group)`, `countsOf(rows)`, `itemStageCaveats(id, windowKey)`, `FunnelBreakdownSpec` (additive: `otherStages`; non-additive: `overlapTotal`), `FunnelBreakdownOutput`, `funnelBreakdown(spec, context, config)`, `stageCaveatsOf(series)`.
- Derives (all `Derive<CardRaw[C], CardOutput[C]>`, `(raw, selection, config = METRICS_CONFIG)`): `deriveUserFunnel`, `deriveItemFunnel` (+ `deriveItemView(raw, selection, config)`, `deriveAlertView(raw, selection, config)`), `deriveRiskDistribution`, `deriveOtifOutcome`, `deriveRaisedToClosed`, `deriveRaisedToFirstView`, `deriveFirstViewToClosure` (all three in `deriveDurations.ts`), `deriveAgeingBacklog`, `deriveClosureComposition`.

## Caveats emitted by derive
| Derive | Always | Conditional |
|---|---|---|
| userFunnel | stage: 1.0 `no-source`; 1.1–1.4 `queue-filter-persona`; 1.2 `id-space-differs`; 1.4 `low-volume` | `now-all-time` (now; card + stages 1.1–1.4); `filters-not-applied` (any item filter); `value-item-view-only` (unit valueUsd); with a dim: `overlap`; `escalated-open-only` (escalated); `truncated` (top-N cut or a stage's groups = MAX_GROUPS) |
| itemFunnel item | stage: 2.0 `proxy`; 2.3 `not-a-conversion`; 2.4 `low-volume` | 2.1 `build-stamp` (window ≤ 7 d); now: `now-open-only` 2.0–2.4, `now-all-time` 2.2–2.4; alert dims: `breakdown-open-only` + `overlap`; `escalated-open-only`; `truncated` |
| itemFunnel alert | stage: 2.3 `not-a-conversion`; 2.4 `low-volume` | 2.1 `build-stamp` (≤ 7 d); now: `now-open-only` 2.1–2.4, `now-all-time` 2.2–2.4; `value-item-view-only` (unit valueUsd); `escalated-open-only`; `overlap` (actionType / writebackType); `truncated` (top-N or a carriedGroups list = MAX_GROUPS) |
| riskDistribution | `delayed-forced-100`, `unscored-largest` | `truncated` (top-N or any of the 14 grouped lists = MAX_GROUPS); `now-all-time` |
| otifOutcome | `unstratified`, `not-worked-includes-unalerted`, `gate-differs` | `filters-not-applied`; `now-all-time` |
| raisedToClosed | `build-stamp`, `opened-events-since-pipeline-start` | `truncated` (top-N); `now-all-time` |
| raisedToFirstView | `censored-unviewed`, `build-stamp`, `opened-events-since-pipeline-start` | `truncated`; `now-all-time` |
| firstViewToClosure | `excludes-close-before-view`, `build-stamp` | `truncated`; `now-all-time` |
| ageingBacklog | `no-target-property` | `opened-events-since-pipeline-start` (total unknownAge > 0); `overlap` (alert dim: value fields); `truncated` |
| closureComposition | `closure-actor-unknown`, `precedence` | `truncated` (top-N or closedTotalByGroup = MAX_GROUPS); `now-all-time` |
Not emitted by derive (loader): `row-cap`, `not-worked-window-cap`, `needs-integration-value`. Derive caveats also include the union of the total's stage caveats (loadCard merges them again; harmless).

## Assumptions (for QUESTIONS.md "Assumed")
1. 4.5 `opened-events-since-pipeline-start` only when the total's `unknownAge > 0` (spec §6 "(with unknownAge)"). 4.2 / 4.3 emit it always (spec §9 lists it unconditionally).
2. Stage-specific codes stay on the stages: `now-all-time` also on 1.1–1.4 and 2.2–2.4, `now-open-only` on 2.0–2.4 (2.1–2.4 in the alert view); group series carry the same stage caveats. Breakdown codes (`overlap`, `breakdown-open-only`, `escalated-open-only`, `truncated`) are card-level only.
3. `build-stamp` on 2.1 when `windowDays(key) ≤ BUILD_STAMP_MAX_WINDOW_DAYS` (7), in both views (architect A5). `BUILD_STAMP_MAX_WINDOW_DAYS`, `DURATION_QUANTILES`, `DURATION_SERIES_LABELS`, `CLOSURE_GROUPS`, `RISK_BUCKETS`, `FUNNEL_STAGES` are imported directly (not in `MetricsConfig`).
4. Duration breakdowns: top-N by alert count over the WHOLE population including excluded alerts (noRaise / closeBeforeView); 4.2's population = worked ∪ not-worked. `excluded` lists every reason of the card (4.2/4.3 `noRaise`, 4.4 `closeBeforeView`) with its count, 0 included. 4.2 notWorked series present only when `raw.notWorked !== null`.
5. 4.2 not-worked rows are also required to be `isClosed` with `closedAt` in the window (besides not in L2("now") and `worked=false`).
6. 4.4 tie: `closedAt == firstViewAt` kept at 0 h; an unparsable timestamp is counted as `closeBeforeView`.
7. 4.5: every row of `raw.openedEvents` is treated as an opened event (the L3 fetch is server-restricted to `opened`; the row may not carry a reliable `eventType`). Age = (asOf − raisedAt)/day, clamped at 0 when raisedAt > asOf. Items whose open alerts all have unknown age are not in `itemBins`. An item not in `raw.items` or with null value contributes value 0 but still counts. `itemBins` is zero-filled on AGE_EDGES_DAYS (always present; "may be empty" = all zero). Threshold is strict `age > N`.
8. 4.1: mode = `raw.mode` (the loaded one); `verdictDate` compared on its first 10 characters against `toDateOnly` of the bounds, inclusive; `workedN` counts verdict ROWS (duplicate rows for one id count twice); `missingVerdict` = distinct worked ids with no row at all (any gate). notWorkedN / notWorkedMade clamped at 0 (no caveat code exists; `outcomeHeadline` returns `clamped` so a caller could report it).
9. itemFunnel alert view: 2.1 = a + max(0, open − openWith) (per group the same formula on the grouped terms, summed per raw value); groups with a 2.1 count of 0 are dropped from the ranking; 2.2–2.4 per group = human rows of the group's alerts (facts attrs, or L3 escalated) ∩ open now under "now"; `other` per stage = total − Σ shown (clamped). Under "now" with `openAlerts` null the open-now set is empty.
10. itemFunnel: view from `raw.view`, not `selection.view`. userFunnel breakdowns are always non-additive (registry). A dim outside the registry (defensive only; loadCard rejects it) gives an empty non-additive breakdown with `overlapRatio` null.
11. riskDistribution breakdown only when both sides carry `groups`; ranking from the `all` side.
12. 4.6: `closedTotalByGroup` null with a dim → no groups, `other` = everything.

## Interface change requests
None.

## Notes for other agents
- Loaders (tsc): `Loader` is exported by `source/MetricsSource.ts`, not `types.ts` (current errors in `loaders/*`).
- itemFunnel alert view expects the loader's `carriedGroups` under escalated as `{ lifecycleAlerts: [], openAlerts: grouped, openWithLifecycleEvent: [] }` and `openAlerts` rows present under "now" and escalated; group labels for escalated must equal `config.ESCALATED_GROUP_LABELS`.

## Unfinished
Nothing.
