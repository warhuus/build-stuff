# Phase 3 review: TESTS (instructions §12 phase 3, item 7)

Reviewer scope: instructions §11, spec §13, D16/D20 test requirements. Report only; no project file edited.
Paths below are relative to `metrics-data-layer/src/data/metrics/__tests__/` unless they start with `src/`.

## Check results (run 2026-09-25)

`npx vitest run --coverage`: 74 files, 656 tests, all green.

| Scope | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| All included files (`src/config/**`, `src/data/metrics/**`, excl. `__tests__`, types.ts, specs.ts, MetricsSource.ts) | 100% (4576/4576) | 99.3% (1866/1879) | 100% (549/549) | 100% (4576/4576) |
| `compute/` (24 files) | 100% | 100% | 100% | 100% |

Uncovered branches (13; lines are 100%): selection.ts:55, loaders/itemFunnelItemView.ts:97, shared/sourceCtx.ts:35, source/fake/fakeEval.ts:53, source/osdk/compileSpec.ts:120 (EventSet `intersect`, see TST-06), compileWhere.ts:131, groupBy.ts:30/40/202, osdkFetches.ts:90, paging.ts:58/134. Apart from compileSpec.ts:120 these are defensive guards (non-array replies, undefined ranges, non-item dim guard).
Acceptance "100% lines on compute/, ≥ 90% overall" is met.

Timing and flakiness: no test depends on sleeps for correctness. The only delays are `setTimeout(0 | 1 | 7−n)`, used to make concurrency observable (recordingClient.ts:137, rowMapping.test.ts:101, loadCardRuntime.test.ts:63), and their assertions hold under Node's timer ordering. `waitFor` is used in the hook tests. One wall-clock dependency: TST-12.

## Coverage matrix: spec §13 (every row) and instructions §11

Legend: ✓ covered; ◐ partly covered (see the finding); ✗ missing.

