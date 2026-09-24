/**
 * 4.6 "what happened before closure" (spec §9 4.6, §10 `CompositionResult`; Appendix A W7). Pure.
 * writeBack / action / viewOnly are counted over the touched alerts (their `closureGroup`, precedence
 * write-back → action → view only); noHuman = closedTotal − the three, clamped at 0.
 */
import { CLOSURE_GROUPS } from "../../../config/metrics";
import type { MetricsConfig } from "../../../config/metrics";
import type { AlertLifecycleRow, BreakdownDimension, BreakdownResult, ClosureGroup, CompositionResult, GroupCount } from "../types";
import { buildBreakdown, countOfGroup, rowsOutside } from "./breakdown";
import { attrsDimValue } from "./dimValues";
import { remainder } from "./stats";

/**
 * Four rows in `CLOSURE_GROUPS` order, zero-filled (spec §9 4.6): writeBack, action, viewOnly = touched
 * alerts in that closure group; noHuman = max(0, closedTotal − writeBack − action − viewOnly) (W7).
 * Touched alerts whose group is noHuman (human events only after closure) fall in the noHuman remainder.
 * `closedTotal` is returned as given.
 */
export function compositionOf(closedTotal: number, touched: readonly AlertLifecycleRow[]): CompositionResult {
  const countOf = (group: ClosureGroup): number => touched.filter((fact) => fact.closureGroup === group).length;
  const human = { writeBack: countOf("writeBack"), action: countOf("action"), viewOnly: countOf("viewOnly") };
  const noHuman = remainder(closedTotal, [human.writeBack, human.action, human.viewOnly]);
  return {
    rows: CLOSURE_GROUPS.map((group) => ({ group, count: group === "noHuman" ? noHuman : human[group] })),
    closedTotal,
  };
}

/**
 * 4.6 breakdown (spec §9 4.6): additive; top-N by `closedTotal(g)` from the grouped closed-event count
 * (`byGroup`); group g = compositionOf(closedTotal(g), touched alerts whose attrs value is g);
 * `other` = compositionOf(closedTotal − Σ shown closedTotal(g) (clamped at 0), touched alerts outside the
 * shown groups including null attrs). Attrs come from the closed event, the same property as `byGroup`.
 */
export function compositionBreakdown(
  dimension: BreakdownDimension,
  closedTotal: number,
  byGroup: readonly GroupCount[],
  touched: readonly AlertLifecycleRow[],
  config: MetricsConfig,
): BreakdownResult<CompositionResult> {
  const keyOf = (fact: AlertLifecycleRow): string | null => attrsDimValue(fact.attrs, dimension);
  return buildBreakdown(
    {
      dimension,
      additive: true,
      ranking: byGroup,
      dataOf: (group) => compositionOf(countOfGroup(byGroup, group), touched.filter((fact) => keyOf(fact) === group)),
      otherOf: (shown) =>
        compositionOf(
          remainder(closedTotal, shown.map((group) => countOfGroup(byGroup, group))),
          rowsOutside(touched, keyOf, shown),
        ),
    },
    config,
  );
}
