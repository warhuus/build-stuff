/**
 * Derive of the 4.1 realised OTIF / CRIT card (spec §9 4.1; Appendix A P2 a–b, P3; spec §5 R3). Pure.
 * Headline only (no breakdowns); the mode is the loaded one (`raw.mode`, part of the cache key).
 */
import { METRICS_CONFIG } from "../../../config/metrics";
import type { Derive, OtifOutcomeRaw, OutcomeHeadline } from "../types";
import { hasFilters } from "../selection";
import { mergeCaveats } from "./caveats";
import { caveatsIf, caveatsIfNow } from "./deriveCommon";
import { outcomeHeadline } from "./otifOutcome";

/**
 * 4.1 derive: `total` = `outcomeHeadline` of the raw (gate and window applied client-side), breakdown null.
 * Caveats: `unstratified`, `not-worked-includes-unalerted`, `gate-differs` (always, first draft);
 * `filters-not-applied` when any item filter is set (R3: 4.1 ignores item filters); `now-all-time` under
 * "now". A clamped not-worked count adds no caveat (no code exists for it; instructions §8 item 13).
 */
export const deriveOtifOutcome: Derive<OtifOutcomeRaw, OutcomeHeadline> = (raw, selection, config = METRICS_CONFIG) => {
  const { headline } = outcomeHeadline(
    { mode: raw.mode, window: raw.window, totals: raw.totals, workedIds: raw.workedIds, verdicts: raw.verdicts },
    config,
  );
  return {
    data: { total: headline, breakdown: null },
    caveats: mergeCaveats(
      ["unstratified", "not-worked-includes-unalerted", "gate-differs"],
      caveatsIf(hasFilters(selection.filters), ["filters-not-applied"]),
      caveatsIfNow(raw.window.key, ["now-all-time"]),
    ),
  };
};
