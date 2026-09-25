# Phase 3 review — Spec fidelity (instructions §12 phase 3 item 2)

Scope: caveat codes, stage-level placement, blocked results, partial status, output shapes, breakdown registry, public API, Selection/URL, useMetric behaviour. The spec (§6, §9, §10), instructions §5, §7, §8 and Appendix A, and decisions D1–D24 were the reference. L1–L6 are not reported again.

## Method
- Read every loader, derive, `loadCard`, `catalogue`, `breakdowns`, `selection`, `index`, hooks and the output/row types.
- Wrote a scratch vitest script (scratchpad `spf/caveats.test.ts`, not in the project). It calls `loadCard` against the fake source with `FIXTURE_CONFIG` for every combination of these:
  - 12 cards;
  - 5 windows;
  - both views of itemFunnel;
  - `null` and each of the 11 dims;
  - both units;
  - filters set and unset.

  It compares the caveat set and status of each result with an expected table built from spec §9 "Caveat codes" and §6 (`truncated`, `row-cap` and the 4.5 `opened-events-…` code were treated as conditional). It also checks:
  - every non-registry dim returns `status: "error"` with the message `breakdown-not-allowed`;
  - all 12 cards under `METRICS_CONFIG` (placeholders unset);
  - `ROW_CAP = 1`, `MAX_GROUPS = 1` and `BREAKDOWN_MAX_GROUPS = 1` for every allowed (card, view, dim).
- Result: **0 missing and 0 extra caveat codes, and 0 status mismatches** over the whole matrix. Every non-registry dim gives `breakdown-not-allowed`.
  - Placeholders block userFunnel and otifOutcome with `needs-integration-value`.
  - The 3.2, 3.3 and 4.7 stubs return the exact spec `reason`, `unblockedBy` and caveats, with no data and no call.
  - `row-cap` sets `partial` on every card that pages. `truncated` appears on a top-N cut and on a `MAX_GROUPS` hit.
- A second probe (`shapes.test.ts`) dumped one result per card to check the shapes (below). A third (`txt.test.ts`) showed that `CAVEAT_TEXT` equals the spec §6 text for all 33 codes, character for character.

## Findings

