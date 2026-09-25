/**
 * In-memory `MetricsSource` (instructions §6): every port method over fixture rows with the OSDK semantics
 * of spec §8 (see `fakeEval.ts`, `fakeGroups.ts`, `fakePaging.ts`). Every call is recorded in `calls`
 * (method + arguments without the ctx) so loader tests can assert which calls were made (Appendix A X2).
 */
import { throwIfAborted } from "../../compute/abort";
import { openAlertDimValue } from "../../compute/dimValues";
import type { AlertEventRow, ItemRow, OpenAlertRow, VerdictRow, Window } from "../../types";
import { inWindow } from "../../window";
import type {
  EventDistinctField,
  EventGroupField,
  EventSet,
  ItemSet,
  OpenAlertSet,
  RiskSet,
} from "../../query/specs";
import type { MetricsSource, SourceCtx } from "../MetricsSource";
import { createEvalCtx, evalEvents, evalItems, evalOpenAlerts, evalRisk } from "./fakeEval";
import type { EvalCtx } from "./fakeEval";
import { countByRanges, countValueByGroup, countValueOf, distinctByGroup, exactDistinct, verdictRowOf, verdictTotals } from "./fakeGroups";
import { createStats, lookupByIds, pageRows } from "./fakePaging";
import type { FakeStats } from "./fakePaging";
import type {
  FixtureAppUsage,
  FixtureEvent,
  FixtureItem,
  FixtureOpenAlert,
  FixtureRisk,
  MetricsFixtures,
} from "./fakeTypes";
import { FIXTURES } from "./fixtures";

/** One recorded port call: the method name and its arguments except the ctx. */
export interface FakeCall {
  readonly method: keyof MetricsSource;
  readonly args: readonly unknown[];
}

/** The fake: a `MetricsSource` plus its call log and limiter counters. */
export interface FakeSource extends MetricsSource {
  /** Every call in order. Tests may clear it with `calls.length = 0`. */
  readonly calls: FakeCall[];
  /** Id-lookup concurrency and paging counters (e.g. `maxInFlight ≤ INNER_CONCURRENCY`). */
  readonly stats: FakeStats;
}

const itemRowOf = (i: FixtureItem): ItemRow => ({
  salesOrderId: i.salesOrderId,
  businessLine: i.businessLine,
  productLine: i.productLine,
  region: i.region,
  plant: i.plant,
  valueUsd: i.valueUsd,
  isOpen: i.isOpen,
});

const eventRowOf = (e: FixtureEvent): AlertEventRow => ({
  riskAlertId: e.riskAlertId,
  salesOrderId: e.salesOrderId,
  eventType: e.eventType,
  eventSource: e.eventSource,
  eventTimestamp: e.eventTimestamp,
  persona: e.persona,
  riskType: e.riskType,
  priorityAtEvent: e.priorityAtEvent,
});

/** Spec §9.0 `ahGroupBy`: queueFilter/routingPersona → persona, alertType → riskType, … → eventType. */
function eventGroupOf(field: EventGroupField): (e: FixtureEvent) => string | null {
  switch (field) {
    case "queueFilter":
    case "routingPersona":
      return (e) => e.persona;
    case "alertType":
      return (e) => e.riskType;
    case "priority":
      return (e) => e.priorityAtEvent;
    case "actionType":
    case "writebackType":
      return (e) => e.eventType;
  }
}

const rowsOf = <R>(keys: ReadonlySet<string>, rows: readonly R[], keyOf: (r: R) => string): R[] =>
  rows.filter((r) => keys.has(keyOf(r)));

/** Evaluation context of one call; rejects first when the call is already aborted. */
function evalCtxOf(data: MetricsFixtures, ctx: SourceCtx): EvalCtx {
  throwIfAborted(ctx.signal);
  return createEvalCtx(data, ctx.config);
}

