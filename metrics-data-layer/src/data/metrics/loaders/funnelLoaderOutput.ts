/**
 * Loader envelope of aggregate-only loaders with grouped calls (userFunnel, itemFunnel): wraps raw data
 * with the fetch-level caveats only (instructions §5 rule 5; lead decision D11; spec §9.0 Truncation).
 * No arithmetic.
 */
import type { MetricsConfig } from "../../../config/metrics";
import { mergeCaveats } from "../compute/caveats";
import { isTruncatedByCap } from "../compute/breakdown";
import type { Caveat, LoaderOutput } from "../types";

/** Fetch-level facts gathered by a loader. */
export interface FunnelFetchFlags {
  /** Any Paged fetch (L1/L2/L3) returned `capped` (D11) → `row-cap` + status "partial". */
  readonly capped: boolean;
  /** Rows of every grouped port call (`countEventsBy`, `countOpenAlertsBy`, `countItemsBy`, `countAppUsersBy`). */
  readonly grouped: readonly (readonly unknown[])[];
}

/**
 * Builds the `LoaderOutput` of a loader from its fetch flags.
 * @param raw the card's raw data.
 * @param flags `capped` and the rows of every grouped call.
 * @param config the loader's config (`MAX_GROUPS`).
 * @returns status "partial" with `row-cap` when capped, else "ok"; `truncated` when any grouped call returned
 * exactly `config.MAX_GROUPS` rows (`isTruncatedByCap`). Caveats in config order.
 */
export function funnelLoaderOutput<R>(raw: R, flags: FunnelFetchFlags, config: MetricsConfig): LoaderOutput<R> {
  const truncated = flags.grouped.some((rows) => isTruncatedByCap(rows, config));
  const caveats: Caveat[] = mergeCaveats(flags.capped ? ["row-cap"] : [], truncated ? ["truncated"] : []);
  return { raw, status: flags.capped ? "partial" : "ok", caveats };
}
