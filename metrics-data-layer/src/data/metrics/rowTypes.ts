/**
 * Row types of the row fetches in spec §9 (raw, before compute), exactly spec §10, plus the per-alert
 * fact row `AlertLifecycleRow` (Appendix A W6). Types only; field names are business names, the
 * OSDK adapter maps property apiNames to them. Timestamps are ISO-8601 UTC strings.
 */
import type { ClosureGroup } from "./outputTypes";

/** L1 row as the spec names it (human AlertHistory event). Spec §10, §9.0.1 L1. */
export interface HumanEvent {
  readonly riskAlertId: string;
  readonly salesOrderId: string | null;
  readonly eventType: string;
  readonly eventSource: string;
  readonly eventTimestamp: string;
  readonly persona: string | null;
  readonly riskType: string | null;
  readonly priorityAtEvent: string | null;
}
/** AlertHistory row as fetched by `MetricsSource.fetchEvents` (L1, L2, L3 opened, 4.2). Spec §10. */
export interface AlertEventRow {
  readonly riskAlertId: string;
  readonly salesOrderId: string | null;
  readonly eventType: string;
  readonly eventSource: string | null;
  readonly eventTimestamp: string;
  readonly persona: string | null;
  readonly riskType: string | null;
  readonly priorityAtEvent: string | null;
}
/** AlertOrderFulfillment row (open alert). `persona` = routing persona. Spec §10, L3. */
export interface OpenAlertRow {
  readonly riskAlertId: string;
  readonly salesOrderId: string;
  readonly persona: string | null;
  readonly priority: string | null;
  readonly riskType: string | null;
  readonly escalated: boolean | null;
}
/** SalesOrders row (L3 items; items by id). Value in USD. Spec §10. */
export interface ItemRow {
  readonly salesOrderId: string;
  readonly businessLine: string | null;
  readonly productLine: string | null;
  readonly region: string | null;
  readonly plant: string | null;
  readonly valueUsd: number | null;
  readonly isOpen: boolean | null;
}
/**
 * OtifOrderVerdict row (4.1). `verdictDate` = the `VERDICT_DATE_PROPERTY` value (`YYYY-MM-DD`). Spec §10.
 */
export interface VerdictRow {
  readonly otifOrderId: string;
  readonly otifVerdict: string | null;
  readonly critVerdict: string | null;
  readonly otifExclusion: string | null;
  readonly critExclusion: string | null;
  readonly verdictDate: string | null;
}
/** Latest-pipeline-event attributes of an alert (`closed` if closed, else `opened`). Appendix A W6. */
export interface AlertAttrs {
  readonly routingPersona: string | null;
  readonly alertType: string | null;
  readonly priority: string | null;
}
/**
 * Per-alert facts (= AlertFacts, L2 rows; exactly spec §10). Built by `compute/alertLifecycle.ts`
 * today; mapped from the future AlertLifecycle object at integration (instructions §5 rule 9).
 * `closureGroup` null while open.
 */
export interface AlertLifecycleRow {
  readonly riskAlertId: string;
  readonly salesOrderId: string | null;
  readonly raisedAt: string | null;
  readonly closedAt: string | null;
  readonly isClosed: boolean;
  readonly firstViewAt: string | null;
  readonly firstActionAt: string | null;
  readonly firstWritebackAt: string | null;
  readonly worked: boolean;
  readonly closureGroup: ClosureGroup | null;
  readonly attrs: AlertAttrs;
}

/** Ungrouped item aggregate: `$count` (distinct items) and `valueUsd:sum` (USD; 0 when none). Spec §9.0 `stageTotal`. */
export interface CountValue {
  readonly count: number;
  readonly valueUsd: number;
}
/** One exact group of a count aggregate; `group` = raw value (booleans `"true"`/`"false"`). Nulls never appear. */
export interface GroupCount {
  readonly group: string;
  readonly count: number;
}
/** One exact group of an item aggregate with count and value. Spec §9.0 `stageByItemDim`. */
export interface GroupCountValue extends CountValue {
  readonly group: string;
}
/** One `$ranges` group: the range's `startValue` and its count; empty ranges are omitted. Spec §8. */
export interface RangeCount {
  readonly startValue: number;
  readonly count: number;
}
/** A paged row fetch: rows (at most ROW_CAP) and whether the cap stopped it. Spec §9.0 `fetchAllPages`. */
export interface Paged<T> {
  readonly rows: readonly T[];
  readonly capped: boolean;
}