const itemsIn = (data: MetricsFixtures, set: ItemSet, ctx: SourceCtx): FixtureItem[] =>
  rowsOf(evalItems(set, evalCtxOf(data, ctx)), data.items, (i) => i.salesOrderId);
const eventsIn = (data: MetricsFixtures, set: EventSet, ctx: SourceCtx): FixtureEvent[] =>
  rowsOf(evalEvents(set, evalCtxOf(data, ctx)), data.events, (e) => e.historyEventId);
const alertsIn = (data: MetricsFixtures, set: OpenAlertSet, ctx: SourceCtx): FixtureOpenAlert[] =>
  rowsOf(evalOpenAlerts(set, evalCtxOf(data, ctx)), data.openAlerts, (a) => a.riskAlertId);
const riskIn = (data: MetricsFixtures, set: RiskSet, ctx: SourceCtx): FixtureRisk[] =>
  rowsOf(evalRisk(set, evalCtxOf(data, ctx)), data.risk, (r) => r.salesOrderId);

/** Spec §9 1.1: AppUsageEvent rows with appId = `config.ALERT_APP_ID` and eventTimestamp in the window. */
function appUsageIn(data: MetricsFixtures, w: Window, ctx: SourceCtx): FixtureAppUsage[] {
  throwIfAborted(ctx.signal);
  return data.appUsage.filter((u) => u.appId === ctx.config.ALERT_APP_ID && inWindow(u.eventTimestamp, w));
}

const distinctOf = (d: EventDistinctField) => (e: FixtureEvent): string | null =>
  d === "actor" ? e.eventActor : e.riskAlertId;

type AggregateMethods = Omit<MetricsSource, `fetch${string}`>;
type FetchMethods = Pick<MetricsSource, `fetch${string}` & keyof MetricsSource>;

/** The eleven aggregate methods (one "server aggregate" each). */
function aggregateMethods(data: MetricsFixtures): AggregateMethods {
  return {
    countItems: async (set, ctx) => countValueOf(itemsIn(data, set, ctx)),
    countItemsBy: async (set, dim, ctx) => countValueByGroup(itemsIn(data, set, ctx), (i) => i[dim], ctx.config.MAX_GROUPS),
    countEvents: async (set, d, ctx) => exactDistinct(eventsIn(data, set, ctx), distinctOf(d)),
    countEventsBy: async (set, d, g, ctx) =>
      distinctByGroup(eventsIn(data, set, ctx), eventGroupOf(g), distinctOf(d), ctx.config.MAX_GROUPS),
    countOpenAlerts: async (set, ctx) => alertsIn(data, set, ctx).length,
    countOpenAlertsBy: async (set, g, ctx) =>
      distinctByGroup(alertsIn(data, set, ctx), (a) => openAlertDimValue(a, g, ctx.config), (a) => a.riskAlertId, ctx.config.MAX_GROUPS),
    countRisk: async (set, ctx) => riskIn(data, set, ctx).length,
    countRiskByScoreRange: async (set, ranges, ctx) => countByRanges(riskIn(data, set, ctx).map((r) => r.otifScore), ranges),
    countAppUsers: async (w, ctx) => exactDistinct(appUsageIn(data, w, ctx), (u) => u.userId),
    countAppUsersBy: async (w, _queueFilter, ctx) =>
      distinctByGroup(appUsageIn(data, w, ctx), (u) => u.persona, (u) => u.userId, ctx.config.MAX_GROUPS),
    countVerdictsBy: async (filter, ctx) => {
      throwIfAborted(ctx.signal);
      return verdictTotals(data.verdicts, filter, ctx.config);
    },
  };
}