| Area | Required case | Test (file:line) | |
|---|---|---|---|
| Window | `resolveWindow(7)` start = end − 7 d | window.test.ts:7 | ✓ |
| | `"now"` → start null | window.test.ts:19 | ✓ |
| | `toDateOnly` for date properties | window.test.ts:35; source/osdk/compileWhere.test.ts:79 (2.0), :117 (verdict date) | ✓ |
| Predicates | `PRED.*` = section-4 strings | source/osdk/compileWhere.test.ts:32 | ✓ |
| | action excludes `updated` | compute/eventPredicates.test.ts:61 | ✓ |
| | a view is not an action | compute/eventPredicates.test.ts:48 | ✓ |
| | `tsIn` `$and` of two single-operator clauses; no lower bound under now | source/osdk/compileWhere.test.ts:50, :55 | ✓ |
| | `dateIn` uses `VERDICT_DATE_PROPERTY` | source/osdk/compileWhere.test.ts:117 | ✓ |
| Query building | `withItemFilters`: no where when empty, one `$in` per dim | source/osdk/compileWhere.test.ts:70; query/build.test.ts:32 | ✓ |
| | `events()` pivots from SalesOrders when filtered | source/osdk/compileSpec.test.ts:87 | ✓ |
| | 2.0 under now = `isOpen` only | source/osdk/compileWhere.test.ts:79; compileSpec.test.ts:44 | ✓ |
| | 2.1 alert view under now issues one call | loaders/itemFunnelAlertView.test.ts:39 (fake only) | ◐ TST-02 |
| | recorded chains of where/pivotTo/intersect/union/subtract match the plans | source/osdk/compileSpec.test.ts:44–:325 (hand-built specs, not the plans) | ◐ TST-02, TST-06 |
| | group-by literal + `$exactWithLimit: MAX_GROUPS` | source/osdk/aggregates.test.ts:32, :69, :90 | ✓ |
| | no derived properties | source/osdk/compileSpec.test.ts:194; structure.test.ts:49 | ✓ |
| Funnel derive | pctPrev/pctFirst differ count vs value | compute/funnel.test.ts:31 | ✓ |
| | 1.0 `no-source` → firstStageId 1.1, card ok | compute/funnel.test.ts:44; compute/deriveUserFunnel.test.ts:16 | ✓ |
| | alert view 2.0 not-applicable → firstStageId 2.1 | compute/deriveItemFunnelAlert.test.ts:32 | ✓ |
| | `trackValue` = previous applicable, null on first | compute/funnel.test.ts:24, :57 | ✓ |
| | zero previous → null pct | compute/funnel.test.ts:37 | ✓ |
| | outsidePath 2.3 / 2.4 (2.4 = write-back not in 2.3) | compute/alertSets.test.ts:59–:66; compute/deriveItemFunnelAlert.test.ts:32 | ✓ |
| | unit valueUsd in alert view → counts + `value-item-view-only` | compute/deriveItemFunnelAlert.test.ts:50 | ✓ |
| Breakdowns | registry = section 5 / Appendix A exactly | breakdowns.test.ts:61 | ✓ |
| | allowed if any stage accepts; others not-applicable | breakdowns.test.ts:94; compute/deriveUserFunnel.test.ts (actionType case) | ✓ |
| | group list chosen once on first applicable stage | loaders/itemFunnelItemAlertDims.test.ts (top-N case); compute/deriveUserFunnel.test.ts (queueFilter case) | ✓ |
| | `other` only additive | compute/breakdown.test.ts:48, :82 | ✓ |
| | overlapRatio over ALL groups before truncation; null for additive | compute/breakdown.test.ts:82, :48 | ✓ |
| | `truncated` when cut | compute/breakdown.test.ts:48; :37 (MAX_GROUPS) | ✓ |
| Alert sets | viewed / acted / writtenBack | compute/alertSets.test.ts:53 | ✓ |
| | acted ∖ viewed outside path | compute/alertSets.test.ts:59 | ✓ |
| | actionType / writebackType count each alert once per type | compute/alertSets.test.ts:77, :87 | ✓ |
| Alert facts | raised = min opened; closed = max closed | compute/alertLifecycle.test.ts:33 | ✓ |
| | reopened → isClosed false | compute/alertLifecycle.test.ts:50; shared/touchedAlerts.test.ts:53 | ✓ |
| | no opened → raisedAt null | compute/alertLifecycle.test.ts:59 | ✓ |
| | tie rule at equal timestamps | compute/alertLifecycle.test.ts:93; compute/eventPredicates.test.ts (tie order) | ✓ |
| | attrs from latest pipeline event | compute/alertLifecycle.test.ts:105 | ✓ |
| | first view from all-time events | compute/alertLifecycle.test.ts:66; shared/touchedAlerts.test.ts:33 | ✓ |
| Closure | write-back > action > view | compute/alertLifecycle.test.ts:170 | ✓ |
| | events after closedAt ignored | compute/alertLifecycle.test.ts:177 | ✓ |
| | open alert → null | compute/alertLifecycle.test.ts:167 | ✓ |
| | noHuman = closedTotal − touched, clamped at 0; groups sum to closedTotal | compute/composition.test.ts:8, :25 | ✓ |
| Risk buckets | `bucketOf(null)` unscored | compute/riskBuckets.test.ts:23 | ✓ |
| | 15, 30 → b15_30; 31 → b31_50 | compute/riskBuckets.test.ts:27; source/fake/fakeEval.test.ts:86 | ✓ |
| | 100 + Delayed → delayed; 100 + At Risk → b91_100 | compute/riskBuckets.test.ts:37; fixtures I4/I5 | ✓ |
| | zero-fills 14 rows | compute/riskBuckets.test.ts:117 | ✓ |
| | unscored by subtraction | compute/riskBuckets.test.ts:98 | ✓ |
| | not-worked = all − worked, never negative; shareOfBucket per unit | compute/riskBuckets.test.ts:128 | ✓ |
| Bins | 1 h ∈ [1, 2) | compute/bins.test.ts:31 | ✓ |
| | last bin (2160 h+) open-ended | compute/bins.test.ts:37 | ✓ |
| | negative durations clamp to 0 and are counted | compute/durations.test.ts:22 | ✓ (never occurs in fixtures, TST-11) |
| | age bins from fixed asOf | compute/ageing.test.ts:45 | ✓ |
| | threshold value counts each item once; pct over known ages, null at 0 | compute/ageing.test.ts:78 | ✓ |
| | median/p90 linear in bin, null in open-ended bin | compute/bins.test.ts:67, :76 | ✓ |
| Outcome | worked rows filtered by gate + window; denominator made + not-made | compute/otifOutcome.test.ts:60 | ✓ |
| | not-worked = totals − worked; n = 0 → null | compute/otifOutcome.test.ts:60, :76 | ✓ |
| | ids without a row → missingVerdict | compute/otifOutcome.test.ts:60 | ✓ |
| | gates never swapped | compute/otifOutcome.test.ts:18; source/osdk/compileWhere.test.ts:113 | ✓ |
| | caveats `unstratified`, `not-worked-includes-unalerted` | compute/deriveOtifOutcome.test.ts:27 | ✓ |
| Durations | 4.2 not-worked excludes human-ever and open-now | compute/durations.test.ts:109 | ✓ |
| | 30/90/now → worked only, partial, `not-worked-window-cap` | loaders/raisedToClosed.test.ts:58; compute/deriveDurations.test.ts (30 d / now case) | ✓ |
| | 4.2 worked includes alert whose only human event precedes window | compute/durations.test.ts:120; fixture A55 via loaders/alertCardsEndToEnd.test.ts:19 | ✓ |
| | 4.3 population by first view in window | compute/durations.test.ts:131 | ✓ |
| | 4.4 excludes close-before-view with count | compute/deriveDurations.test.ts:114 (synthetic only) | ◐ TST-03 |
| Section 1 | ignores item filters; `filters-not-applied`; not in cache key | loaders/userFunnel.test.ts:131; loadCard.test.ts:118; selection.test.ts:151; compute/deriveUserFunnel.test.ts:42 | ✓ |
| Config | every Caveat has text in `CAVEAT_TEXT` | none | ✗ TST-01 |
| | 3.2, 3.3, 4.7 have `unblockedBy` | loaders/blocked.test.ts:6 | ✓ |
| | placeholder → blocked, `needs-integration-value` | loadCard.test.ts:178; loaders/blocked.test.ts (integrationBlock) | ✓ |
| Cache and hook | cache hit synchronous | hooks/useMetric.test.ts:102; loadCard.test.ts:91 | ✓ |
| | unit/threshold changes do not refetch | hooks/useMetric.test.ts:113; loadCard.test.ts:103 | ✓ |
| | stale response does not overwrite newer | hooks/useMetric.test.ts:162 | ✓ |
| | clearMetricsCache clears cache + memo, mounted hooks refetch | hooks/useMetric.test.ts:128; shared/sharedLoaders.test.ts:77; loadCard.test.ts:142 | ✓ |
| | shared loader once for two concurrent cards | loadCard.test.ts:129; shared/sharedLoaders.test.ts:15 | ✓ |
| Paging | follows nextPageToken; reports progress | source/osdk/fetches.test.ts:22 | ✓ |
| | stops on signal.aborted | source/osdk/fetches.test.ts:52 | ✓ |
| | stops at ROW_CAP, row-cap, partial | source/osdk/fetches.test.ts:35; loader row-cap tests | ✓ (cap semantics = known L1) |
| | app semaphore ≤ 4 | loadCardRuntime.test.ts:57; shared/concurrency.test.ts:11 | ✓ |
| | inner batches ≤ INNER_CONCURRENCY | source/osdk/fetches.test.ts:81; source/fake/fakePaging.test.ts:66 | ✓ |
| §11 boundaries | score 30/31; Delayed@100 vs At Risk@100; null score; bin edges; zero previous; null stage; closure before first view; events after closure | rows above plus compute/funnel.test.ts:63 (null stage), compute/alertLifecycle.test.ts (closure before first view case) | ✓ |
| §11 fixtures | ~40 items / 70 alerts / ~300 events | source/fake/fixtures.test.ts:10 (40 / 70; events only `> 150`, actual 164 = known L3) | ◐ TST-08 |
| | 2 business lines, 2 regions, 3 plants; open/closed items; created before/in window | fixtures.ts:8–14 (I5 08-28, I6 08-20, I7 09-01, I8 08-25) | ✓ |
| | alerts open / closed / reopened | fixtureAlerts.ts A29–A31 | ✓ |
| | viewed-only, acted-without-view, write-back | A09–A14, A21–A23 / A47 / A51, A25–A28 / A50–A52 | ✓ |
| | null scores, Delayed | I6 I7 … / I4 I14 I22 | ✓ |
| | raised before pipeline start | A32–A34, A56 | ✓ |
| | verdict rows with both gates | 1015, 1025, 9003 | ✓ |
| | one user with two personas | u1 Planner + Logistics in app usage only | ◐ TST-11 |
| | fixed now | fixtures.ts:34 | ✓ |
| §11 loaders/derive | every window key per card | see TST-04 | ◐ |
| | every view | itemFunnel item + alert | ✓ |
| | every registry dim (loader raw) | all cards | ✓ |
| | hand-computed from fixtures with working | loader raw yes; derived outputs mostly not | ◐ TST-03, TST-05 |
| | both units; threshold change without refetch | every derive test file; compute/deriveAgeingBacklog.test.ts:34; loadCard.test.ts:103 | ✓ |
| §11 fake | §6 semantics (nulls dropped, maxGroups, now, AOF open only, pipeline start) | source/fake/fakeSource.test.ts, fakePaging.test.ts, fakeEval.test.ts, fixtures.test.ts | ✓ |
| §11 compileSpec | recording stub, chain + exact where per spec kind | source/osdk/compileSpec.test.ts | ◐ TST-02, TST-06 |
| D16 | no group-by-only property in AH/OOV where | source/osdk/groupByOnly.test.ts:61 (with an anti-vacuity check) | ✓ |
| D20 | one test listing every loader's fetch calls against the fake | none (only per-loader pins) | ✗ TST-09 |
| §11 selection | round-trip; defaults omitted; invalid fall back | selection.test.ts:87, :77, :100 | ✓ |
| §11 breakdowns | registry exact; outside → `breakdown-not-allowed`; not-applicable stages | breakdowns.test.ts:61, :70; loadCard.test.ts:154; derive tests | ✓ |
| §11 hooks | cached-sync; loading with stale data; abort on key change; error capture | hooks/useMetric.test.ts:102, :142, :162, :196 | ✓ |

