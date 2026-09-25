/**
 * Derive of the 3.1 current OTIF risk distribution card (spec §9 3.1; Appendix A O1, O3, O5). Pure.
 * 14 rows (7 buckets × worked), not worked = all − worked; `shareOfBucket` in the selected unit.
 */
import { METRICS_CONFIG, RISK_BUCKETS } from "../../../config/metrics";
import type { MetricsConfig } from "../../../config/metrics";
import type { BreakdownResult, BucketRow, Derive, ItemDim, RiskDistributionRaw, Unit } from "../types";
import { buildBreakdown } from "./breakdown";
import { mergeCaveats } from "./caveats";
import { caveatsIfNow, truncationCaveats } from "./deriveCommon";
import {
  bucketAmountsOfGroup,
  bucketAmountsOutside,
  bucketRows,
  groupTotalsAcrossBuckets,
  riskSideTotals,
} from "./riskBuckets";
import type { BucketAmounts, BucketGroups } from "./riskBuckets";

/** Grouped rows of both sides, present only with a breakdown. */
interface SideGroups {
  readonly all: BucketGroups;
  readonly worked: BucketGroups;
}

/**
 * 3.1 item-dim breakdown (spec §9 3.1): additive; top-N by each group's total count over all buckets
 * (all side); group g = 14 rows of g's per-bucket amounts; `other` = per-bucket total − Σ shown groups
 * (items with a null dimension value land there), per side.
 */
function riskBreakdown(
  dimension: ItemDim,
  groups: SideGroups,
  totals: { readonly all: BucketAmounts; readonly worked: BucketAmounts },
  unit: Unit,
  config: MetricsConfig,
): BreakdownResult<readonly BucketRow[]> {
  return buildBreakdown<readonly BucketRow[]>(
    {
      dimension,
      additive: true,
      ranking: groupTotalsAcrossBuckets(groups.all),
      dataOf: (group) =>
        bucketRows(bucketAmountsOfGroup(groups.all, group), bucketAmountsOfGroup(groups.worked, group), unit),
      otherOf: (shown) =>
        bucketRows(
          bucketAmountsOutside(totals.all, groups.all, shown),
          bucketAmountsOutside(totals.worked, groups.worked, shown),
          unit,
        ),
    },
    config,
  );
}

/** Every grouped server result of one side (7 buckets), for the MAX_GROUPS truncation check. */
function groupedLists(groups: BucketGroups | null): readonly (readonly unknown[])[] {
  return groups === null ? [] : RISK_BUCKETS.map((bucket) => groups[bucket]);
}

/**
 * 3.1 derive (spec §9 3.1): total = `bucketRows(all, worked, unit)` from `riskSideTotals` of both sides; with a dim and
 * both sides' groups, the additive `riskBreakdown`. Caveats: `delayed-forced-100`, `unscored-largest`
 * (always); `truncated` when top-N cut groups or a grouped call returned `MAX_GROUPS` rows; `now-all-time`
 * under "now".
 */
export const deriveRiskDistribution: Derive<RiskDistributionRaw, readonly BucketRow[]> = (
  raw,
  selection,
  config = METRICS_CONFIG,
) => {
  const totals = { all: riskSideTotals(raw.all, config), worked: riskSideTotals(raw.worked, config) };
  const allGroups = raw.all.groups;
  const workedGroups = raw.worked.groups;
  const breakdown =
    raw.dimension !== null && allGroups !== null && workedGroups !== null
      ? riskBreakdown(raw.dimension, { all: allGroups, worked: workedGroups }, totals, selection.unit, config)
      : null;
  return {
    data: { total: bucketRows(totals.all, totals.worked, selection.unit), breakdown },
    caveats: mergeCaveats(
      ["delayed-forced-100", "unscored-largest"],
      truncationCaveats(breakdown, [...groupedLists(allGroups), ...groupedLists(workedGroups)], config),
      caveatsIfNow(raw.window.key, ["now-all-time"]),
    ),
  };
};
