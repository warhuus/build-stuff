/**
 * Loader of card 4.3 `raisedToFirstView` (spec §9 4.3; lead decisions D11, D12). Raw only.
 */
import { raisedToFirstViewPopulation } from "../compute/durations";
import type { Loader } from "../source/MetricsSource";
import type { DurationRaw } from "../types";
import { resolveWindow } from "../window";
import { loadFactsDuration } from "./alertCardWiring";

/**
 * 4.3 loader: L2 over the SELECTED window (D12; first view over all-time human events, W4), no not-worked
 * fetch, and for an item dim `itemsById` of the population's salesOrderIds (first view in the window, L5).
 * @param selection selection (window, filters).
 * @param breakdown validated breakdown or null.
 * @param deps loader dependencies.
 * @returns `DurationRaw` (`notWorked` null; `items` null without an item dim); `row-cap` + partial when capped.
 */
export const loadRaisedToFirstView: Loader<DurationRaw> = (selection, breakdown, deps) => {
  const window = resolveWindow(selection.window, deps.now);
  return loadFactsDuration(
    { factsWindow: window, window, filters: selection.filters, breakdown, populationOf: raisedToFirstViewPopulation },
    deps,
  );
};
