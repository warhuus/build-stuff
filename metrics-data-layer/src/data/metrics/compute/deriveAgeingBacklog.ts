/**
 * Derive of the 4.5 ageing backlog card (spec §9 4.5; Appendix A O1, O3, O6). Pure. The threshold N is
 * `selection.ageingThresholdDays`, applied here, so changing it never refetches.
 */
import { METRICS_CONFIG } from "../../../config/metrics";
import type { MetricsConfig } from "../../../config/metrics";
import type { AgeingBacklog, AgeingBacklogRaw, BreakdownDimension, Derive, ItemRow } from "../types";
import { isAlertDim, isItemDim } from "../breakdowns";
import { ageingBacklog, agedAlerts, raisedAtByAlert } from "./ageing";
import type { AgedAlert } from "./ageing";
import { mergeCaveats } from "./caveats";
import { additiveRowBreakdown, caveatsIf, truncationCaveats } from "./deriveCommon";
import { itemValueOf, itemsById, openAlertDimValue } from "./dimValues";

/** Group key of an aged alert: alert dims from the open alert row, item dims from its item (spec §9 4.5). */
function agedKeyOf(
  dim: BreakdownDimension,
  items: ReadonlyMap<string, ItemRow>,
  config: MetricsConfig,
): (entry: AgedAlert) => string | null {
  if (isItemDim(dim)) return (entry) => itemValueOf(entry.alert.salesOrderId, items, dim);
  return (entry) => openAlertDimValue(entry.alert, dim, config);
}

/**
 * 4.5 derive (spec §9 4.5): total = `ageingBacklog` of every open alert with N = selection
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
  const breakdown =
    dimension === null ? null : additiveRowBreakdown(aged, dimension, agedKeyOf(dimension, items, config), dataOf, config);
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
