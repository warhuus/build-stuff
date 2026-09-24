/**
 * Derive of the 4.6 closure composition card (spec §9 4.6; Appendix A W4, W7). Pure. The touched
 * population is the L2("now") facts filtered to closed alerts with `closedAt` in the selected window.
 */
import { METRICS_CONFIG } from "../../../config/metrics";
import type { ClosureCompositionRaw, CompositionResult, Derive } from "../types";
import { mergeCaveats } from "./caveats";
import { compositionBreakdown, compositionOf } from "./composition";
import { caveatsIfNow, truncationCaveats } from "./deriveCommon";
import { closedInWindow } from "./durations";

/**
 * 4.6 derive: total = `compositionOf(closedTotal, touched closed in window)`; with a dim, the additive
 * `compositionBreakdown` over `closedTotalByGroup` (absent → no groups). Caveats: `closure-actor-unknown`,
 * `precedence` (always); `truncated` when top-N cut groups or the grouped call returned `MAX_GROUPS` rows;
 * `now-all-time` under "now".
 */
export const deriveClosureComposition: Derive<ClosureCompositionRaw, CompositionResult> = (
  raw,
  _selection,
  config = METRICS_CONFIG,
) => {
  const touched = closedInWindow(raw.facts, raw.window);
  const byGroup = raw.closedTotalByGroup ?? [];
  const breakdown =
    raw.dimension === null ? null : compositionBreakdown(raw.dimension, raw.closedTotal, byGroup, touched, config);
  return {
    data: { total: compositionOf(raw.closedTotal, touched), breakdown },
    caveats: mergeCaveats(
      ["closure-actor-unknown", "precedence"],
      truncationCaveats(breakdown, [raw.closedTotalByGroup], config),
      caveatsIfNow(raw.window.key, ["now-all-time"]),
    ),
  };
};
