# Phase 2 — Agent C (OSDK adapter) findings

## What I built
Not delivered:
- `stubs/app-sdk/index.ts`: the reviewer's verified stub, copied verbatim. It has 7 object types with typed `properties`, `props`, `links` and `objectSet`, and no `any`. `OtifOrderVerdict.otifOtShipmentEndDate` and `otifFirstInitialDeliveryDateTarget` are `datetime` (date).

Delivered (`src/data/metrics/source/osdk/`, the only code that imports `@osdk/client` or `@app/sdk`; zero `any`):
| File | Lines | Content |
|---|---|---|
| `osdkSource.ts` | 57 | `createOsdkSource({ client, sdk }): MetricsSource` (X5): the 16 methods delegate to the two files below. Also `OsdkSourceDeps`. |
| `osdkAggregates.ts` | 141 | The 11 aggregate methods, `compilerFor`, `verdictSet`, `OsdkDeps`. |
| `osdkFetches.ts` | 125 | The 5 row fetches. Verdicts support `"in"` (chunks of `ID_BATCH`, paged) and `"eq"` (one `$eq` per id, `$pageSize: 1`). |
| `compileSpec.ts` | 172 | `createSpecCompiler` with 4 mutually recursive exhaustive switches, literal pivots (S8), the `setOp` structural helper (F12), `isAllItems` and `OsdkObjectTypes` (the SDK bundle type). |
| `compileWhere.ts` | 177 | `toDateOnly`, `tsIn`, `buildPredicates(config)` (PRED in one literal, S9), `eventFilterWhere`, `itemFiltersWhere`, `openInWindowWhere` (2.0), `openAlertWhere`, `riskWhere` (3.1, including NOT_DELAYED and `$isNull`), `verdictGate`, `verdictDateIn` (switch on `VERDICT_DATE_PROPERTY`; the placeholder throws), `appUsageWhere` (the placeholder throws). |
| `groupBy.ts` | 207 | Grouped aggregates. The switch sits at the call site, so `$group` is precisely typed (F7). Every exact group-by has `$exactWithLimit: config.MAX_GROUPS`; `$ranges` gets a mutable copy (F5) and no limit. Escalated groups are labelled with `String(v) === "true"` (F6). Null groups are dropped. |
| `paging.ts` | 134 | `fetchAllPages`: `$pageSize`, `$nextPageToken`, `ROW_CAP` → `capped`, a signal check before every page, progress. Also `runLimited` (an own limiter for `INNER_CONCURRENCY`), `chunkIds`, `mergePaged`, `createProgress`, `abortError`, `fetchMapped`. No asyncIter. |
| `rowMapping.ts` | 175 | Literal `$select` tuples and the D15 mapping to `AlertEventRow`, `OpenAlertRow`, `ItemRow` and `VerdictRow`. `verdictDateReader(config)` picks the date property. |

All files are ≤ 250 lines and all functions ≤ 40 lines (checked with the TypeScript AST). There is no `any`, no cast and no `withProperties`.

Tests (`src/data/metrics/__tests__/source/osdk/`, node environment, 73 tests):
- `recordingClient.ts` (harness): a real `createClient` with a recording `fetch`. It answers `fullMetadata` (including linkTypes), `aggregate` and `loadObjects`. `chainOf()` decodes the wire object set into the OSDK call chain (`base` / `where` / `pivotTo` / `intersect` / `union` / `subtract`). The where clauses come back in exact OSDK form (`{ p: { $op } }`, `$and`, `$or`, `$not`). `whereFieldsOn(set, type)` follows pivots and set operations. It uses no casts.
- `osdkTestUtils.ts`: `TEST_CONFIG` (placeholders filled), windows, filters, `makeCtx`, `setup`.
- `compileWhere.test.ts`: PRED equals the spec §4 clauses exactly; tsIn and the "now" window; single and multiple predicates; withItemFilters; 2.0 date-only bounds and `isOpen` only under "now"; open-alert, risk and gate clauses; dateIn for both properties; placeholders throw.
- `compileSpec.test.ts`: the exact chain and where clauses for every kind of all 4 set types, including set operations. Also: `events()` pivots from filtered SalesOrders when filters are set and filters AlertHistory directly without them; the L2 chain; the 3.1 worked intersection; `isAllItems`; and a source scan (no `withProperties`, no `asyncIter`, `pivotTo` only with literals).
- `aggregates.test.ts`: `$select`/aggregation and `groupBy` of every aggregate method; `$exactWithLimit` on every grouped call with a config override; `$ranges` without `maxGroupCount`; zero ranges omitted; empty ranges send no request; escalated labels for `true` and `"false"`; null groups dropped; defensive reads (missing metrics give 0); app-usage and verdict where clauses; placeholders reject with no request; an aborted signal rejects before the call.
- `fetches.test.ts`: paging follows `nextPageToken` with `PAGE_SIZE` and the literal `$select`; progress; `ROW_CAP` gives `capped` (and an exact fit is not capped); abort between pages (1 request, AbortError); empty ids send no request (D14); id chunks, de-duplication and `maxInFlight == INNER_CONCURRENCY` (never above); a cap across chunks; abort between chunks; verdicts `"in"` vs `"eq"` (per-id `$eq`, `pageSize` 1, concurrency bound), `verdictDate` for both properties, and a placeholder that sends no request.
- `rowMapping.test.ts`: the D15 drop and null policy, timestamp normalisation, verdict dates; the limiter's order, bound and stop on failure; `mergePaged`.
- `groupByOnly.test.ts` (D16): about 260 requests across every predicate, window, group field, open-alert condition, risk condition, verdict mode and verdict lookup. No AlertHistory where clause names `persona`, `riskType` or `priorityAtEvent`, and no OtifOrderVerdict where clause names `critClassification`. The walker is proven non-vacuous, and those fields do appear in `groupBy`.

