# Phase 3 review: OSDK usage (instructions §12 phase 3, item 5)

Scope: `src/data/metrics/source/osdk/**`, every loader and shared loader, `query/build*.ts`, the default source wiring, and the source/osdk recording-client tests.
This is a report only. No project file was edited.
Scratch probe: `/tmp/claude-0/-home-user-build-stuff/6668890e-cf53-523c-8931-07c0cb904c0d/scratchpad/osdk3/chains.test.ts`. It compiles the output of every builder in `query/build*.ts` through the real `createOsdkSource` and a recording `createClient`, then prints the wire chain, groupBy, `$select` and `pageSize`. Run it with `npx vitest run --config vitest.config.ts` in that folder.
The source/osdk, structure and layering tests pass: 85/85.
Not re-reported because they are already scheduled: L1 (capped semantics), L2 (`toDateOnly` copy), L5 (itemsById population) and L6.

## Findings

| id | severity | file:line | finding | evidence | reference | suggested fix |
|---|---|---|---|---|---|---|
| OSD-01 | minor | `source/osdk/rowMapping.ts:13-34` (select tuples) as used by `shared/touchedAlerts.ts:37`, `shared/openAlerts.ts:42`, `shared/notWorkedAlerts.ts:37`, `loaders/otifOutcome.ts:28` | Four row fetches select more columns than the spec's `$select`, because each port fetch method has one fixed select tuple per row type. **L2 `openIds`:** 6 columns instead of `["riskAlertId"]`. **L3 `opened`:** 8 columns instead of `["riskAlertId","eventTimestamp"]` (~20k+ rows). **4.2 `openedEv`:** 8 columns instead of 2, on the superset of every alert on the items. **4.1 worked ids:** 7 columns instead of `["salesOrderId"]`, all-time under "now". Row counts do not change and every fetch is allowed by X2, so the cost is bandwidth. **Side effect:** `toOpenAlertRow` drops a row without `salesOrderId` (`rowMapping.ts:120`). For L2 `openIds`, a touched open alert with a null `salesOrderId` would then be missing from `openNow`, and its `isClosed` would be wrong, even though the spec needs only `riskAlertId` there. | The probe's `SEL` output: `L2open … SEL ["riskAlertId","salesOrderId","persona","priority","riskType","escalated"]`, `L3o … SEL<8 event columns>`, `4.2 opened … SEL<8 event columns>`, `4.1 worked … SEL [7 item columns]` | spec §9.0.1 L2, L3; §9 4.1 step 2; §9 4.2 `openedEv`; instructions §5 rule 6 | The port is frozen, so record this in REVIEW.md as an accepted deviation (bandwidth only). Integration can revisit it if page counts matter. If the lead reopens the port, add narrow-select variants, e.g. `fetchEvents(set, ctx, "idTimestamp")`. A cheaper alternative: have `toOpenAlertRow` keep rows with a null `salesOrderId` when the caller only needs ids. |
| OSD-02 | minor | `loaders/itemFunnelItemView.ts:65-77, 83-87` | **Item-view alert dims (routingPersona / priority / escalated): the per-group aggregates have no concurrency limit.** 2.1 fires one `countItems` per candidate value in a single `Promise.all`. Candidates come from a grouped call capped only by `MAX_GROUPS` = 10,000. The 7 stage totals and 2 outside paths run at the same time, and then 3 × `BREAKDOWN_MAX_GROUPS` more calls follow. Every call carries the 2.1 closed-leg union (search-around, 2–10 s per the spec). Nothing bounds this fan-out: the app semaphore holds one slot per card, and `INNER_CONCURRENCY` is not applied. | `perGroup` → `Promise.all(groups.map(... countItems ...))`. Probe chain `IF perGroup so22`: `intersect[so21-chain(union closed leg), AOF.where(escalated).pivotTo(sourceSalesOrder)]` | spec §11 "inner batches use their own limiter (INNER_CONCURRENCY)"; §9 2.1 cost "+1 per group value" | Run the per-group calls through a limiter of `config.INNER_CONCURRENCY`. `paging.runLimited` lives in `source/osdk`, which loaders may not import, so move a generic limiter to `shared/` (e.g. `shared/concurrency.ts`) and use it here. Alternatively, record in REVIEW.md that routing persona and priority have ~10 values in practice. |
| OSD-03 | minor | `__tests__/source/osdk/compileSpec.test.ts:99-136, 158-180` | **The recording-client tests never compile the real plan builders.** Every chain test uses a hand-written spec. `query/build*.ts` is checked only as plain spec objects (`__tests__/query/*`) and against the fake. **Consequences:** the recorded §9 plans are not pinned for: the 4.2/4.6 `finalSet` (the subtract test uses *human* events, not `closed`); 4.2 `openedEv` (a pivot applied to a subtract result); the 2.1 `alerted` union with the closed leg; `perGroup`; the 1.2–1.4 escalated chain; the 3.1 scored-bucket value chain (`where(scoreIn).pivotTo("salesOrder")`); the unscored split; and the L3 chains. Spec §13 requires "recorded chains of where/pivotTo/intersect/union/subtract match the plans". Composition makes the current chains correct: all of them were verified by hand (table below). But a builder regression would pass the osdk suite. | `closedNotOpen` at `compileSpec.test.ts:106-118` is `subtract(humanEvents, …)`. No file under `__tests__/source/osdk` imports `query/build*`: `grep -l "query/build" __tests__/source/osdk` returns nothing. | spec §13 "Query building"; instructions §12 phase 3 item 5 | Add `__tests__/source/osdk/planChains.test.ts`. It runs each builder (`humanEvents`, `touchedEventsChain`, `touchedOpenAlerts`, `l3*`, `closedNotOpenNow`, `openedEventsOfItemsOf`, `itemFunnelSets` all 7 sets under W7 and now, `stageWithOpenAlertWhere`, `carriedAlertSets`, `escalatedEvents`, `workedItems`, `riskAll`, `riskWorked`, `riskBucket`/`itemsOfRisk`) through `setup()` and asserts the exact `chainOf` result, with and without filters. The scratch probe can serve as the template. |

