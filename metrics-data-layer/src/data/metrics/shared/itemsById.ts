/**
 * Items by id (spec §9.0 `itemsById`; used by the 4.2–4.4 item-dimension breakdowns). A thin, un-memoised
 * wrapper over `MetricsSource.fetchItemsByIds` (card-specific id lists; the card's raw cache holds the
 * result). Id chunks and their limiter live in the source (Appendix A X3).
 */
import type { LoaderDeps } from "../source/MetricsSource";
import type { ItemRow, Paged } from "../types";
import { sortedDistinct, sourceCtxOf } from "./sourceCtx";

const NO_ITEMS: Paged<ItemRow> = { rows: [], capped: false };

/**
 * Fetches the items with the given salesOrderIds.
 * @param ids salesOrderIds in any order; duplicates are removed and the rest sorted (deterministic calls).
 * @param deps loader dependencies (`signal`, `onProgress`, `config` passed to the source).
 * @returns `{ rows, capped }`; ids with no item are absent. No ids → `{ rows: [], capped: false }` without
 * a call (lead decision D14). Rejects on source error or abort.
 */
export function loadItemsByIds(ids: Iterable<string>, deps: LoaderDeps): Promise<Paged<ItemRow>> {
  const unique = sortedDistinct(ids);
  if (unique.length === 0) return Promise.resolve(NO_ITEMS);
  return deps.source.fetchItemsByIds(unique, sourceCtxOf(deps, deps.signal));
}
