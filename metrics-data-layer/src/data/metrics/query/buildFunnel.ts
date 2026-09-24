/**
 * itemFunnel spec builders (spec §9 2.0–2.4): item-view stage sets, outside paths and the 2.1 alert-view
 * term sets. Pure; built on the primitives of `build.ts`.
 */
import type { ItemFilters, Window } from "../types";
import {
  allOpenAlerts,
  events,
  itemsOfOpenAlerts,
  itemsWithEvent,
  itemsWithOpenAlertWhere,
  openAlerts,
  openAlertsOfEvents,
  openItemsInWindow,
  withItemFilters,
} from "./build";
import type { EventSet, ItemSet, OpenAlertCondition, OpenAlertSet } from "./specs";

/** Item-view stage sets and outside paths (spec §9 2.0–2.4). */
export interface ItemFunnelSets {
  /** 2.0: items open at any point in the window, item filters applied. */
  readonly so20: ItemSet;
  /** 2.1: so20 ∩ (items with an open alert ∪ items with a closed event in the window). */
  readonly so21: ItemSet;
  /** 2.2: so21 ∩ items with a viewed event in the window. */
  readonly so22: ItemSet;
  /** 2.3: so22 ∩ items with an action event in the window. */
  readonly so23: ItemSet;
  /** 2.4: so23 ∩ items with a write-back event in the window. */
  readonly so24: ItemSet;
  /** 2.3 outside path: so21 ∩ acted − so22 (acted without a view). */
  readonly outside23: ItemSet;
  /** 2.4 outside path: so21 ∩ written back − so23 (written back outside the path). */
  readonly outside24: ItemSet;
}

const intersect = (a: ItemSet, b: ItemSet): ItemSet => ({ kind: "intersect", a, b });
const subtract = (a: ItemSet, b: ItemSet): ItemSet => ({ kind: "subtract", a, b });

/**
 * Spec §9 2.1 `alerted`: items with an open alert (`AOF.pivotTo("sourceSalesOrder")`), united under a
 * bounded window with items having a `closed` event in it. Under "now" (`start` null): open alerts only.
 */
export const alertedItems = (w: Window): ItemSet => {
  const openNow = itemsOfOpenAlerts(allOpenAlerts);
  return w.start === null ? openNow : { kind: "union", a: openNow, b: itemsWithEvent(["closed"], w) };
};

/**
 * Spec §9 2.0–2.4 item view: every stage set and both outside paths for window `w` and filters `f`.
 * Filters enter once, through so20; the event legs are unfiltered AlertHistory pivots.
 */
export const itemFunnelSets = (w: Window, f: ItemFilters): ItemFunnelSets => {
  const so20 = withItemFilters(openItemsInWindow(w), f);
  const so21 = intersect(so20, alertedItems(w));
  const so22 = intersect(so21, itemsWithEvent(["viewed"], w));
  const acted = itemsWithEvent(["action"], w);
  const writtenBack = itemsWithEvent(["writeback"], w);
  const so23 = intersect(so22, acted);
  const so24 = intersect(so23, writtenBack);
  return {
    so20,
    so21,
    so22,
    so23,
    so24,
    outside23: subtract(intersect(so21, acted), so22),
    outside24: subtract(intersect(so21, writtenBack), so23),
  };
};

/**
 * Spec §9 2.1 `perGroup(soX, g)`: items of a stage having at least one open alert (of the filtered items)
 * matching `cond`.
 */
export const stageWithOpenAlertWhere = (stage: ItemSet, f: ItemFilters, cond: OpenAlertCondition): ItemSet =>
  intersect(stage, itemsWithOpenAlertWhere(f, cond));

/** Spec §9 2.1 alert view terms: stage = distinct alerts of `life` + count(`open`) − count(`openWithLifecycle`). */
export interface CarriedAlertSets {
  /** Term a: opened/closed events in the window (item filters by pivot). */
  readonly life: EventSet;
  /** All open alerts (item filters by pivot); the only term under "now". */
  readonly open: OpenAlertSet;
  /** Open alerts that have an opened/closed event in the window (`life.pivotTo("alert")`). */
  readonly openWithLifecycle: OpenAlertSet;
}

/** Spec §9 2.1 alert view: the three term sets for window `w` and filters `f`. */
export const carriedAlertSets = (w: Window, f: ItemFilters): CarriedAlertSets => {
  const life = events(["lifecycle"], w, f);
  return { life, open: openAlerts(f), openWithLifecycle: openAlertsOfEvents(life) };
};