/** The five row fetches: paged set fetches and chunked id lookups. */
function fetchMethods(data: MetricsFixtures, stats: FakeStats): FetchMethods {
  const itemsById = (chunk: ReadonlySet<string>): ItemRow[] => rowsOf(chunk, data.items, (i) => i.salesOrderId).map(itemRowOf);
  return {
    fetchEvents: async (set, ctx) => pageRows(eventsIn(data, set, ctx).map(eventRowOf), ctx, stats),
    fetchOpenAlerts: async (set, ctx) => pageRows<OpenAlertRow>(alertsIn(data, set, ctx), ctx, stats),
    fetchItems: async (set, ctx) => pageRows(itemsIn(data, set, ctx).map(itemRowOf), ctx, stats),
    fetchItemsByIds: async (ids, ctx) => lookupByIds(ids, ctx.config.ID_BATCH, itemsById, ctx, stats),
    fetchVerdictsByIds: async (ids, ctx) => {
      const size = ctx.config.VERDICT_ID_LOOKUP === "eq" ? 1 : ctx.config.ID_BATCH;
      const verdicts = (chunk: ReadonlySet<string>): VerdictRow[] =>
        rowsOf(chunk, data.verdicts, (v) => v.otifOrderId).map((v) => verdictRowOf(v, ctx.config));
      return lookupByIds(ids, size, verdicts, ctx, stats);
    },
  };
}

/** Wraps a source so every call is appended to `calls` (method + arguments without the ctx). */
function recording(inner: MetricsSource, calls: FakeCall[]): MetricsSource {
  const rec = <T>(method: keyof MetricsSource, args: readonly unknown[], run: () => T): T => {
    calls.push({ method, args });
    return run();
  };
  return {
    countItems: (s, c) => rec("countItems", [s], () => inner.countItems(s, c)),
    countItemsBy: (s, g, c) => rec("countItemsBy", [s, g], () => inner.countItemsBy(s, g, c)),
    countEvents: (s, d, c) => rec("countEvents", [s, d], () => inner.countEvents(s, d, c)),
    countEventsBy: (s, d, g, c) => rec("countEventsBy", [s, d, g], () => inner.countEventsBy(s, d, g, c)),
    countOpenAlerts: (s, c) => rec("countOpenAlerts", [s], () => inner.countOpenAlerts(s, c)),
    countOpenAlertsBy: (s, g, c) => rec("countOpenAlertsBy", [s, g], () => inner.countOpenAlertsBy(s, g, c)),
    countRisk: (s, c) => rec("countRisk", [s], () => inner.countRisk(s, c)),
    countRiskByScoreRange: (s, r, c) => rec("countRiskByScoreRange", [s, r], () => inner.countRiskByScoreRange(s, r, c)),
    countAppUsers: (w, c) => rec("countAppUsers", [w], () => inner.countAppUsers(w, c)),
    countAppUsersBy: (w, g, c) => rec("countAppUsersBy", [w, g], () => inner.countAppUsersBy(w, g, c)),
    countVerdictsBy: (f, c) => rec("countVerdictsBy", [f], () => inner.countVerdictsBy(f, c)),
    fetchEvents: (s, c) => rec("fetchEvents", [s], () => inner.fetchEvents(s, c)),
    fetchOpenAlerts: (s, c) => rec("fetchOpenAlerts", [s], () => inner.fetchOpenAlerts(s, c)),
    fetchItems: (s, c) => rec("fetchItems", [s], () => inner.fetchItems(s, c)),
    fetchItemsByIds: (ids, c) => rec("fetchItemsByIds", [ids], () => inner.fetchItemsByIds(ids, c)),
    fetchVerdictsByIds: (ids, c) => rec("fetchVerdictsByIds", [ids], () => inner.fetchVerdictsByIds(ids, c)),
  };
}

/**
 * Creates the in-memory source over `data` (default: the fixtures). Semantics: see the module comment and
 * `MetricsSource`. Config comes from each call's `ctx.config`, so tests override caps per call.
 * @returns the source with its `calls` log and `stats` counters.
 */
export function createFakeSource(data: MetricsFixtures = FIXTURES): FakeSource {
  const calls: FakeCall[] = [];
  const stats = createStats();
  const inner: MetricsSource = { ...aggregateMethods(data), ...fetchMethods(data, stats) };
  return { ...recording(inner, calls), calls, stats };
}
