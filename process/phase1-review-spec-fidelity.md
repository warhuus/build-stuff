# Phase 1 review 1: spec fidelity

Reviewer: Phase 1 Reviewer 1 (spec fidelity). I only report here and did not edit any file.
Binding inputs: Instructions (incl. Appendix A), Spec, and the Excel dump. Precedence: instructions > spec > Excel.

## Verdict

I found no blockers. The phase-1 output follows the spec closely:

- **Caveat codes.** `CAVEATS` in `metricsCodes.ts` has the 33 codes of spec §6, in the same order, with the V4 rename. It has no invented code.
- **Caveat texts.** I compared all 33 `CAVEAT_TEXT` entries with spec §6 using a script. Every text matches exactly.
- **Config values.** `PIPELINE_EVENTS_START`, `DURATION_EDGES_HOURS`, `AGE_EDGES_DAYS`, `RISK_RANGES`, `PAGE_SIZE`, `ROW_CAP`, `MAX_GROUPS`, `BREAKDOWN_MAX_GROUPS`, `ID_BATCH`, `INNER_CONCURRENCY` and `VERDICT_ID_LOOKUP` all match spec §9.0 and Appendix A V1–V8. So do the stage, outside-path and series labels. The placeholders follow instructions §13.3 and V7.
- **Stubs.** The blocked reason, `unblockedBy` and caveats for 3.2, 3.3 and 4.7 match spec §9 word for word.
- **Output types.** The types match spec §10 as amended by O1–O7. `BucketRow.group` is gone and `FunnelBreakdown` is not built. `readonly` modifiers were added and some sub-interfaces were extracted, for example `BreakdownGroup`, `AgeingThreshold` and `AlertAttrs`. Neither change alters the shape.
- **Selection.** `Selection` matches instructions §7 field for field, including its defaults and bounds.
- **Row coverage.** Excel rows 1.0–4.7 all appear in `CARD_META.rows`: 16 first-draft rows and 4 stubs, with no extra card.
- **Query plans.** Every spec §9 plan can be expressed with the specs and the port, including L1–L3 and every item in Appendix A X1.

The findings below are gaps in the documentation and in the assumptions. None of them changes a metric's meaning.

## Findings

