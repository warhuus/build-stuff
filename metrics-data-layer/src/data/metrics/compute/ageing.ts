/**
 * 4.5 ageing backlog (spec §9 4.5, §10 `AgeingBacklog`; Appendix A O6): alert ages from the earliest
 * `opened` event, alert and item age histograms on `config.AGE_EDGES_DAYS`, and the threshold tiles for
 * N days (set here, so changing N never refetches, Appendix A O3). Pure; `asOf` is a parameter.
 */
import type { MetricsConfig } from "../../../config/metrics";
import type {
  AgeBin,
  AgeingBacklog,
  AgeingThreshold,
  AlertEventRow,
  ItemAgeBin,
  ItemRow,
  OpenAlertRow,
} from "../types";
import { daysBetween } from "../window";
import { assignBin, countBins, zeroFilledBins } from "./bins";
import { compareTimestamps } from "./eventPredicates";
import { percent } from "./stats";

/**
 * `raised(a)` per alert (spec §4): the earliest `eventTimestamp` of its opened events. The rows are the
 * L3 opened fetch (already restricted to `opened` events server-side), so every row counts.
 */
export function raisedAtByAlert(openedEvents: readonly AlertEventRow[]): Map<string, string> {
  const raised = new Map<string, string>();
  for (const event of openedEvents) {
    const current = raised.get(event.riskAlertId);
    if (current === undefined || compareTimestamps(event.eventTimestamp, current) < 0) {
      raised.set(event.riskAlertId, event.eventTimestamp);
    }
  }
  return raised;
}

/** An open alert with its age in days (null = unknown: no opened event since the pipeline start). */
export interface AgedAlert {
  readonly alert: OpenAlertRow;
  readonly ageDays: number | null;
}

/**
 * Age of each open alert at `asOf` in days (spec §9 4.5: (asOf − raisedAt) / 86 400 000 ms), null when
 * the alert has no raise time. A raise time after `asOf` gives age 0 (clamped, never negative).
 */
export function agedAlerts(
  alerts: readonly OpenAlertRow[],
  raisedAt: ReadonlyMap<string, string>,
  asOf: string,
): AgedAlert[] {
  return alerts.map((alert) => {
    const days = daysBetween(raisedAt.get(alert.riskAlertId) ?? null, asOf);
    return { alert, ageDays: days === null ? null : Math.max(0, days) };
  });
}

/** Known ages of `aged` (unknown ages dropped). */
function knownAges(aged: readonly AgedAlert[]): number[] {
  return aged.flatMap((entry) => (entry.ageDays === null ? [] : [entry.ageDays]));
}

/** Alert age histogram (spec §9 4.5 `alertBins`), zero-filled on `config.AGE_EDGES_DAYS`; unknown ages skipped. */
export function alertAgeBins(aged: readonly AgedAlert[], config: MetricsConfig): AgeBin[] {
  return countBins(knownAges(aged), config.AGE_EDGES_DAYS).map((bin) => ({
    binStart: bin.binStart,
    binEnd: bin.binEnd,
    alertCount: bin.count,
  }));
}

/**
 * Oldest known alert age per item (`salesOrderId`) among `aged`; items whose alerts all have unknown age
 * are absent. Map order = first appearance.
 */
export function oldestAgeByItem(aged: readonly AgedAlert[]): Map<string, number> {
  const oldest = new Map<string, number>();
  for (const { alert, ageDays } of aged) {
    if (ageDays === null) continue;
    oldest.set(alert.salesOrderId, Math.max(ageDays, oldest.get(alert.salesOrderId) ?? ageDays));
  }
  return oldest;
}

/** `valueUsd` of an item (USD), 0 when the item was not fetched or its value is null. */
function itemValue(salesOrderId: string, items: ReadonlyMap<string, ItemRow>): number {
  return items.get(salesOrderId)?.valueUsd ?? 0;
}

/**
 * Item age histogram (spec §9 4.5 `itemBins`, Appendix A O6): each item placed once by its OLDEST open
 * alert's age, its value summed once. Zero-filled on `config.AGE_EDGES_DAYS` (always present; all zero
 * with no aged items).
 */
export function itemAgeBins(
  aged: readonly AgedAlert[],
  items: ReadonlyMap<string, ItemRow>,
  config: MetricsConfig,
): ItemAgeBin[] {
  const bins = zeroFilledBins(config.AGE_EDGES_DAYS).map(
    (bin): ItemAgeBin => ({ binStart: bin.binStart, binEnd: bin.binEnd, itemCount: 0, valueUsd: 0 }),
  );
  for (const [salesOrderId, age] of oldestAgeByItem(aged)) {
    const index = assignBin(age, config.AGE_EDGES_DAYS);
    if (index === null) continue;
    const bin = bins[index];
    bins[index] = { ...bin, itemCount: bin.itemCount + 1, valueUsd: bin.valueUsd + itemValue(salesOrderId, items) };
  }
  return bins;
}

/**
 * Threshold tiles for N days (spec §9 4.5, Appendix A O6): alerts with age > N (strict); valueUsd = Σ
 * value over DISTINCT items with at least one such alert; pct = alerts / open alerts with known age,
 * null when none has a known age.
 */
export function thresholdTiles(
  aged: readonly AgedAlert[],
  items: ReadonlyMap<string, ItemRow>,
  days: number,
): AgeingThreshold {
  const past = aged.filter((entry) => entry.ageDays !== null && entry.ageDays > days);
  const pastItems = new Set(past.map((entry) => entry.alert.salesOrderId));
  const valueUsd = [...pastItems].reduce((total, id) => total + itemValue(id, items), 0);
  return { days, alerts: past.length, valueUsd, pct: percent(past.length, knownAges(aged).length) };
}

/** Inputs of `ageingBacklog`: the (possibly group-restricted) aged alerts, items by id, `asOf`, N. */
export interface AgeingInput {
  readonly aged: readonly AgedAlert[];
  readonly items: ReadonlyMap<string, ItemRow>;
  readonly asOf: string;
  readonly thresholdDays: number;
}

/**
 * The `AgeingBacklog` of a set of aged open alerts (spec §9 4.5): alertBins, itemBins, openAlerts = alert
 * count, unknownAge = alerts without a raise time, asOf, and the threshold tiles for `thresholdDays`.
 */
export function ageingBacklog(input: AgeingInput, config: MetricsConfig): AgeingBacklog {
  return {
    alertBins: alertAgeBins(input.aged, config),
    itemBins: itemAgeBins(input.aged, input.items, config),
    openAlerts: input.aged.length,
    unknownAge: input.aged.filter((entry) => entry.ageDays === null).length,
    asOf: input.asOf,
    threshold: thresholdTiles(input.aged, input.items, input.thresholdDays),
  };
}
