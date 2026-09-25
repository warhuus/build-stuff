/**
 * Derive of the itemFunnel card, section 2 (spec §9 2.0–2.4; Appendix A O1, O3, O4, F3–F6). Pure.
 * Dispatches on the loaded view (`raw.view`, part of the cache key): item view → `deriveItemView`,
 * alert view → `deriveAlertView`.
 */
import { METRICS_CONFIG } from "../../../config/metrics";
import type { Derive, FunnelSeries, ItemFunnelRaw } from "../types";
import { deriveAlertView } from "./deriveItemFunnelAlert";
import { deriveItemView } from "./deriveItemFunnelItem";

/**
 * itemFunnel derive (spec §9 2.0–2.4, item and alert view): `FunnelSeries` (section 2) in the selected unit plus the breakdown and caveats of
 * the loaded view (see `deriveItemView` / `deriveAlertView`).
 */
export const deriveItemFunnel: Derive<ItemFunnelRaw, FunnelSeries> = (raw, selection, config = METRICS_CONFIG) =>
  raw.view === "item" ? deriveItemView(raw, selection, config) : deriveAlertView(raw, selection, config);
