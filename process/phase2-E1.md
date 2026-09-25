# Phase 2 — Agent E1 (userFunnel, itemFunnel loaders)

## Built
Source (`src/data/metrics/loaders/`):
- `userFunnel.ts` — `loadUserFunnel: Loader<UserFunnelRaw>`. 1.1 `countAppUsers(w)`; 1.2–1.4 `countEvents(events([viewed|action|writeback], w, EMPTY_FILTERS), "actor")`. With a dim, only the stages in `stagesForDim("userFunnel", …)`: 1.1 `countAppUsersBy(w, "queueFilter")`; queueFilter / alertType / actionType / writebackType `countEventsBy(stageEvents, "actor", dim)`; escalated two `countEvents(escalatedEvents(v, [pred], w), "actor")` per stage, labelled with `config.ESCALATED_GROUP_LABELS` (both groups always present, including a count of 0). Every call runs in parallel. Item filters are never read.
- `itemFunnel.ts` — `loadItemFunnel: Loader<ItemFunnelRaw>`. Picks the view loader from `selection.view` (D21 split).
- `itemFunnelItemView.ts` — `loadItemView(selection, breakdown, deps)`. Makes 7 `countItems` calls: so20…so24, outside23 and outside24 from `itemFunnelSets`. Item dims: `countItemsBy` on each of the 5 stages. Alert dims (routingPersona, priority, escalated): candidates come from `countOpenAlertsBy(openAlerts(f), dim)`. 2.1 then runs `countItems(stageWithOpenAlertWhere(so21, f, cond))` for every candidate. The candidates are ranked with `compute/breakdown.topGroups(…, BREAKDOWN_MAX_GROUPS)`, and 2.2–2.4 are queried only for the top groups. 2.0 does not appear in the groups. For escalated, the condition value is `group === ESCALATED_GROUP_LABELS.true`. The totals run in parallel with the group chain.
- `itemFunnelAlertView.ts` — `loadAlertView(...)`. The carried terms come from `carriedAlertSets`. Under "now" only `countOpenAlerts(open)` is called, and both lifecycle terms are set to 0. With a window, it calls `countEvents(life, "alert")` plus 2 × `countOpenAlerts`. Grouped terms:
  - alertType, routingPersona, priority: `countEventsBy(life, "alert", dim)` and `countOpenAlertsBy` on open and openWithLifecycle. Under "now" only the open term is queried and the other two are `[]`.
  - escalated: `countOpenAlertsBy(open, "escalated")` only.
  - actionType, writebackType: `carriedGroups` is null.

  `humanEvents` = L1(selected window, f).rows. `facts` = L2(selected window, f) for the three attribute dims only (D12). `openAlerts` = L3 alerts only under "now" or with escalated. `capped` from any L1/L2/L3 result sets status "partial" with `row-cap`.
- `funnelLoaderOutput.ts` (helper) — `funnelLoaderOutput(raw, { capped, grouped }, config)`. Returns the envelope, adding `truncated` when any grouped call returned `MAX_GROUPS` rows (`isTruncatedByCap`). Pairs that are synthesised from two `countEvents` calls (userFunnel escalated) never count toward truncation. Note: `loaders/riskDistribution.ts` (another agent) also imports this helper.

Tests (`__tests__/loaders/`), 49 tests, 100% lines and functions on my five files:
- `userFunnel.test.ts`: every window; each of the 5 dims; AMER vs no filter gives identical `calls` and output for every dim; truncated; an end-to-end check with `deriveUserFunnel`.
- `itemFunnelItemView.test.ts`: every window with full totals and outside paths, plus the exact call args; AMER 7 d; the 4 item dims at 7 d, every stage; truncated.
- `itemFunnelItemAlertDims.test.ts`: routingPersona at 7 d; priority at now; top-N with `BREAKDOWN_MAX_GROUPS = 2`; escalated at 7 d with AMER; truncated; end to end with `deriveItemFunnel`.
- `itemFunnelAlertView.test.ts`: every window (terms, L1, which calls were made); priority at 7 d with AMER; alertType at 7 d; routingPersona at now; escalated at 7 d; actionType at 7 d; writebackType at 90 d; row-cap and truncated; end to end (2.1 = 57).

tsc, eslint, and the layering and structure tests all pass.

