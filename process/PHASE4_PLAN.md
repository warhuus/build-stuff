# Phase 4 — lead decisions on every phase-3 finding

Findings files: process/phase3-{correctness,spec-fidelity,modularity,structure,osdk,types,tests}.md. Lead notes L1–L6 in PHASE1_DECISIONS.md.
Decision codes: FIX (agent in brackets) · ACCEPT (no change; record rationale in REVIEW.md / QUESTIONS.md) · DEFER (second draft; record).
The lead AUTHORISES the frozen-file changes listed here (post-freeze changes, recorded in REVIEW.md).

## Correctness
- COR-01 FIX [G1]. Alert view must be a nested funnel (Excel 2.2 = 2.1 ∩ …; spec §8 "open at any point in the window = open now OR has a closed event ≥ start"). Alert view ALWAYS loads L2(selected window) facts and L3 open alerts (both allowed fetches; L3 memo shared with 4.5). 2.2–2.4 and outside paths only count alert ids in the 2.1 population: `openNowIds.has(id) || (fact.closedAt !== null && fact.closedAt >= window.start)`; under "now" (start null) = open now only (existing rule). Groups likewise. Record in QUESTIONS "Assumed" (spec §9 2.2 plan text vs §9 2.1/§1 and Excel; nesting wins).
- COR-02 FIX [G1]. Alert-view alert dims for an alert OPEN now use its L3 AlertOrderFulfillment row (persona/priority/riskType) on every stage; closed alerts use L2 facts attrs (pipeline event). Consistent with 2.1 term b (AOF values). Record in QUESTIONS.
- COR-03 FIX [G1]. Drop zero-count candidate groups before top-N in item view alert dims and in userFunnel escalated (consistent with alert view).

## Spec fidelity
- SPF-01 FIX [G1]. When unit valueUsd falls back to counts, `FunnelSeries.unit` = "count" (the unit the numbers are in) + caveat value-item-view-only. Record in QUESTIONS.
- SPF-02 FIX [G3]. Loading with no previous result: computedAt = ISO of the request time.
- SPF-03 FIX [G3]. index.ts also exports the spec §10 row types and Paged, SourceCtx, Progress (types only).
- SPF-04 / TYP-03 FIX [G3]. `loadCard` public: `opts.source` optional; default = getDefaultOsdkSource(). Implement by index.ts exporting `loadCard` as a thin wrapper that fills the default source (index may import source/osdk per §5.1); the internal loadCard keeps `source` required. Same exported name, same result/cache. Record in QUESTIONS.
- SPF-05 ACCEPT → QUESTIONS "Assumed" (4.5 emits opened-events-since-pipeline-start only when unknownAge > 0).
- SPF-06 FIX [G1] (folded into MOD-02: truncation check only on grouped-call lists; escalated pairs excluded).

