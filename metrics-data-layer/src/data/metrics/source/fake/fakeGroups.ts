/**
 * Aggregation helpers of the fake source with OSDK aggregate semantics (spec §8, instructions §5 rules 7–8):
 * null group values dropped, groups capped at `config.MAX_GROUPS` keeping the largest (ties by name),
 * `exactDistinct` ignores nulls, `valueUsd:sum` ignores nulls and is 0 when empty, `$ranges` keyed by
 * range start with empty ranges omitted and null values dropped.
 */
import { PLACEHOLDER } from "../../../../config/metrics";
import type { MetricsConfig, VerdictDateProperty } from "../../../../config/metrics";
import { compareGroupCounts, groupRows } from "../../compute/breakdown";
import { inVerdictWindow, passesGate, verdictOf } from "../../compute/otifOutcome";
import type { CountValue, GroupCount, GroupCountValue, RangeCount, VerdictRow } from "../../types";
import type { VerdictFilter } from "../../query/specs";
import type { FixtureItem, FixtureVerdict } from "./fakeTypes";

/**
 * The `max` largest groups, count descending then name ascending (the fake's `$exactWithLimit`; same order as
 * `compute/breakdown.topGroups`, kept generic so count+value groups keep their value).
 */
export function capGroups<G extends GroupCount>(groups: readonly G[], max: number): G[] {
  return [...groups].sort(compareGroupCounts).slice(0, Math.max(0, max));
}

/** Number of distinct non-null values (`prop:exactDistinct`). */
export function exactDistinct<R>(rows: readonly R[], valueOf: (row: R) => string | null): number {
  return new Set(rows.map(valueOf).filter((v): v is string => v !== null)).size;
}

/** Distinct non-null values per non-null group key, capped at `max` groups. */
export function distinctByGroup<R>(
  rows: readonly R[],
  groupOf: (row: R) => string | null,
  valueOf: (row: R) => string | null,
  max: number,
): GroupCount[] {
  const groups = groupRows(rows, groupOf);
  return capGroups([...groups].map(([group, members]) => ({ group, count: exactDistinct(members, valueOf) })), max);
}

/** `$count` (distinct items) and `valueUsd:sum` (nulls ignored, 0 when empty) of items. */
export function countValueOf(items: readonly FixtureItem[]): CountValue {
  return { count: items.length, valueUsd: items.reduce((sum, i) => sum + (i.valueUsd ?? 0), 0) };
}

/** Items grouped by a non-null key with count and value, capped at `max` groups. */
export function countValueByGroup(
  items: readonly FixtureItem[],
  groupOf: (item: FixtureItem) => string | null,
  max: number,
): GroupCountValue[] {
  const groups = groupRows(items, groupOf);
  return capGroups([...groups].map(([group, members]) => ({ group, ...countValueOf(members) })), max);
}

/** `$ranges` counts: `[start, end)` ranges in the given order, empty ranges omitted, null values dropped. */
export function countByRanges(
  values: readonly (number | null)[],
  ranges: readonly (readonly [number, number])[],
): RangeCount[] {
  return ranges
    .map(([start, end]) => ({ startValue: start, count: values.filter((v) => v !== null && v >= start && v < end).length }))
    .filter((r) => r.count > 0);
}

/** The verdict date of a row per `VERDICT_DATE_PROPERTY` (V7); null while the property is a placeholder. */
export function verdictDateOf(row: FixtureVerdict, property: VerdictDateProperty): string | null {
  return property === PLACEHOLDER ? null : row[property];
}

/**
 * Maps a fixture verdict to the port row (spec §10 `VerdictRow`).
 * @param v fixture row.
 * @param config supplies `VERDICT_DATE_PROPERTY`.
 * @returns the row; `verdictDate` = the chosen date property, null while it is the placeholder.
 */
export function verdictRowOf(v: FixtureVerdict, config: MetricsConfig): VerdictRow {
  return {
    otifOrderId: v.otifOrderId,
    otifVerdict: v.otifVerdict,
    critVerdict: v.critVerdict,
    otifExclusion: v.otifExclusion,
    critExclusion: v.critExclusion,
    verdictDate: verdictDateOf(v, config.VERDICT_DATE_PROPERTY),
  };
}

/**
 * Spec §9 4.1 step 1: rows whose mode gate = `EXCLUSION_GATE_PASS` and whose verdict date is in the window,
 * grouped by the mode's classification (nulls dropped), capped at `MAX_GROUPS`. The gate, verdict and date
 * rules are the derive's own (`compute/otifOutcome` `passesGate`, `verdictOf`, `inVerdictWindow`; D8).
 */
export function verdictTotals(rows: readonly FixtureVerdict[], filter: VerdictFilter, config: MetricsConfig): GroupCount[] {
  const passing = rows
    .map((r) => verdictRowOf(r, config))
    .filter((r) => passesGate(r, filter.mode, config) && inVerdictWindow(r.verdictDate, filter.window));
  return distinctByGroup(passing, (r) => verdictOf(r, filter.mode), (r) => r.otifOrderId, config.MAX_GROUPS);
}
