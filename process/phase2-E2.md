# Phase 2 — Agent E2 (loaders riskDistribution, otifOutcome, blocked helpers) findings

## Built
Source (`src/data/metrics/loaders/`):
- `riskDistribution.ts` — `loadRiskDistribution: Loader<RiskDistributionRaw>` (spec §9 3.1, D17). Per side (all = `riskAll(f)`, worked = `riskWorked(w, f)`), all in one parallel batch: `countRisk(set)`, `countRiskByScoreRange(riskNotDelayed(set), config.RISK_RANGES)`, `countRisk(riskBucket(set,"delayed"))`, `countItems(itemsOfRisk(set))` → `totalValue`, `countItems(itemsOfRisk(riskBucket(set,b)))` for the 6 fetched buckets → `bucketTotals`. With an item dim: + `countItemsBy(itemsOfRisk(riskBucket(set,b)), dim)` for all 7 buckets (unscored via the UNSCORED where) per side. Calls: 4 countRisk + 2 range + 14 countItems (+14 countItemsBy with a breakdown); no row fetches. `truncated` when any countItemsBy returns MAX_GROUPS rows. 109 lines.
- `otifOutcome.ts` — `loadOtifOutcome: Loader<OtifOutcomeRaw>` (spec §9 4.1). `countVerdictsBy({mode: selection.otifMode, window})` ∥ (`fetchItems(workedItems(w))` → sorted distinct salesOrderIds → `fetchVerdictsByIds(ids)`). Filters ignored (R3). `row-cap` + partial when the id fetch or the verdict lookup is capped; `truncated` if the totals aggregate returns MAX_GROUPS groups. 60 lines.
- `blocked.ts` — `stubBlocked(cardId): BlockedCard | null` (from `CARD_META[id].stub`; null for first-draft cards) and `integrationBlock(cardId, config): BlockedCard | null` (`{reason: "needs-integration-value", unblockedBy: INTEGRATION_UNBLOCKED_BY[key], caveats: ["needs-integration-value"]}` for the first key of `CARD_META[id].requires` with `config[key] === config.PLACEHOLDER`). `BlockedCard = BlockedInfo & { caveats }`. Pure.
- Both loaders reuse E1's generic `loaders/funnelLoaderOutput.ts` (`funnelLoaderOutput(raw, {capped, grouped}, config)`) instead of duplicating the envelope logic. If E1 renames it, the two imports need updating (suggest renaming to `loaderOutput.ts` since it is card-agnostic).

Tests (`__tests__/loaders/`): `riskDistribution.test.ts` (12: windows 7/30/now, AMER, each of the 4 item dims, non-item dim → none, truncated, abort, derive end-to-end), `otifOutcome.test.ts` (10: 7 d otif + crit, 30 d and now both modes, AMER filter → identical calls/raw, VERDICT_ID_LOOKUP "eq", row cap, truncated, abort, derive end-to-end), `blocked.test.ts` (8). 30 tests pass; 100 % stmts/branches/functions/lines on the three files; tsc and eslint clean on my files; layering test passes. (structure.test currently fails only on another agent's `__tests__/loaders/raisedToClosed.test.ts: any`.)

## Hand-checked fixture values (working in the test comments)
- 3.1 all (no filter): 30 items / 436000; buckets unscored 8 (148k), b15_30 5 (62k), b31_50 4 (57k), b51_70 4 (40k, I29 null value), b71_90 3 (46k), b91_100 3 (43k), delayed 3 (40k); ranges 5/4/4/3/3.
- 3.1 worked open items: 7 d 13 (I2 I7 I9 I10 I11 I13 I15 I17 I18 I19 I21 I24 I25) / 191000, no delayed; 30 d 20 / 287000 (+I6 I12 I14 I16 I22 I26 I29); now 23 / 333000 (+I3 I20 I23; not worked I1 I4 I5 I8 I27 I28 I30).
- 3.1 AMER: all 9 / 226000 (one item per scored bucket + delayed, unscored I24 I27 I30); worked 7 d 3 / 70000 (I21 I24 I25).
- 4.1 worked ids: 7 d 16, 30 d 26, now 32 (includes closed items); verdict rows 6 / 7 / 8 (1009 1011 1015 1025 1032 1040, +1038, +1031). Totals otif 7 d 5/1, 30 d 5/3, now 7/3; crit 7 d 6/1, 30 d 7/2, now 8/3. Derive 7 d otif: worked 2/2, not worked 4/3, missingVerdict 10.

## Decisions / assumptions (for QUESTIONS.md "Assumed")
1. 3.1 `truncated` is checked on the `countItemsBy` calls only; the `$ranges` groupBy has no `$exactWithLimit` (spec §9 3.1, §8) and returns ≤ 5 rows.
2. 3.1 with a non-item breakdown (should never reach the loader; loadCard validates) is treated as no breakdown (`dimension: null`).
3. 4.1 `totals` counts as a grouped call for `truncated` (it uses `$exactWithLimit: MAX_GROUPS`, spec §9 4.1).
4. 4.1 worked ids are de-duplicated and sorted (`sortedDistinct`) before the verdict lookup (deterministic call args). When the id fetch is capped, verdicts are still fetched for the capped id list and the card is partial (D11).
5. 4.1 ignores `breakdown` (registry: none allowed); `dimension` is always null.
6. `stubBlocked` returns null (rather than throwing) for first-draft cards so loadCard can chain `stubBlocked(id) ?? integrationBlock(id, config)`.

## Interface change requests
None.

## Unfinished
Nothing.
