/**
 * Deterministic, hand-checkable fixture dataset (instructions §11) for loader, derive and fake tests.
 * Alerts and events: see the ALERTS table and legend in `fixtureAlerts.ts`.
 *
 * FIXTURE_NOW = 2026-09-01T12:00:00.000Z. Window starts: 7 d 2026-08-25T12:00Z, 14 d 2026-08-18T12:00Z,
 * 30 d 2026-08-02T12:00Z, 90 d 2026-06-03T12:00Z (date-only bounds: 08-25, 08-18, 08-02, 06-03; end 09-01).
 *
 * Items I1–I40 (`${1000 + n}_10`), value n × 1000 USD (I29 null). Dims: business line odd BL-A / even BL-B
 * (I30 null); product line I1–15 PL-1, I16–30 PL-2, I31–40 PL-3 (I27 null); region I1–20 EMEA, I21–40 AMER
 * (I29 null); plant n mod 3 = 1 P100, 2 P200, 0 P300 (I28 null).
 * I1–I30 open (isOpen true, no GI date); created 2026-03-01 except I5 08-28, I6 08-20, I7 09-01, I8 08-25,
 * I27 null (so I27 is only in the "now" 2.0 set). I31–I40 closed (isOpen false) with actualGiDate:
 * I31 08-30, I32 08-25 (= 7 d start date, inclusive), I33 08-24, I34 08-10, I35 07-01, I36 04-01, I37 null,
 * I38 08-15, I39 06-10, I40 02-01. Items without any alert: I27, I28, I30.
 *
 * Risk (open items only, SalesOrderOtifEvaluation) — bucket: items
 *   unscored (null score): I6 NC, I7 NAR, I16 NC, I18 NAR, I20 NC, I24 NAR, I27 NC, I30 NAR   (8)
 *   b15_30: I1 30, I3 15, I15 20, I17 25, I26 12 (below 15: range starts at 0)                  (5)
 *   b31_50: I2 31, I8 50, I19 45, I28 40                                                        (4)
 *   b51_70: I9 51, I10 70, I21 65, I29 60                                                       (4)
 *   b71_90: I11 71, I12 90, I23 85                                                              (3)
 *   b91_100: I5 100 (At Risk), I13 91, I25 95                                                   (3)
 *   delayed: I4, I14, I22 (Delayed, score 100)                                                  (3)
 *
 * Verdicts (OtifOrderVerdict): see VERDICT_ROWS (id, otif, crit, otif gate, crit gate, ship end, first target).
 * App usage: see APP_USAGE_ROWS; u1 uses two queue filters (Planner, Logistics); u7 is on another app.
 */
import { METRICS_CONFIG } from "../../../../config/metrics";
import type { MetricsConfig } from "../../../../config/metrics";
import { FIXTURE_EVENTS, FIXTURE_OPEN_ALERTS, fixtureTime, itemId } from "./fixtureAlerts";
import type { FixtureAppUsage, FixtureItem, FixtureRisk, FixtureVerdict, MetricsFixtures } from "./fakeTypes";

/** The fixed "now" of every fixture test. */
export const FIXTURE_NOW: Date = new Date("2026-09-01T12:00:00.000Z");

/** AppUsageEvent.appId of the alert app in the fixtures (tests set `config.ALERT_APP_ID` to it). */
export const FIXTURE_APP_ID = "alert-app";

/** METRICS_CONFIG with the integration placeholders set to fixture values (ALERT_APP_ID, verdict date). */
export const FIXTURE_CONFIG: MetricsConfig = {
  ...METRICS_CONFIG,
  ALERT_APP_ID: FIXTURE_APP_ID,
  VERDICT_DATE_PROPERTY: "otifOtShipmentEndDate",
};

type Nullable = string | null;
/** Item columns: n, creation date, actual GI date, isOpen, valueUsd, business line, product line, region, plant. */
type ItemLine = readonly [number, Nullable, Nullable, boolean, number | null, Nullable, Nullable, Nullable, Nullable];