No blocker or major findings.

## X2 trace: every row-fetch call site

Every row fetch outside `source/` is listed below. The grep for `fetchEvents|fetchItems|fetchOpenAlerts|fetchItemsByIds|fetchVerdictsByIds` excluding `source/` and `__tests__` matched these 11 sites. The compiled chains come from the probe (`f` = filtered variant).

| # | call site | spec passed → compiled chain | X2 entry allowing it |
|---|---|---|---|
| 1 | `shared/humanEvents.ts:38` `fetchEvents(humanEvents(w,f))` | `AH.where(human ∧ tsIn)`; `f`: `SO.where(F).pivotTo(alertHistory).where(human ∧ tsIn)` | L1 (spec §9.0.1 L1) |
| 2 | `shared/touchedAlerts.ts:36` `fetchEvents(touchedEventsChain(w,f))` | `events(human,w,f).pivotTo(salesOrder_1).pivotTo(alertHistory).where($or[lifecycle, human])` | L2 `evSet` |
| 3 | `shared/touchedAlerts.ts:37` `fetchOpenAlerts(touchedOpenAlerts(w,f))` | `events(human,w,f).pivotTo(alert)` | L2 `openIds` |
| 4 | `shared/openAlerts.ts:27` `fetchOpenAlerts(l3OpenAlerts(f))` | `AOF` ; `f`: `SO.where(F).pivotTo(orderFulfillmentAlerts)` | L3 `alerts` |
| 5 | `shared/openAlerts.ts:42` `fetchEvents(l3OpenedEvents(f))` | `aofSet(f).pivotTo(historyEvents).where(opened)` | L3 `opened` |
| 6 | `shared/openAlerts.ts:56` `fetchItems(l3Items(f))` | `aofSet(f).pivotTo(sourceSalesOrder)` | L3 `items` |
| 7 | `shared/notWorkedAlerts.ts:36` `fetchEvents(closedNotOpenNow(w,f))` | `closedSet.subtract(closedSet.pivotTo(alert).pivotTo(historyEvents))`, `closedSet = events(closed,w,f)` | 4.2 not-worked `closedEv` |
| 8 | `shared/notWorkedAlerts.ts:37` `fetchEvents(openedEventsOfItemsOf(finalSet))` | `finalSet.pivotTo(salesOrder_1).pivotTo(alertHistory).where(opened)` | 4.2 not-worked `openedEv` |
| 9 | `shared/itemsById.ts:22` `fetchItemsByIds(ids)` (via `alertCardWiring.itemsForDim`, used by 4.2/4.3/4.4 only with an item dim) | `SO.where({salesOrderId:{$in:chunk}})` × chunks | items by id (4.2–4.4 item-dim breakdowns) |
| 10 | `loaders/otifOutcome.ts:28` `fetchItems(workedItems(w))` | `AH.where(human ∧ tsIn).pivotTo(salesOrder_1)` (item filters not applied, R3) | 4.1 worked ids |
| 11 | `loaders/otifOutcome.ts:30` `fetchVerdictsByIds(workedIds)` | `OOV.where({otifOrderId:{$in:chunk}})` or `{$eq:id}` with `$pageSize:1` | 4.1 verdicts |