| id | severity | file:line | finding | reference | suggested fix |
|---|---|---|---|---|---|
| SF-01 | minor | process/DESIGN.md:42 (A1); src/data/metrics/rawTypes.ts:245 | A1 says that leaving filters out of the 4.1 raw key, and the window out of the 4.5 raw key, gives "the same invalidation as spec §11". That is not literally true. Spec §11 says "A window change re-runs every card" and "A filter change re-runs every card except `userFunnel`". Under A1, 4.5 does not re-run on a window change, so `asOf` and the ages stay stale until `clearMetricsCache()`, and 4.1 does not re-run on a filter change. The metric's meaning is unchanged, because 4.1 ignores filters (R3) and 4.5 does not use the window. However, `AgeingBacklogRaw` extends `RawBase` and so carries a `window`. A cached 4.5 raw will hold the window of the first load. | Spec §11 (cache key, invalidation); instructions §5 rule 10 | Log A1 in QUESTIONS.md as a deliberate deviation from spec §11, not as "the same". State that derive must never read `raw.window` for 4.5 and that `MetricResult.window` comes from `loadCard` step 1. Alternatively, drop `window` from `AgeingBacklogRaw`. Also make sure `filters-not-applied` for 4.1 comes from derive, which DESIGN already does. |
| SF-02 | minor | process/DESIGN.md:30 | The `closureComposition` row lists only `truncated` among its loader caveats. The card consumes L2, which is a paged fetch, so it can hit `ROW_CAP` and must then return `partial` with `row-cap`. The rows for `raisedToFirstView` and `firstViewToClosure`, which use the same L2, do list `row-cap`. | Spec §6 `row-cap` ("any paged fetch that reached ROW_CAP"); instructions §5 rules 5–6 | Add `row-cap` (L) to the closureComposition row, and propagate L2's `capped` flag to every consumer: itemFunnel alert view and 4.2–4.6. |
| SF-03 | minor | process/DESIGN.md:23 | The itemFunnel alert-view row lists "L2 (alertType/routingPersona/priority)" but does not say which window it passes. W4 requires the selected window here. 4.2, 4.4 and 4.6 use "now", and the table states the window explicitly for 4.2–4.6 but not here. | Appendix A W4; spec §9.0.1 "Which window each card passes" | Write "L2(w,f)" in that row. |
| SF-04 | minor | process/DESIGN.md:39 (step 4) | Step 4 of the loadCard flow says what the integration-blocked result returns: reason and `unblockedBy`. It does not say which `caveats` the result carries. Stubs take theirs from `StubMeta.caveats`. The placeholder path has no stated list. | Instructions §8 item 10 (`caveats: [...]`); spec §6 `needs-integration-value` | State `caveats: ["needs-integration-value"]` for the placeholder-blocked result. |
| SF-05 | minor | process/DESIGN.md:41–43 | The Assumptions/Blocked section omits the known deviations of Appendix A P2 a–e. Two further Excel items are not offered and not listed in P2: the section-1 business-line breakdown (Excel says it depends on S1) and the 4.1 "segment by number of alerts touched per item". Spec P2(d) says "all breakdowns on 4.1", which arguably covers the second one only. | Appendix A P2; instructions §8 item 14; §13 rule 2 | Add a "Known deviations (copy of P2 a–e)" list to DESIGN and QUESTIONS.md. Log the section-1 business-line breakdown and the 4.1 alerts-per-item segmentation under "Assumed" as not offered in the first draft. |
| SF-06 | minor | process/DESIGN.md:42 (A2) | A2 keeps the 14 value calls of 3.1 alongside the 14 grouped calls when a breakdown is set. Spec §9 3.1 says the grouped calls "replace" them. The spec's plan is internally inconsistent: it also says that items with a null dimension value land in `other`, and that needs per-bucket total values, which only the value calls provide. A2 is the reading that honours the rule, and it does not change the meaning. The cost rises from 20 to 34 calls with a breakdown. | Spec §9 3.1 (breakdown path, Cost) | Accept A2. Record it in QUESTIONS.md under "Assumed" with the cost impact and the reason: `other` must include items whose dimension value is null. |
| SF-07 | minor | process/DESIGN.md:42 (A7), :25 | A7: for 4.1, the worked ids come from `fetchItems(itemsWithEvent([human],w))`, which returns full `ItemRow`s (7 columns). The spec fetches `["salesOrderId"]` only. Under "now" this is the all-time worked population, so each row costs more bandwidth. The meaning is unchanged. The design correctly passes no filters (R3). | Spec §9 4.1 step 2 | Accept, or add an id-only fetch (e.g. `fetchItemIds(set)`) if Reviewer 2 wants the port narrower. Record the choice in QUESTIONS.md. |
| SF-08 | minor | src/data/metrics/query/specs.ts:109–115 (A3) | A3: `EventGroupField` uses breakdown names (`queueFilter`, `routingPersona`, …) rather than the AlertHistory fields that instructions §6 names (`riskType`, `persona`, `priorityAtEvent`, `eventType`). This departs from the literal wording of instructions §6. It follows instructions §5 rule 2, which keeps apiNames out of non-osdk code, so it is the safer reading. The mapping in the JSDoc is correct. `queueFilter` and `routingPersona` both map to `persona`. That is right because both read the same property on different event subsets. | Instructions §6 (rules for the port) vs §5 rule 2 | Accept. Record the conflict and the resolution in QUESTIONS.md under "Assumed". |
| SF-09 | minor | src/data/metrics/rowTypes.ts:8–18, MetricsSource.ts:238 (A4) | A4: L1 rows are typed `AlertEventRow`, where `eventSource` is nullable. Spec §10 names `HumanEvent` as the L1 row type, and the port never returns `HumanEvent`, which is exported but unused. The meaning is unchanged. | Spec §10 `HumanEvent` ("L1 rows"); §9.0.1 L1 | Accept, but note in the `HumanEvent` JSDoc and in QUESTIONS.md that L1 is served as `AlertEventRow` (or make L1 return `HumanEvent` after a null-check in compute). |
| SF-10 | minor | src/data/metrics/source/MetricsSource.ts:237–242 | `fetchEvents`, `fetchOpenAlerts` and `fetchItems` take any set. Nothing in the types stops a loader from paging raw event history, for example `fetchEvents({kind:"all"})`. The allowed row-fetch list (X2) is enforced only by the doc comment. The instructions' sketch used purpose-named row methods. This is fidelity-relevant because rule 6 is a hard rule. Reviewer 2 owns the question of port width. | Instructions §5 rule 6; Appendix A X2 | Either narrow the port to purpose-named row methods, or keep it generic and add a phase-3 check (test or review item) that every `fetch*` call site matches X2's list. |
| SF-11 | minor | src/config/ (absent) | The error message `breakdown-not-allowed` (instructions §7) has no config constant. Instructions §10 requires every string constant to live in config. | Instructions §7, §10 | Add `BREAKDOWN_NOT_ALLOWED = "breakdown-not-allowed"` to `config/metrics.ts`. |
| SF-12 | minor | process/DESIGN.md (absent) | DESIGN does not mention the `createOsdkSource({ client, sdk })` factory (X5), the S11 / spec §14 integration checks (`isOpen`/`escalated` filterability, `$in` on `otifOrderId`/`riskAlertId`, chained-pivot latency), or the L2 per-alert fallback (spec §9.0.1). These are phase-2 and phase-4 concerns, but the agents build from DESIGN. | Appendix A X5, S11; spec §9.0.1 fallback, §14 | Add one line each: Agent C builds the factory. INTEGRATION.md lists S11 and spec §14 items 1–5. The L2 fallback is left as an integration switch, not built (or say that it is built). |

