/**
 * Per-alert facts (`AlertLifecycleRow`, Appendix A W6) from an alert's AlertHistory events: spec §9.0.1
 * `alertFactsOf`, §4 `raised`/`closed`/`alert_is_closed`, §9 4.6 closure groups. Mirrors the second-draft
 * AlertLifecycle columns (spec §12.1, instructions §5 rule 9). Pure; config values are parameters (D1).
 */
import { CLOSURE_PRECEDENCE } from "../../../config/metrics";
import type { MetricsConfig } from "../../../config/metrics";
import type { AlertAttrs, AlertEventRow, AlertLifecycleRow, ClosureGroup } from "../types";
import {
  compareEvents,
  compareTimestamps,
  isActionEvent,
  isClosedEvent,
  isHumanEvent,
  isOpenedEvent,
  isViewedEvent,
  isWritebackEvent,
  sortEvents,
} from "./eventPredicates";
import type { EventTest, TimedEvent } from "./eventPredicates";

/** Attributes of an alert with no pipeline event: null, so it falls outside every group (spec §9.0.1). */
export const NULL_ALERT_ATTRS: AlertAttrs = { routingPersona: null, alertType: null, priority: null };

/** Human-event test per precedence group (spec §9 4.6: write-back → action → view only). */
const PRECEDENCE_TESTS: Readonly<Record<(typeof CLOSURE_PRECEDENCE)[number], EventTest>> = {
  writeBack: isWritebackEvent,
  action: isActionEvent,
  viewOnly: isViewedEvent,
};

/** Earliest event matching `test` in `compareEvents` order, or null. */
function earliest<E extends TimedEvent>(events: readonly E[], test: EventTest, config: MetricsConfig): E | null {
  return events.reduce<E | null>((best, event) => {
    if (!test(event, config)) return best;
    return best === null || compareEvents(event, best, config) < 0 ? event : best;
  }, null);
}

/** Latest event matching `test` in `compareEvents` order (later input wins a full tie), or null. */
function latest<E extends TimedEvent>(events: readonly E[], test: EventTest, config: MetricsConfig): E | null {
  return events.reduce<E | null>((best, event) => {
    if (!test(event, config)) return best;
    return best === null || compareEvents(event, best, config) >= 0 ? event : best;
  }, null);
}

/**
 * 4.6 closure group (spec §9 4.6, Excel 4.6): precedence write-back → action → view only over the human
 * events with `eventTimestamp ≤ closedAt` (tie rule: at an equal timestamp human events precede `closed`,
 * spec §4); none → `noHuman`. Events after `closedAt` are ignored. `closedAt` null (alert not closed) → null.
 */
export function closureGroupOf(
  events: readonly TimedEvent[],
  closedAt: string | null,
  config: MetricsConfig,
): ClosureGroup | null {
  if (closedAt === null) return null;
  const beforeClose = events.filter(
    (event) => isHumanEvent(event, config) && compareTimestamps(event.eventTimestamp, closedAt) <= 0,
  );
  const group = CLOSURE_PRECEDENCE.find((candidate) =>
    beforeClose.some((event) => PRECEDENCE_TESTS[candidate](event, config)),
  );
  return group ?? "noHuman";
}

/**
 * The alert's latest pipeline event per Appendix A W6: the latest `closed` event when the alert is closed,
 * else the latest `opened` event, falling back to the latest `closed` event when there is no `opened`
 * (reopened alert raised before PIPELINE_EVENTS_START). Null when the alert has no pipeline event.
 */
export function attrsEventOf(
  events: readonly AlertEventRow[],
  isClosed: boolean,
  config: MetricsConfig,
): AlertEventRow | null {
  const lastClosed = latest(events, isClosedEvent, config);
  if (isClosed) return lastClosed;
  return latest(events, isOpenedEvent, config) ?? lastClosed;
}

/**
 * `attrs` from the latest pipeline event (`attrsEventOf`): its persona (routing persona), riskType
 * (alert type) and priorityAtEvent. Persona on human events is the queue filter and is never used.
 * No pipeline event → all null (`NULL_ALERT_ATTRS`). Spec §9.0.1, Appendix A W6.
 */