Coverage of `source/osdk/**` from these tests: statements 100%, branches 97.3%, functions 100%, lines 100%.
Checks: `npx tsc --noEmit` is clean for my files. The only errors are in `source/fake/fakeSource.ts`, which another agent is writing. `npx eslint` on source/osdk, the tests and stubs passes with `--max-warnings 0`. structure.test and layering.test pass.

## Decisions and assumptions (for QUESTIONS.md)
1. **ofItems(all) shortcut** (spec §9.0 `events`, `aofSet`, `soeAll`: "without filters, filter X directly"). When the ItemSet is `all`, or `filtered` with every dimension empty over `all`, `EventSet.ofItems`, `OpenAlertSet.ofItems` and `RiskSet.ofItems` compile to the target's base set, not a pivot. It differs from the pivot only for orphan rows (an event or alert whose item is missing). **The fake must treat `ofItems(all)` as "all" too.**
2. A single-predicate `EventFilter` compiles without the `$or` wrapper; with several predicates they go inside `$or` (F2).
3. **`capped` is precise.** It is `true` only when rows were cut: a next page existed, or the page overflowed the cap. A fetch that ends exactly at `ROW_CAP` with no next token is `capped: false`. The spec pseudocode marks any fetch with ≥ ROW_CAP rows as capped. The fake should match.
4. D15 detail:
   - An `AlertEventRow` without `riskAlertId`, without `eventType` (non-null in the type) or without a parsable `eventTimestamp` is dropped.
   - An `OpenAlertRow` without `riskAlertId` or `salesOrderId` (both non-null in the type) is dropped.
   - Items without `salesOrderId` and verdicts without `otifOrderId` are dropped.
   - Timestamps are normalised through `Date.parse` → `toISOString()`, `verdictDate` is sliced to `YYYY-MM-DD`, and a non-finite `valueUsd` becomes `null`.
5. Id lookups de-duplicate ids. Merged chunk rows are cut at `ROW_CAP`, and `capped` is set if any chunk was capped or the merge cut rows.
6. The signal is checked before every aggregate as well as between pages and chunks. The rejection is a `DOMException` named `AbortError`.
7. A placeholder `ALERT_APP_ID` or `VERDICT_DATE_PROPERTY` throws before any request (loadCard blocks those cards first, D13).
8. `countRiskByScoreRange` with no ranges sends no request and returns `[]`. Range groups with count 0 are omitted.
9. Progress (D24): `{ loaded }` is cumulative within one port call, across its pages and id chunks.
10. `toDateOnly` has its own copy in `compileWhere.ts` (`iso.slice(0, 10)`), because `window.ts` did not exist yet. If `window.ts` exports the same helper, the review can dedupe it (the layering allows source → window).
11. I did not use `chunk` from `src/lib/osdk.ts`: it takes a mutable `T[]` and is a non-delivered host copy. `paging.chunkIds` replaces it.

