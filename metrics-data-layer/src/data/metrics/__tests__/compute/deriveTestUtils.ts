// Small hand-built rows and selections for the derive tests (no fixtures).
import { METRICS_CONFIG } from "../../../../config/metrics";
import type { MetricsConfig } from "../../../../config/metrics";
import { DEFAULT_SELECTION } from "../../selection";
import type {
  AlertEventRow,
  AlertLifecycleRow,
  ItemRow,
  OpenAlertRow,
  Selection,
  Window,
  WindowKey,
} from "../../types";
import { resolveWindow } from "../../window";

export const NOW = new Date("2026-09-24T12:00:00.000Z");
export const NOW_ISO = NOW.toISOString();

/** Window resolved at NOW (7 d: start 2026-09-17T12:00Z). */
export const win = (key: WindowKey): Window => resolveWindow(key, NOW);

/** Default selection with overrides. */
export const sel = (overrides: Partial<Selection> = {}): Selection => ({ ...DEFAULT_SELECTION, ...overrides });

/** Config with small group caps: top-2 shown, MAX_GROUPS 3. */
export const SMALL: MetricsConfig = { ...METRICS_CONFIG, BREAKDOWN_MAX_GROUPS: 2, MAX_GROUPS: 3 };

/** ISO timestamp `days` days (fractional ok) before NOW. */
export const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

/** A fact row; defaults: closed 1 day ago, raised 2 days ago, worked, attrs A/P1/High. */
export const fact = (id: string, overrides: Partial<AlertLifecycleRow> = {}): AlertLifecycleRow => ({
  riskAlertId: id,
  salesOrderId: `so-${id}`,
  raisedAt: daysAgo(2),
  closedAt: daysAgo(1),
  isClosed: true,
  firstViewAt: null,
  firstActionAt: null,
  firstWritebackAt: null,
  worked: true,
  closureGroup: "viewOnly",
  attrs: { alertType: "A", routingPersona: "P1", priority: "High" },
  ...overrides,
});

/** An event row (defaults: a view by a user 1 day ago). */
export const ev = (riskAlertId: string, eventType: string, overrides: Partial<AlertEventRow> = {}): AlertEventRow => ({
  riskAlertId,
  salesOrderId: `so-${riskAlertId}`,
  eventType,
  eventSource: eventType === "opened_by_user" ? "user view" : "user",
  eventTimestamp: daysAgo(1),
  persona: null,
  riskType: null,
  priorityAtEvent: null,
  ...overrides,
});

/** An open alert row. */
export const openAlert = (riskAlertId: string, overrides: Partial<OpenAlertRow> = {}): OpenAlertRow => ({
  riskAlertId,
  salesOrderId: `so-${riskAlertId}`,
  persona: "P1",
  priority: "High",
  riskType: "A",
  escalated: false,
  ...overrides,
});

/** An item row. */
export const item = (salesOrderId: string, overrides: Partial<ItemRow> = {}): ItemRow => ({
  salesOrderId,
  businessLine: "BL1",
  productLine: "PL1",
  region: "R1",
  plant: "P01",
  valueUsd: 100,
  isOpen: true,
  ...overrides,
});
