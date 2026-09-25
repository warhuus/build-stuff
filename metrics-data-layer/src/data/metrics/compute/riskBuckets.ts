/**
 * 3.1 risk buckets (spec §9 3.1, §9.0 `RISK_RANGES`, §2 glossary; Appendix A O5): bucket of a score,
 * range ↔ bucket mapping, per-side bucket totals with unscored by subtraction, and the 14 zero-filled
 * `BucketRow`s with `shareOfBucket`. Pure; ranges and the Delayed status come from `config` (D1).
 */
import { RISK_BUCKETS, SCORED_BUCKETS } from "../../../config/metrics";
import type { MetricsConfig } from "../../../config/metrics";
import type { BucketRow, CountValue, GroupCount, GroupCountValue, RiskBucketId, RiskSideRaw, Unit } from "../types";
import { remainder, safeDivide, sum } from "./stats";

/** A scored bucket (b15_30 … b91_100). */
export type ScoredBucketId = (typeof SCORED_BUCKETS)[number];

/** One `[start, end)` score range and its bucket. */
export interface ScoredRange {
  readonly bucket: ScoredBucketId;
  readonly start: number;
  readonly end: number;
}

/** Count and value (USD) per bucket, all seven buckets present. */
export type BucketAmounts = Readonly<Record<RiskBucketId, CountValue>>;

/** Per-bucket grouped rows of one side (`RiskSideRaw.groups`). */
export type BucketGroups = Readonly<Record<RiskBucketId, readonly GroupCountValue[]>>;

const ZERO: CountValue = { count: 0, valueUsd: 0 };

/**
 * `config.RISK_RANGES` zipped with `SCORED_BUCKETS` (index-aligned, spec §9.0): b15_30 = [0, 31), …,
 * b91_100 = [91, 101). Extra entries on either side are ignored.
 */
export function rangesFromConfig(config: MetricsConfig): ScoredRange[] {
  return SCORED_BUCKETS.flatMap((bucket, index) => {
    const range = config.RISK_RANGES[index];
    return range ? [{ bucket, start: range[0], end: range[1] }] : [];
  });
}

/**
 * Bucket of one item (spec §9 3.1): otifStatus Delayed → `delayed` whatever the score (spec §2); null
 * score → `unscored`; else the `[start, end)` range holding it (15 and 30 → b15_30, 31 → b31_50,
 * 100 + At Risk → b91_100). A score below the first range lands in the first bucket (spec §9 3.1 note);
 * a score at or above the last end (outside the 15–100 domain) lands in the last bucket. No configured
 * ranges → `unscored`.
 */
export function bucketOf(score: number | null, otifStatus: string | null, config: MetricsConfig): RiskBucketId {
  if (otifStatus === config.OTIF_STATUS_DELAYED) return "delayed";
  if (score === null) return "unscored";
  const ranges = rangesFromConfig(config);
  const hit = ranges.find((range) => score >= range.start && score < range.end);
  if (hit) return hit.bucket;
  if (ranges.length === 0) return "unscored";
  const belowAll = ranges.every((range) => score < range.start);
  return (belowAll ? ranges[0] : ranges[ranges.length - 1]).bucket;
}

/** Scored bucket whose range starts at `start` (a `$ranges` group's `startValue`, spec §8), else null. */
export function bucketOfRangeStart(start: number, config: MetricsConfig): ScoredBucketId | null {
  return rangesFromConfig(config).find((range) => range.start === start)?.bucket ?? null;
}

/**
 * Bucket amounts from (bucket, amount) entries, zero for absent buckets. The literal record lists every
 * `RiskBucketId`, so a new bucket in `config.RISK_BUCKETS` fails to compile here until it is added.
 */
function fromEntries(entries: readonly (readonly [RiskBucketId, CountValue])[]): BucketAmounts {
  const amounts: Record<RiskBucketId, CountValue> = {
    unscored: ZERO, b15_30: ZERO, b31_50: ZERO, b51_70: ZERO, b71_90: ZERO, b91_100: ZERO, delayed: ZERO,
  };
  for (const [bucket, amount] of entries) amounts[bucket] = amount;
  return amounts;
}

/**
 * Bucket totals of one 3.1 side (spec §9 3.1): scored counts from the `$ranges` rows (missing ranges
 * zero-filled, unknown starts ignored), delayed from its count call, values from the per-bucket value
 * calls; unscored count = total − Σ ranges − delayed and unscored value = total value − Σ bucket values,
 * both clamped at 0 (nulls are dropped by groupBy, instructions §5 rule 8).
 */