## For INTEGRATION.md (assumptions about the real SDK; expected type errors)
- **Package and exports.** `@app/sdk` must export the values `SalesOrders`, `AlertHistory`, `AlertOrderFulfillment`, `SalesOrderOtifEvaluation`, `OtifOrderVerdict`, `AppUsageEvent` and `AlertType`. The wiring is `createOsdkSource({ client, sdk })` with `import * as sdk from "@app/sdk"` and the host `client`. A missing export fails at the wiring site: `OsdkObjectTypes` in `compileSpec.ts`. `AlertType` is only in the type and is not queried, so it can be removed from `OsdkObjectTypes` if the SDK lacks it.
- **Property wire types assumed:**
  - string: all ids, dimensions, persona, priority, riskType, eventType, eventSource, eventActor, classifications, exclusions, appId, userId.
  - boolean: `isOpen`, `escalated`.
  - double: `valueUsd`.
  - integer: `otifScore`.
  - date (`datetime`): `salesOrderItemCreationDate`, `actualGiDate`, `otifOtShipmentEndDate`, `otifFirstInitialDeliveryDateTarget`.
  - timestamp: `eventTimestamp` (AlertHistory and AppUsageEvent).
- **Expected type errors if a type differs:**
  - `otifScore` long or decimal (client type `string`): `compileWhere.ts` `riskWhere` (`$gte`/`$lt` numbers) and `groupBy.ts` `riskByRanges` (`$ranges`).
  - `valueUsd` not double or integer: the `"valueUsd:sum"` selects in `osdkAggregates.countItems` and `groupBy.itemsGrouped`, and the `fetchMapped(..., toItemRow)` call in `osdkFetches.ts` (the `OsdkItemRow.valueUsd` number).
  - `isOpen` or `escalated` not boolean: `openInWindowWhere` and `openAlertWhere` (`$eq: true`/`boolean`), plus the rowMapping calls for items and open alerts in `osdkFetches.ts`.
  - A renamed property: the where literals in `compileWhere.ts`, the group-by literals in `groupBy.ts` and the `*_SELECT` tuples in `rowMapping.ts`.
  - Any fetched property typed differently from the structural `Osdk*Row` interfaces (`T | null | undefined`): the `fetchMapped` calls in `osdkFetches.ts`.
- **Dates vs timestamps.** If the four date properties are timestamps rather than dates, it still compiles (both filter as strings), but the `YYYY-MM-DD` bounds in 2.0 and 4.1 must become full ISO strings (`compileWhere.ts`: `openInWindowWhere`, `verdictDateIn`).
- **Links assumed** (the name must be a literal of the source type's `links`):

  | From | Link | To | Cardinality |
  |---|---|---|---|
  | SO | `alertHistory` | AH | many |
  | SO | `orderFulfillmentAlerts` | AOF | many |
  | SO | `otifEvaluation` | SOE | one |
  | AH | `salesOrder_1` | SO | one |
  | AH | `alert` | AOF | one |
  | AOF | `sourceSalesOrder` | SO | one |
  | AOF | `historyEvents` | AH | many |
  | SOE | `salesOrder` | SO | one |

  A missing or renamed link fails on that `pivotTo` line in `compileSpec.ts`.
- **Set arithmetic.** `setOp` uses a structural `SetArithmetic<S>`. The generated `__DefinitionMetadata.objectSet` must be an `ObjectSet<X>` (the generator emits `XObjectSet extends ObjectSet<X>`). A mismatch would show up at the three `setOp(...)` calls in `compileSpec.ts`.
- **Runtime notes.**
  - `fetchPage` makes the client GET `objectTypes/<X>/fullMetadata` for the root type and for every source type along a pivot, to resolve links. The user needs ontology metadata read access.
  - `aggregate` takes no signal, so abort is checked between calls.
  - `$in` and `$eq` on `otifOrderId` are unverified (`VERDICT_ID_LOOKUP`, spec §14 item 2).
  - The spec's L2 per-alert fallback (F8) has no port method; add `fetchEventsByAlertIds` if the chained pivot is slow.
- **Verify values at integration:**
  - `EVENT_TYPES` and `ACTION_EVENT_SOURCES` strings (the PRED test pins them).
  - `EXCLUSION_GATE_PASS = "No"`.
  - `OTIF_STATUS_DELAYED = "Delayed"`.
  - How escalated groups come back (boolean or string; both handled).

## Notes for other agents
- Fake source (Agent for `source/fake`): mirror decision 1 (`ofItems(all)` = all), decision 3 (precise `capped`), de-duplication of ids, empty ids giving no rows, zero-count ranges omitted, null groups dropped, and escalated labels.
- `source/fake/fakeSource.ts` currently fails `tsc` (unused `createStats`, `FIXTURES` and `createMethods`; undefined `inWindowOf`). I assume that is work in progress; I did not touch it.

## Interface change requests
None.

## Unfinished
Nothing.