Which loaders use which shared loader:
- **itemFunnel alert view:** L1(w) always; L2(w) only for attribute dims; L3 alerts under "now" or with escalated.
- **4.2:** L2("now"), NW(w) for 7/14 only, and itemsById.
- **4.3:** L2(w) and itemsById.
- **4.4:** L2("now") and itemsById.
- **4.6:** L2("now").
- **4.5:** L3 × 3.

All of these match D12 and spec §9. userFunnel, the itemFunnel item view and riskDistribution make aggregate calls only; their loader tests assert the exact call lists. No loader, catalogue or `loadCard` calls a fetch directly outside the 11 sites above. **No raw event-history load exists.**

## Checklist (verified, no finding)

**Row cap, paging and abort**
- **ROW_CAP / PAGE_SIZE:** every row fetch goes through `paging.fetchAllPages` with `$pageSize: ctx.config.PAGE_SIZE` and `cap = ctx.config.ROW_CAP` (`osdkFetches.ts:32,44,56,73,104`). The verdict `"eq"` path uses `$pageSize: 1` as spec §9 4.1 says. Merged chunks are cut at ROW_CAP (`paging.mergePaged`). Probe: `PS 1000` on every loadObjects.
- **Abort:**
  - `throwIfAborted` runs before every page (`paging.ts:181`), before every chunk and per-id task (`runLimited`, `paging.ts:220`), and before every aggregate (`compilerFor`, `verdictSet`, `appUsageSet`).
  - The shared memos check the caller's signal (`memo.ts:59`).
  - Tests prove a single request after an abort between pages (`fetches.test.ts:52-62`) and between chunks (`fetches.test.ts:106-115`).
- **Id batching:** `chunkIds(unique, ID_BATCH)` through `runLimited(…, INNER_CONCURRENCY, …)`, the adapter's own limiter; no semaphore is used in `shared/` or `source/`. Ids are de-duplicated. `maxInFlight == INNER_CONCURRENCY` is tested for items, verdicts `"in"` and verdicts `"eq"`.

**Filters and group-bys**
- **D14 (no `$in: []`):**
  - Empty id lists return before any request (`osdkFetches.ts:66,120`; `shared/itemsById.ts:269`).
  - `chunkIds` never yields an empty chunk.
  - `itemFiltersWhere` skips empty dimensions and returns `null` when all are empty.
  - `ACTION_EVENT_SOURCES` and `EVENT_TYPES.writeback` are readonly literal tuples, so a config override cannot make them empty.
