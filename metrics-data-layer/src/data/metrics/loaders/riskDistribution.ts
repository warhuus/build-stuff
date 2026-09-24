/**
 * riskDistribution loader, 3.1 current OTIF risk distribution (spec §9 3.1; lead decision D17).
 * Per side (all = `riskAll(f)`, worked = `riskWorked(w, f)`): total count, not-Delayed score-range counts,
 * delayed count, total value and the 6 fetched bucket totals; with an item-dim breakdown additionally one
 * grouped call per bucket (all 7, unscored via its where-clause). Every call is issued in parallel.
 * Unscored count/value, not worked = all − worked and every share are derive's job.
 */
import { RISK_BUCKETS } from "../../../config/metricsCodes";
import { itemsOfRisk, riskAll, riskBucket, riskNotDelayed, riskWorked } from "../query/buildRisk";
import type { RiskSet } from "../query/specs";
import { sourceCtxOf } from "../shared/sourceCtx";
import type { Loader, MetricsSource, SourceCtx } from "../source/MetricsSource";
import type {
  BreakdownDimension,
  FetchedRiskBucket,
  GroupCountValue,
  ItemDim,
  RiskBucketId,
  RiskDistributionRaw,
  RiskSideRaw,
} from "../types";
import { resolveWindow } from "../window";
import { funnelLoaderOutput } from "./funnelLoaderOutput";

/** Item-dim groups of one side: one grouped `countItemsBy` per bucket (spec §9 3.1 `split(b, set, d)`). */
type SideGroups = Readonly<Record<RiskBucketId, readonly GroupCountValue[]>>;

/**
 * Runs `fetch` for the 6 fetched buckets in parallel (spec §9 3.1 `value(b, set)`; unscored by subtraction).
 * @returns the results keyed by bucket.
 */
async function perFetchedBucket<T>(fetch: (b: FetchedRiskBucket) => Promise<T>): Promise<Record<FetchedRiskBucket, T>> {
  const [b15_30, b31_50, b51_70, b71_90, b91_100, delayed] = await Promise.all([
    fetch("b15_30"),
    fetch("b31_50"),
    fetch("b51_70"),
    fetch("b71_90"),
    fetch("b91_100"),
    fetch("delayed"),
  ]);
  return { b15_30, b31_50, b51_70, b71_90, b91_100, delayed };
}

/**
 * Grouped count + value per bucket of one side (spec §9 3.1 breakdown path; all 7 buckets, unscored by its
 * where-clause). Null values of the dim are dropped by the source.
 */
async function sideGroups(set: RiskSet, dim: ItemDim, source: MetricsSource, ctx: SourceCtx): Promise<SideGroups> {
  const split = (b: RiskBucketId) => source.countItemsBy(itemsOfRisk(riskBucket(set, b)), dim, ctx);
  const [unscored, fetched] = await Promise.all([split("unscored"), perFetchedBucket(split)]);
  return { unscored, ...fetched };
}

/**
 * The ungrouped calls of one side (spec §9 3.1: total, byRange, delayed, totalValue, value(b, set)).
 * @returns the side without groups (`groups: null`).
 */
async function sideTotals(set: RiskSet, source: MetricsSource, ctx: SourceCtx): Promise<RiskSideRaw> {
  const [totalCount, rangeCounts, delayedCount, total, bucketTotals] = await Promise.all([
    source.countRisk(set, ctx),
    source.countRiskByScoreRange(riskNotDelayed(set), ctx.config.RISK_RANGES, ctx),
    source.countRisk(riskBucket(set, "delayed"), ctx),
    source.countItems(itemsOfRisk(set), ctx),
    perFetchedBucket((b) => source.countItems(itemsOfRisk(riskBucket(set, b)), ctx)),
  ]);
  return { totalCount, rangeCounts, delayedCount, totalValue: total.valueUsd, bucketTotals, groups: null };
}

/**
 * Loads the 3.1 raw data.
 * @param selection `window` (worked side only; "now" = all-time, Appendix A W3) and `filters` (both sides).
 * @param breakdown an item dim (validated by loadCard) or null; other dims are treated as null.
 * @param deps source, now, signal, config (`RISK_RANGES`, `MAX_GROUPS`).
 * @returns raw `{ window, dimension, all, worked }`; caveat `truncated` when any grouped call returned exactly
 * `MAX_GROUPS` rows. Aggregates only, so status is always "ok". Rejects on source error or abort.
 */
export const loadRiskDistribution: Loader<RiskDistributionRaw> = async (selection, breakdown, deps) => {
  const window = resolveWindow(selection.window, deps.now);
  const dimension = itemDimOf(breakdown);
  const ctx = sourceCtxOf(deps, deps.signal);
  const sets = [riskAll(selection.filters), riskWorked(window, selection.filters)] as const;
  const [allTotals, workedTotals, allGroups, workedGroups] = await Promise.all([
    sideTotals(sets[0], deps.source, ctx),
    sideTotals(sets[1], deps.source, ctx),
    dimension === null ? null : sideGroups(sets[0], dimension, deps.source, ctx),
    dimension === null ? null : sideGroups(sets[1], dimension, deps.source, ctx),
  ]);
  const raw: RiskDistributionRaw = {
    window,
    dimension,
    all: { ...allTotals, groups: allGroups },
    worked: { ...workedTotals, groups: workedGroups },
  };
  const grouped = [allGroups, workedGroups].flatMap((g) => (g === null ? [] : RISK_BUCKETS.map((b) => g[b])));
  return funnelLoaderOutput(raw, { capped: false, grouped }, deps.config);
};

/** The breakdown as an item dim (3.1 allows item dims only; registry in `breakdowns.ts`). */
function itemDimOf(breakdown: BreakdownDimension | null): ItemDim | null {
  switch (breakdown) {
    case "businessLine":
    case "productLine":
    case "region":
    case "plant":
      return breakdown;
    default:
      return null;
  }
}
