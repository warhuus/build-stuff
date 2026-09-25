# Questions

This file has three parts:

- **Known deviations** (instructions §8 item 14, Appendix A P2, lead decision D19)
- **Assumed**: every place where we took the safer reading (instructions §13 rule 2)
- **Blocked** (instructions §13 rule 3)

## Known deviations

These are first-draft deviations from the Excel. In each case the spec deliberately wins. Copied verbatim from Appendix A P2:

a. 4.1 "not worked" = gated verdicts not worked, including items that never had an alert. Caveat `not-worked-includes-unalerted`. (Excel intends alerted-but-untouched; that needs the item-to-verdict link, second draft.)
b. 4.1 headline only, no stratification by alert type × priority. Caveat `unstratified`.
c. 3.1 worked(i) is windowed (Excel has no window).
d. Breakdowns the Excel lists but the first draft does not offer (see the registry below): escalated on 4.2–4.4 and 4.6; item dims on 4.6; all breakdowns on 4.1; item dims in the itemFunnel alert view.
e. action_event excludes `eventType = "updated"` (automation backfill; W1). A clarification, listed so it is visible.

Two more Excel items are not offered (D19):

f. **Section 1 business-line breakdown.** The Excel header for 1.0 and section 1 lists it. It depends on the company directory (S1, spec §7), so the userFunnel registry row has no item dims (Appendix A breakdown registry). Section 1 ignores item filters and adds `filters-not-applied` (F7).
g. **4.1 "alerts touched per item" segmentation.** The spec does not describe it (spec §9 4.1). Instructions §13 rule 4 says not to add a metric or breakdown the spec does not describe.

## Assumed

### Selection and cache

- **Raw cache key.** The key is `card | window | view (itemFunnel only) | otifMode (otifOutcome only) | filtersKey (every card except userFunnel) | breakdown`. Unit and `ageingThresholdDays` are never part of it. The fields are labelled, so keys cannot collide. Refs: spec §11; Appendix A O3, F7; D6.
- **4.1 and 4.5 keep the window and filters in the key** (the literal reading of spec §11). This supersedes architect A1. 4.5 fetches the same L3 data for every window, so a window change reuses the L3 memo. It does not reuse the card cache. Refs: spec §11; D6.
- **`filtersKey`** is canonical: values are sorted, de-duplicated and URI-encoded per dimension (e.g. `bl=a,b;pl=;rg=x;pt=`). Ref: spec §11.
- **Filter values.**
  - Non-strings and empty strings are dropped. `bl=` in a URL means no value.
  - Values are not trimmed, because they are raw property values.
  - Values are sorted by UTF-16 code unit.
  - Refs: spec §5 B3; instructions §7.
- **URL parsing.**
  - A scalar key takes its first value.
  - `w` accepts `now` or decimal digits.
  - `n` accepts digits only, and the result must be an integer from 1 to 365.
  - Unknown params are ignored on read and kept on write.
  - Ref: instructions §7.
- **Windows.** `resolveWindow` subtracts exactly N × 24 h. `inWindow` is inclusive at both ends. A null or unparsable timestamp is outside every window. Refs: instructions §8 item 2; spec §9.0 `tsIn`.
- **Shared-loader memos** are keyed on `window.key` + `filtersKey` only. The first caller's `now`, `config` and `onProgress` drive the shared run. A later caller with a different config joins that run until `clearMetricsCache()`. Refs: spec §11; D7.
- **Shared runs and abort.**
  - Concurrent callers share one run, and each caller's abort rejects only that caller.
  - The run aborts only when every caller that passed a signal has aborted. A caller without a signal keeps it alive.
  - A load still in flight during `clearMetricsCache()` is not stored.
  - A rejected load is evicted, so the next call retries.
  - Refs: D5, D7; instructions §8 item 11.
- **Order of the loadCard prechecks:** breakdown not allowed → stub → placeholder. A disallowed breakdown on a stub card therefore reads `breakdown-not-allowed`. Refs: architect A8; D13.
- **`capped`** is true whenever the rows fetched reach `ROW_CAP`, even if the last page ended exactly at the cap and nothing was cut. A result of exactly `ROW_CAP` rows is `partial` + `row-cap`. Refs: spec §9.0 `fetchAllPages` pseudocode; lead note L1.
- **Id lookups.**
  - Ids are de-duplicated and sorted before the call.
  - The row cap applies across all chunks.
  - An empty id list returns no rows, with no call.
  - Callers must not rely on the row order.
  - Refs: D14; Appendix A S2.