## Assumptions A1–A10: consistency with the binding documents

| # | Consistent? | Changes a metric's meaning? | Note |
|---|---|---|---|
| A1 | Partly | No | Deviates from the invalidation rules in spec §11. It is not "the same". See SF-01. |
| A2 | Yes (resolves a spec inconsistency) | No | See SF-06. |
| A3 | Yes (resolves a conflict between instructions §6 and §5.2) | No | See SF-08. |
| A4 | Yes | No | See SF-09. |
| A5 | Yes | No | Spec §6 and §9 2.1 list `build-stamp` for 2.1 without restricting the view. "Window ≤ 7 d" applies only to key 7, since "now" is unbounded. |
| A6 | Yes | No | Instructions §6: the fake enforces `maxGroups` by truncation. Rule 7 adds `truncated` only when a call returns exactly `MAX_GROUPS` groups. |
| A7 | Yes | No | See SF-07. Only the fetched columns change. |
| A8 | Yes | No | Instructions §7 (`breakdown-not-allowed`) and §8.10 (blocked, no calls) both still hold. A stub card with any breakdown returns `error`, which is correct because the registry allows no breakdown for stubs. |
| A9 | Yes | No | Spec §10: `MetricResult.window` is the resolved window. |
| A10 | Yes | No | `resolveWindow(key, now)` is pure (instructions §5 rule 4). Placing it on the compute layer is a layering choice; Reviewer 2 should confirm it. |

## Coverage checklist (for the lead)

- **Excel rows 1.0–4.7:** covered. Stubs 1.0 (stage), 3.2, 3.3 and 4.7 follow spec §7 and F5.
- **Spec §9 plans.** Each plan maps to specs and port calls in the DESIGN card table:
  - 1.0–1.4, including escalated through `EventSet.ofOpenAlerts(where escalated)`.
  - 2.0–2.4 in both views: 2.1 alert-view terms a and b, `now` with one call, and outside paths.
  - 3.1: count calls, value calls and breakdown calls.
  - 4.1 through 4.6.
  - L1–L3, including the L2 chained pivot and the touched-and-open ids.
- **Appendix A items:**
  - P2, P3: reflected. P2 still needs listing, see SF-05.
  - O1–O7: reflected.
  - F1–F7: reflected. F4: `ItemViewRaw.outsidePath` is required for both 2.3 and 2.4.
  - Breakdown registry: reflected. `breakdowns.ts` is phase 2, and the DESIGN card table matches the registry.
  - B1–B3: reflected.
  - W1–W7: reflected.
  - V1–V8: exact.
  - S1–S11: reflected in the spec semantics documented on the port. S11 is not yet in DESIGN, see SF-12.
  - X1–X4: reflected.
  - X5, X6: not in DESIGN, see SF-12.
- **Nothing extra:**
  - No extra card, caveat code or breakdown dimension.
  - `AppUsageGroupField` drops the sketch's `region`, which is correct because the registry offers no region breakdown on section 1.
  - The only extra config entries are the fixture helpers `VIEW_EVENT_SOURCE` and `PIPELINE_EVENT_SOURCE`, which are harmless.

## Interface change requests

None.
