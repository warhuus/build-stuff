# Phase 2 — Agent A1 (core compute) findings

## Built
Source (all pure; config values taken as a `config: MetricsConfig` parameter; static code lists / texts imported):
`src/data/metrics/compute/{stats,caveats,eventPredicates,alertLifecycle,alertSets,riskBuckets,bins,breakdown,funnel}.ts`
Tests: `src/data/metrics/__tests__/compute/*.test.ts` (9 files, 114 tests). Coverage on these nine files: 100% statements / branches / functions / lines.
Checks: eslint clean on my files; vitest green; `tsc --noEmit` shows no errors in my files (the only errors at the time of the run were in `source/fake/fakeSource.ts`, which another agent is still writing).

## Exported API (signatures)
### stats.ts
- `safeDivide(numerator: number|null, denominator: number|null): number|null`
- `fraction(part: number|null, whole: number|null): number|null`
- `sum(values: readonly number[]): number` · `sumBy<R>(rows, valueOf: (row: R) => number): number` · `sumNullable(values: readonly (number|null)[]): number|null`
- `clampNonNegative(value: number): number` · `remainder(total: number, parts: readonly number[]): number` (= max(0, total − Σ parts))
### caveats.ts
- `mergeCaveats(...lists: readonly (readonly Caveat[])[]): Caveat[]` (union with duplicates removed, in CAVEAT_ORDER)
### eventPredicates.ts (D8)
- types `ClassifiableEvent {eventType; eventSource: string|null}`, `TimedEvent extends ClassifiableEvent {eventTimestamp}`, `EventTest = (event, config) => boolean`
- `isViewedEvent / isActionEvent / isWritebackEvent / isHumanEvent / isOpenedEvent / isClosedEvent / isLifecycleEvent(event, config): boolean`
- `matchesPredicate(predicate: EventPredicate, event, config): boolean` · `matchesAnyPredicate(predicates: readonly EventPredicate[], event, config): boolean`
- `tieRankOf(event, config): number` (opened 0 < human/other 1 < closed 2) · `timestampMs(iso): number` · `compareTimestamps(a, b): number` · `compareEvents(a: TimedEvent, b: TimedEvent, config): number` · `sortEvents<E extends TimedEvent>(events, config): E[]`
### alertLifecycle.ts
- `NULL_ALERT_ATTRS: AlertAttrs`
- `alertFactsOf(riskAlertId: string, events: readonly AlertEventRow[], isOpenNow: boolean, config): AlertLifecycleRow`
- `closureGroupOf(events: readonly TimedEvent[], closedAt: string|null, config): ClosureGroup|null`
- `attrsEventOf(events, isClosed: boolean, config): AlertEventRow|null` · `alertAttrsOf(events, isClosed, config): AlertAttrs`
- `groupEventsByAlert<E extends {riskAlertId: string}>(rows: readonly E[]): Map<string, E[]>`
- `alertFactsForIds(alertIds: Iterable<string>, rows: readonly AlertEventRow[], openNowIds: ReadonlySet<string>, config): AlertLifecycleRow[]` (for L2 and the D2 not-worked loader)
### alertSets.ts
- `interface AlertFunnelSets { viewed, acted, writtenBack, stage22, stage23, outside23, stage24, outside24: ReadonlySet<string> }`
- `alertFunnelSets(rows: readonly AlertEventRow[], config, keep: ReadonlySet<string>|null = null): AlertFunnelSets`
- `alertIdsWhere(rows, test: EventTest, config): Set<string>` · `intersectIds(a, b): Set<string>` · `subtractIds(a, b): Set<string>` · `rowsOfAlerts(rows, keep|null): readonly AlertEventRow[]`
- `alertIdsByEventType(rows, test, alertIds: ReadonlySet<string>, config): Map<string, Set<string>>` · `eventTypeGroups(rows, test, alertIds, config): GroupCount[]`
- `actionTypeGroups(rows, sets: AlertFunnelSets, config): GroupCount[]` (action rows of stage23 alerts) · `writebackTypeGroups(rows, sets, config): GroupCount[]` (write-back rows of stage24 alerts)
### riskBuckets.ts
- types `ScoredBucketId`, `ScoredRange {bucket, start, end}`, `BucketAmounts = Readonly<Record<RiskBucketId, CountValue>>`, `BucketGroups = Readonly<Record<RiskBucketId, readonly GroupCountValue[]>>`
- `rangesFromConfig(config): ScoredRange[]` · `bucketOf(score: number|null, otifStatus: string|null, config): RiskBucketId` · `bucketOfRangeStart(start: number, config): ScoredBucketId|null`
- `emptyBucketAmounts(): BucketAmounts` · `riskSideTotals(side: RiskSideRaw, config): BucketAmounts` (unscored by subtraction)
- `bucketAmountsOfGroup(groups: BucketGroups, group: string): BucketAmounts` · `bucketAmountsOutside(totals, groups, shown: readonly string[]): BucketAmounts` · `groupTotalsAcrossBuckets(groups): GroupCount[]`
- `shareOfBucket(rows: readonly BucketRow[], unit: Unit): BucketRow[]` · `bucketRows(all: BucketAmounts, worked: BucketAmounts, unit: Unit): BucketRow[]` (14 rows, bucket order, worked true then false)
### bins.ts
- types `BinRange {start, end: number|null}`, `CountedBin {binStart, binEnd: number|null, count}` (= DurationBin shape)
- `rangesFromEdges(edges): BinRange[]` · `assignBin(value, edges): number|null` · `zeroFilledBins(edges): CountedBin[]` · `countBins(values, edges): CountedBin[]` · `quantileFromBins(bins: readonly CountedBin[], q: number): number|null` (O7)
### breakdown.ts (D9)
- `compareGroupCounts(a, b): number` · `sortGroupCounts(counts): GroupCount[]` · `topGroups(counts, max): GroupCount[]` · `isTruncatedByCap(rows: readonly unknown[], config): boolean`
- `type BreakdownSpec<T> = AdditiveBreakdownSpec<T> | NonAdditiveBreakdownSpec<T>`: common `{dimension, ranking: readonly GroupCount[] (ALL groups), dataOf(group) => T}`; additive `{additive: true, otherOf(shown: readonly string[]) => T}`; non-additive `{additive: false, overlapTotal: number|null}`
- `buildBreakdown<T>(spec: BreakdownSpec<T>, config): BreakdownResult<T>`
- `groupRows<R>(rows, keyOf: (row) => string|null): Map<string, R[]>` · `groupCountsOf<R>(groups): GroupCount[]` · `rowsOutside<R>(rows, keyOf, shown): R[]` · `countOfGroup(groups, group): number`
### funnel.ts
- types `DerivedStages {stages, caveats}`, `StageAmounts {count; valueUsd: number|null}`, `FunnelSeriesInput {section, view, window, unit, generatedAt, stages}`, `FunnelSeriesResult {series: FunnelSeries; caveats}`
- `deriveStages(stages: readonly FunnelStageRaw[], unit: Unit): DerivedStages` · `usesCountFallback(stages, unit): boolean` · `firstOkStageId(stages): StageId|null`
- `unavailableStage(id, availability: Exclude<Availability,"ok">, caveats = []): FunnelStageRaw` · `notApplicableStage(id): FunnelStageRaw` · `okStage(id, amounts: StageAmounts, caveats = [], outsidePath = null): FunnelStageRaw` · `outsidePathOf("2.3"|"2.4", amounts): OutsidePath` · `itemAmounts(total: CountValue): StageAmounts`
- `funnelSeries(input: FunnelSeriesInput): FunnelSeriesResult`