| id | severity | file:line | finding | evidence | reference | suggested fix |
|---|---|---|---|---|---|---|
| SPF-01 | minor | src/data/metrics/compute/deriveUserFunnel.ts:88-94; compute/deriveItemFunnelAlert.ts:302; compute/funnel.ts:136-150 | Under the unit-`valueUsd` count fallback (section 1 and the alert view), `FunnelSeries.unit` still says `"valueUsd"`. Yet `trackValue`, `pctPrev` and `pctFirst` are all computed on counts. A UI that labels `trackValue` with `series.unit` would show user and alert counts as USD. | Probe: `userFunnel`, unit `valueUsd` → `unit: "valueUsd"`, stage 1.2 `valueUsd: null`, `trackValue: 4` (the 1.1 user count), card caveat `value-item-view-only`. | Appendix A F6 ("falls back to counts"), O3 (`FunnelSeries.unit` set by derive); spec §10 `FunnelStage` ("on the active unit") | When `usesCountFallback` is true, set `FunnelSeries.unit` to `"count"` (the unit actually used) and keep `value-item-view-only`. Otherwise, document in `QUESTIONS.md` that `unit` echoes the selection and `value-item-view-only` means counts. |
| SPF-02 | minor | src/data/metrics/hooks/useMetric.ts:41-46 | When a load has no previous result, the `loading` result has `computedAt: ""`. That is not an ISO-8601 timestamp. | `computedAt: previous?.computedAt ?? ""`. Phase2-F note 7 confirms it. | Instructions §5 rule 11 ("Timestamps are ISO-8601 UTC strings"); spec §10 `MetricResult.computedAt: string` | Use `env.now().toISOString()` (the request time). Otherwise record the empty-string convention in `QUESTIONS.md` and in the `MetricResult` JSDoc. |
| SPF-03 | minor | src/data/metrics/index.ts:169-223 | The barrel does not export the spec §10 row types `HumanEvent`, `AlertEventRow`, `OpenAlertRow`, `ItemRow`, `VerdictRow` and `AlertLifecycleRow`. It does export `MetricsSource`, whose methods use these types. It also leaves out `Paged`, `SourceCtx` and the `query/specs` set types. So a host cannot type a custom or decorated `MetricsSource` from `index.ts`. | `grep` of index.ts: none of the six are exported. §7 asks for "every output type in spec §10" plus "the types they use". | Instructions §7; spec §10 "Row types of the fetches" | Re-export the six row types plus `Paged` and `SourceCtx` (types only). As a minimum, re-export the types reachable from the exported `MetricsSource` and `LoadCardOptions`. |
| SPF-04 | minor | src/data/metrics/loadCard.ts:28-34; index.ts:225-233 | `loadCard` requires `opts.source`, but `index.ts` offers no way to get a `MetricsSource`: it exports neither `createOsdkSource` nor the default source. A non-React caller must therefore import `source/osdk` directly. That breaks "index.ts is the ONLY file the UI imports". The hook path is fine, because the provider defaults to the OSDK source. | Value exports of index.ts are exactly the §7 list, and none of them produces a source. §5 rule 1 already allows `index.ts` to import `source/osdk`. | Instructions §4 (`index.ts` "The ONLY file the UI imports"), §5 rule 1, §7 `loadCard` signature | Lead decision, one of two: (a) re-export `createOsdkSource` from the barrel and note it in `REVIEW.md` as an addition to §7; or (b) default `opts.source` to `getDefaultOsdkSource()`. Record the choice in `QUESTIONS.md`. |
| SPF-05 | minor | src/data/metrics/compute/deriveAgeingBacklog.ts:85 | 4.5 emits `opened-events-since-pipeline-start` only when the total's `unknownAge > 0`. Spec §9 4.5 lists the code as "(with `unknownAge`)", and 4.2 and 4.3 emit it unconditionally. The conditional reading is a decision that has not yet been recorded as an assumption. | Matrix: ageingBacklog under `ROW_CAP = 1` (unknownAge 0) has no code; under the defaults (unknownAge 3) it has the code. Phase2-A2 note 1 states the choice. | Spec §9 4.5 "Caveat codes"; instructions §13 rule 2 | Keep the behaviour, but list it in `QUESTIONS.md` "Assumed" with the spec reference. Or emit it always, which is the safer reading for a card whose population by definition includes pre-pipeline alerts. |
| SPF-06 | minor | src/data/metrics/compute/deriveUserFunnel.ts:113 | Derive re-runs the `MAX_GROUPS` truncation check over `raw.groups` for every stage, including the escalated groups. The loader builds those two rows from two ungrouped counts, and correctly marks them `grouped: false`. So `truncated` is emitted without any grouped call when `MAX_GROUPS === 2`. This is not reachable with the real `MAX_GROUPS = 10_000`, but it contradicts the rule. | Probe: `MAX_GROUPS: 2`, userFunnel escalated → caveats include `truncated`, and `breakdown.truncated` is null. With `MAX_GROUPS` 3 or 5 it is absent. | Spec §9.0 Truncation; instructions §5 rule 7 ("only when a call returns exactly MAX_GROUPS groups") | Drop the derive-side cap check, because `funnelLoaderOutput` already adds `truncated` for real grouped calls. Or skip it when `dimension === "escalated"`. |

No blocker or major findings.

## Verified as matching (no finding)

**Caveats per card (spec §9 / §6)**
- **userFunnel:**
  - on the stages: `no-source` (1.0), `queue-filter-persona` (1.1–1.4), `id-space-differs` (1.2), `low-volume` (1.4), `now-all-time` (1.1–1.4 under now);
  - on the card: `overlap` for every dim, `escalated-open-only`, `filters-not-applied`, `value-item-view-only`, `truncated`.
- **itemFunnel, item view:**
  - on the stages: `proxy` (2.0), `build-stamp` (2.1, 7 days only), `not-a-conversion` (2.3), `low-volume` (2.4), `now-open-only` (2.0–2.4 under now), `now-all-time` (2.2–2.4 under now);
  - with an alert dim: `breakdown-open-only` and `overlap`;
  - with escalated: `escalated-open-only`.
