/**
 * Loader of card 4.2 `raisedToClosed` (spec §9 4.2; lead decisions D2, D11, D12). Raw only: the L2("now")
 * facts, the not-worked candidates (7 / 14 days) and, for an item dim, the items of the population.
 */
import { loadNotWorkedAlerts } from "../shared/notWorkedAlerts";
import { loadTouchedAlerts } from "../shared/touchedAlerts";
import type { Loader } from "../source/MetricsSource";
import type { DurationRaw } from "../types";
import { resolveWindow } from "../window";
import { itemsForDim, loaderEnvelope, salesOrderIdsOf } from "./alertCardWiring";

/**
 * 4.2 loader. In parallel: `loadTouchedAlerts("now", f)` (worked side, D12) and, when the window key is in
 * `config.NOT_WORKED_WINDOW_KEYS`, `loadNotWorkedAlerts(w, f)` (D2; the derive removes L2 ids). Then, for an
 * item-dim breakdown, `itemsById` of EVERY fact and not-worked salesOrderId (a superset of the population:
 * the closedAt-in-window selection is derive's, so the loader does no filtering).
 * @param selection selection (window, filters; unit is derive's).
 * @param breakdown validated breakdown (spec §9 4.2: alert attrs or item dims) or null.
 * @param deps loader dependencies.
 * @returns `DurationRaw` with `notWorked` null outside 7 / 14 days, `items` null without an item dim.
 * Caveats: `not-worked-window-cap` + partial for 30 / 90 / now; `row-cap` + partial when any fetch capped.
 */
export const loadRaisedToClosed: Loader<DurationRaw> = async (selection, breakdown, deps) => {
  const window = resolveWindow(selection.window, deps.now);
  const f = selection.filters;
  const withNotWorked = deps.config.NOT_WORKED_WINDOW_KEYS.includes(window.key);
  const [facts, notWorked] = await Promise.all([
    loadTouchedAlerts(resolveWindow("now", deps.now), f, deps),
    withNotWorked ? loadNotWorkedAlerts(window, f, deps) : Promise.resolve(null),
  ]);
  const notWorkedRows = notWorked === null ? null : notWorked.rows;
  const items = await itemsForDim(breakdown, salesOrderIdsOf(facts.rows, notWorkedRows ?? []), deps);
  const raw: DurationRaw = {
    window,
    dimension: breakdown,
    facts: facts.rows,
    notWorked: notWorkedRows,
    items: items === null ? null : items.rows,
  };
  return loaderEnvelope(raw, [facts, notWorked, items], { notWorkedWindowCap: !withNotWorked });
};