- **`$exactWithLimit`:**
  - All 20 exact `$groupBy` literals in `groupBy.ts` carry `$exactWithLimit: max`, with `max = config.MAX_GROUPS`.
  - `riskByRanges` uses `$ranges` on a mutable copy and no limit (`groupBy.ts:199-201`).
  - Probe: `maxGroupCount:10000` on the exact group-bys; none on `ranges`.
- **Group-by-only properties:**
  - No where clause in `compileWhere.ts` names AlertHistory `persona`/`riskType`/`priorityAtEvent` or OtifOrderVerdict `critClassification`. `openAlertWhere` names only AlertOrderFulfillment `persona`/`priority`/`escalated`, which are exact.
  - The specs cannot express such a filter (`EventFilter` holds predicates and a window only).
  - `groupByOnly.test.ts` walks more than 250 recorded requests (D16).

**OSDK syntax rules**
- **S1:** every bound is a single-operator clause inside `$and` (`tsIn`, `openInWindowWhere`, `riskWhere` scoreIn, `verdictDateIn`, `appUsageWhere`).
- **S2:** no `fetchOne` / `fetchOneWithErrors` anywhere. Key lookups use `.where({pk:{$in|$eq}}).fetchPage`.
- **S3 / F7:** the `switch` sits at the aggregate call site and reads `$group.<literal>` in the same case.
- **S7:** results are read defensively: `num()` / `n()` on `$count`, `valueUsd?.sum`, `<prop>?.exactDistinct`, `$group.otifScore?.startValue`, and arrays are guarded with `Array.isArray`.
- **S8:** every `pivotTo` takes a literal (the source scan test is at `compileSpec.test.ts:194-201`).
- **S9:** `buildPredicates` returns one literal of all 7 clauses. viewed/action/writeback are `WhereClause<AlertHistory>` consts, as in the spec pseudocode. Nothing is assigned after declaration.
- **S10:** a `fetchPage` loop with `$nextPageToken`; no `asyncIter` (scanned).
- **S11:** `isOpen: {$eq: true}` and `escalated: {$eq: boolean}`. No `withProperties` (scanned).

**Date and timestamp bounds**
- **Dates (`YYYY-MM-DD` via `toDateOnly`):** `salesOrderItemCreationDate`, `actualGiDate` and the verdict dates. Probe: `"$lte":"2026-09-24"`, `"$gte":"2026-09-17"`.
- **Timestamps (full ISO):** `eventTimestamp` on AlertHistory and AppUsageEvent. Probe: `"2026-09-17T10:30:00.000Z"`.

**Imports and default wiring**
- **Import boundary:** outside `source/osdk`, only the non-delivered stub `src/client.ts` and the two test harness files import `@osdk/client` or `@app/sdk`. Nothing outside `source/osdk` imports `src/client.ts` or `src/lib/osdk.ts`. `structure.test.ts:33-38` enforces this.
- **Default wiring:** `source/osdk/defaultSource.ts` builds `createOsdkSource({ client, sdk })` lazily and once, from the host's named `client` export (instructions §3) and `import * as sdk from "@app/sdk"`.
  - Its only importer is `hooks/MetricsSourceContext.ts`, as §5.1 allows.
  - `index.ts` does not export the OSDK or fake factories, which matches the §7 list.
  - `MetricsSourceContext.test.ts` tests the default.

**Recording-client tests**
The tests assert exact OSDK where objects via `chainOf` / `toOsdkWhere`:
- `PRED` is pinned to spec §4 literals (`compileWhere.test.ts:19-40`).
- `tsIn` / `now` bounds; the 2.0 date-only clause is pinned literally (`compileSpec.test.ts:48-58`).
- 4.1 gate and date clauses; exact `groupBy` wire, including `$ranges` without `maxGroupCount`; `$select` tuples, `pageSize` and tokens.

The gap is OSD-03.

