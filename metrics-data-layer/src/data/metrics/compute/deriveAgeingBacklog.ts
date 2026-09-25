/**
 * Derive of the 4.5 ageing backlog card (spec §9 4.5; Appendix A O1, O3, O6). Pure. The threshold N is
 * `selection.ageingThresholdDays`, applied here, so changing it never refetches.
 */
import { METRICS_CONFIG } from "../../../config/metrics";
import type { AgeingBacklog, AgeingBacklogRaw, BreakdownResult, Derive } from "../types";
import { isAlertDim } from "../breakdowns";
import { ageingBacklog, agedAlerts, raisedAtByAlert } from "./ageing";
import type { AgedAlert } from "./ageing";
import { mergeCaveats } from "./caveats";
import { additiveRowBreakdown, caveatsIf, truncationCaveats } from "./deriveCommon";
import { itemsById, openAlertKeyOf } from "./dimValues";

/**
 * 4.5 derive (spec §9 4.5): group keys from `openAlertKeyOf` (alert dims from the open-alert row, item dims
 * from its item); total = `ageingBacklog` of every open alert with N = selection
 * `ageingThresholdDays`; breakdown additive on alert counts (top-N by open-alert count, `other` = alerts
 * outside the shown groups), each group an `AgeingBacklog` of its alerts and their items.
 * Caveats: `no-target-property` (always); `opened-events-since-pipeline-start` when unknownAge > 0;
 * `overlap` under an alert dim (value fields: an item with alerts in two groups counts in both);
 * `truncated` when top-N cut groups. `row-cap` comes from the loader.
 */
export const deriveAgeingBacklog: Derive<AgeingBacklogRaw, AgeingBacklog> = (
  raw,
  selection,
  config = METRICS_CONFIG,
) => {
  const items = itemsById(raw.items);
  const aged = agedAlerts(raw.alerts, raisedAtByAlert(raw.openedEvents), raw.asOf);
  const dataOf = (rows: readonly AgedAlert[]): AgeingBacklog =>
    ageingBacklog({ aged: rows, items, asOf: raw.asOf, thresholdDays: selection.ageingThresholdDays }, config);
  const dimension = raw.dimension;
  let breakdown: BreakdownResult<AgeingBacklog> | null = null;
  if (dimension !== null) {
    const alertKey = openAlertKeyOf(dimension, items, config);
    breakdown = additiveRowBreakdown(aged, dimension, (entry) => alertKey(entry.alert), dataOf, config);
  }
  const total = dataOf(aged);
  return {
    data: { total, breakdown },
    caveats: mergeCaveats(
      ["no-target-property"],
      caveatsIf(total.unknownAge > 0, ["opened-events-since-pipeline-start"]),
      caveatsIf(dimension !== null && isAlertDim(dimension), ["overlap"]),
      truncationCaveats(breakdown, [], config),
    ),
  };
};
