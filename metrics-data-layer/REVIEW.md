# REVIEW — Metrics data layer

The build followed instructions §12: four phases, with sub-agents doing the work and the lead deciding every conflict. The sub-agents' working files are kept in the repository under `process/`, next to this folder:
- `DESIGN.md`
- `PHASE1_DECISIONS.md`
- `PHASE4_PLAN.md`
- the `phase1-review-*`, `phase2-*`, `phase3-*` and `phase4-*` findings files.

This file summarises them.

## 1. Process

| Phase | Agents | Output |
|---|---|---|
| 1 Design | Architect; 3 reviewers (spec fidelity, modularity, OSDK feasibility) | types, query specs, port, config, DESIGN.md; 45 findings; lead decisions D1–D24; interfaces frozen |
| 2 Build | A1 core compute, A2 card compute and derives, B query builders + fake + fixtures, C OSDK adapter, D1 infra, D2 shared loaders, E1–E3 loaders, F catalogue + loadCard + hooks + index | 74 test files, 656 tests, all green |
| 3 Review | 7 reviewers: correctness, spec fidelity, modularity, structure, OSDK, types/API, tests | 65 findings (§3) |
| 4 Fix | G1 compute/loaders, G2 source/shared, G3 types/loadCard/hooks, G4 tests, G5 docs; the lead | fixes and final checks (§4) |

Phase 2 ran in waves, because building against frozen interfaces still needs the lower layers to exist before the upper ones:
1. A1, B, C, D1
2. A2, D2
3. E1–E3
4. F

## 2. Phase 1 decisions

The architect's design was accepted with these amendments. The full text is in `process/PHASE1_DECISIONS.md`.

| Id | Finding | Decision |
|---|---|---|
| D1 | Derive could not see the config that tests override (modularity B2) | `derive(raw, selection, config = METRICS_CONFIG)`; loadCard passes the loader's config |
| D2 | The 4.2 not-worked raw data held event rows, so the AlertLifecycle seam would change the raw type (M1) | New shared loader `notWorkedAlerts.ts` returns `AlertLifecycleRow[]`; `DurationRaw.notWorked` is typed to match |
| D3 | An empty predicate list compiles to `$or: []` (OSDK F2) | `EventFilter.predicates` is a non-empty tuple |
| D4 | No constant for `breakdown-not-allowed` (SF-11) | `BREAKDOWN_NOT_ALLOWED` added to config |
| D5 | One cache map breaks cast-free inference (modularity B1) | One typed cache map per card |
| D6 | Filter key collisions (M4) and the literal spec §11 key (SF-01) | Canonical, dimension-qualified `filtersKey`. Key = card, window, view (itemFunnel), otifMode (otifOutcome), filters (not userFunnel), breakdown. Unit and threshold are never in the key |
| D7 | Shared in-flight loads were aborted by the first caller (M5) | Memo with its own AbortController and a subscriber count; failed or aborted entries are evicted |
| D8 | Predicate logic written three times (M2) | `compute/eventPredicates.ts`, reused by the fake |
| D9 | No shared breakdown helper (M3) | `compute/breakdown.ts`: `topGroups`, `buildBreakdown`, `groupRows` |
| D10 | `selection.ts`, `breakdowns.ts` and `window.ts` had no place in the layers (M6) | They sit in the pure layer |
| D11 | Row-cap from shared loaders was not propagated (SF-02) | Every consumer propagates `capped` as `partial` plus `row-cap` |
| D12 | Which window L2 uses (SF-03) | Alert view and 4.3 use the selected window; 4.2, 4.4 and 4.6 use "now" and then filter on `closedAt` |
| D13 | Blocked result shape (SF-04) | `needs-integration-value` caveat; check order: not allowed → stub → placeholder |
| D14 | `$in: []` matches all objects (OSDK F1) | Empty id list means no call |
| D15–D16 | Row mapping; group-by-only safety (OSDK F3–F7) | Drop rows missing a key; recording test on AlertHistory and OtifOrderVerdict where clauses |
| D17–D19 | 3.1 value calls; architect assumptions A2–A10; Excel items not offered | Accepted and recorded in QUESTIONS.md |
| D20–D24 | Row-fetch enforcement; file splits; scanner tests; loadCard ownership; progress | Implemented |

Lead notes raised during phase 2 (all fixed in phase 4 unless marked):

| Note | Issue | Outcome |
|---|---|---|
| L1 | OSDK paging reported capped only when rows were cut | Aligned with spec §9.0: capped once rows reach `ROW_CAP` |
| L2 | `compileWhere` had its own `toDateOnly` copy | Removed; uses `window.ts` |
| L3 | Fixtures have 164 events, not about 300 | **Accepted**: kept small so every value can be checked by hand |
| L4 | Request for a `VERDICT_DATE_PROPERTIES` tuple | **Declined**: V7 already provides the typed union |
| L5 | 4.2–4.4 fetched items for all touched alerts | Items are now fetched for the population only |
| L6 | Two loader-envelope helpers | Merged into `loaders/loaderOutput.ts` |

## 3. Changes after the freeze

