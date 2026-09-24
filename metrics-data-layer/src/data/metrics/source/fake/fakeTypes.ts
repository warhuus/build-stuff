/**
 * In-memory row shapes of the fake source (instructions §6, §11). Field names are business names that
 * mirror the object properties the port needs; dates are `YYYY-MM-DD`, timestamps ISO-8601 UTC strings.
 */
import type { PLACEHOLDER, VerdictDateProperty } from "../../../../config/metrics";
import type { OpenAlertRow } from "../../types";

/** A SalesOrders row (one sales order item). */
export interface FixtureItem {
  readonly salesOrderId: string;
  readonly salesOrderItemCreationDate: string | null;
  readonly actualGiDate: string | null;
  readonly isOpen: boolean | null;
  readonly valueUsd: number | null;
  readonly businessLine: string | null;
  readonly productLine: string | null;
  readonly region: string | null;
  readonly plant: string | null;
}

/** An AlertHistory row. `persona` on human events is the queue filter; on pipeline events the routing persona. */
export interface FixtureEvent {
  readonly historyEventId: string;
  readonly riskAlertId: string;
  readonly salesOrderId: string | null;
  readonly eventType: string;
  readonly eventSource: string | null;
  readonly eventActor: string | null;
  readonly eventTimestamp: string;
  readonly persona: string | null;
  readonly riskType: string | null;
  readonly priorityAtEvent: string | null;
}

/** An AlertOrderFulfillment row: currently open alerts only. */
export type FixtureOpenAlert = OpenAlertRow;

/** A SalesOrderOtifEvaluation row (open items only). */
export interface FixtureRisk {
  readonly salesOrderId: string;
  readonly otifStatus: string | null;
  readonly otifScore: number | null;
}

/** Verdict date properties that can be chosen at integration (V7), excluding the placeholder. */
export type ChosenVerdictDateProperty = Exclude<VerdictDateProperty, typeof PLACEHOLDER>;

/** An OtifOrderVerdict row with both gates and both candidate verdict dates (`YYYY-MM-DD` or null). */
export type FixtureVerdict = {
  readonly otifOrderId: string;
  readonly otifVerdict: string | null;
  readonly critVerdict: string | null;
  readonly otifExclusion: string | null;
  readonly critExclusion: string | null;
} & Readonly<Record<ChosenVerdictDateProperty, string | null>>;

/** An AppUsageEvent row. `persona` = queue filter selected at the time. */
export interface FixtureAppUsage {
  readonly eventId: string;
  readonly userId: string | null;
  readonly appId: string;
  readonly eventTimestamp: string;
  readonly persona: string | null;
}

/** The whole in-memory dataset the fake source evaluates specs over. */
export interface MetricsFixtures {
  readonly items: readonly FixtureItem[];
  readonly events: readonly FixtureEvent[];
  readonly openAlerts: readonly FixtureOpenAlert[];
  readonly risk: readonly FixtureRisk[];
  readonly verdicts: readonly FixtureVerdict[];
  readonly appUsage: readonly FixtureAppUsage[];
}