- **Progress.**
  - `progress.loaded` is the sum of per-port-call row deltas for this load.
  - A caller that joins an in-flight load, or hits the cache, gets no progress.
  - A zero-row page still counts as one progress report.
  - Refs: D24; MOD-01.
- **Abort messages.** Every abort, from any layer, surfaces as `status: "error"`, `error: "aborted"`. Refs: instructions §7; TYP-07.
- **`MetricResult`** is a union discriminated on `status`. It uses the spec §10 field names; fields that are absent are typed `undefined`. Refs: instructions §10; TYP-01.

### Funnels (userFunnel, itemFunnel)

- **Unit fallback.** With unit `valueUsd`, if any `ok` stage has a null `valueUsd` (section 1 and the alert view), the whole funnel falls back to counts, so one funnel never mixes units. In that case `FunnelSeries.unit` is `"count"`, the unit the numbers are actually in, and the card adds `value-item-view-only`. Refs: Appendix A F6, O3; spec §10 `FunnelSeries`; SPF-01.
- **Applicable stages.** An "applicable" stage is one with `availability: "ok"`. Any other stage gets null `pctPrev`, `pctFirst` and `trackValue`, and is skipped when finding the previous stage. If no stage is `ok`, `firstStageId` is the section's first stage id, because the type cannot be null. Refs: Appendix A F2, F3; spec §10.
- **Where caveat codes sit.**
  - Stage codes stay on their stage:
    - `now-all-time` on 1.1–1.4 and 2.2–2.4
    - `now-open-only` on 2.0–2.4 (2.1–2.4 in the alert view)
    - `build-stamp`, `proxy`, `not-a-conversion`, `low-volume` and `id-space-differs` as the spec places them
  - The breakdown codes `overlap`, `breakdown-open-only`, `escalated-open-only` and `truncated` are card-level only.
  - Refs: instructions §5 rule 5; spec §6.
- **`build-stamp` on 2.1** appears when the window is at most 7 days (`BUILD_STAMP_MAX_WINDOW_DAYS`), in both views. Refs: spec §6; architect A5.
- **actionType groups include write-back event types** whose `eventSource` is an action source. This follows the spec §4 `action_event` predicate literally, and matches what `countEventsBy(action, eventType)` returns for 1.3. Refs: spec §4; Appendix A W2.
- **userFunnel.**
  - Stages for a dimension come from the registry row.
  - `selection.filters` is never read.
  - Breakdowns are always non-additive.
  - The escalated breakdown is two ungrouped `countEvents` calls per stage (true and false). These never trigger `truncated`.
  - Refs: Appendix A registry, F7; spec §9 1.2–1.4; SPF-06.
- **Zero-count groups.** Candidate groups with a count of 0 on the ranking stage are dropped before top-N, so they are neither shown nor counted in `truncated.total`. This applies to item-view alert dims, userFunnel escalated and the alert view. Refs: spec §5 B2; spec §9.0 Truncation; COR-03.
- **Item-view alert dims** (routingPersona, priority, escalated).
  - Candidates come from `countOpenAlertsBy(openAlerts(f), dim)`.
  - 2.1 runs one `countItems` per candidate through the `INNER_CONCURRENCY` limiter.
  - 2.2–2.4 are queried only for the top groups, after 2.1. The spec §11 note "2.2–2.4 in parallel with 2.1" therefore holds for totals only.
  - Candidates with a 0 count on 2.2–2.4 stay as zero entries.
  - Refs: spec §9 2.1, §11; OSD-02.
- **Alert view is a nested funnel.**
  - 2.2–2.4, their groups and both outside paths count only alerts in the 2.1 population: open now, or `closedAt` ≥ window start. Under "now" that means open-now only.
  - The literal spec §9 2.2 plan ("distinct riskAlertId of viewed rows") is narrower; the nesting wins.
  - Cost: the alert view always loads L2 (selected window) and L3 open alerts. Both are memoised, and L3 is shared with 4.5.
  - Refs: spec §1, §9 2.1, §8; Excel 2.2 = 2.1 ∩ …; COR-01.
