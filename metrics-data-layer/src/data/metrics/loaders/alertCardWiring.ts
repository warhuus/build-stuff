/**
 * Wiring shared by the section-4 alert card loaders (spec §9 4.2–4.6): the loader envelope with the
 * fetch-level caveats (instructions §5 rule 5, lead decision D11) and the item-dim `itemsById` fetch.
 * No arithmetic: only flags, id collection and port / shared-loader calls.
 */
import { isItemDim } from "../breakdowns";
import { mergeCaveats } from "../compute/caveats";
import { loadItemsByIds } from "../shared/itemsById";
import { loadTouchedAlerts } from "../shared/touchedAlerts";
import type { LoaderDeps } from "../source/MetricsSource";
import type {
  AlertLifecycleRow,
  BreakdownDimension,
  DurationRaw,
  ItemFilters,
  ItemRow,
  LoaderOutput,
  Paged,
  Window,
} from "../types";

/** Loader-level flags beyond the row cap. */
export interface EnvelopeFlags {
  /** A grouped port call returned exactly `config.MAX_GROUPS` rows (`isTruncatedByCap`). */
  readonly truncated?: boolean;
  /** 4.2 under a window key outside `config.NOT_WORKED_WINDOW_KEYS` (spec §9 4.2). */
  readonly notWorkedWindowCap?: boolean;
}

/**
 * The loader envelope (instructions §5 rule 5; D11): `row-cap` when any fetch was capped, `truncated`
 * and `not-worked-window-cap` per `flags`; status `partial` on `row-cap` or `not-worked-window-cap`.
 * @param raw the card's raw data.
 * @param fetches every `Paged` result the loader used (null entries = fetch not made, skipped).
 * @param flags extra loader caveats.
 * @returns `{ raw, status, caveats }`, caveats de-duplicated in config order.
 */
export function loaderEnvelope<R>(
  raw: R,
  fetches: readonly (Paged<unknown> | null)[],
  flags: EnvelopeFlags = {},
): LoaderOutput<R> {
  const capped = fetches.some((p) => p !== null && p.capped);
  const notWorkedCap = flags.notWorkedWindowCap === true;
  return {
    raw,
    status: capped || notWorkedCap ? "partial" : "ok",
    caveats: mergeCaveats(
      capped ? ["row-cap"] : [],
      flags.truncated === true ? ["truncated"] : [],
      notWorkedCap ? ["not-worked-window-cap"] : [],
    ),
  };
}

/**
 * The non-null salesOrderIds of alert rows (any order, duplicates allowed; `loadItemsByIds` de-duplicates).
 * @param lists alert-row lists.
 * @returns the ids.
 */
export function salesOrderIdsOf(...lists: readonly (readonly AlertLifecycleRow[])[]): string[] {
  return lists.flatMap((rows) => rows.flatMap((r) => (r.salesOrderId === null ? [] : [r.salesOrderId])));
}

/**
 * Items by id for an item-dim breakdown (spec §9 4.2–4.4 "Item dims: fetch the population's items with
 * `itemsById` (only when an item dim is selected)").
 * @param breakdown validated breakdown or null.
 * @param ids salesOrderIds of the population.
 * @param deps loader dependencies.
 * @returns the items (`Paged`) for an item dim; `null` without a call otherwise.
 */
export function itemsForDim(
  breakdown: BreakdownDimension | null,
  ids: readonly string[],
  deps: LoaderDeps,
): Promise<Paged<ItemRow> | null> {
  return breakdown !== null && isItemDim(breakdown) ? loadItemsByIds(ids, deps) : Promise.resolve(null);
}

/**
 * 4.3 / 4.4 body (spec §9 4.3–4.4, D12): L2 over `factsWindow`, no not-worked fetch, items of every
 * fact's salesOrderId for an item dim. Population selection by window is left to derive.
 * @param factsWindow L2 window (4.3: the selected window; 4.4: `"now"`).
 * @param window resolved selection window (goes into the raw).
 * @param filters item filters.
 * @param breakdown validated breakdown or null.
 * @param deps loader dependencies.
 * @returns the `DurationRaw` envelope; `row-cap` + partial when L2 or itemsById was capped.
 */
export async function loadFactsDuration(
  factsWindow: Window,
  window: Window,
  filters: ItemFilters,
  breakdown: BreakdownDimension | null,
  deps: LoaderDeps,
): Promise<LoaderOutput<DurationRaw>> {
  const facts = await loadTouchedAlerts(factsWindow, filters, deps);
  const items = await itemsForDim(breakdown, salesOrderIdsOf(facts.rows), deps);
  const raw: DurationRaw = {
    window,
    dimension: breakdown,
    facts: facts.rows,
    notWorked: null,
    items: items === null ? null : items.rows,
  };
  return loaderEnvelope(raw, [facts, items]);
}