The lead authorised all of these:
- `types.ts`: `Derive` gains an optional `config` parameter (D1). `MetricResult` becomes a union on `status` (TYP-01), because instructions §10 ("discriminated unions over optional-field soup") outranks the spec §10 sketch. The field names and JSON shape are unchanged.
- `rawTypes.ts`: `DurationRaw.notWorked` becomes `AlertLifecycleRow[]` (D2). The `AlertViewRaw` doc comment is updated for COR-01/02; this is a doc-only change.
- `query/specs.ts`: the predicate list is non-empty (D3).
- `config/metrics.ts`: `BREAKDOWN_NOT_ALLOWED` (D4).
- `__tests__/layering.test.ts`: G2 added a rank for the new file `source/batching.ts`.

## 4. Phase 3 findings

Severities are as the reviewers gave them. "Fixed" means the change is in the tree and covered by tests.

| Id | Sev | Finding | Decision | Fixed |
|---|---|---|---|---|
| COR-01 | minor | Alert view 2.2–2.4 counted alerts outside 2.1 (A53, A54 at 7 d) | Nesting wins (Excel 2.2 = 2.1 ∩ …); L2 and L3 always loaded in alert view | yes (G1) |
| COR-02 | minor | Alert-view groups used AOF values on 2.1 and pipeline attrs on 2.2–2.4 | Open alerts use their AOF row on every stage | yes (G1) |
| COR-03 | minor | Zero-count candidate groups shown | Dropped before top-N | yes (G1) |
| SPF-01 | minor | `unit` said valueUsd while numbers were counts | `unit` = "count" on fallback, plus caveat | yes (G1) |
| SPF-02 | minor | Loading `computedAt: ""` | Request time, as ISO | yes (G3) |
| SPF-03 | minor | Row types not exported | Exported as types | yes (G3) |
| SPF-04 | minor | Non-React callers had no source | Public `loadCard` defaults to the OSDK source | yes (G3) |
| SPF-05 | minor | 4.5 caveat condition | Accepted; in QUESTIONS.md | n/a |
| SPF-06 | minor | Spurious `truncated` from escalated pairs | Truncation check only on grouped-call lists | yes (G1) |
| MOD-01 | major | Progress sum wrong across fetches | Per-call delta ctx; running total | yes (G3) |
| MOD-02 | major | Truncation checked in both loaders and derives | Derives only; added to 4.1 | yes (G1) |
| MOD-03 | major | Fake re-implemented 4.1 verdict rules | Fake reuses compute | yes (G2) |
| MOD-04 | major | Registry facts copied in five loaders | Guards exported from `breakdowns.ts` | yes (G1) |
| MOD-05 | minor | Escalated label rule written four times | One helper pair | yes |
| MOD-06 | minor | Duplicate grouping helpers | `groupRows` used everywhere. The fake keeps `capGroups`, because `topGroups` would drop `valueUsd` | partly |
| MOD-07 | minor | Duplicate predicate | Removed | yes |
| MOD-08 | minor | String ordering written three times; `sortedDistinct` in `shared/` | `compute/stats` | yes |
| MOD-09 | minor | Stage-id lists hand-copied | Built from `FUNNEL_STAGES` | yes |
| MOD-10 | minor | Bucket ids hand-written | Config lists, except two literal `Record`s kept on purpose (the compiler checks them when a bucket is added) | partly |
| MOD-11 | minor | Funnel caveat assembly repeated in 3 derives | Accepted: each derive differs in which caveats apply | no |
| MOD-12 | minor | `other` re-implemented per card | Partly shared; count/value `amountsOutside` left per card | partly |
| MOD-13 | minor | Magic date length, ad-hoc math | `dateOnlyOrNull`, stats helpers | yes |
| MOD-14 | minor | Three abort helpers with different messages | `compute/abort.ts`; one message, "aborted" | yes (G2) |
| MOD-15 | minor | Adapters duplicated chunking and limiting | `source/batching.ts`. The two id-lookup functions stay separate | partly |
| MOD-16 | minor | Redundant id filters | Removed | yes |
| MOD-17 | minor | Key builders copied | One `memoKey`. Card-key labels unchanged | partly |
| MOD-18 | minor | Dead code | `sumNullable`, `emptyBucketAmounts`, `clamped` removed. `bucketOf` kept (spec §12.2 seam). `WINDOW_OPTIONS`, `MOUNT_ORDER` and `HumanEvent` kept (config and spec types) | partly |
| MOD-19 | minor | Duplicated test helpers | Shared helpers | G4 |
| MOD-20 | minor | Gaps in layering and purity scanners | Hardened | G4 |
| STR-01 | major | Host `chunk` re-created | Imported from `src/lib/osdk.ts` via `source/batching.ts` | yes (G2) |
| STR-02 | major | No CAVEAT_TEXT test | `config.test.ts` | G4 |
| STR-03 | minor | Scanner regex gaps | Hardened | G4 |
| STR-04 | minor | §4 names not used | `deriveFunnel`, `itemsOpenInWindow`, `percent` | yes (G1) |
| STR-05 | minor | Same name, different contracts | Renamed or de-duplicated (e.g. `compileRiskCondition`) | yes |
| STR-06 | minor | Added files not justified | Accepted; justified in §5 | n/a |
| STR-07 | minor | Stub load and derive lived in `catalogue.ts` | `loaders/blocked.ts`, `compute/deriveStub.ts` | yes (G1) |
| STR-08 | minor | Test tree did not mirror the source | Renamed and moved | G4 |
| STR-09 | minor | Extra tsconfig `types` | Kept `["node"]` for the Node-based scanner tests; `vitest/globals` removed (tests import from vitest) | yes (lead) |
| STR-10 | minor | JSDoc citations and null behaviour | Added | yes |
| OSD-01 | minor | Some fetches select more columns than the spec | Accepted: port frozen, bandwidth only. Row mapping drops open alerts without `salesOrderId` (D15) | n/a |
| OSD-02 | minor | Unbounded per-candidate aggregates | `runLimited(INNER_CONCURRENCY)` | yes (G1) |
| OSD-03 | minor | Real builders never compiled in OSDK tests | `planChains.test.ts` | G4 |
| TYP-01 | major | `MetricResult` optional-field soup | Union on `status` | yes (G3) |
| TYP-02 | major | Selection updater lost queued updates | Latest-selection ref | yes (G3) |
| TYP-03 | major | = SPF-04 | as SPF-04 | yes (G3) |
| TYP-04 | minor | Implicit any in `groupBy.ts` | Typed `aggregateRows` | yes (G2) |
| TYP-05 | minor | New dimension would compile but compute the wrong thing | Exhaustive switches with `never` | yes (G1, G2) |
| TYP-06 | minor | Inline provider props restarted loads | Memoised environment; `now` may be a function | yes (G3) |
| TYP-07 | minor | Abort error text inconsistent | "aborted" everywhere. Errors stay strings (spec §10) | yes (G3) |
| TYP-08 | minor | Dependent fields not tied in types | Accepted: spec §10 shapes | n/a |
| TST-01 | blocker | No CAVEAT_TEXT test | `config.test.ts` | G4 |
| TST-02 | major | Real plans never compiled | `planChains.test.ts` | G4 |
| TST-03 | major | Derived outputs thin on fixtures | Fixture end-to-end tests | G4 |
| TST-04 | minor | Windows 14 and 90 not tested for some cards | Added | G4 |
| TST-05 | minor | Sentinel and length-only checks in the alert-view test | Replaced with exact values | G4 |
| TST-06 | minor | EventSet `intersect` and OpenAlertSet `union`/`subtract` never compiled | Added | G4 |
| TST-07 | minor | `any` scanner gaps | Hardened | G4 |
| TST-08 | minor | Weak assertions | Replaced with exact values | G4 |
| TST-09 | minor | No row-fetch sweep (D20) | Sweep test | G4 |
| TST-10 | minor | Derive dimension loops covered only `plant` | All allowed dimensions | G4 |
| TST-11 | minor | Some fixture paths never fire | Unit tests (fixture data unchanged) | G4 |
| TST-12 | minor | Test depended on the real clock | Fixed clock | G4 |