## Compiled chains vs spec §9 (probe output, W7; `f` = two filter dims)

| plan | compiled (matches spec) |
|---|---|
| **L1** | `AH.where($and[HUMAN, TS7])`; f: `SO.where(F).pivotTo(alertHistory).where(…)` ✓ |
| **L2 chain** | `AH.where(HUMAN∧TS7).pivotTo(salesOrder_1).pivotTo(alertHistory).where($or[lifecycle, HUMAN])` ✓ |
| **L2 openIds** | `AH.where(HUMAN∧TS7).pivotTo(alert)` ✓ |
| **L3** | `AOF`; `AOF.pivotTo(historyEvents).where(opened)`; `AOF.pivotTo(sourceSalesOrder)`; f: from `SO.where(F).pivotTo(orderFulfillmentAlerts)` ✓ |
| **2.0** | `SO.where($and[creation ≤ "2026-09-24", $or[isOpen=true, actualGi ≥ "2026-09-17"]])` (+ `.where(F)`); now: `SO.where(isOpen=true)` ✓ |
| **2.1** (closed-leg union) | `so20 ∩ (AOF.pivotTo(sourceSalesOrder) ∪ AH.where(closed∧TS7).pivotTo(salesOrder_1))`; now: `so20 ∩ AOF.pivotTo(sourceSalesOrder)` ✓ |
| **2.2–2.4, outside paths** | `so21 ∩ viewed-items`, `∩ acted`, `∩ written back`; `(so21 ∩ acted) − so22`; `(so21 ∩ wb) − so23` ✓ |
| **perGroup** | `soX ∩ aofSet(f).where(escalated=true).pivotTo(sourceSalesOrder)` ✓ |
| **2.1 alert view** | `events(lifecycle,w,f)`; `aofSet(f)`; `events(lifecycle,w,f).pivotTo(alert)` ✓ |
| **1.2–1.4 escalated** | `AOF.where(escalated=v).pivotTo(historyEvents).where(pred∧TS7)` ✓ |
| **3.1 soeAll / soeWorked** | `SOE` (f: `SO.where(F).pivotTo(otifEvaluation)`) `∩ AH.where(HUMAN∧TS7).pivotTo(salesOrder_1).pivotTo(otifEvaluation)` ✓ |
| **3.1 byRange / value / split** | `.where($not delayed)` + `$ranges` [0,31)…[91,101); `.where($and[notDelayed, score≥51, score<71]).pivotTo(salesOrder)`; unscored `.where($and[notDelayed, score isNull]).pivotTo(salesOrder)` + exact plantCode ✓ |
| **4.2 / 4.6 finalSet** | `subtract[closedSet, closedSet.pivotTo(alert).pivotTo(historyEvents)]`, `closedSet = AH.where(closed∧TS7)` (f: via SO pivot); 4.6 grouped `priorityAtEvent` exact 10000 ✓ |
| **4.2 openedEv** | `finalSet.pivotTo(salesOrder_1).pivotTo(alertHistory).where(opened)` ✓ |
| **4.1** | `AH.where(HUMAN∧TS7).pivotTo(salesOrder_1)`; `OOV.where($and[officialExclusionCrit="No", $and[date ≥ "2026-09-17", date ≤ "2026-09-24"]])` grouped `critClassification` exact; now: `date ≤ end` only ✓ |
| **1.1** | `AppUsageEvent.where($and[appId=…, TS7])` grouped `persona` exact ✓ |

## Summary
There are no blockers and no majors. Three minors:
- **OSD-01:** four fetches select more columns than the spec's `$select`; the port is frozen, so accept it or narrow the selects later.
- **OSD-02:** the item-view alert-dim per-group aggregates have no limiter.
- **OSD-03:** the osdk tests never compile the real plan builders into chains.

Every compiled chain matches spec §9. Each of the 11 row-fetch sites maps to an X2 entry, and every other hard OSDK rule checked holds.