export function riskSideTotals(side: RiskSideRaw, config: MetricsConfig): BucketAmounts {
  const countOf = (bucket: ScoredBucketId): number =>
    sum(side.rangeCounts.filter((row) => bucketOfRangeStart(row.startValue, config) === bucket).map((row) => row.count));
  const scored = SCORED_BUCKETS.map((bucket): [RiskBucketId, CountValue] => [
    bucket,
    { count: countOf(bucket), valueUsd: side.bucketTotals[bucket].valueUsd },
  ]);
  const delayed: CountValue = { count: side.delayedCount, valueUsd: side.bucketTotals.delayed.valueUsd };
  const unscored: CountValue = {
    count: remainder(side.totalCount, [...scored.map(([, amount]) => amount.count), delayed.count]),
    valueUsd: remainder(side.totalValue, [...scored.map(([, amount]) => amount.valueUsd), delayed.valueUsd]),
  };
  return fromEntries([...scored, ["delayed", delayed], ["unscored", unscored]]);
}

/** One breakdown group's amounts per bucket from grouped rows (absent group → zero). Spec §9 3.1. */
export function bucketAmountsOfGroup(groups: BucketGroups, group: string): BucketAmounts {
  return fromEntries(
    RISK_BUCKETS.map((bucket) => {
      const row = groups[bucket].find((entry) => entry.group === group);
      return [bucket, row ? { count: row.count, valueUsd: row.valueUsd } : ZERO];
    }),
  );
}

/**
 * Per-bucket `other` of an additive item-dim breakdown: bucket total − Σ shown groups, clamped at 0
 * (items with a null dimension value land here). Spec §9 3.1.
 */
export function bucketAmountsOutside(totals: BucketAmounts, groups: BucketGroups, shown: readonly string[]): BucketAmounts {
  return fromEntries(
    RISK_BUCKETS.map((bucket) => {
      const inShown = groups[bucket].filter((row) => shown.includes(row.group));
      return [
        bucket,
        {
          count: remainder(totals[bucket].count, inShown.map((row) => row.count)),
          valueUsd: remainder(totals[bucket].valueUsd, inShown.map((row) => row.valueUsd)),
        },
      ];
    }),
  );
}

/** Ranking for top-N: each group's count summed over all buckets (spec §9 3.1), unsorted. */
export function groupTotalsAcrossBuckets(groups: BucketGroups): GroupCount[] {
  const totals = new Map<string, number>();
  for (const bucket of RISK_BUCKETS) {
    for (const row of groups[bucket]) totals.set(row.group, (totals.get(row.group) ?? 0) + row.count);
  }
  return [...totals].map(([group, count]) => ({ group, count }));
}

/** Amount of a row in the active unit (valueUsd null → null). */
function amountIn(row: BucketRow, unit: Unit): number | null {
  return unit === "count" ? row.count : row.valueUsd;
}

/**
 * Sets `shareOfBucket` on every row: row amount / Σ amounts of the rows of the same bucket, in `unit`
 * (Appendix A O5: worked share = "% worked within each bucket"). Null when the bucket sums to 0 or the
 * row's value is null.
 */
export function shareOfBucket(rows: readonly BucketRow[], unit: Unit): BucketRow[] {
  return rows.map((row) => {
    const peers = rows.filter((peer) => peer.bucket === row.bucket).map((peer) => amountIn(peer, unit) ?? 0);
    return { ...row, shareOfBucket: safeDivide(amountIn(row, unit), sum(peers)) };
  });
}

/**
 * The 14 zero-filled 3.1 rows (7 buckets in `RISK_BUCKETS` order × worked true then false) with
 * `shareOfBucket` in `unit`. Not worked = all − worked per bucket, count and value, never negative.
 * Spec §9 3.1, instructions §9.
 */
export function bucketRows(all: BucketAmounts, worked: BucketAmounts, unit: Unit): BucketRow[] {
  const rows = RISK_BUCKETS.flatMap((bucket): BucketRow[] => [
    { bucket, worked: true, count: worked[bucket].count, valueUsd: worked[bucket].valueUsd, shareOfBucket: null },
    {
      bucket,
      worked: false,
      count: remainder(all[bucket].count, [worked[bucket].count]),
      valueUsd: remainder(all[bucket].valueUsd, [worked[bucket].valueUsd]),
      shareOfBucket: null,
    },
  ]);
  return shareOfBucket(rows, unit);
}
