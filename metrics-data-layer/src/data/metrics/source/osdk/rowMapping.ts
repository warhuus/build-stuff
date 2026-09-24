/**
 * OSDK rows → port rows (spec §10 row types; decision D15). A row missing its id field (or a field its row type
 * declares non-null, e.g. `eventTimestamp`) is dropped; other missing values become `null`. Timestamps are
 * normalised to ISO-8601 UTC; date values to `YYYY-MM-DD`. The `$select` lists are literal tuples (spec §8).
 */
import type { AlertEventRow, ItemRow, MetricsConfig, OpenAlertRow, VerdictRow } from "../../types";
import { toDateOnly } from "./compileWhere";

/** A property value as the client may deliver it: typed `T | undefined`; `null` accepted defensively. */
type Val<T> = T | null | undefined;

/** AlertHistory columns fetched for `AlertEventRow` (spec §9.0.1 L1/L2). */
export const EVENT_SELECT = [
  "riskAlertId",
  "salesOrderId",
  "eventType",
  "eventSource",
  "eventTimestamp",
  "persona",
  "riskType",
  "priorityAtEvent",
] as const;
/** AlertOrderFulfillment columns fetched for `OpenAlertRow` (spec §9.0.1 L3). */
export const OPEN_ALERT_SELECT = ["riskAlertId", "salesOrderId", "persona", "priority", "riskType", "escalated"] as const;
/** SalesOrders columns fetched for `ItemRow` (spec §9.0 `itemsById`). */
export const ITEM_SELECT = [
  "salesOrderId",
  "businessLineName",
  "productLineName",
  "iscRegionName",
  "plantCode",
  "valueUsd",
  "isOpen",
] as const;
/** OtifOrderVerdict columns fetched for `VerdictRow` (spec §9 4.1 `V_SELECT`; both candidate dates). */
export const VERDICT_SELECT = [
  "otifOrderId",
  "initOtifClassification",
  "critClassification",
  "officialExclusionOtif",
  "officialExclusionCrit",
  "otifOtShipmentEndDate",
  "otifFirstInitialDeliveryDateTarget",
] as const;

/** Structural view of a fetched AlertHistory row (the selected properties). */
export interface OsdkEventRow {
  readonly riskAlertId?: Val<string>;
  readonly salesOrderId?: Val<string>;
  readonly eventType?: Val<string>;
  readonly eventSource?: Val<string>;
  readonly eventTimestamp?: Val<string>;
  readonly persona?: Val<string>;
  readonly riskType?: Val<string>;
  readonly priorityAtEvent?: Val<string>;
}
/** Structural view of a fetched AlertOrderFulfillment row. */
export interface OsdkOpenAlertRow {
  readonly riskAlertId?: Val<string>;
  readonly salesOrderId?: Val<string>;
  readonly persona?: Val<string>;
  readonly priority?: Val<string>;
  readonly riskType?: Val<string>;
  readonly escalated?: Val<boolean>;
}
/** Structural view of a fetched SalesOrders row. */
export interface OsdkItemRow {
  readonly salesOrderId?: Val<string>;
  readonly businessLineName?: Val<string>;
  readonly productLineName?: Val<string>;
  readonly iscRegionName?: Val<string>;
  readonly plantCode?: Val<string>;
  readonly valueUsd?: Val<number>;
  readonly isOpen?: Val<boolean>;
}
/** Structural view of a fetched OtifOrderVerdict row. */
export interface OsdkVerdictRow {
  readonly otifOrderId?: Val<string>;
  readonly initOtifClassification?: Val<string>;
  readonly critClassification?: Val<string>;
  readonly officialExclusionOtif?: Val<string>;
  readonly officialExclusionCrit?: Val<string>;
  readonly otifOtShipmentEndDate?: Val<string>;
  readonly otifFirstInitialDeliveryDateTarget?: Val<string>;
}