- **Alert-view grouping.** An alert open now is grouped by its AlertOrderFulfillment row on every stage. A closed alert is grouped by its L2 attrs (latest pipeline event). `escalated` exists only for open alerts; closed alerts go to `other`. Refs: spec §9 2.1 term b, §9 2.2, §12.1; COR-02.
- **Alert-view 2.1.**
  - 2.1 = a + max(0, open − open-with-lifecycle-event). Per group, the same formula is applied to the grouped terms.
  - Under "now" the lifecycle terms are 0 and are not queried.
  - The alert-view `escalated` breakdown is additive, at alert grain.
  - Refs: spec §9 2.1; instructions §8 item 5; Appendix A registry.
- **`truncated` (MAX_GROUPS)** is decided in the derive only:
  - It is set when a grouped call returns exactly `MAX_GROUPS` rows, or when top-N cuts groups.
  - For item-view alert dims it checks the 2.1 candidate list.
  - The synthetic escalated pairs are never checked.
  - Refs: spec §9.0 Truncation; instructions §5 rule 7; MOD-02.
- **`EventGroupField` uses breakdown names** (e.g. `alertType`), not AlertHistory apiNames. Only `source/osdk` maps them to `riskType`, `persona`, `priorityAtEvent` and `eventType`. Refs: instructions §5 rule 2; architect A3.

### Risk (3.1)

- **With an item breakdown**, 3.1 keeps the per-bucket value calls in addition to the 14 grouped calls. Bucket totals and `other` then include items whose dimension value is null. The spec says the grouped calls "replace" them; replacing would drop those items. Refs: spec §9 3.1 cost line; D17; architect A2.
- **Scores outside the ranges.** A score below the first range goes to `b15_30`. A score at or above the last range end goes to `b91_100`. With no ranges configured, every score is `unscored`. The server would count a score ≥ 101 as unscored, by subtraction; real scores lie in 15–100. Ref: spec §9 3.1 note.
- **`$not { otifStatus = Delayed }`** is taken to match rows whose `otifStatus` is null. Ref: spec §9 3.1 ("unverified").
- **`truncated`** is checked only on the `countItemsBy` calls. The `$ranges` groupBy has no `$exactWithLimit` and returns at most 5 rows. Range groups with a count of 0 are omitted, and an empty range list sends no request. Refs: spec §9 3.1, §8; instructions §5 rule 7.
- **The breakdown** is built only when both sides (all, worked) carry groups. The ranking comes from the `all` side. Ref: Appendix A B2.

### Outcome (4.1)

- **Verdict dates.**
  - The date is compared by its UTC calendar date against date-only window bounds, inclusive.
  - A timestamp value is reduced to its UTC date.
  - An empty or unparsable date becomes `null`: the verdict is then outside every window, and the load does not fail.
  - Refs: spec §9 4.1 `dateIn`; instructions §8 item 2; D15.
- **Counting.**
  - `workedN` counts verdict rows, so duplicate rows for one id count twice.
  - `missingVerdict` = distinct worked ids with no verdict row at all.
  - `notWorkedN` and `notWorkedMade` are clamped at 0. No caveat code exists for this.
  - Refs: spec §9 4.1; Appendix A P3.
- **Worked ids.**
  - They come from `fetchItems(workedItems(w))` (ItemRow fields), then are de-duplicated and sorted.
  - If the id fetch is capped, verdicts are still fetched for the capped list, and the card is `partial` + `row-cap`.
  - Refs: spec §9 4.1 step 2; D11; architect A7.
- **The `totals` aggregate** counts as a grouped call for `truncated`: it passes `$exactWithLimit`. The mode used is the loaded `raw.mode`. Breakdown and filters are ignored; `filters-not-applied` is added when filters are set. Refs: spec §9 4.1; Appendix A registry.

### Durations (4.2–4.4) and alert facts

- **Which event gives an alert's attrs.**
  - Closed alert: its latest `closed` event.
  - Not closed (including reopened): its latest `opened` event. If it has none, its latest `closed` event (a reopened alert raised before `PIPELINE_EVENTS_START`).
  - No pipeline event: null attrs.
  - Ties use the spec §4 order. Full ties go to the later event in input order.
  - Refs: Appendix A W6; spec §9.0.1, §4.
