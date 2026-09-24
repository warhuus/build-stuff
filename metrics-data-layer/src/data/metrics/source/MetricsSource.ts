/**
 * The data source port (instructions §6). Every data source (OSDK adapter, in-memory fake) implements
 * `MetricsSource` with identical semantics. No OSDK type appears here.
 *
 * Shared semantics (both implementations):
 * - One aggregate method call = one server aggregate. Grouped calls use `$exactWithLimit: config.MAX_GROUPS`
 *   and return at most that many groups (the fake truncates, keeping the largest counts, ties by group name);
 *   null group values are dropped; booleans become `config.ESCALATED_GROUP_LABELS` strings. The caller adds
 *   `truncated` when `rows.length === config.MAX_GROUPS` (instructions §5 rule 7).
 * - Row fetches page by `config.PAGE_SIZE`, stop at `config.ROW_CAP` (`capped: true`), check
 *   `ctx.signal.aborted` between pages and batches (rejecting with an AbortError), and report
 *   `ctx.onProgress({ loaded })` after each page. Id lookups chunk by `config.ID_BATCH` with at most
 *   `config.INNER_CONCURRENCY` chunks in flight (own limiter, never the app semaphore; Appendix A X3).
 * - AlertOrderFulfillment holds open alerts only; the event → open-alert pivot resolves only for open alerts;
 *   `opened`/`closed` events exist only from `config.PIPELINE_EVENTS_START`.
 * - Allowed row fetches (Appendix A X2): L1–L3, items by id, 4.1 worked ids and verdicts, the 4.2 not-worked
 *   fetch, 4.5. Everything else is an aggregate.
 */
import type {
  AlertEventRow,
  BreakdownDimension,
  CountValue,
  GroupCount,
  GroupCountValue,
  ItemRow,
  LoaderOutput,
  MetricsConfig,
  OpenAlertRow,
  Paged,
  Progress,
  RangeCount,
  Selection,
  VerdictRow,
  Window,
} from "../types";
import type {
  AppUsageGroupField,
  EventDistinctField,
  EventGroupField,
  EventSet,
  ItemGroupField,
  ItemSet,
  OpenAlertGroupField,
  OpenAlertSet,
  RiskSet,
  VerdictFilter,
} from "../query/specs";

/** Per-call context: abort signal (checked between pages/batches), progress sink, config. */
export interface SourceCtx {
  readonly signal: AbortSignal;
  readonly onProgress?: (p: Progress) => void;
  readonly config: MetricsConfig;
}

/** 4.1 gated totals grouped by the mode's classification value (e.g. "OTIF" / "Not OTIF"). */
export type VerdictTotals = readonly GroupCount[];

/** The port. Every method rejects on abort or source error; none returns partial data silently. */
export interface MetricsSource {
  /** `$count` + `valueUsd:sum` of an item set (spec §9.0 `stageTotal`). valueUsd 0 when empty. */
  countItems(set: ItemSet, ctx: SourceCtx): Promise<CountValue>;
  /** The same grouped by an item dimension (spec §9.0 `stageByItemDim`); null values dropped. */
  countItemsBy(set: ItemSet, groupBy: ItemGroupField, ctx: SourceCtx): Promise<readonly GroupCountValue[]>;

  /** `eventActor:exactDistinct` or `riskAlertId:exactDistinct` of an event set (spec §9 1.2–1.4, 2.1, 4.6). */
  countEvents(set: EventSet, distinct: EventDistinctField, ctx: SourceCtx): Promise<number>;
  /** The same grouped by an AlertHistory group-by field (spec §9.0 `ahGroupBy`). */
  countEventsBy(
    set: EventSet,
    distinct: EventDistinctField,
    groupBy: EventGroupField,
    ctx: SourceCtx,
  ): Promise<readonly GroupCount[]>;

