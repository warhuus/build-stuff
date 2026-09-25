/** Test helper for the section-4 alert card loaders (4.2–4.6): selections, expected port calls, fixture ids. */
import { expect } from "vitest";
import { closedNotOpenNow, humanEvents, openedEventsOfItemsOf, touchedEventsChain, touchedOpenAlerts } from "../../query/build";
import { itemId } from "../../source/fake/fixtureAlerts";
import type { FakeCall, FakeSource } from "../../source/fake/fakeSource";
import type { ItemFilters, Window, WindowKey } from "../../types";

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

/** Alert ids from numbers and inclusive [from, to] ranges: `alertIds(9, [11, 13])` = A09 A11 A12 A13. */
export const alertIds = (...ns: readonly (number | readonly [number, number])[]): string[] =>
  ns.flatMap((n) => (typeof n === "number" ? [n] : Array.from({ length: n[1] - n[0] + 1 }, (_, i) => n[0] + i)))
    .map((n) => `A${String(n).padStart(2, "0")}`);
/** The 48 open alerts (status O in the ALERTS table): A01–A34, A57–A70. */
export const OPEN_IDS: readonly string[] = alertIds([1, 34], [57, 70]);
/**
 * L1 = L2(w) alert ids per window: alerts with a human token (vw ac rs es dl wb wt wr) whose stamp is in the window.
 * 7 d (24 rows): A09 vw@2, A11 vw@5, A13 vw@1, A15 vw+ac@5, A18 ac@3, A19 vw+ac@1, A21 ac@3, A25 vw+ac+wb@4,
 *   A32 ac@5, A44 vw@6, A46 vw+ac@5, A49 vw+ac@4, A53 vw@5, A54 ac@3, A58 vw@0, A62 vw@1, A65 vw@2, A70 dl@1.
 * 14 d (37 rows) adds A10 vw@9, A16 vw@12+rs@11, A26 vw+wt@11, A28 wb@10, A29 vw@9, A42 vw@11, A50 vw+ac+wb@8,
 *   A55 vw@8, A69 vw@10 (+13).
 * 30 d (47 rows) adds A11 vw@18 (row only), A17 vw+dl@27, A22 dl@15, A27 wr@24, A43 vw@29, A47 ac@17,
 *   A51 wt@19, A60 vw+ac@19 (+10).
 * 90 d (62 rows) adds A12 vw@35, A18 vw@48 (row only), A20 vw+es@65, A23 rs@33, A28 vw+ac@75 (rows only),
 *   A30 vw@59, A45 vw@69, A48 vw+dl@44, A52 vw+wr@58, A63 es@43, A67 vw@87 (+15).
 * now (66 rows) adds A14 vw@92, A32 vw@120 (row only), A33 vw@200, A56 vw@130 (+4).
 */
export const TOUCHED_IDS: Readonly<Record<WindowKey, readonly string[]>> = {
  7: alertIds(9, 11, 13, 15, 18, 19, 21, 25, 32, 44, 46, 49, 53, 54, 58, 62, 65, 70),
  14: alertIds(9, 10, 11, 13, 15, 16, 18, 19, 21, 25, 26, 28, 29, 32, 42, 44, 46, 49, 50, 53, 54, 55, 58, 62, 65, 69, 70),
  30: alertIds([9, 11], 13, [15, 19], 21, 22, [25, 29], 32, 42, 43, 44, 46, 47, [49, 51], 53, 54, 55, 58, 60, 62, 65, 69, 70),
  90: alertIds([9, 13], [15, 23], [25, 30], 32, [42, 55], 58, 60, 62, 63, 65, 67, 69, 70),
  now: alertIds([9, 23], [25, 30], 32, 33, [42, 56], 58, 60, 62, 63, 65, 67, 69, 70),
};
