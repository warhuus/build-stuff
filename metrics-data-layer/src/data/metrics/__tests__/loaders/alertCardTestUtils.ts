/** Test helper for the section-4 alert card loaders (4.2–4.6): selections, expected port calls, fixture ids. */
import { expect } from "vitest";
import { closedNotOpenNow, humanEvents, openedEventsOfItemsOf, touchedEventsChain, touchedOpenAlerts } from "../../query/build";
import { DEFAULT_SELECTION, EMPTY_FILTERS } from "../../selection";
import { itemId } from "../../source/fake/fixtureAlerts";
import type { FakeCall, FakeSource } from "../../source/fake/fakeSource";
import type { ItemFilters, Selection, Window, WindowKey } from "../../types";

/** Default selection with a window key and filters. */
export const sel = (window: WindowKey, filters: ItemFilters = EMPTY_FILTERS): Selection => ({
  ...DEFAULT_SELECTION,
  window,
  filters,
});

/** The three port calls of one L2 run (L1 human events, the chain, the touched open alerts). */
export const l2Calls = (w: Window, f: ItemFilters): FakeCall[] => [
  { method: "fetchEvents", args: [humanEvents(w, f)] },
  { method: "fetchEvents", args: [touchedEventsChain(w, f)] },
  { method: "fetchOpenAlerts", args: [touchedOpenAlerts(w, f)] },
];

/** The two port calls of the 4.2 not-worked fetch. */
export const notWorkedCalls = (w: Window, f: ItemFilters): FakeCall[] => [
  { method: "fetchEvents", args: [closedNotOpenNow(w, f)] },
  { method: "fetchEvents", args: [openedEventsOfItemsOf(closedNotOpenNow(w, f))] },
];

/** The itemsById call for item numbers (ids sorted, as loadItemsByIds sends them). */
export const itemsCall = (nums: readonly number[]): FakeCall => ({
  method: "fetchItemsByIds",
  args: [[...nums].sort((a, b) => a - b).map(itemId)],
});

/** Asserts the recorded calls equal `expected` as a multiset (parallel calls have no fixed order). */
export function expectCalls(source: FakeSource, expected: readonly FakeCall[]): void {
  const norm = (calls: readonly FakeCall[]): string[] => calls.map((c) => JSON.stringify(c)).sort();
  expect(norm(source.calls)).toEqual(norm(expected));
}

/** Item numbers 1..n ranges helper: `range(9, 26)` = 9, 10, …, 26. */
export const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * Items of the 46 L2("now") alerts (no filter). Alert → item: A09–A23 → I9–I23, A25 I25, A26 I26,
 * A27 I9, A28 I16, A29 I29, A30 I20, A32 I2, A33 I3, A42 I38, A43 I39, A44 I40, A45 I31, A46 I32,
 * A47 I33, A48 I34, A49 I10, A50 I11, A51 I12, A52 I35, A53 I36, A54 I13, A55 I14, A56 I15, A58 I17,
 * A60 I19, A62 I21, A63 I22, A65 I24, A67 I26, A69 I6, A70 I7 → distinct: I2 I3 I6 I7, I9–I26, I29,
 * I31–I36, I38–I40 = 4 + 18 + 1 + 6 + 3 = 32.
 */
export const L2_NOW_ITEMS: readonly number[] = [2, 3, 6, 7, ...range(9, 26), 29, ...range(31, 36), 38, 39, 40];

/** The 46 L2("now") alert ids: every alert with a human token (A24 agent-only, A08/A34 `up` only excluded). */
export const L2_NOW_IDS: readonly string[] = [
  ...range(9, 23), 25, 26, 27, 28, 29, 30, 32, 33, ...range(42, 56), 58, 60, 62, 63, 65, 67, 69, 70,
].map((n) => `A${String(n).padStart(2, "0")}`);

/** The 18 L2("now") alerts on AMER items (I21–I40 except I29). */
export const L2_NOW_AMER_IDS: readonly string[] = [
  "A21", "A22", "A23", "A25", "A26", "A42", "A43", "A44", "A45", "A46", "A47", "A48", "A52", "A53", "A62", "A63",
  "A65", "A67",
];

/** Their items: A21/A62 I21, A22/A63 I22, A23 I23, A65 I24, A25 I25, A26/A67 I26, A45 I31, A46 I32, A47 I33,
 * A48 I34, A52 I35, A53 I36, A42 I38, A43 I39, A44 I40 → 15. */
export const L2_NOW_AMER_ITEMS: readonly number[] = [...range(21, 26), ...range(31, 36), 38, 39, 40];
