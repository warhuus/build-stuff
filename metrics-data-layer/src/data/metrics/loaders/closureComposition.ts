/**
 * Loader of card 4.6 `closureComposition` (spec §9 4.6; lead decisions D11, D12). Raw only.
 */
import { isTruncatedByCap } from "../compute/breakdown";
import { closedNotOpenNow } from "../query/build";
import type { EventGroupField } from "../query/specs";
import { sourceCtxOf } from "../shared/sourceCtx";
import { loadTouchedAlerts } from "../shared/touchedAlerts";
import type { Loader } from "../source/MetricsSource";
import type { BreakdownDimension, ClosureCompositionRaw } from "../types";
import { resolveWindow } from "../window";
import { loaderEnvelope } from "./alertCardWiring";

/** The AlertHistory group-by field of a 4.6 dim (closed-event persona / riskType / priorityAtEvent). */
function eventGroupOf(dim: BreakdownDimension | null): EventGroupField | null {
  switch (dim) {
    case "alertType":
    case "routingPersona":
    case "priority":
      return dim;
    default:
      return null;
  }
}

/**
 * 4.6 loader, three calls in parallel: `countEvents(closedNotOpenNow(w, f), "alert")` (closedTotal), the
 * same grouped by the dim's AlertHistory field (alertType / routingPersona / priority, attrs of the closed
 * event) when a breakdown is given, and `loadTouchedAlerts("now", f)` (D12; derive keeps closedAt in w).
 * @param selection selection (window, filters).
 * @param breakdown validated breakdown (alertType, routingPersona, priority) or null.
 * @param deps loader dependencies.
 * @returns `ClosureCompositionRaw` (`closedTotalByGroup` null without a breakdown). `truncated` when the
 * grouped call returned `config.MAX_GROUPS` rows; `row-cap` + partial when L2 was capped.
 */
export const loadClosureComposition: Loader<ClosureCompositionRaw> = async (selection, breakdown, deps) => {
  const window = resolveWindow(selection.window, deps.now);
  const f = selection.filters;
  const ctx = sourceCtxOf(deps, deps.signal);
  const finalSet = closedNotOpenNow(window, f);
  const group = eventGroupOf(breakdown);
  const [closedTotal, byGroup, facts] = await Promise.all([
    deps.source.countEvents(finalSet, "alert", ctx),
    group === null ? Promise.resolve(null) : deps.source.countEventsBy(finalSet, "alert", group, ctx),
    loadTouchedAlerts(resolveWindow("now", deps.now), f, deps),
  ]);
  const raw: ClosureCompositionRaw = {
    window,
    dimension: breakdown,
    closedTotal,
    closedTotalByGroup: byGroup,
    facts: facts.rows,
  };
  return loaderEnvelope(raw, [facts], { truncated: byGroup !== null && isTruncatedByCap(byGroup, deps.config) });
};