## Decisions / assumptions (for QUESTIONS.md "Assumed")
1. **attrs event (W6, spec §9.0.1).** Closed alert → latest `closed` event. Not closed (including reopened / open now) → latest `opened` event, and **if there is no `opened` event, the latest `closed` event** (a reopened alert raised before PIPELINE_EVENTS_START). No pipeline event → null attrs. "Latest" uses the §4 tie order; if two events are fully tied, the later one in input order wins.
2. **salesOrderId of a fact row** = the attrs event's salesOrderId, else the earliest non-null salesOrderId among the alert's events in time order, else null.
3. **`bucketOf` outside the ranges.** A score below the first range goes to the first bucket (b15_30), as the lead asked and as the spec §9 3.1 note says. A score at or above the last range end (≥ 101, outside the 15–100 domain) goes to the last bucket (b91_100). No configured ranges → `unscored`. On the server a score ≥ 101 would drop out of `$ranges` and be counted as unscored by subtraction. The difference cannot happen with real data (the score domain is 15–100).
4. **Unit fallback (F6).** `deriveStages` falls back to counts for the WHOLE funnel when unit is `valueUsd` and any `ok` stage has `valueUsd: null`, so one funnel never mixes units. It then returns `value-item-view-only`.
5. **"Applicable" stage = availability `ok`.** A stage with any other availability gets null pctPrev, pctFirst and trackValue, and is skipped when finding the "previous" stage. An `ok` stage with a null count gives null percentages and a null trackValue for the next stage.
6. **`funnelSeries.firstStageId` when no stage is `ok`**: the section's first stage id (`FUNNEL_STAGES.user[0]` / `.item[0]`). `FunnelSeries.firstStageId` cannot be null, so it needs a value.
7. **actionType groups (B10) include write-back event types** when the write-back row's eventSource is an action source. This follows the spec §4 predicate literally (a write-back from `user` is also an `action_event`; W2 says "a write-back is an action"), so it matches what the server `countEventsBy(action, eventType)` returns for 1.3.
8. **`EVENT_TIE_ORDER`, `CLOSURE_PRECEDENCE`, `SCORED_BUCKETS`, `RISK_BUCKETS`, `CAVEAT_ORDER`, `FUNNEL_STAGES`, `STAGE_LABELS`, `OUTSIDE_PATH_LABELS` are imported directly.** They are code lists, orders and texts that are not in `MetricsConfig`. Numeric and value config (event types, sources, ranges, Delayed status, group caps) always comes from the `config` parameter.
9. **Timestamps** are compared by instant (`Date.parse`), not as strings, so `Z` and `+00:00` forms compare correctly.
10. **`quantileFromBins` with q ≤ 0** returns null (no bin satisfies c_before < target).
11. **`assignBin`** returns null for a value below the first edge or NaN. `countBins` does not count such values, so callers (durations) must clamp negatives before binning.

## Notes for other agents
- compute/eventPredicates imports the type `EventPredicate` from `query/specs.ts` (same pure layer). If the D22 import-direction test forbids compute → query, tell me/the lead; the type could move to types.ts.
- `buildBreakdown` takes the ranking list of ALL groups. It picks the top N itself (`config.BREAKDOWN_MAX_GROUPS`), computes `truncated` from the top-N cut only, and computes overlapRatio over all ranking groups. It does not detect a MAX_GROUPS cap truncation: callers add the `truncated` caveat with `isTruncatedByCap`.

## Interface change requests
None.

## Unfinished
Nothing.