## Modularity
- MOD-01 FIX [G3]. Progress: shared/sourceCtx builds a per-fetch-call ctx whose onProgress forwards deltas; loadCard keeps a running total. Remove the matching heuristic. G3 owns shared/sourceCtx.ts for this change.
- MOD-02 FIX [G1]. `truncated` (MAX_GROUPS cap) decided only in derives (via isTruncatedByCap on grouped-call lists; never on synthetic escalated pairs); add to deriveOtifOutcome. Loader envelope carries only row-cap and not-worked-window-cap.
- MOD-03 FIX [G2]. Fake verdict rules reuse compute/otifOutcome (passesGate, verdictOf, inVerdictWindow).
- MOD-04 FIX [G1]. Narrowing guards exported from breakdowns.ts; delete per-loader copies.
- MOD minors: FIX where cheap [G1 compute/loaders/catalogue; G2 source/shared]: escalated label rule once (config ESCALATED_GROUP_LABELS + one helper in compute/dimValues); stage-id lists from config FUNNEL_STAGES; bucket ids from config RISK_BUCKETS; date length via toDateOnly; stats helpers instead of ad-hoc Math.max/reduce; one abort helper (shared/errors.ts abortError; source/osdk and fake import it — allowed? source adapters are rank 3.5 and shared is rank 4 → NOT allowed. Put abortError/throwIfAborted in window.ts? No: create `compute/abort.ts`? compute must be pure (no I/O) — a DOMException factory is pure. Decision: move abortError/isAbortError/throwIfAborted to `compute/abort.ts`; shared/errors.ts re-exports); groupEventsByAlert → groupRows; capGroups → topGroups; hasItemFilters → hasFilters (keep one, in selection.ts); sortedDistinct → compute/stats or dimValues; duplicate id-filter before alertFactsForIds removed; dead code removed (WINDOW_OPTIONS stays — frozen config and it is the spec's window option list; bucketOf stays — spec §12.2 seam "bucketOf shared by 3.1–3.3"; emptyBucketAmounts/sumNullable/clamped removed if unused). MOUNT_ORDER ACCEPT (config documents spec §11 queue order; queue order is mount order by construction). HumanEvent ACCEPT (spec §10 type, exported).
- Test-helper dup (sel ×11, source wrapper ×2) FIX [G4].
- Layering/purity test gaps FIX [G4].

## Structure
- STR-01 FIX [G2]. source/osdk/paging.ts and fake use `chunk` from src/lib/osdk.ts (host helper; pass a copy `[...ids]`).
- STR-02 = TST-01 FIX [G4].
- STR-03 FIX [G4]. Harden scanners (any regex, `export { x as default }`, client import with .js, unranked imports flagged).
- STR-04 FIX [G1]. Provide the §4 names: compute/funnel.ts exports `deriveFunnel` (rename deriveStages), query/build.ts `itemsOpenInWindow` (rename openItemsInWindow — G2 owns query? G1 owns query renames; G2 does not touch query), compute/stats.ts `percent` (rename fraction). Update all call sites.
- STR-05 FIX partially [G2 / G1]: duplicates removed by MOD fixes; remaining same-name different-contract symbols renamed (osdk `riskWhere` → `compileRiskCondition`).
- STR-06 ACCEPT → REVIEW.md lists each added file and why.
- STR-07 FIX [G1]. Stub loader/derive move to loaders/blocked.ts and compute/deriveStub.ts.
- STR-08 FIX [G4]. Test files renamed to mirror sources.
- STR-09 FIX [lead]. tsconfig types → ["node"] only if vitest globals unused (tests import from vitest).
- STR-10 FIX [G1/G2/G3 in their files]. Add spec citations / null behaviour to the listed JSDocs.

## OSDK
- OSD-01 ACCEPT (port frozen; bandwidth only). But the toOpenAlertRow drop on missing salesOrderId: FIX [G2] — keep row with salesOrderId "" ? No: OpenAlertRow.salesOrderId is non-null by spec §10; keep D15 (drop) and record.
- OSD-02 FIX [G1]. Per-candidate 2.1 aggregates run through runLimited(INNER_CONCURRENCY).
- OSD-03 = TST-02 FIX [G4]. planChains.test.ts compiles the real builders.
- verdictsByEq direct fetchPage (structure note) FIX [G2]: route through paging.ts.
- L1 FIX [G2]: capped when rows.length >= ROW_CAP (spec §9.0); flip fetches.test.ts expectations.
- L2 FIX [G2]: compileWhere uses window.ts toDateOnly.

## Types
- TYP-01 FIX [G3] (authorised change to frozen types.ts): MetricResult becomes a discriminated union on status, same field names as spec §10: ok|partial → data required; loading → data optional; blocked → blocked required, data absent; error → error required. computedAt always ISO. Record in REVIEW (instructions §10 "discriminated unions" outranks spec §10 sketch; shape-compatible).
- TYP-02 FIX [G3]. useMetricsSelection updater queues correctly (latest-selection ref updated synchronously).
- TYP-04 FIX [G2]. groupBy.ts implicit any removed.
- TYP-05 FIX [G1 + G2 + G3]. Exhaustive switches (with `never` check) at every BreakdownDimension/CardId dispatch; no negative `isAlertDim`.
- TYP-06 FIX [G3]. Provider memoises its environment on (source, now?.getTime(), config).
- TYP-07 ACCEPT partially: abort surfaces as error "aborted" consistently (G3); error strings stay strings (spec §10 `error?: string`).
- TYP-08 ACCEPT (spec §10 shapes; documented).

## Tests (G4 runs AFTER G1–G3 finish)
- TST-01 FIX: config.test.ts — every Caveat has non-empty CAVEAT_TEXT, every BlockedReason has text, INTEGRATION_UNBLOCKED_BY non-empty, stubs have unblockedBy (spec §13 Config row).
- TST-02 FIX: planChains.test.ts (reuse scratchpad/osdk3/chains.test.ts probe).
- TST-03 FIX: fixture end-to-end derived outputs (bins, median/p90, excluded, threshold tiles, 2.2–2.4 alert view incl. COR-01 nesting, outside paths, 4.6 groups by dim), using process/phase3-correctness.md hand-derived tables (re-derive values that COR-01/02/03 change).
- TST-04..TST-10, TST-12 FIX. TST-11 FIX via unit tests (do NOT change fixtures).
- D20 sweep test FIX.

## File ownership in phase 4 (no agent edits another's files; update the tests of the files you change)
- G1: compute/** (except compute/abort.ts), query/**, loaders/**, catalogue.ts, breakdowns.ts, window.ts, selection.ts (hasFilters only) + their tests.
- G2: source/** (osdk, fake, fixtures — fixtures data must NOT change), compute/abort.ts (new), shared/** except shared/sourceCtx.ts and shared/cache.ts + their tests.
- G3: types.ts (TYP-01 only), loadCard.ts, hooks/**, index.ts, shared/sourceCtx.ts, shared/cache.ts + their tests (__tests__/loadCard*, hooks/, index.test.ts, catalogue.test.ts only if it breaks on their change).
- G4 (after G1–G3): __tests__/** additions and renames, scanners.
- Lead: tsconfig, REVIEW.md. G5 (docs): README.md, INTEGRATION.md, QUESTIONS.md.
If your change breaks a test file owned by another agent (e.g. a loader test depending on derive numbers), you MAY update that test's expectations for values your change legitimately alters, re-deriving them by hand with a working comment; list every such edit in your findings file.
