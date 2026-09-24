/**
 * Shared loader L3 (spec §9.0.1 L3): every open alert (AlertOrderFulfillment), their all-time `opened`
 * events and their items, item filters by pivot. Three separate memos keyed by `filtersKey(filters)` only
 * (spec §11: L3 by filters), so a card needing only the alerts fetches only them (lead decision D7).
 * Never acquires the app semaphore (Appendix A X3).
 */
import { l3Items, l3OpenAlerts, l3OpenedEvents } from "../query/build";
import { filtersKey } from "../selection";
import type { LoaderDeps } from "../source/MetricsSource";
import type { AlertEventRow, ItemFilters, ItemRow, OpenAlertRow, Paged } from "../types";
import { createSharedMemo } from "./memo";
import { sourceCtxOf } from "./sourceCtx";

const alertsMemo = createSharedMemo<string, Paged<OpenAlertRow>>();
const openedMemo = createSharedMemo<string, Paged<AlertEventRow>>();
const itemsMemo = createSharedMemo<string, Paged<ItemRow>>();

/**
 * L3 alerts: every open alert (`OpenAlertRow`: routing persona, priority, riskType, escalated).
 * @param filters item filters (open alerts of the filtered items when any is set).
 * @param deps loader dependencies; `deps.signal` rejects only this caller (D7).
 * @returns `{ rows, capped }` in source order; `capped` when ROW_CAP stopped the fetch (D11).
 */
export function loadOpenAlerts(filters: ItemFilters, deps: LoaderDeps): Promise<Paged<OpenAlertRow>> {
  return alertsMemo.get(
    `L3a|${filtersKey(filters)}`,
    (signal) => deps.source.fetchOpenAlerts(l3OpenAlerts(filters), sourceCtxOf(deps, signal)),
    deps.signal,
  );
}

/**
 * L3 opened: the all-time `opened` events of the open alerts (several per reopened alert; none for an
 * alert raised before PIPELINE_EVENTS_START).
 * @param filters item filters (pivot).
 * @param deps loader dependencies; `deps.signal` rejects only this caller (D7).
 * @returns `{ rows, capped }` in source order; `capped` when ROW_CAP stopped the fetch (D11).
 */
export function loadOpenAlertOpenedEvents(filters: ItemFilters, deps: LoaderDeps): Promise<Paged<AlertEventRow>> {
  return openedMemo.get(
    `L3o|${filtersKey(filters)}`,
    (signal) => deps.source.fetchEvents(l3OpenedEvents(filters), sourceCtxOf(deps, signal)),
    deps.signal,
  );
}

/**
 * L3 items: the distinct items of the open alerts (pivot `sourceSalesOrder`); value in USD.
 * @param filters item filters (pivot).
 * @param deps loader dependencies; `deps.signal` rejects only this caller (D7).
 * @returns `{ rows, capped }` in source order; `capped` when ROW_CAP stopped the fetch (D11).
 */
export function loadOpenAlertItems(filters: ItemFilters, deps: LoaderDeps): Promise<Paged<ItemRow>> {
  return itemsMemo.get(
    `L3i|${filtersKey(filters)}`,
    (signal) => deps.source.fetchItems(l3Items(filters), sourceCtxOf(deps, signal)),
    deps.signal,
  );
}