const ITEM_ROWS: readonly ItemLine[] = [
  [1, "2026-03-01", null, true, 1000, "BL-A", "PL-1", "EMEA", "P100"],
  [2, "2026-03-01", null, true, 2000, "BL-B", "PL-1", "EMEA", "P200"],
  [3, "2026-03-01", null, true, 3000, "BL-A", "PL-1", "EMEA", "P300"],
  [4, "2026-03-01", null, true, 4000, "BL-B", "PL-1", "EMEA", "P100"],
  [5, "2026-08-28", null, true, 5000, "BL-A", "PL-1", "EMEA", "P200"],
  [6, "2026-08-20", null, true, 6000, "BL-B", "PL-1", "EMEA", "P300"],
  [7, "2026-09-01", null, true, 7000, "BL-A", "PL-1", "EMEA", "P100"],
  [8, "2026-08-25", null, true, 8000, "BL-B", "PL-1", "EMEA", "P200"],
  [9, "2026-03-01", null, true, 9000, "BL-A", "PL-1", "EMEA", "P300"],
  [10, "2026-03-01", null, true, 10000, "BL-B", "PL-1", "EMEA", "P100"],
  [11, "2026-03-01", null, true, 11000, "BL-A", "PL-1", "EMEA", "P200"],
  [12, "2026-03-01", null, true, 12000, "BL-B", "PL-1", "EMEA", "P300"],
  [13, "2026-03-01", null, true, 13000, "BL-A", "PL-1", "EMEA", "P100"],
  [14, "2026-03-01", null, true, 14000, "BL-B", "PL-1", "EMEA", "P200"],
  [15, "2026-03-01", null, true, 15000, "BL-A", "PL-1", "EMEA", "P300"],
  [16, "2026-03-01", null, true, 16000, "BL-B", "PL-2", "EMEA", "P100"],
  [17, "2026-03-01", null, true, 17000, "BL-A", "PL-2", "EMEA", "P200"],
  [18, "2026-03-01", null, true, 18000, "BL-B", "PL-2", "EMEA", "P300"],
  [19, "2026-03-01", null, true, 19000, "BL-A", "PL-2", "EMEA", "P100"],
  [20, "2026-03-01", null, true, 20000, "BL-B", "PL-2", "EMEA", "P200"],
  [21, "2026-03-01", null, true, 21000, "BL-A", "PL-2", "AMER", "P300"],
  [22, "2026-03-01", null, true, 22000, "BL-B", "PL-2", "AMER", "P100"],
  [23, "2026-03-01", null, true, 23000, "BL-A", "PL-2", "AMER", "P200"],
  [24, "2026-03-01", null, true, 24000, "BL-B", "PL-2", "AMER", "P300"],
  [25, "2026-03-01", null, true, 25000, "BL-A", "PL-2", "AMER", "P100"],
  [26, "2026-03-01", null, true, 26000, "BL-B", "PL-2", "AMER", "P200"],
  [27, null, null, true, 27000, "BL-A", null, "AMER", "P300"],
  [28, "2026-03-01", null, true, 28000, "BL-B", "PL-2", "AMER", null],
  [29, "2026-03-01", null, true, null, "BL-A", "PL-2", null, "P200"],
  [30, "2026-03-01", null, true, 30000, null, "PL-2", "AMER", "P300"],
  [31, "2026-03-01", "2026-08-30", false, 31000, "BL-A", "PL-3", "AMER", "P100"],
  [32, "2026-03-01", "2026-08-25", false, 32000, "BL-B", "PL-3", "AMER", "P200"],
  [33, "2026-03-01", "2026-08-24", false, 33000, "BL-A", "PL-3", "AMER", "P300"],
  [34, "2026-03-01", "2026-08-10", false, 34000, "BL-B", "PL-3", "AMER", "P100"],
  [35, "2026-03-01", "2026-07-01", false, 35000, "BL-A", "PL-3", "AMER", "P200"],
  [36, "2026-03-01", "2026-04-01", false, 36000, "BL-B", "PL-3", "AMER", "P300"],
  [37, "2026-03-01", null, false, 37000, "BL-A", "PL-3", "AMER", "P100"],
  [38, "2026-03-01", "2026-08-15", false, 38000, "BL-B", "PL-3", "AMER", "P200"],
  [39, "2026-03-01", "2026-06-10", false, 39000, "BL-A", "PL-3", "AMER", "P300"],
  [40, "2026-03-01", "2026-02-01", false, 40000, "BL-B", "PL-3", "AMER", "P100"],
];

/** Risk columns: item number, otifStatus, otifScore. */
const RISK_ROWS: readonly (readonly [number, string, number | null])[] = [
  [1, "At Risk", 30], [2, "At Risk", 31], [3, "At Risk", 15], [4, "Delayed", 100], [5, "At Risk", 100],
  [6, "Not Confirmed", null], [7, "Not At Risk", null], [8, "At Risk", 50], [9, "At Risk", 51],
  [10, "At Risk", 70], [11, "At Risk", 71], [12, "At Risk", 90], [13, "At Risk", 91], [14, "Delayed", 100],
  [15, "Not At Risk", 20], [16, "Not Confirmed", null], [17, "Not At Risk", 25], [18, "Not At Risk", null],
  [19, "At Risk", 45], [20, "Not Confirmed", null], [21, "At Risk", 65], [22, "Delayed", 100],
  [23, "At Risk", 85], [24, "Not At Risk", null], [25, "At Risk", 95], [26, "Not At Risk", 12],
  [27, "Not Confirmed", null], [28, "At Risk", 40], [29, "At Risk", 60], [30, "Not At Risk", null],
];