export function alertAttrsOf(events: readonly AlertEventRow[], isClosed: boolean, config: MetricsConfig): AlertAttrs {
  const source = attrsEventOf(events, isClosed, config);
  if (source === null) return NULL_ALERT_ATTRS;
  return { routingPersona: source.persona, alertType: source.riskType, priority: source.priorityAtEvent };
}

/** First non-null `salesOrderId`, preferring the attrs event, then events in time order; else null. */
function salesOrderIdOf(ordered: readonly AlertEventRow[], attrsEvent: AlertEventRow | null): string | null {
  return attrsEvent?.salesOrderId ?? ordered.find((event) => event.salesOrderId !== null)?.salesOrderId ?? null;
}

/**
 * Builds one alert's facts (spec §9.0.1 `alertFactsOf`, Appendix A W6). Only events whose `riskAlertId`
 * equals `riskAlertId` are used; pass ALL of the alert's events (all-time, W4).
 * - raisedAt = min `opened` ts (null without an opened event: raised before PIPELINE_EVENTS_START, spec §4);
 * - closedAt = max `closed` ts; isClosed = has a `closed` event AND not `isOpenNow` (spec §4 `alert_is_closed`);
 * - firstViewAt / firstActionAt / firstWritebackAt = earliest matching event over all events given;
 * - worked = any human event; closureGroup = `closureGroupOf` when closed, else null;
 * - attrs = `alertAttrsOf`; salesOrderId from the events. Timestamps are the input ISO strings.
 */
export function alertFactsOf(
  riskAlertId: string,
  events: readonly AlertEventRow[],
  isOpenNow: boolean,
  config: MetricsConfig,
): AlertLifecycleRow {
  const own = events.filter((event) => event.riskAlertId === riskAlertId);
  const stampOf = (test: EventTest): string | null => earliest(own, test, config)?.eventTimestamp ?? null;
  const closedAt = latest(own, isClosedEvent, config)?.eventTimestamp ?? null;
  const isClosed = closedAt !== null && !isOpenNow;
  const attrsEvent = attrsEventOf(own, isClosed, config);
  return {
    riskAlertId,
    salesOrderId: salesOrderIdOf(sortEvents(own, config), attrsEvent),
    raisedAt: stampOf(isOpenedEvent),
    closedAt,
    isClosed,
    firstViewAt: stampOf(isViewedEvent),
    firstActionAt: stampOf(isActionEvent),
    firstWritebackAt: stampOf(isWritebackEvent),
    worked: own.some((event) => isHumanEvent(event, config)),
    closureGroup: isClosed ? closureGroupOf(own, closedAt, config) : null,
    attrs: alertAttrsOf(own, isClosed, config),
  };
}

/**
 * Groups event rows by `riskAlertId`. Map order = first appearance; each list keeps input order.
 * Empty input → empty map.
 */
export function groupEventsByAlert<E extends { readonly riskAlertId: string }>(
  rows: readonly E[],
): Map<string, E[]> {
  const byAlert = new Map<string, E[]>();
  for (const row of rows) {
    const list = byAlert.get(row.riskAlertId);
    if (list) list.push(row);
    else byAlert.set(row.riskAlertId, [row]);
  }
  return byAlert;
}

/**
 * Facts for every id in `alertIds` (in that order, duplicates collapsed) from a pool of event rows that
 * may cover other alerts too; `openNowIds` = alerts open now (AlertOrderFulfillment rows). An id with no
 * events gets all-null facts, `worked: false`. Spec §9.0.1 L2, decision D2 (4.2 not-worked).
 */
export function alertFactsForIds(
  alertIds: Iterable<string>,
  rows: readonly AlertEventRow[],
  openNowIds: ReadonlySet<string>,
  config: MetricsConfig,
): AlertLifecycleRow[] {
  const byAlert = groupEventsByAlert(rows);
  return [...new Set(alertIds)].map((id) => alertFactsOf(id, byAlert.get(id) ?? [], openNowIds.has(id), config));
}
