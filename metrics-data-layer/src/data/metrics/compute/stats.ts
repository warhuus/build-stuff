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
 * Share `part / whole` as a fraction (0..1 for a part of its whole), `null` when `whole` is 0 or either
 * side is null. Same arithmetic as `safeDivide`; the name states intent. Instructions §8 item 7.
 */
export function fraction(part: number | null, whole: number | null): number | null {
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

/** Sum of the non-null values; `null` when every value is null or the list is empty. */
export function sumNullable(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : sum(present);
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
