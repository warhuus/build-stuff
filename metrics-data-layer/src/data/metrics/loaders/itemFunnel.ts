/**
 * itemFunnel loader, section 2 (spec §9 2.0–2.4; Appendix A O4): dispatches on `selection.view` (part of
 * the raw cache key, D6) to the item-view or alert-view loader. Split per lead decision D21.
 */
import type { Loader } from "../source/MetricsSource";
import type { ItemFunnelRaw } from "../types";
import { loadAlertView } from "./itemFunnelAlertView";
import { loadItemView } from "./itemFunnelItemView";

/**
 * itemFunnel: item view → `loadItemView` (aggregates only); alert view → `loadAlertView` (aggregates + L1,
 * L2, L3 as the dim needs).
 * @param selection selection (window, filters, view).
 * @param breakdown validated dim for the view, or null.
 * @param deps loader dependencies.
 * @returns the view's raw data (`raw.view` = the selected view) and fetch-level caveats.
 */
export const loadItemFunnel: Loader<ItemFunnelRaw> = (selection, breakdown, deps) =>
  selection.view === "item" ? loadItemView(selection, breakdown, deps) : loadAlertView(selection, breakdown, deps);