- **`salesOrderId` of a fact** = the attrs event's id; otherwise the earliest non-null id among the alert's events; otherwise null. Ref: spec §10 `AlertLifecycleRow`.
- **Timestamps are compared as instants** (`Date.parse`), not as strings. Ref: instructions §5 rule 11.
- **Top-N for duration breakdowns** ranks by alert count over the whole population, including excluded alerts (`noRaise`, `closeBeforeView`). The 4.2 population is worked ∪ not worked. `excluded` lists every reason of the card, including counts of 0. Refs: Appendix A B2; spec §10 `DurationResult`.
- **4.2 not-worked rows** must be `isClosed`, with `closedAt` in the window, and must not be in the L2 ("now") facts. `closedAt` = the latest closed event fetched in the window, which equals the all-time latest because the window ends at now. Refs: spec §9 4.2; Appendix A W5; D2.
- **Items for item-dimension breakdowns.** 4.2–4.4 fetch items only for the population chosen by the same pure function the derive uses. Excluded alerts are part of that population. Refs: spec §9 4.2 ("fetch the population's items"); lead note L5.
- **4.4 edge cases.** When `closedAt == firstViewAt`, the alert is kept at 0 h. An unparsable timestamp counts as `closeBeforeView`. Ref: spec §9 4.4.
- **Pipeline-start caveat.** 4.2 and 4.3 always emit `opened-events-since-pipeline-start`, because spec §9 lists it unconditionally. Ref: spec §9 4.2, 4.3.
- **Quantiles and bins.** A quantile with q ≤ 0 is null. A value below the first bin edge is not binned; negative durations are clamped first and counted in `clampedNegative`. Ref: Appendix A O7.

### Ageing (4.5)

- **Pipeline-start caveat.** 4.5 emits `opened-events-since-pipeline-start` only when the total's `unknownAge > 0`. Refs: spec §9 4.5 "(with `unknownAge`)", §6; SPF-05.
- **Ages.**
  - Every row of the L3 opened-events fetch counts as an `opened` event.
  - Age = (asOf − raisedAt) / day, clamped at 0.
  - The threshold is strict: age > N.
  - Ref: spec §9 4.5.
- **Items.**
  - An item whose open alerts all have unknown age is not in `itemBins`.
  - An item missing from the fetched items, or with a null value, adds value 0 but still counts.
  - `itemBins` is zero-filled on `AGE_EDGES_DAYS`, so it is always present.
  - Refs: spec §9 4.5; Appendix A O6.
- **Window and `asOf`.** The result `window` is the resolved selection window (4.5 does not use it). `asOf` is `now` at load time. Fetching ignores the window. Refs: architect A9; D18.

### Composition (4.6)

- **Without a breakdown**, 4.6 makes no grouped call (`closedTotalByGroup: null`). With a dimension but a null group list, there are no groups and `other` holds everything. Ref: spec §9 4.6.
- **The group of a closed alert** is the `riskType` / `persona` / `priorityAtEvent` of its closed event, from a groupBy. Refs: spec §9 4.6; Appendix A registry.
- **`noHuman` clamping.** A group's `noHuman` count is clamped at 0 when it would be negative. Ref: Appendix A W7.

### Source / OSDK adapter

- **`ofItems(all)` shortcut.** When the item set is all items (no filters), `EventSet`, `OpenAlertSet` and `RiskSet.ofItems` compile to the target's base set rather than a pivot. The two differ only for orphan rows. The fake does the same. Ref: spec §9.0 `events`, `aofSet`, `soeAll` ("without filters, filter X directly").
- **Predicates.** A single-predicate event filter compiles without an `$or` wrapper. Ref: Appendix A S1.
- **Row mapping** (D15).
  - These rows are dropped:
    - an event without `riskAlertId`, without `eventType`, or without a parsable `eventTimestamp`
    - an open alert without `riskAlertId` or `salesOrderId`
    - an item without `salesOrderId`
    - a verdict without `otifOrderId`
  - Other missing fields become `null`.
  - Timestamps are normalised to ISO UTC. A non-finite `valueUsd` becomes `null`.
  - Known effect: an open alert with a null `salesOrderId` is missing from L2's open-now set (OSD-01).
- **Wider selects.** Four row fetches select more columns than the spec's `$select`, because the port has one select tuple per row type. Only bandwidth is affected. Refs: spec §9.0.1, §9 4.1, §9 4.2; OSD-01.
- **Abort checks.** The signal is checked before every aggregate, and between pages and chunks. Ref: Appendix A S10.
- **Placeholders in the adapter.** A placeholder `ALERT_APP_ID` or `VERDICT_DATE_PROPERTY` throws before any request. `loadCard` blocks those cards first, so this never runs in practice. Ref: instructions §8 item 8.
- **Escalated groups** are read with `String(v) === "true"`, so a boolean or a string both work. Null groups are dropped from every groupBy; null and unscored buckets come from subtraction. Refs: spec §5 B3; Appendix A S4; instructions §5 rule 8.
- **Order.** L2 fetches L1, the chain and the open ids concurrently. L2 and not-worked rows are sorted by `riskAlertId`. Grouped results are sorted by the derive, never by the server. Ref: instructions §5 rule 11.
- **Id chunks** use the host's `chunk` from `src/lib/osdk.ts`, on a copy of the id list, with the chunk size at least 1. Refs: instructions §3; STR-01.

