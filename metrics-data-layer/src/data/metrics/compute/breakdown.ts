/**
 * Generic breakdown helpers reused by every card (decision D9; spec §5 B2–B5, §9.0 Truncation;
 * Appendix A O1, B2). Pure; the group caps come from `config` (decision D1).
 */
import type { MetricsConfig } from "../../../config/metrics";
import type { BreakdownDimension, BreakdownResult, GroupCount } from "../types";
import { safeDivide, sumBy } from "./stats";

/**
 * Sort order of breakdown groups: count descending, then group name ascending (instructions §5 rule 11).
 * Name order uses plain code-unit comparison so the result never depends on the locale.
 */
export function compareGroupCounts(a: GroupCount, b: GroupCount): number {
  if (a.count !== b.count) return b.count - a.count;
  if (a.group === b.group) return 0;
  return a.group < b.group ? -1 : 1;
}

/** A sorted copy (`compareGroupCounts`) of `counts`. */
export function sortGroupCounts(counts: readonly GroupCount[]): GroupCount[] {
  return [...counts].sort(compareGroupCounts);
}

/**
 * Top-N groups (spec §5 B2): the `max` largest by count, ties by name ascending. `max ≤ 0` → none.
 * Callers pass `config.BREAKDOWN_MAX_GROUPS` (Appendix A V3).
 */
export function topGroups(counts: readonly GroupCount[], max: number): GroupCount[] {
  return sortGroupCounts(counts).slice(0, Math.max(0, max));
}

/**
 * True when a grouped call returned exactly `config.MAX_GROUPS` groups, so the server may have dropped
 * some (spec §9.0 Truncation, instructions §5 rule 7) → caveat `truncated`.
 */
export function isTruncatedByCap(rows: readonly unknown[], config: MetricsConfig): boolean {
  return rows.length === config.MAX_GROUPS;
}

/** Fields common to both breakdown kinds. */
interface BreakdownSpecBase<T> {
  readonly dimension: BreakdownDimension;
  /**
   * EVERY group with its ranking count: on the first applicable stage (funnels) or the whole population
   * (other cards), spec §5 B2. The shown list is chosen once from it.
   */
  readonly ranking: readonly GroupCount[];
  /** The card data of one shown group. */
  readonly dataOf: (group: string) => T;
}

/** Additive dim (groups partition the population): `other` = everything outside the shown groups (B4). */
export interface AdditiveBreakdownSpec<T> extends BreakdownSpecBase<T> {
  readonly additive: true;
  /**
   * Data of everything outside `shown` (including rows with a null dimension value), e.g. computed from
   * the rows outside the groups (`rowsOutside`) or as total − Σ shown (`remainder` in stats.ts).
   */
  readonly otherOf: (shown: readonly string[]) => T;
}

/** Non-additive dim (groups overlap): no `other`; `overlapRatio` = Σ ALL groups / `overlapTotal` (B5). */
export interface NonAdditiveBreakdownSpec<T> extends BreakdownSpecBase<T> {
  readonly additive: false;
  /** Total on the first applicable stage / whole population (same basis as `ranking`); null if unknown. */
  readonly overlapTotal: number | null;
}

/** Input of `buildBreakdown`, discriminated by `additive`. */
export type BreakdownSpec<T> = AdditiveBreakdownSpec<T> | NonAdditiveBreakdownSpec<T>;

/**
 * Builds a `BreakdownResult<T>` (Appendix A O1; spec §5 B2–B5):
 * - groups: the top `config.BREAKDOWN_MAX_GROUPS` of `ranking`, largest first, ties by name;
 * - other: additive only (`otherOf(shown names)`), else null;
 * - truncated: `{ shown, total }` group counts only when top-N cut groups, else null;
 * - overlapRatio: non-additive only, Σ over ALL ranking groups (before truncation) / `overlapTotal`,
 *   null on a zero/null total; always null for additive dims.
 */
export function buildBreakdown<T>(spec: BreakdownSpec<T>, config: MetricsConfig): BreakdownResult<T> {
  const shown = topGroups(spec.ranking, config.BREAKDOWN_MAX_GROUPS);
  const names = shown.map((entry) => entry.group);
  const cut = spec.ranking.length > shown.length;
  return {
    dimension: spec.dimension,
    additive: spec.additive,
    groups: names.map((group) => ({ group, data: spec.dataOf(group) })),
    other: spec.additive ? spec.otherOf(names) : null,
    truncated: cut ? { shown: shown.length, total: spec.ranking.length } : null,
    overlapRatio: spec.additive ? null : safeDivide(sumBy(spec.ranking, (entry) => entry.count), spec.overlapTotal),
  };
}

/**
 * Client-side grouping (4.2–4.6): rows by `keyOf(row)`. Rows with a null key fall outside every group
 * (they still count in an additive `other`). Map order = first appearance; lists keep input order.
 */
export function groupRows<R>(rows: readonly R[], keyOf: (row: R) => string | null): Map<string, R[]> {
  const groups = new Map<string, R[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/** `GroupCount[]` (row count per group, sorted by `compareGroupCounts`) of a `groupRows` result. */
export function groupCountsOf<R>(groups: ReadonlyMap<string, readonly R[]>): GroupCount[] {
  return sortGroupCounts([...groups].map(([group, rows]) => ({ group, count: rows.length })));
}

/**
 * The rows outside the shown groups: null key or a key not in `shown` (the additive `other` population,
 * spec §9 4.2 / 4.5 / 4.6).
 */
export function rowsOutside<R>(rows: readonly R[], keyOf: (row: R) => string | null, shown: readonly string[]): R[] {
  const shownSet = new Set(shown);
  return rows.filter((row) => {
    const key = keyOf(row);
    return key === null || !shownSet.has(key);
  });
}

/** Count of `groups` whose group is `group`, 0 when absent (lookup into server group rows). */
export function countOfGroup(groups: readonly GroupCount[], group: string): number {
  return groups.find((entry) => entry.group === group)?.count ?? 0;
}