/** Verdict columns: id, OTIF class, CRIT class, OTIF exclusion, CRIT exclusion, ship end date, first target date. */
const VERDICT_ROWS: readonly (readonly [string, Nullable, Nullable, string, string, Nullable, Nullable])[] = [
  ["1009_10", "OTIF", "CRIT", "No", "No", "2026-08-30", "2026-08-28"],
  ["1011_10", "Not OTIF", "CRIT", "No", "No", "2026-08-20", "2026-08-29"],
  ["1015_10", "OTIF", "Not CRIT", "No", "Yes", "2026-08-26", "2026-08-26"],
  ["1025_10", "Not OTIF", "Not CRIT", "Yes", "No", "2026-08-31", "2026-08-31"],
  ["1031_10", "OTIF", "CRIT", "No", "No", "2026-08-25", "2026-08-10"],
  ["1032_10", "OTIF", "CRIT", "No", "No", "2026-07-15", "2026-07-15"],
  ["1038_10", "Not OTIF", "CRIT", "No", "No", "2026-09-01", "2026-09-01"],
  ["1001_10", "OTIF", "CRIT", "No", "No", "2026-08-29", "2026-08-29"],
  ["1040_10", "OTIF", "Not CRIT", "No", "No", "2026-05-01", "2026-05-01"],
  ["9001_10", "OTIF", "CRIT", "No", "No", "2026-08-28", "2026-08-28"],
  ["9002_10", "Not OTIF", "Not CRIT", "No", "No", "2026-08-15", "2026-08-15"],
  ["9003_10", "OTIF", "CRIT", "Yes", "Yes", "2026-08-27", "2026-08-27"],
  ["9004_10", null, "CRIT", "No", "No", "2026-08-27", "2026-08-27"],
  ["9006_10", "OTIF", "CRIT", "No", "No", null, null],
];

/** App usage columns: userId, appId, days ago, hour (UTC), queue-filter persona. */
const APP_USAGE_ROWS: readonly (readonly [string, string, number, number, Nullable])[] = [
  ["u1", FIXTURE_APP_ID, 1, 9, "Planner"],
  ["u1", FIXTURE_APP_ID, 3, 9, "Logistics"],
  ["u1", FIXTURE_APP_ID, 0, 11, "Planner"],
  ["u2", FIXTURE_APP_ID, 2, 9, "All"],
  ["u2", FIXTURE_APP_ID, 20, 9, "All"],
  ["u3", FIXTURE_APP_ID, 10, 9, "CustomerService"],
  ["u4", FIXTURE_APP_ID, 1, 10, null],
  ["u5", FIXTURE_APP_ID, 40, 9, "Logistics"],
  ["u6", FIXTURE_APP_ID, 100, 9, "Planner"],
  ["u7", "other-app", 1, 9, "Planner"],
];

/** SalesOrders rows. */
export const FIXTURE_ITEMS: readonly FixtureItem[] = ITEM_ROWS.map(
  ([n, salesOrderItemCreationDate, actualGiDate, isOpen, valueUsd, businessLine, productLine, region, plant]) => ({
    salesOrderId: itemId(n),
    salesOrderItemCreationDate,
    actualGiDate,
    isOpen,
    valueUsd,
    businessLine,
    productLine,
    region,
    plant,
  }),
);

/** The whole fixture dataset (default data of `createFakeSource`). */
export const FIXTURES: MetricsFixtures = {
  items: FIXTURE_ITEMS,
  events: FIXTURE_EVENTS,
  openAlerts: FIXTURE_OPEN_ALERTS,
  risk: RISK_ROWS.map(([n, otifStatus, otifScore]): FixtureRisk => ({ salesOrderId: itemId(n), otifStatus, otifScore })),
  verdicts: VERDICT_ROWS.map(
    ([otifOrderId, otifVerdict, critVerdict, otifExclusion, critExclusion, ship, target]): FixtureVerdict => ({
      otifOrderId,
      otifVerdict,
      critVerdict,
      otifExclusion,
      critExclusion,
      otifOtShipmentEndDate: ship,
      otifFirstInitialDeliveryDateTarget: target,
    }),
  ),
  appUsage: APP_USAGE_ROWS.map(
    ([userId, appId, days, hour, persona], i): FixtureAppUsage => ({
      eventId: `U${String(i + 1).padStart(2, "0")}`,
      userId,
      appId,
      eventTimestamp: fixtureTime(days, hour),
      persona,
    }),
  ),
};