const str = (v: Val<string>): string | null => (typeof v === "string" ? v : null);
const num = (v: Val<number>): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: Val<boolean>): boolean | null => (typeof v === "boolean" ? v : null);

/** ISO-8601 UTC form of a timestamp value; `null` when missing or unparsable. */
export function isoTimestamp(v: Val<string>): string | null {
  if (typeof v !== "string" || v === "") return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** AlertHistory → AlertEventRow; `null` (dropped) without riskAlertId, eventType or a valid eventTimestamp. */
export function toAlertEventRow(r: OsdkEventRow): AlertEventRow | null {
  const riskAlertId = str(r.riskAlertId);
  const eventType = str(r.eventType);
  const eventTimestamp = isoTimestamp(r.eventTimestamp);
  if (riskAlertId === null || eventType === null || eventTimestamp === null) return null;
  return {
    riskAlertId,
    salesOrderId: str(r.salesOrderId),
    eventType,
    eventSource: str(r.eventSource),
    eventTimestamp,
    persona: str(r.persona),
    riskType: str(r.riskType),
    priorityAtEvent: str(r.priorityAtEvent),
  };
}

/** AlertOrderFulfillment → OpenAlertRow; `null` (dropped) without riskAlertId or salesOrderId. */
export function toOpenAlertRow(r: OsdkOpenAlertRow): OpenAlertRow | null {
  const riskAlertId = str(r.riskAlertId);
  const salesOrderId = str(r.salesOrderId);
  if (riskAlertId === null || salesOrderId === null) return null;
  return {
    riskAlertId,
    salesOrderId,
    persona: str(r.persona),
    priority: str(r.priority),
    riskType: str(r.riskType),
    escalated: bool(r.escalated),
  };
}

/** SalesOrders → ItemRow (businessLine ← businessLineName, productLine ← productLineName, region ←
 * iscRegionName, plant ← plantCode; valueUsd in USD); `null` (dropped) without salesOrderId. */
export function toItemRow(r: OsdkItemRow): ItemRow | null {
  const salesOrderId = str(r.salesOrderId);
  if (salesOrderId === null) return null;
  return {
    salesOrderId,
    businessLine: str(r.businessLineName),
    productLine: str(r.productLineName),
    region: str(r.iscRegionName),
    plant: str(r.plantCode),
    valueUsd: num(r.valueUsd),
    isOpen: bool(r.isOpen),
  };
}

/**
 * Reads the verdict date named by `config.VERDICT_DATE_PROPERTY`. Throws while it is the placeholder (loadCard
 * blocks 4.1 first); call it before fetching so no request is sent. Spec §9 4.1, Appendix A V7.
 */
export function verdictDateReader(config: MetricsConfig): (r: OsdkVerdictRow) => Val<string> {
  switch (config.VERDICT_DATE_PROPERTY) {
    case "otifOtShipmentEndDate":
      return (r) => r.otifOtShipmentEndDate;
    case "otifFirstInitialDeliveryDateTarget":
      return (r) => r.otifFirstInitialDeliveryDateTarget;
    default:
      throw new Error("VERDICT_DATE_PROPERTY is not set (needs-integration-value)");
  }
}

/** OtifOrderVerdict → VerdictRow (`verdictDate` `YYYY-MM-DD` from `dateOf`); `null` (dropped) without otifOrderId. */
export function toVerdictRow(r: OsdkVerdictRow, dateOf: (r: OsdkVerdictRow) => Val<string>): VerdictRow | null {
  const otifOrderId = str(r.otifOrderId);
  if (otifOrderId === null) return null;
  const date = str(dateOf(r));
  return {
    otifOrderId,
    otifVerdict: str(r.initOtifClassification),
    critVerdict: str(r.critClassification),
    otifExclusion: str(r.officialExclusionOtif),
    critExclusion: str(r.officialExclusionCrit),
    verdictDate: date === null || date === "" ? null : toDateOnly(date),
  };
}
