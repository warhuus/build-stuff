/**
 * Histogram bins on fixed edges (spec §9.0 `DURATION_EDGES_HOURS`, `AGE_EDGES_DAYS`; Appendix A V1, O7).
 * Bins are `[binStart, binEnd)`; the last bin is open-ended (`binEnd: null`). Units are the caller's
 * (hours for durations, days for ages). Pure.
 */

/** One bin range: `[start, end)`, `end` null on the open-ended last bin. */
export interface BinRange {
  readonly start: number;
  readonly end: number | null;
}

/** A counted bin (the `DurationBin` shape; ageing maps it to `AgeBin`/`ItemAgeBin`). */
export interface CountedBin {
  readonly binStart: number;
  readonly binEnd: number | null;
  readonly count: number;
}

/**
 * Bin ranges from ascending edges: bin i = `[edges[i], edges[i + 1])`, the last `[edges[n − 1], null)`.
 * `[0, 1, 2]` → `[0,1) [1,2) [2,∞)`. No edges → no bins. Appendix A V1.
 */
export function rangesFromEdges(edges: readonly number[]): BinRange[] {
  return edges.map((start, index) => ({ start, end: index + 1 < edges.length ? edges[index + 1] : null }));
}

/**
 * Index of the bin holding `value`: the last edge ≤ value, so a value exactly on an edge belongs to the
 * bin starting there (1 h ∈ [1, 2)); anything from the last edge upward is in the open-ended last bin.
 * Null when `value` is below the first edge, NaN, or there are no edges. Spec §13 Bins.
 */
export function assignBin(value: number, edges: readonly number[]): number | null {
  let index: number | null = null;
  for (let i = 0; i < edges.length; i += 1) {
    if (value >= edges[i]) index = i;
  }
  return index;
}

/** Zero-count bins on `edges` (zero-fill, instructions §5 rule 11). */
export function zeroFilledBins(edges: readonly number[]): CountedBin[] {
  return rangesFromEdges(edges).map((range) => ({ binStart: range.start, binEnd: range.end, count: 0 }));
}

/**
 * Zero-filled bin counts of `values` on `edges` (every bin present, in edge order). Values that fit no
 * bin (`assignBin` null: below the first edge or NaN) are not counted; callers clamp negatives first.
 */
export function countBins(values: readonly number[], edges: readonly number[]): CountedBin[] {
  const counts = edges.map(() => 0);
  for (const value of values) {
    const index = assignBin(value, edges);
    if (index !== null) counts[index] += 1;
  }
  return zeroFilledBins(edges).map((bin, index) => ({ ...bin, count: counts[index] }));
}

/**
 * Quantile `q` (0 < q ≤ 1; median 0.5, p90 0.9) from bins, Appendix A O7 exactly: n = Σ counts,
 * target = q · n; walking bins in order with cumulative count c, the bin with c_before < target ≤
 * c_before + count holds it; value = binStart + (target − c_before) / count · (binEnd − binStart).
 * Null when n = 0, when that bin is the open-ended last bin, or when no bin qualifies (q ≤ 0).
 */
export function quantileFromBins(bins: readonly CountedBin[], q: number): number | null {
  const n = bins.reduce((total, bin) => total + bin.count, 0);
  if (n === 0) return null;
  const target = q * n;
  let before = 0;
  for (const bin of bins) {
    if (before < target && target <= before + bin.count) {
      if (bin.binEnd === null) return null;
      return bin.binStart + ((target - before) / bin.count) * (bin.binEnd - bin.binStart);
    }
    before += bin.count;
  }
  return null;
}
