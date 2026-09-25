/**
 * Null-safe arithmetic shared by every derive (instructions §8 item 7). Pure.
 * Percentages are fractions 0..1; any division by zero or by null gives `null`.
 */

/**
 * `numerator / denominator`, or `null` when either operand is null or the denominator is 0.
 * Units: whatever the operands carry. Instructions §8 item 7.
 */
export function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

/**
 * Percentage `part / whole`, expressed as a fraction (0..1 for a part of its whole; instructions §4
 * `percent`), `null` when `whole` is 0 or either side is null. Same arithmetic as `safeDivide`; the name
 * states intent. Instructions §8 item 7.
 */
export function percent(part: number | null, whole: number | null): number | null {
  return safeDivide(part, whole);
}

/** Sum of `values`; 0 for an empty list. */
export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Sum of `valueOf(row)` over `rows`; 0 for no rows. */
export function sumBy<R>(rows: readonly R[], valueOf: (row: R) => number): number {
  return rows.reduce((total, row) => total + valueOf(row), 0);
}

/** `value` clamped at 0 from below (a subtraction that must never go negative). Spec §9 3.1, 4.6. */
export function clampNonNegative(value: number): number {
  return Math.max(0, value);
}

/**
 * `total − Σ parts`, clamped at 0: the remainder outside the listed parts (additive `other`, unscored by
 * subtraction, not-worked = all − worked). Spec §9.0 Truncation, §9 3.1.
 */
export function remainder(total: number, parts: readonly number[]): number {
  return clampNonNegative(total - sum(parts));
}

/**
 * Locale-independent string order by UTF-16 code unit (the tie-break of every name sort, instructions §5
 * rule 11). @returns negative / 0 / positive like `Array.prototype.sort` comparators.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Distinct ids sorted by `compareCodeUnits`, for deterministic output and id lookups.
 * @param ids ids in any order, duplicates allowed.
 * @returns a new sorted array without duplicates; empty input → empty array.
 */
export function sortedDistinct(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort(compareCodeUnits);
}
