/**
 * The named AlertHistory predicates of spec §4 evaluated on one event row, and the tie order at equal
 * timestamps (decision D8: one home for event classification). Values come from `config` (decision D1).
 * Used by `alertLifecycle.ts`, `alertSets.ts` and the fake source. Pure.
 */
import { EVENT_TIE_ORDER } from "../../../config/metrics";
import type { MetricsConfig } from "../../../config/metrics";
import type { EventPredicate } from "../query/specs";

/** The fields of an AlertHistory row the predicates read. `eventSource` may be null at the source. */
export interface ClassifiableEvent {
  readonly eventType: string;
  readonly eventSource: string | null;
}

/** An event row that can also be ordered in time (ISO-8601 UTC `eventTimestamp`). */
export interface TimedEvent extends ClassifiableEvent {
  readonly eventTimestamp: string;
}

/** A predicate on one event row taking config values (the `is*Event` functions below). */
export type EventTest = (event: ClassifiableEvent, config: MetricsConfig) => boolean;

/** Spec §4 `viewed_event`: `eventType = 'opened_by_user'`. */
export function isViewedEvent(event: ClassifiableEvent, config: MetricsConfig): boolean {
  return event.eventType === config.EVENT_TYPES.viewed;
}

/**
 * Spec §4 `action_event`: (eventSource in ACTION_EVENT_SOURCES OR eventType = 'deeplink_clicked') AND
 * eventType <> 'updated' (Appendix A W1). A view (`eventSource = 'user view'`) is not an action; a null
 * eventSource matches only through `deeplink_clicked`.
 */
export function isActionEvent(event: ClassifiableEvent, config: MetricsConfig): boolean {
  if (event.eventType === config.EVENT_TYPES.updated) return false;
  const sources: readonly string[] = config.ACTION_EVENT_SOURCES;
  const bySource = event.eventSource !== null && sources.includes(event.eventSource);
  return bySource || event.eventType === config.EVENT_TYPES.deeplink;
}

/** Spec §4 `writeback_event`: eventType is one of the three ERP write-back types. */
export function isWritebackEvent(event: ClassifiableEvent, config: MetricsConfig): boolean {
  const types: readonly string[] = config.EVENT_TYPES.writeback;
  return types.includes(event.eventType);
}

/** Spec §4 `human` = viewed OR action OR writeback (= worked, Appendix A W1–W2). `updated` is never human. */
export function isHumanEvent(event: ClassifiableEvent, config: MetricsConfig): boolean {
  return isViewedEvent(event, config) || isActionEvent(event, config) || isWritebackEvent(event, config);
}

/** Pipeline `opened` event (spec §3, §4 `raised(a)`). */
export function isOpenedEvent(event: ClassifiableEvent, config: MetricsConfig): boolean {
  return event.eventType === config.EVENT_TYPES.opened;
}

/** Pipeline `closed` event (spec §3, §4 `closed(a)`). */
export function isClosedEvent(event: ClassifiableEvent, config: MetricsConfig): boolean {
  return event.eventType === config.EVENT_TYPES.closed;
}

/** `lifecycle` = opened OR closed (spec §9.0 `PRED.lifecycle`). */
export function isLifecycleEvent(event: ClassifiableEvent, config: MetricsConfig): boolean {
  return isOpenedEvent(event, config) || isClosedEvent(event, config);
}

/**
 * Evaluates one named predicate (query/specs `EventPredicate`, spec §9.0 `PRED`) on an event row.
 * Returns true when the row matches.
 */
export function matchesPredicate(predicate: EventPredicate, event: ClassifiableEvent, config: MetricsConfig): boolean {
  switch (predicate) {
    case "viewed":
      return isViewedEvent(event, config);
    case "action":
      return isActionEvent(event, config);
    case "writeback":
      return isWritebackEvent(event, config);
    case "human":
      return isHumanEvent(event, config);
    case "opened":
      return isOpenedEvent(event, config);
    case "closed":
      return isClosedEvent(event, config);
    case "lifecycle":
      return isLifecycleEvent(event, config);
  }
}

/**
 * True when the row matches ANY of the predicates (an `EventFilter` ORs its predicates, query/specs).
 * An empty list matches nothing.
 */
export function matchesAnyPredicate(
  predicates: readonly EventPredicate[],
  event: ClassifiableEvent,
  config: MetricsConfig,
): boolean {
  return predicates.some((predicate) => matchesPredicate(predicate, event, config));
}

/**
 * Rank of an event in the spec §4 tie rule at equal timestamps: opened (0) < human (1) < closed (2).
 * `opened`/`closed` are checked first; any other event (e.g. `updated`) ranks with human events.
 */
export function tieRankOf(event: ClassifiableEvent, config: MetricsConfig): number {
  if (isOpenedEvent(event, config)) return EVENT_TIE_ORDER.opened;
  if (isClosedEvent(event, config)) return EVENT_TIE_ORDER.closed;
  return EVENT_TIE_ORDER.human;
}

/** Milliseconds since the epoch of an ISO-8601 timestamp (pure parse, no clock). */
export function timestampMs(iso: string): number {
  return Date.parse(iso);
}

/**
 * Negative / zero / positive comparison of two ISO-8601 timestamps by instant (not by string), so
 * `…Z` and `…+00:00` forms compare correctly.
 */
export function compareTimestamps(a: string, b: string): number {
  return timestampMs(a) - timestampMs(b);
}

/**
 * Sort comparator for events: by `eventTimestamp`, then by the spec §4 tie rule (opened, human, closed).
 * Events equal on both compare as 0 (a stable sort keeps input order).
 */
export function compareEvents(a: TimedEvent, b: TimedEvent, config: MetricsConfig): number {
  const byTime = compareTimestamps(a.eventTimestamp, b.eventTimestamp);
  return byTime !== 0 ? byTime : tieRankOf(a, config) - tieRankOf(b, config);
}

/** A copy of `events` in `compareEvents` order (stable; input untouched). */
export function sortEvents<E extends TimedEvent>(events: readonly E[], config: MetricsConfig): E[] {
  return [...events].sort((a, b) => compareEvents(a, b, config));
}