- **itemFunnel, alert view:** the same stage codes without `proxy`, because 2.0 is `not-applicable`. Also `value-item-view-only`, `overlap` only for actionType and writebackType (B10), and `escalated-open-only`.
- **3.1:** `delayed-forced-100`, `unscored-largest`, `truncated`, `now-all-time`.
- **4.1:** `unstratified`, `not-worked-includes-unalerted`, `gate-differs`, `filters-not-applied`, `now-all-time`, `row-cap`.
- **4.2:** `build-stamp`, `opened-events-since-pipeline-start`, `not-worked-window-cap` with `partial` at 30, 90 and now (worked series only, also inside groups), `truncated`, `row-cap`, `now-all-time`.
- **4.3 and 4.4:** exactly as listed in spec §9. `row-cap` is added per D11.
- **4.5:** `no-target-property`, `overlap` under alert dims (escalated included), `truncated`, `row-cap`.
- **4.6:** `closure-actor-unknown`, `precedence`, `truncated`, `now-all-time`.
- No card emits a code that the spec does not list for it. The union is de-duplicated and in spec §6 order (`CAVEAT_ORDER`).

**Blocked results (D13, instructions §8 items 8 and 10)**
- The check order is breakdown-not-allowed, then stub, then placeholder. None of them makes a call.
- The shape is `{ status, blocked: { reason, unblockedBy }, caveats, window, computedAt }`.
- The stub texts are verbatim from spec §9 3.2, 3.3 and 4.7. The stub caveats are `not-captured`, `not-captured` + `delayed-forced-100`, and `no-source`.

**Output shapes (spec §10, O1–O7)**
- **Funnels:**
  - `FunnelStageRaw` has `count` null unless the stage is ok, and `valueUsd` null in section 1 and in the alert view;
  - `outsidePath` appears only on the 2.3 and 2.4 totals and is null inside groups; 2.4 outside is always computed;
  - `firstStageId` is 1.1, 2.0 and 2.1 respectively;
  - `trackValue` and `pctPrev` are null on the first applicable stage;
  - stage 1.0 is `not-applicable` in every group.
- **3.1:** 14 `BucketRow`s in `RISK_BUCKETS` order (worked, then not worked), with `shareOfBucket` per unit.
- **4.2–4.4:** `DurationResult` has 12 zero-filled bins with the last `binEnd` null, `excluded` zero-filled per reason, and O7 quantiles.
- **4.5:** `AgeingBacklog` has 33 zero-filled alert and item bins, `asOf` in ISO, and `pct` over the alerts with known age.
- **4.6:** `CompositionResult` has 4 rows in `CLOSURE_GROUPS` order.
- **All cards:** `window`, `computedAt` (ISO) and `progress` are set.

**Breakdown registry (Appendix A)**
- `breakdowns.ts` matches the table row by row: dims, stages and additive flags.
- B10: actionType and writebackType in the alert view are `additive: false`, `other: null`, with `overlapRatio` on 2.3 or 2.4.
- Groups are chosen once, on the first applicable stage or on the whole population (B2).
- `other` is set only for additive dims. `overlapRatio` is Σ over all groups divided by the first-stage total, and is null for additive dims.
- `truncated` is `{ shown, total }` only on a top-N cut.

**F6 / F7**
- F6: with unit `valueUsd`, section 1 and the alert view fall back to counts and add `value-item-view-only`, in groups too (but see SPF-01).
- F7: section 1 ignores filters. `filters-not-applied` is computed from the selection after the cache. The userFunnel `cacheKey` has no filters part.

**Public API, Selection and hooks**
- `index.ts` value exports are exactly the instructions §7 list.
- The defaults are 30, count, item, empty filters, otif, 30.
- URL keys are `w,u,v,bl,pl,rg,pt,om,n`. Filters are written as repeated params, sorted and de-duplicated. Defaults are omitted, and invalid values fall back to the defaults (probe: `w=8&u=x&n=0` gives the defaults).
- `useMetric` covers every item on the §7 behaviour list: synchronous cached result, loading that keeps the previous data, the semaphore via `loadCard`, a per-instance request id, abort on key change or unmount, errors turned into `status: "error"`, and a refetch on a `useSyncExternalStore` version bump.

## Summary
There are no blockers and no majors. Caveat emission, blocked and partial status, the breakdown registry, the output shapes and the public API all match spec §6, §9, §10, Appendix A and instructions §7 across the full card × window × view × breakdown × unit × filter matrix. The six findings are all minor:
- SPF-01: `FunnelSeries.unit` under the count fallback.
- SPF-02: `computedAt: ""` on a first load.
- SPF-03: the spec §10 row types are missing from the barrel.
- SPF-04: `loadCard` has no source obtainable from the barrel.
- SPF-05: the conditional 4.5 pipeline-start caveat is not recorded in `QUESTIONS.md`.
- SPF-06: a spurious `truncated` from the derive-side cap check on userFunnel escalated, unreachable with the real config.
