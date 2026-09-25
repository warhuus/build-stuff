/**
 * Loader of card 4.4 `firstViewToClosure` (spec §9 4.4; lead decisions D11, D12). Raw only.
 */
import { firstViewToClosurePopulation } from "../compute/durations";
import type { Loader } from "../source/MetricsSource";
import type { DurationRaw } from "../types";
import { resolveWindow } from "../window";
import { loadFactsDuration } from "./alertCardWiring";

/**
 * 4.4 loader: L2 over the `"now"` window (D12; the derive keeps alerts closed in the selected window and
 * viewed), no not-worked fetch, and for an item dim `itemsById` of the population's salesOrderIds (closed
 * in the window with a first view, L5).
 * @param selection selection (window, filters).
 * @param breakdown validated breakdown or null.
 * @param deps loader dependencies.
 * @returns `DurationRaw` (`notWorked` null; `items` null without an item dim); `row-cap` + partial when capped.
 */
export const loadFirstViewToClosure: Loader<DurationRaw> = (selection, breakdown, deps) =>
  loadFactsDuration(
    {
      factsWindow: resolveWindow("now", deps.now),
      window: resolveWindow(selection.window, deps.now),
      filters: selection.filters,
      breakdown,
      populationOf: firstViewToClosurePopulation,
    },
    deps,
  );