## Hand-checked fixture values (the working is in the test comments)
- **userFunnel** users per stage (1.1 / 1.2 / 1.3 / 1.4):

  | Window | 1.1 | 1.2 | 1.3 | 1.4 |
  |---|---|---|---|---|
  | 7 d | 3 | 5 | 5 | 1 |
  | 14 d | 4 | 5 | 5 | 3 |
  | 30 d | 4 | 5 | 5 | 4 |
  | 90 d | 5 | 6 | 6 | 5 |
  | now | 6 | 6 | 6 | 5 |

  Groups at 7 d:
  - 1.2 escalated: true 1, false 4. 1.3: true 0, false 5.
  - 1.2 alertType: LateGI 4, CreditBlock 2, Allocation 1.
  - 1.3 actionType: status_changed 4, deeplink_clicked 1, delivery_block_removed 1.
- **Item view** (count / kUSD) for 2.0, 2.1, 2.2, 2.3, 2.4, then outside 2.3 and outside 2.4:

  | Window | 2.0 | 2.1 | 2.2 | 2.3 | 2.4 | Outside 2.3 | Outside 2.4 |
  |---|---|---|---|---|---|---|---|
  | 7 d | 31/472 | 29/414 | 11/196 | 7/135 | 1/25 | 3/27 | 0 |
  | 14 d | 32/505 | 30/447 | 16/258 | 10/188 | 4/78 | 3/27 | 0 |
  | 30 d | 34/577 | 32/519 | 17/296 | 12/214 | 5/87 | 6/94 | 1/12 |
  | 90 d | 36/651 | 34/593 | 24/485 | 17/333 | 7/134 | 5/87 | 0 |
  | now | 30/436 | 27/351 | 20/281 | 15/234 | 6/99 | 3/52 | 0 |
  | AMER 7 d | 10/262 | 8/204 | 4/102 | 3/78 | 1/25 | 0 | 0 |

  routingPersona at 7 d, 2.1: Planner 18/220, Logistics 12/161, CustomerService 11/121.
- **Alert view** carried terms (a, open, open∩a):

  | Window | a | open | open∩a |
  |---|---|---|---|
  | 7 d | 27 | 48 | 18 |
  | 14 d | 38 | 48 | 24 |
  | 30 d | 48 | 48 | 31 |
  | 90 d | 64 | 48 | 43 |
  | now | 0 | 48 | 0 |
  | AMER 7 d | 9 | 12 | 3 |

  So 2.1 at 7 d = 57. alertType at 7 d:
  - a: LateGI 16, Allocation 7, CreditBlock 4.
  - open: LateGI 21, CreditBlock 14, Allocation 13.
  - open∩a: LateGI 10, Allocation 6, CreditBlock 2.

## Decisions / assumptions (for QUESTIONS.md "Assumed")
1. Item-view alert dims (spec §9 2.1): raw 2.1 groups follow the order the candidate call returned them. 2.2–2.4 groups follow the `topGroups` order. A candidate whose count is 0 on 2.1 is kept in the raw data and ranked last. Candidates with a zero count on 2.2–2.4 stay as `{count: 0, valueUsd: 0}` entries.
2. userFunnel escalated (spec §9 1.2–1.4): both the "true" and "false" groups are always returned, even when a count is 0, because they come from two ungrouped calls. They never trigger `truncated`.
3. Spec §11 says "2.2–2.4 are issued in parallel with 2.1". Totals are issued in parallel with 2.1. For alert dims, the 2.2–2.4 group calls must wait for the 2.1 per-candidate results, because they need the top-N.
4. userFunnel reads the stage list for a dim from the registry's userFunnel row (it is the same for both views). `selection.filters` is never read (R3). The `filters-not-applied` caveat is added by derive.
5. Alert view under "now": `carriedGroups.openWithLifecycleEvent` and `.lifecycleAlerts` are `[]` (not queried). `carried` lifecycle terms are 0 (rawTypes doc).

## Interface change requests
None.

## Notes for other agents / lead
- Shared-loader memos are keyed without config (D2 note 1). The alert-view tests call `clearMetricsCache()` in `beforeEach` and use config overrides only in fresh runs.
- `funnelLoaderOutput.ts` overlaps with `loaderEnvelope` in `alertCardWiring.ts` (written at the same time by another agent). `riskDistribution.ts` imports mine. In phase 4 they could be merged into one helper; `loaderEnvelope` takes a `truncated` flag and mine takes the grouped rows.

## Unfinished
Nothing.
