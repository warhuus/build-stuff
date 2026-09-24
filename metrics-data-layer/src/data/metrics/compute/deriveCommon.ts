/**
 * Helpers shared by the card derives (instructions §5 rule 5): conditional caveats, the `truncated`
 * rule (spec §9.0 Truncation) and the client-side additive breakdown over fetched rows (spec §9
 * 4.2–4.5, decision D9). Pure.
 */
import type { MetricsConfig } from "../../../config/metrics";
import type { BreakdownDimension, BreakdownResult, Caveat, WindowKey } from "../types";
import { buildBreakdown, groupCountsOf, groupRows, isTruncatedByCap, rowsOutside } from "./breakdown";

/** `caveats` when `condition` holds, else `[]`. */
export function caveatsIf(condition: boolean, caveats: readonly Caveat[]): readonly Caveat[] {
  return condition ? caveats : [];
}

/** `caveats` under the `"now"` window (e.g. `now-all-time`, spec §6), else `[]`. */
export function caveatsIfNow(windowKey: WindowKey, caveats: readonly Caveat[]): readonly Caveat[] {
  return caveatsIf(windowKey === "now", caveats);
}

/**
 * `truncated` (spec §9.0 Truncation, §6) when the breakdown's top-N cut groups or any grouped server
 * result in `grouped` returned exactly `config.MAX_GROUPS` rows (`isTruncatedByCap`); absent lists
 * (null / undefined) are skipped. Otherwise `[]`.
 */
export function truncationCaveats(
  breakdown: BreakdownResult<unknown> | null,
  grouped: readonly (readonly unknown[] | null | undefined)[],
  config: MetricsConfig,
): readonly Caveat[] {
  const capped = grouped.some((rows) => rows !== null && rows !== undefined && isTruncatedByCap(rows, config));
  return caveatsIf(capped || (breakdown !== null && breakdown.truncated !== null), ["truncated"]);
}

/**
 * Additive breakdown over fetched rows (spec §9 4.2–4.5; decision D9): groups by `keyOf` (null key →
 * outside every group), top `config.BREAKDOWN_MAX_GROUPS` by row count over the whole population
 * (spec §5 B2), each group's data = `dataOf(its rows)`, `other` = `dataOf(rows outside the shown groups)`
 * (including null keys). `overlapRatio` null.
 */
export function additiveRowBreakdown<R, T>(
  rows: readonly R[],
  dimension: BreakdownDimension,
  keyOf: (row: R) => string | null,
  dataOf: (rows: readonly R[]) => T,
  config: MetricsConfig,
): BreakdownResult<T> {
  return buildBreakdown(
    {
      dimension,
      additive: true,
      ranking: groupCountsOf(groupRows(rows, keyOf)),
      dataOf: (group) => dataOf(rows.filter((row) => keyOf(row) === group)),
      otherOf: (shown) => dataOf(rowsOutside(rows, keyOf, shown)),
    },
    config,
  );
}