  /** `$count` of an open-alert set (spec §9 2.1 alert view, term b). */
  countOpenAlerts(set: OpenAlertSet, ctx: SourceCtx): Promise<number>;
  /** The same grouped by an AlertOrderFulfillment field (spec §9.0 `aofGroupBy`); escalated → "true"/"false". */
  countOpenAlertsBy(set: OpenAlertSet, groupBy: OpenAlertGroupField, ctx: SourceCtx): Promise<readonly GroupCount[]>;

  /** `$count` of a risk-evaluation set (spec §9 3.1 total and delayed counts). */
  countRisk(set: RiskSet, ctx: SourceCtx): Promise<number>;
  /**
   * `$count` grouped by `otifScore` `$ranges` (no `$exactWithLimit`); rows keyed by range start, empty ranges
   * omitted, null scores dropped (spec §9 3.1 `byRange`). `ranges` are `[start, end)`.
   */
  countRiskByScoreRange(
    set: RiskSet,
    ranges: readonly (readonly [number, number])[],
    ctx: SourceCtx,
  ): Promise<readonly RangeCount[]>;

  /** `userId:exactDistinct` of AppUsageEvent with appId = `config.ALERT_APP_ID` in the window (spec §9 1.1). */
  countAppUsers(window: Window, ctx: SourceCtx): Promise<number>;
  /** The same grouped by queue-filter persona (spec §9 1.1). */
  countAppUsersBy(window: Window, groupBy: AppUsageGroupField, ctx: SourceCtx): Promise<readonly GroupCount[]>;

  /** Gated OtifOrderVerdict `$count` grouped by the mode's classification (spec §9 4.1 step 1). */
  countVerdictsBy(filter: VerdictFilter, ctx: SourceCtx): Promise<VerdictTotals>;

  /** Paged fetch of AlertHistory rows of an event set (L1, L2 chain, L3 opened, 4.2 not-worked). */
  fetchEvents(set: EventSet, ctx: SourceCtx): Promise<Paged<AlertEventRow>>;
  /** Paged fetch of open alerts (L3 alerts; L2 touched-and-open ids). */
  fetchOpenAlerts(set: OpenAlertSet, ctx: SourceCtx): Promise<Paged<OpenAlertRow>>;
  /** Paged fetch of items of a set (L3 items via sourceSalesOrder; 4.1 worked ids). */
  fetchItems(set: ItemSet, ctx: SourceCtx): Promise<Paged<ItemRow>>;
  /** Items by id: `$in` on salesOrderId in chunks of ID_BATCH; missing ids are absent (spec §9.0 `itemsById`). */
  fetchItemsByIds(ids: readonly string[], ctx: SourceCtx): Promise<Paged<ItemRow>>;
  /** Verdicts by otifOrderId per `config.VERDICT_ID_LOOKUP` ("in" chunks / "eq" per id); missing ids absent. */
  fetchVerdictsByIds(ids: readonly string[], ctx: SourceCtx): Promise<Paged<VerdictRow>>;

  // Second-draft seam (instructions §5 rule 9, spec §12.1): when the AlertLifecycle object exists, one method
  //   fetchAlertLifecycles(filter: { touchedIn: Window | null; closedIn: Window | null; filters: ItemFilters },
  //                        ctx: SourceCtx): Promise<Paged<AlertLifecycleRow>>
  // replaces `shared/touchedAlerts.ts` (L2 fetch) + `compute/alertLifecycle.ts`; the adapter maps its
  // columns to `AlertLifecycleRow`. Loaders keep their signatures and raw types.
}

/** Dependencies of every loader. `config` defaults to METRICS_CONFIG; tests override it (Appendix A X4). */
export interface LoaderDeps {
  readonly source: MetricsSource;
  readonly now: Date;
  readonly signal: AbortSignal;
  readonly onProgress?: (p: Progress) => void;
  readonly config: MetricsConfig;
}

/** A card loader: selection + validated breakdown → raw data envelope. Instructions §5 rule 5. */
export type Loader<R> = (
  selection: Selection,
  breakdown: BreakdownDimension | null,
  deps: LoaderDeps,
) => Promise<LoaderOutput<R>>;
