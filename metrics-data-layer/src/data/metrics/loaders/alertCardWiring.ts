/**
 * Wiring shared by the section-4 duration card loaders (spec §9 4.2–4.4): the item-dim `itemsById` fetch of
 * the population's items (lead note L5) and the 4.3 / 4.4 body. No arithmetic: population selection is the
 * pure `compute/durations` population function; this file only collects ids and calls shared loaders.
 */
import { isItemDim } from "../breakdowns";
import type { DurationAlert } from "../compute/durations";
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
import { loaderOutput } from "./loaderOutput";

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

/** How a 4.3 / 4.4 loader picks its population (spec §9 4.3–4.4): the pure compute population function. */
export type PopulationOf = (facts: readonly AlertLifecycleRow[], window: Window) => readonly DurationAlert[];

/** Inputs of `loadFactsDuration`. */
export interface FactsDurationInput {
  /** L2 window (4.3: the selected window; 4.4: `"now"`; D12). */
  readonly factsWindow: Window;
  /** Resolved selection window (goes into the raw and selects the population). */
  readonly window: Window;
  readonly filters: ItemFilters;
  readonly breakdown: BreakdownDimension | null;
  /** `raisedToFirstViewPopulation` (4.3) or `firstViewToClosurePopulation` (4.4). */
  readonly populationOf: PopulationOf;
}

/**
 * 4.3 / 4.4 body (spec §9 4.3–4.4, D12): L2 over `factsWindow`, no not-worked fetch and, for an item dim,
 * `itemsById` of the POPULATION's salesOrderIds only (spec §9 4.2 "fetch the population's items"; lead
 * note L5), the population chosen by `populationOf` (the same pure function the derive uses).
 * @param input windows, filters, breakdown and population function.
 * @param deps loader dependencies.
 * @returns the `DurationRaw` envelope; `row-cap` + partial when L2 or itemsById was capped.
 */
export async function loadFactsDuration(input: FactsDurationInput, deps: LoaderDeps): Promise<LoaderOutput<DurationRaw>> {
  const facts = await loadTouchedAlerts(input.factsWindow, input.filters, deps);
  const population = input.populationOf(facts.rows, input.window);
  const items = await itemsForDim(input.breakdown, salesOrderIdsOf(population.map((alert) => alert.fact)), deps);
  const raw: DurationRaw = {
    window: input.window,
    dimension: input.breakdown,
    facts: facts.rows,
    notWorked: null,
    items: items === null ? null : items.rows,
  };
  return loaderOutput(raw, [facts, items]);
}
