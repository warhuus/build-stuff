/**
 * The eleven aggregate port methods on OSDK (spec §9.0 `stageTotal`, §9 1.1–4.1). One method call = one
 * server aggregate; the signal is checked before the call (aggregates take no signal). Results are read
 * defensively (S7): `$count ?? 0`, `valueUsd?.sum ?? 0`, `<prop>?.exactDistinct ?? 0`.
 */
import type { Client, ObjectSet, WhereClause } from "@osdk/client";
import type { AppUsageEvent, OtifOrderVerdict } from "@app/sdk";
import type { CountValue, GroupCount, GroupCountValue, RangeCount, Window } from "../../types";
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
} from "../../query/specs";
import type { SourceCtx, VerdictTotals } from "../MetricsSource";
import { createSpecCompiler, type OsdkObjectTypes, type SpecCompiler } from "./compileSpec";
import { appUsageWhere, verdictDateIn, verdictGate } from "./compileWhere";
import {
  appUsersGrouped,
  eventsGrouped,
  itemsGrouped,
  openAlertsGrouped,
  riskByRanges,
  finiteOrZero,
  verdictsGrouped,
} from "./groupBy";
import { throwIfAborted } from "../../compute/abort";

/** The injected dependencies of the adapter (Appendix A X5). */
export interface OsdkDeps {
  readonly client: Client;
  readonly sdk: OsdkObjectTypes;
}

/** A spec compiler for this call's config; rejects with AbortError when already aborted. */
export function compilerFor(deps: OsdkDeps, ctx: SourceCtx): SpecCompiler {
  throwIfAborted(ctx.signal);
  return createSpecCompiler({ client: deps.client, sdk: deps.sdk, config: ctx.config });
}

/** `$count` + `valueUsd:sum` of an item set; 0 when empty. Spec §9.0 `stageTotal`. */
export async function countItems(deps: OsdkDeps, set: ItemSet, ctx: SourceCtx): Promise<CountValue> {
  const r = await compilerFor(deps, ctx).items(set).aggregate({
    $select: { $count: "unordered", "valueUsd:sum": "unordered" },
  });
  return { count: finiteOrZero(r.$count), valueUsd: finiteOrZero(r.valueUsd?.sum) };
}

/** Items grouped by an item dimension (`$exactWithLimit: MAX_GROUPS`). Spec §9.0 `stageByItemDim`. */
export async function countItemsBy(deps: OsdkDeps, set: ItemSet, g: ItemGroupField, ctx: SourceCtx): Promise<GroupCountValue[]> {
  return itemsGrouped(compilerFor(deps, ctx).items(set), g, ctx.config.MAX_GROUPS);
}

/** `eventActor:exactDistinct` (actor) or `riskAlertId:exactDistinct` (alert). Spec §9 1.2–1.4, 2.1. */
export async function countEvents(deps: OsdkDeps, set: EventSet, d: EventDistinctField, ctx: SourceCtx): Promise<number> {
  const s = compilerFor(deps, ctx).events(set);
  if (d === "actor") {
    const r = await s.aggregate({ $select: { "eventActor:exactDistinct": "unordered" } });
    return finiteOrZero(r.eventActor?.exactDistinct);
  }
  const r = await s.aggregate({ $select: { "riskAlertId:exactDistinct": "unordered" } });
  return finiteOrZero(r.riskAlertId?.exactDistinct);
}

/** The same grouped by an AlertHistory group-by field. Spec §9.0 `ahGroupBy`. */
export async function countEventsBy(
  deps: OsdkDeps,
  set: EventSet,
  d: EventDistinctField,
  g: EventGroupField,
  ctx: SourceCtx,
): Promise<GroupCount[]> {
  return eventsGrouped(compilerFor(deps, ctx).events(set), d, g, ctx.config.MAX_GROUPS);
}

/** `$count` of an open-alert set. Spec §9 2.1 alert view. */
export async function countOpenAlerts(deps: OsdkDeps, set: OpenAlertSet, ctx: SourceCtx): Promise<number> {
  const r = await compilerFor(deps, ctx).openAlerts(set).aggregate({ $select: { $count: "unordered" } });
  return finiteOrZero(r.$count);
}

/** Open alerts grouped by an AlertOrderFulfillment field. Spec §9.0 `aofGroupBy`. */
export async function countOpenAlertsBy(
  deps: OsdkDeps,
  set: OpenAlertSet,
  g: OpenAlertGroupField,
  ctx: SourceCtx,
): Promise<GroupCount[]> {
  return openAlertsGrouped(compilerFor(deps, ctx).openAlerts(set), g, ctx.config);
}

/** `$count` of a risk set. Spec §9 3.1. */
export async function countRisk(deps: OsdkDeps, set: RiskSet, ctx: SourceCtx): Promise<number> {
  const r = await compilerFor(deps, ctx).risk(set).aggregate({ $select: { $count: "unordered" } });
  return finiteOrZero(r.$count);
}

/** `$count` per `otifScore` `$ranges` (no `$exactWithLimit`). Spec §9 3.1 `byRange`. */
export async function countRiskByScoreRange(
  deps: OsdkDeps,
  set: RiskSet,
  ranges: readonly (readonly [number, number])[],
  ctx: SourceCtx,
): Promise<RangeCount[]> {
  return riskByRanges(compilerFor(deps, ctx).risk(set), ranges);
}

function appUsageSet(deps: OsdkDeps, w: Window, ctx: SourceCtx): ObjectSet<AppUsageEvent> {
  throwIfAborted(ctx.signal);
  return deps.client(deps.sdk.AppUsageEvent).where(appUsageWhere(w, ctx.config));
}

/** Distinct `userId` of alert-app usage in the window. Spec §9 1.1. Throws on a placeholder ALERT_APP_ID. */
export async function countAppUsers(deps: OsdkDeps, w: Window, ctx: SourceCtx): Promise<number> {
  const r = await appUsageSet(deps, w, ctx).aggregate({ $select: { "userId:exactDistinct": "unordered" } });
  return finiteOrZero(r.userId?.exactDistinct);
}

/** The same per queue-filter persona. Spec §9 1.1. */
export async function countAppUsersBy(deps: OsdkDeps, w: Window, g: AppUsageGroupField, ctx: SourceCtx): Promise<GroupCount[]> {
  return appUsersGrouped(appUsageSet(deps, w, ctx), g, ctx.config.MAX_GROUPS);
}

/** The gated verdict set: mode gate AND verdict date in the window (spec §9 4.1). */
export function verdictSet(deps: OsdkDeps, filter: VerdictFilter, ctx: SourceCtx): ObjectSet<OtifOrderVerdict> {
  throwIfAborted(ctx.signal);
  const where: WhereClause<OtifOrderVerdict> = { $and: [verdictGate(filter.mode, ctx.config), verdictDateIn(filter.window, ctx.config)] };
  return deps.client(deps.sdk.OtifOrderVerdict).where(where);
}

/** Gated verdict totals per classification value. Spec §9 4.1 step 1. */
export async function countVerdictsBy(deps: OsdkDeps, filter: VerdictFilter, ctx: SourceCtx): Promise<VerdictTotals> {
  return verdictsGrouped(verdictSet(deps, filter, ctx), filter.mode, ctx.config.MAX_GROUPS);
}