## Findings

| id | severity | file:line | finding | evidence | reference | suggested fix |
|---|---|---|---|---|---|---|
| TST-01 | blocker | (missing test) | No test checks that every caveat code has text in `CAVEAT_TEXT`. Spec §13 Config lists this as a required case, and acceptance §14 requires "Checked by a test". Today only `tsc` enforces it, through `Record<Caveat, string>` in src/config/metricsText.ts:15. Nothing checks for empty strings, and nothing checks the blocked-reason texts. | `grep -rn CAVEAT_TEXT __tests__` finds only index.test.ts:9, the barrel key list. | spec §13 Config; instr. §14 acceptance | Add `__tests__/config.test.ts`: for each code in `CAVEATS`, `CAVEAT_TEXT[c]` is a non-empty single sentence. Also cover blocked reasons and `INTEGRATION_UNBLOCKED_BY`. Optionally scan `src/` for caveat string literals and check that each one is in `CAVEATS`. |
| TST-02 | major | source/osdk/compileSpec.test.ts:44–325; aggregates.test.ts; fetches.test.ts | The OSDK compiler is tested only with hand-built specs. No test compiles the real plan specs from `query/build.ts`, `buildFunnel.ts` or `buildRisk.ts`, and no loader runs against the recording client. So "recorded chains … match the plans" (spec §13) is never checked for the plans that ship. This is the only protection the OSDK code has before integration (instr. §11). Plans that are never compiled include: `itemFunnelSets` so21 (intersect with union of AOF→sourceSalesOrder and closed events→salesOrder_1), outside23/24 subtract, `closedNotOpenNow` (the test uses a human-event stand-in at compileSpec.test.ts:252), `openedEventsOfItemsOf`, `escalatedEvents`, `touchedOpenAlerts`, the `l3*` chains, `stageWithOpenAlertWhere`, `riskWorked` with filters, and `workedItems`. The "2.1 alert view under now issues one call" case is verified only against the fake. | `grep -l "query/build" __tests__/source/osdk/*` returns nothing; there is no loader import under `__tests__/source/osdk/`. | spec §13 Query building; instr. §11 compileSpec | Add `source/osdk/plans.test.ts`. For each builder, at W7 and WNOW, with and without `SOME_FILTERS`, compile through `createOsdkSource(recordingClient)` and assert `chainOf(...)` against the §9 plan chain. Also run each loader against the recording client (empty replies) and assert the request count and kinds (for example, 2.1 alert view under now = 1 aggregate). |
| TST-03 | major | loaders/alertCardsEndToEnd.test.ts:19–47; loaders/itemFunnelAlertView.test.ts:137–141; compute/deriveTestUtils.ts:1 | The final card outputs are rarely hand-checked against the fixtures. Derive tests use synthetic rows ("no fixtures"). The fixture end-to-end checks cover only: 4.2 `n` at 7 d, 4.3 / 4.4 `n` at 7 d, 4.5 `openAlerts` / `unknownAge`, 4.6 group counts at 7 d, and the alert-view stage 2.1 at 7 d. Nothing fixture-based checks bins, median, p90, `excluded`, `clampedNegative`, 4.2 not-worked at 14 d, 4.5 threshold tiles, `alertBins` or `itemBins`, 4.6 per-group breakdown, or alert-view 2.2–2.4, outside paths and actionType/writebackType groups. Some fixture edge cases therefore never reach a derived-output assertion. A53 (close before view) is closed at @8, so it can be excluded by 4.4 only at 14 d or longer, and 4.4 is never derived on fixtures at those windows. A41 (op = cl at the same stamp) is never a measured 4.2 duration. | `grep -rn "excluded\|median\|p90\|itemBins\|alertBins" __tests__/loaders __tests__/hooks __tests__/loadCard*` finds no matches. | instr. §11 "Hand-compute each expected output from the fixtures and write the working" | Add fixture-driven derive tests (loader, then derive) with the working in comments. Cover: 4.2 at 7 and 14 d (series n, excluded noRaise incl. A40, bins for A35/A36); 4.4 at 14 d (excluded closeBeforeView = A53); 4.5 at N = 30 (threshold tiles, a few bins); 4.6 alertType at 30 d; itemFunnel alert view at 7 d and now (all 5 stages, outside paths, actionType groups with A25/A28 overlap). |
| TST-04 | minor | loaders/riskDistribution.test.ts:53–88; otifOutcome.test.ts:40–97; raisedToFirstView.test.ts:27–57; firstViewToClosure.test.ts:26; closureComposition.test.ts:36 | Not every window key is tested per card. riskDistribution, otifOutcome, 4.3, 4.4 and 4.6 test only 7, 30 and now; 14 and 90 are missing. (userFunnel, itemFunnel and 4.2 cover all five. 4.5 does not use the window.) | test titles at the lines cited | instr. §11 "at least one test per window key used in the spec" (WindowKey = now, 7, 14, 30, 90) | Extend the `it.each` window tables with 14 and 90, with hand-computed expectations. |
| TST-05 | minor | loaders/itemFunnelAlertView.test.ts:36–37, 43–44, 89, 107–108, 117 | Weak or skipped assertions. A `-1` sentinel skips the L1 row-count assertion at 30 and 90 d. The expectations cite "phase2-D2" instead of the working. Facts and open alerts are checked by length only (18, 46, 48). | `if (l1Rows >= 0) expect(...)` at line 44 | instr. §11 working in a comment | Give the 30 d and 90 d L1 row counts with working. Assert id lists (`idsOf`) instead of lengths. |
| TST-06 | minor | source/osdk/compileSpec.test.ts:232–302; src/data/metrics/source/osdk/compileSpec.ts:120 | Not every spec kind is compiled in a test. EventSet `intersect` is never compiled (it is the only compileSpec branch without coverage), and OpenAlertSet `union` / `subtract` are never asserted. | coverage: compileSpec.ts branch at 120 uncovered | instr. §11 "exact where objects for each spec kind" | Add chain assertions for EventSet intersect and OpenAlertSet union/subtract. |
| TST-07 | minor | structure.test.ts:55 | The acceptance grep for `any` misses generic-argument and return-position uses. Today eslint `no-explicit-any` catches them, but the acceptance check says a test does. | Node check: the regex returns false for `Map<string, any>`, `Record<string, any>` and `(a: number) => any`. | instr. §14 acceptance "no any … Checked by a test" | Use `/\bany\b/` on comment- and string-stripped code, or a TS AST walk for `AnyKeyword` (layering.test.ts already parses the AST). |
| TST-08 | minor | loadCard.test.ts:58, 80–84, 115; hooks/useMetric.test.ts:226, 237; loadCardRuntime.test.ts:74–81; source/fake/fixtures.test.ts:15 | Weak assertions where exact values are known. `r.data` is checked with `toBeDefined`. The test named "unions … in config order" asserts `arrayContaining` plus uniqueness, so the order is never checked. The threshold-7 vs threshold-30 check uses `toBeGreaterThan`. Progress is checked as `> 0` or monotone rather than a hand-computed total. Fixture events are checked as `> 150`, though the known count is 164 (L3). | lines cited | instr. §11 hand-computed expectations | Assert exact values: caveat list `toEqual` in CAVEATS order, threshold alert counts from the fixtures, final `progress.loaded` for 4.2 at 7 d, and `events.length === 164`. |
| TST-09 | minor | (missing test); loaders/itemFunnelItemAlertDims.test.ts:25–97 | D20 asks for one test that lists every loader's fetch calls against the fake (X2). No such test exists. Per-loader pins cover most cases. The item-view alert-dim tests count only `countItems` / `countOpenAlertsBy`, so they would not catch an added row fetch. | `grep -rn "D20\|X2" __tests__` finds only a comment at raisedToClosed.test.ts:42. | PHASE1_DECISIONS D20; Appendix A X2 | Add a sweep over every card × allowed dim × window against the fake. Assert that every `fetch*` call's spec is one of the allowed builders (L1, L2 chain, touchedOpenAlerts, L3 ×3, notWorked ×2, workedItems, itemsById, verdictsByIds). |
| TST-10 | minor | compute/deriveDurations.test.ts:81; compute/deriveAgeingBacklog.test.ts:73 | The dimension loops run over a single-element array (`["plant"]`). Derive for 4.2–4.5 never runs with businessLine, productLine or region. 4.5 derive never runs with routingPersona or priority. dimValues.test.ts covers the mapping, but not the derive path per registry dim. | `const dims: BreakdownDimension[] = ["plant"]` | instr. §11 "per breakdown dimension the registry allows" | Iterate over `allowedBreakdowns(card, "item")` with expected groups. |
| TST-11 | minor | src/data/metrics/source/fake/fixtureAlerts.ts:128–135; fixtures.ts:123–134 | Some fixture paths never exercise a branch. Human-event persona is a static per-user map, so "one user with two personas" appears only in app usage (1.1). Section-1 queueFilter overlap on 1.2–1.4 from the fixtures is always 1.0. No fixture alert has first view before raise, so `clampedNegative` is always 0 on fixture data. No alert has two write-back types, so alert-view writebackType overlap is never above 1 on fixtures. | 7 d 1.2 queueFilter groups 2+1+1+1 = 5 = total (loaders/userFunnel.test.ts:56). | instr. §11 fixture content | Give u1 a Logistics human event (for example on A27 or A60). Add one alert whose view precedes its `op` (negative 4.3 duration). Give A28 a second write-back type. Update the hand-computed tests. |
| TST-12 | minor | loadCardRuntime.test.ts:28–33 | Wall-clock dependency. The test asserts `computedAt > FIXTURE_NOW` (2026-09-01) using the real clock, so it fails on any machine or CI clock set before that date. | `expect(Date.parse(r.computedAt)).toBeGreaterThan(FIXTURE_NOW.getTime())` | instr. §11 "Fix now to a constant" | Capture `before = Date.now()` and `after` around the call and assert `before ≤ computedAt ≤ after`. |

Note (not re-reported, known L1): source/osdk/fetches.test.ts:44 ("is not capped when the last page ends exactly at ROW_CAP") and :35 (rows sliced to 5) codify the current OSDK cap semantics. They must be inverted when L1 is fixed in phase 4.

## Summary
- Blocker: TST-01. No runtime test that every caveat code has text in `CAVEAT_TEXT`, although spec §13 and acceptance §14 both require one.
- Major: TST-02. The OSDK compiler is never tested with the real plan specs or loaders; only hand-built specs are recorded.
- Major: TST-03. Derived card outputs (bins, quantiles, exclusions, threshold tiles, alert-view stages 2.2–2.4, 4.6 groups) are not hand-checked against the fixtures. The A53 close-before-view case never reaches a derive.
- Coverage: 100% lines overall and on `compute/`; branches 99.3% overall, 100% on `compute/`. 74 files and 656 tests green.