### Hooks and provider

- **`loadCard` defaults.** `opts.source` is optional in the public API and defaults to the app's OSDK source (`getDefaultOsdkSource()`). The default source lives in `source/osdk/defaultSource.ts`, because hooks may not import the client. Refs: instructions §7, §4 ("index.ts is the ONLY file the UI imports"), §5 rules 1–2; SPF-04.
- **`MetricsSourceProvider`** is written with `createElement` in a `.ts` file. It is a data provider, not UI. Ref: instructions §2 ("no JSX") vs §7.
- **Provider props.** `config` and `now` are optional, besides `source`. `now` is a `Date` or `() => Date`. The environment is memoised on the identity of `source` and `config` plus the pinned instant, so an inline clock does not restart loads. Refs: instructions §7; TYP-06.
- **While loading.**
  - The hook keeps the previous data only when the previous result was for the same card id.
  - `computedAt` is the previous result's time, or, when there is none, the request time. The request time is also the load's `now`.
  - Refs: instructions §7; spec §10; instructions §5 rule 11; SPF-02.
- **Cached results.** The `window` of a cached result is resolved at its `computedAt`, i.e. the window the loader used. An error result for a raw key is reused for unit and threshold changes of that key. Ref: spec §10 ("from the cache entry, not the render").
- **Semaphore queue order** follows hook mount order. No explicit `MOUNT_ORDER` sort is applied. Ref: spec §11 ("queue order = mount order").
- **`CARDS`** is the keyed record `CARD_META`, not an array. Ref: instructions §7.
- **`useMetricsSelection` updaters queue.** Two updaters in one event both apply. Ref: instructions §7; TYP-02.

## Blocked

There are exactly two config values still equal to `PLACEHOLDER` (`"<to be set at integration>"`) in `src/config/metrics.ts`. `INTEGRATION_KEYS` = `["ALERT_APP_ID", "VERDICT_DATE_PROPERTY"]`.

| Item | Blocks | Result | Unblocked by | Ref |
|---|---|---|---|---|
| `ALERT_APP_ID` | `userFunnel` (whole card) | `blocked`, reason `needs-integration-value` | Set `ALERT_APP_ID` in `src/config/metrics.ts` (the alert app's `AppUsageEvent.appId`) | spec §9 1.1; instructions §8 item 8, §13 rule 3 |
| `VERDICT_DATE_PROPERTY` | `otifOutcome` | `blocked`, reason `needs-integration-value` | Set `VERDICT_DATE_PROPERTY` to `otifOtShipmentEndDate` or `otifFirstInitialDeliveryDateTarget` | spec §14 item 1, §9 4.1; Appendix A V7; instructions §8 item 8 |
| 3.2 `riskMovement` | the card (stub) | `blocked`, reason `not-captured`, caveats `not-captured` | S2: record the OTIF risk score over time | spec §7, §9 3.2 |
| 3.3 `riskCalibration` | the card (stub) | `blocked`, reason `not-captured`, caveats `not-captured`, `delayed-forced-100` | S2 (and the item ↔ verdict link) | spec §7, §9 3.3 |
| 4.7 `rolledValue` | the card (stub) | `blocked`, reason `no-source`, caveats `no-source` | S4: a confirmed rolled-value data source | spec §7, §9 4.7 |
| Stage 1.0 | the stage only; `userFunnel` stays `ok` | stage `availability: "no-source"`, caveat `no-source`; "% of 1.0" is null; `not-applicable` in every group | S1: the directory list of alert-app users and roles | spec §7, §9 1.0; Appendix A F5 |

`VERDICT_ID_LOOKUP = "in"` is not a placeholder, but it must be verified at integration. If neither `$in` nor `$eq` works on `otifOrderId`, 4.1 must be stubbed until the item ↔ verdict link exists (spec §14 item 2; Appendix A V8).
