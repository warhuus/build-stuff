# Integration

This file covers:

1. Placeholders to fill
2. Values to verify
3. Assumptions about the real SDK
4. Open decisions and sanity checks
5. Runtime notes
6. Copy steps
7. Expected type errors

File paths are relative to `src/`.

## 1. Placeholders to fill

Only two config values in `config/metrics.ts` are still set to `PLACEHOLDER` (`"<to be set at integration>"`). `QUESTIONS.md` "Blocked" lists the same two. While a value is still the placeholder, `loadCard` blocks the card that needs it: `status: "blocked"`, reason `needs-integration-value`, with no network call.

| What | Where | Blocks while unset | How to fill |
|---|---|---|---|
| `ALERT_APP_ID` | `config/metrics.ts` | `userFunnel` (spec §9 1.1) | The `AppUsageEvent.appId` value of the alert app. Filtered with `$eq`. |
| `VERDICT_DATE_PROPERTY` | `config/metrics.ts` | `otifOutcome` (spec §14 item 1, §9 4.1) | `"otifOtShipmentEndDate"` or `"otifFirstInitialDeliveryDateTarget"`. The type allows only these two names or the placeholder (Appendix A V7). |

Two more values are not in config:

- **The `@app/sdk` package name.** The code imports `@app/sdk` (a placeholder name) in these files:
  - `data/metrics/source/osdk/compileSpec.ts`
  - `data/metrics/source/osdk/compileWhere.ts`
  - `data/metrics/source/osdk/groupBy.ts`
  - `data/metrics/source/osdk/osdkAggregates.ts`
  - `data/metrics/source/osdk/defaultSource.ts` (`import * as sdk`)
  - the OSDK test harness `data/metrics/__tests__/helpers/osdkHarness.ts`

  There are two ways to point it at the real package:
  - **(a)** Replace the string `"@app/sdk"` with the real package name in those files.
  - **(b)** Keep the string and add an alias. The alias needs a tsconfig `paths` entry, `"@app/sdk": ["./node_modules/<real-sdk>"]` (or the package's entry file), plus the same alias in the host's Vite/Vitest `resolve.alias`.

  `structure.test.ts` checks that only `source/osdk` imports `@app/sdk`. With (a), update the literal in that test too.
- **The client import.** `source/osdk/defaultSource.ts` imports `{ client }` from `../../../../client`, which is `src/client.ts`. `source/batching.ts` imports `{ chunk }` from `../../../lib/osdk`, which is `src/lib/osdk.ts`. These are the host paths from instructions §3. Nothing changes if the host has them there.

The host sets both config values by editing `config/metrics.ts`, which is what `INTEGRATION_UNBLOCKED_BY` says to do. Alternatively, it can pass a full `MetricsConfig` through `<MetricsSourceProvider config={...}>` or `loadCard(..., { config })`.

## 2. Values to verify (set, but unconfirmed)

| Value | Current | Check |
|---|---|---|
| `VERDICT_ID_LOOKUP` | `"in"` | Spec §14 item 2 and Appendix A V8. Use a known id to confirm that `OtifOrderVerdict.where({ otifOrderId: { $eq: id } }).fetchPage({ $pageSize: 1 })` returns the row despite the not-exact-matchable flag. Then confirm that `$in` returns it too. If only `$eq` works, set `"eq"`. If neither works, 4.1 must be stubbed until the item ↔ verdict link exists. Also confirm that `otifOrderId` has the same format as `SalesOrders.salesOrderId`. |
| `EVENT_TYPES` | `opened_by_user`, `deeplink_clicked`, `updated`, `opened`, `closed`, write-backs `delivery_block_removed`, `delivery_tolerance_corrected`, `allocation_rejection_lifted` | These are the `AlertHistory.eventType` strings from spec §3 and §4. The predicate test pins them. |
| `ACTION_EVENT_SOURCES` | `user`, `user action`, `action` | The `eventSource` values of an action (spec §4). |
| `EXCLUSION_GATE_PASS` | `"No"` | The `officialExclusionOtif` / `officialExclusionCrit` value that lets a verdict in (spec §9 4.1). |
| `VERDICT_VALUES` | `OTIF`/`Not OTIF`, `CRIT`/`Not CRIT` | The values of `initOtifClassification` and `critClassification` (Appendix A P3). |
| `OTIF_STATUS_DELAYED` | `"Delayed"` | The `SalesOrderOtifEvaluation.otifStatus` value of delayed items (spec §9 3.1). |
| `PIPELINE_EVENTS_START` | `"2026-05-15"` | The first UTC day with pipeline `opened`/`closed` events (Appendix A V4). |
| `RISK_RANGES` | `[0,31) [31,51) [51,71) [71,91) [91,101)` | The `otifScore` bands. Scores fall in 15–100. |
| `escalated` group values | handled as a boolean or a `"true"`/`"false"` string | `groupBy.escalatedGroupLabel` normalises both forms. |

## 3. Assumptions about the real SDK types

These assumptions are taken from `stubs/app-sdk/index.ts`. That file is the typed stand-in; it is not delivered.

**Exports.** `@app/sdk` must export these object-type values:

- `SalesOrders`
- `AlertHistory`
- `AlertOrderFulfillment`
- `SalesOrderOtifEvaluation`
- `OtifOrderVerdict`
- `AppUsageEvent`
- `AlertType`

`source/osdk/compileSpec.ts` `OsdkObjectTypes` collects them, and `defaultSource.ts` passes `import * as sdk` to it. `AlertType` appears only in that type and is never queried, so if the SDK lacks it, remove it from `OsdkObjectTypes`.

**Properties used and the wire types assumed:**

| Object | Property (wire type) |
|---|---|
| SalesOrders | `salesOrderId` (string, PK), `isOpen` (boolean), `salesOrderItemCreationDate` (date), `actualGiDate` (date), `valueUsd` (double), `businessLineName`, `productLineName`, `iscRegionName`, `plantCode` (string) |
| AlertHistory | `historyEventId` (string, PK), `riskAlertId`, `salesOrderId`, `eventType`, `eventSource`, `eventActor`, `persona`, `riskType`, `priorityAtEvent` (string), `eventTimestamp` (timestamp) |
| AlertOrderFulfillment | `riskAlertId` (string, PK), `salesOrderId`, `persona`, `priority`, `riskType` (string), `escalated` (boolean) |
| SalesOrderOtifEvaluation | `salesOrderId` (string, PK), `otifStatus` (string), `otifScore` (integer) |
| OtifOrderVerdict | `otifOrderId` (string, PK), `initOtifClassification`, `critClassification`, `officialExclusionOtif`, `officialExclusionCrit` (string), `otifOtShipmentEndDate`, `otifFirstInitialDeliveryDateTarget` (date) |
| AppUsageEvent | `eventId` (string, PK), `userId`, `appId`, `persona` (string), `eventTimestamp` (timestamp) |

Breakdown and filter dimensions map to properties as follows:

| Dimension | Property |
|---|---|
| businessLine | `businessLineName` |
| productLine | `productLineName` |
| region | `iscRegionName` |
| plant | `plantCode` |
| routingPersona, queueFilter | `persona` |
| alertType | `riskType` |
| priority | `priorityAtEvent` on AlertHistory, `priority` on AOF |
| actionType, writebackType | `eventType` |

**Links.** Link names must be string literals of the source type's `links` (Appendix A S8). This table follows `process/phase2-C.md`:

| From | Link | To | Cardinality | Used by |
|---|---|---|---|---|
| SalesOrders | `alertHistory` | AlertHistory | many | events of filtered items |
| SalesOrders | `orderFulfillmentAlerts` | AlertOrderFulfillment | many | open alerts of filtered items |
| SalesOrders | `otifEvaluation` | SalesOrderOtifEvaluation | one | 3.1 risk of items |
| AlertHistory | `salesOrder_1` | SalesOrders | one | items of events (2.1–2.4, L2 chain, 4.1 worked ids) |
| AlertHistory | `alert` | AlertOrderFulfillment | one | open alerts of events (2.1 term b, L2 open ids, 4.2 / 4.6 subtract) |
| AlertOrderFulfillment | `sourceSalesOrder` | SalesOrders | one | items with open alerts |
| AlertOrderFulfillment | `historyEvents` | AlertHistory | many | L3 opened events |
| SalesOrderOtifEvaluation | `salesOrder` | SalesOrders | one | items of a risk set |

**Set arithmetic.** `compileSpec.ts` `setOp` uses a structural `SetArithmetic<S>` type, which expects each generated `objectSet` to extend `ObjectSet<X>`. The generator emits it that way.

**Dates vs timestamps.** Four properties are assumed to be dates:

- `salesOrderItemCreationDate`
- `actualGiDate`
- `otifOtShipmentEndDate`
- `otifFirstInitialDeliveryDateTarget`

They are compared with `YYYY-MM-DD` bounds on the UTC calendar date. If any of them is a timestamp instead, the code still compiles, but the bounds in `compileWhere.ts` `openInWindowWhere` (2.0) and `verdictDateIn` (4.1) must become full ISO strings.

## 4. Spec §14 open decisions and Appendix A S11 checks

Run these against the live ontology before release.

- [ ] **Verdict date property** (§14 item 1). Set `VERDICT_DATE_PROPERTY`.
- [ ] **`$in` / `$eq` on `otifOrderId`** (§14 item 2). Set `VERDICT_ID_LOOKUP`, as described in section 2. The same test settles `$in` on `AlertHistory.riskAlertId`, which the L2 fallback below needs.
- [ ] **SDK coverage** (§14 item 3). The SDK must expose these objects and links:
  - objects: `AppUsageEvent`, `SalesOrderOtifEvaluation`, `OtifOrderVerdict`, `AlertType`
  - links: `SalesOrders.otifEvaluation`, `AlertOrderFulfillment.historyEvents`, `AlertHistory.alert`

  Without them, 1.1, 3.1, 4.1, 4.5 and every `pivotTo("alert")` step cannot run.
- [ ] **`isOpen` and `escalated` filters** (§14 item 4, Appendix A S11). Both are filtered with `$eq`. Sanity counts:
  - `SalesOrders.where({ isOpen: { $eq: true } })` should count about 18k.
  - `escalated = true` + `escalated = false` on `AlertOrderFulfillment` should equal the open-alert count, which is about 20k.
- [ ] **Chained pivot cost** (§14 item 5). Time these chains:
  - L2: human events → `salesOrder_1` → `alertHistory` (`query/build.ts` `touchedEventsChain`)
  - the 4.2 / 4.6 set: closed events in the window, minus the open alerts of those events (`closedNotOpenNow`, with `pivotTo("alert")`)

  If L2 is too slow, the spec's fallback fetches the same rows with more calls, one `$in` per chunk of alert ids. **There is no port method for it yet.** To use it, add `fetchEventsByAlertIds(ids, ctx)` to `source/MetricsSource.ts`, implement it in both adapters (use `batching.idChunks` + `paging.fetchAllPages`), and switch `shared/touchedAlerts.ts` to it.

## 5. Runtime notes

- **Metadata reads.** The first `fetchPage` or `aggregate` on a type makes the client GET `objectTypes/<X>/fullMetadata`. A pivot also triggers that GET for every source type along the way, to resolve links. The app user needs read access to the ontology metadata.
- **Abort.** Neither `aggregate` nor `fetchPage` takes an abort signal (S10), so the adapter checks the signal before every call, between pages and between id chunks. A request already in flight finishes, and its result is dropped.
- **Paging and caps.**
  - Paging uses the `fetchPage` loop, with `PAGE_SIZE = 1000` and `$nextPageToken`.
  - A fetch that reaches `ROW_CAP = 60_000` rows makes the card `partial` with `row-cap`.
  - Grouped aggregates pass `$exactWithLimit: MAX_GROUPS` (10,000).
  - An empty id list sends no request, because `$in: []` would match every object.
- **Wider selects.** Four row fetches select more columns than the spec's `$select`, because the frozen port has one select tuple per row type (OSD-01). They are the L2 open ids, the L3 opened events, the 4.2 opened events and the 4.1 worked ids. Only bandwidth is affected. Revisit this if page counts matter.

## 6. Copying `src/` into the host app

1. Copy these paths from `metrics-data-layer/src/` to the same paths in the host `src/`:
   - `src/config/metrics.ts`, `src/config/metricsCodes.ts`, `src/config/metricsText.ts`
   - the whole folder `src/data/metrics/`, including `__tests__/` if the host should run the tests
2. **Do not copy** the entries in `.deliveryignore`:
   - `src/client.ts` (the host has the real client)
   - `src/lib/osdk.ts` (the host has `collectAll` and `chunk`)
   - `stubs/`

   Do not copy `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`, `node_modules/` or `coverage/` either.
3. Point `@app/sdk` at the real SDK, as described in section 1 (rename the import or add an alias). Remove the standalone `paths` entry for `stubs/app-sdk`.
4. Fill in `ALERT_APP_ID` and `VERDICT_DATE_PROPERTY` in `src/config/metrics.ts`. Settle `VERDICT_ID_LOOKUP`.
5. **Wiring.** No wiring is required. Without a provider, the hooks use `getDefaultOsdkSource()`, which is `createOsdkSource({ client, sdk })` over `src/client.ts` and `@app/sdk`. To inject a source, put the provider above the Metrics page:

   ```ts
   import { createElement } from "react";
   import { MetricsSourceProvider } from "./data/metrics";
   createElement(MetricsSourceProvider, { source: mySource /* optional */, config: myConfig /* optional */ }, page);
   ```

   `useMetricsSelection` needs a react-router context, which the app's `<Router>` provides.
6. **Dependencies.**
   - Runtime: `react` ^18, `react-router-dom` ^6 (already in the host) and `@osdk/client` ^2.7 (already in the host). The delivered code has no other runtime dependency. `@osdk/api` is used only by `stubs/`.
   - To run the delivered tests in the host, it needs these devDependencies: `vitest` ^3, `@vitest/coverage-v8`, `jsdom`, `@testing-library/react`. For lint: `eslint-plugin-react-hooks`, `typescript-eslint`. The hook tests need `environment: "jsdom"`.
   - The tests in `__tests__/source/osdk/` import the SDK through `__tests__/helpers/osdkHarness.ts`. Their recording client (`__tests__/helpers/recordingClient.ts`) answers `fullMetadata` from a hard-coded table of the link names above, so update that table if the real names differ.
7. Run `tsc --noEmit`, `eslint` and `vitest run` in the host. Fix any errors listed in section 7.
8. Run the checks in section 4 against the live ontology.

## 7. Expected integration type errors and where they appear

Once the real SDK types replace the stub, differences show up only in `source/osdk/`:

| If the real SDK… | Error location |
|---|---|
| lacks one of the 7 exports, or names one differently | `source/osdk/compileSpec.ts` (`OsdkObjectTypes` imports) and `source/osdk/defaultSource.ts` (`createOsdkSource({ client, sdk })`) |
| names or omits a link | the matching `pivotTo("…")` line in `source/osdk/compileSpec.ts` (`compileItems`, `compileEvents`, `compileOpenAlerts`, `compileRisk`) |
| renames a property | where literals in `source/osdk/compileWhere.ts`; `$groupBy` literals in `source/osdk/groupBy.ts`; the `*_SELECT` tuples in `source/osdk/rowMapping.ts`; `"valueUsd:sum"` in `osdkAggregates.countItems` / `groupBy.itemsGrouped`; `otifOrderId` in `osdkFetches.ts` |
| types `otifScore` as long or decimal (client type `string`) | `compileWhere.ts` `compileRiskCondition` (numeric `$gte` / `$lt`) and `groupBy.ts` `riskByRanges` (`$ranges`) |
| types `valueUsd` as something other than double or integer | the `"valueUsd:sum"` selects in `osdkAggregates.countItems` and `groupBy.itemsGrouped`; the `fetchMapped(..., toItemRow)` call in `osdkFetches.ts` (`OsdkItemRow.valueUsd`) |
| types `isOpen` or `escalated` as something other than boolean | `compileWhere.ts` `openInWindowWhere` and `openAlertWhere` (`$eq: true` / boolean); the row-mapping calls for items and open alerts in `osdkFetches.ts` |
| types a fetched property differently from the structural `Osdk*Row` interfaces (`T \| null \| undefined`) | the `fetchMapped(...)` calls in `source/osdk/osdkFetches.ts` (`fetchEvents`, `fetchOpenAlerts`, `fetchItems`, `fetchItemsByIds`, verdict lookups) |
| names the verdict date properties differently | `compileWhere.ts` `verdictDateIn` and `rowMapping.ts` `verdictDateReader` / `VERDICT_SELECT`. Also update the `VerdictDateProperty` union in `config/metrics.ts`. |
| emits an `objectSet` that is not an `ObjectSet<X>` | the three `setOp(...)` calls in `source/osdk/compileSpec.ts` |
| types `eventActor`, `userId` or `riskAlertId` so that `exactDistinct` is not allowed | the `ACTOR_SEL` / `ALERT_SEL` / `userId:exactDistinct` selects in `source/osdk/groupBy.ts` and `osdkAggregates.countEvents` / `countAppUsers` |

The host-helper imports need the host module paths and export names from instructions §3:

- `source/batching.ts` imports `chunk` from `src/lib/osdk.ts`.
- `source/osdk/defaultSource.ts` imports `client` from `src/client.ts`.