"G4" in the Fixed column means the test fixer's outcome is listed in §6.

## 5. Files added beyond the §4 tree (STR-06)

Instructions §4 allows these inside the existing folders.
- `config/metricsCodes.ts`, `config/metricsText.ts` keep config under 250 lines; `metrics.ts` re-exports them.
- `types.ts` is split into `outputTypes.ts`, `rowTypes.ts` and `rawTypes.ts` for size; `types.ts` re-exports them.
- `compute/` additions:
  - `eventPredicates.ts` (D8)
  - `alertSets.ts`
  - `caveats.ts`
  - `abort.ts` (MOD-14)
  - `dimValues.ts`, `deriveCommon.ts` and `funnelGroups.ts`: shared derive helpers that keep derives under 40 lines per function
  - one derive file per card family
  - `deriveStub.ts` (STR-07)
- `query/buildFunnel.ts` and `query/buildRisk.ts` keep `build.ts` under 250 lines.
- `source/batching.ts` is the one chunker and limiter, shared by both adapters (STR-01).
- `source/osdk/` additions:
  - `compileWhere.ts`, `groupBy.ts`, `osdkAggregates.ts`, `osdkFetches.ts` and `rowMapping.ts` (D21 size splits)
  - `defaultSource.ts`: lazy default source, so `hooks/` never imports OSDK
- `source/fake/`: `fakeEval.ts`, `fakeGroups.ts`, `fakePaging.ts` and `fixtureAlerts.ts` (size).
- `shared/` additions:
  - `memo.ts` (D7)
  - `inflight.ts`: breaks the cache ↔ memo cycle
  - `sourceCtx.ts`: per-call source context
  - one file per shared loader: `humanEvents`, `touchedAlerts`, `openAlerts`, `notWorkedAlerts`, `itemsById`
- `loaders/` additions: `itemFunnelItemView.ts` and `itemFunnelAlertView.ts` (150-line limit), `alertCardWiring.ts` (4.3/4.4 shared body), `loaderOutput.ts` (L6).

## 6. Final check results

FINAL_RESULTS_PLACEHOLDER
