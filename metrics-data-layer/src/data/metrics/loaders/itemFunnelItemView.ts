/**
 * itemFunnel item view loader (spec §9 2.0–2.4 item view, §11 "2.2–2.4 are issued in parallel with 2.1").
 * Stage sets and outside paths from `query/buildFunnel.itemFunnelSets`; item dims via `countItemsBy` per
 * stage; alert dims (routingPersona, priority, escalated) at item grain via one `countItems` per candidate
 * group, all candidates on 2.1 and the top `BREAKDOWN_MAX_GROUPS` of the non-empty ones (ranked with compute
 * `topGroups`, the one allowed loader ranking, spec §9 2.1; COR-03) on 2.2–2.4. The per-candidate calls run
 * through `runLimited(config.INNER_CONCURRENCY)` (spec §11 inner limiter; OSD-02).
 */
import { FUNNEL_STAGES } from "../../../config/metrics";
import { isItemDim, isOpenAlertFilterDim } from "../breakdowns";
import { nonEmptyGroups, topGroups } from "../compute/breakdown";
import { escalatedValueOf } from "../compute/dimValues";
import { openAlerts } from "../query/build";
import { itemFunnelSets, stageWithOpenAlertWhere } from "../query/buildFunnel";
import type { ItemFunnelSets } from "../query/buildFunnel";
import type { OpenAlertCondition, OpenAlertFilterField } from "../query/specs";
import { runLimited } from "../shared/concurrency";
import { sourceCtxOf } from "../shared/sourceCtx";
import type { LoaderDeps, MetricsSource, SourceCtx } from "../source/MetricsSource";
import type {
  BreakdownDimension,
  GroupCountValue,
  ItemDim,
  ItemFilters,
  ItemStageId,
  ItemViewRaw,
  LoaderOutput,
  Selection,
} from "../types";
import { resolveWindow } from "../window";
import { loaderOutput } from "./loaderOutput";

/** Stage id → its set in `ItemFunnelSets`. */
const STAGE_SET: Readonly<Record<ItemStageId, keyof ItemFunnelSets>> = {
  "2.0": "so20",
  "2.1": "so21",
  "2.2": "so22",
  "2.3": "so23",
  "2.4": "so24",
};
const ITEM_STAGES: readonly ItemStageId[] = FUNNEL_STAGES.item;
/** 2.2–2.4: the stages queried for the top groups of 2.1 only. */
const LATER_STAGES: readonly ItemStageId[] = FUNNEL_STAGES.item.slice(2);

/** Grouped stage rows per stage. */
type ItemGroups = Partial<Record<ItemStageId, readonly GroupCountValue[]>>;

/** What the alert-dim group queries need. */
interface GroupCtx {
  readonly dim: OpenAlertFilterField;
  readonly sets: ItemFunnelSets;
  readonly filters: ItemFilters;
  readonly source: MetricsSource;
  readonly ctx: SourceCtx;
}

/** Spec §9.0 `aofWhere(d, g)`: escalated compares the boolean whose label is `g`. */
function conditionOf(dim: OpenAlertFilterField, group: string, ctx: SourceCtx): OpenAlertCondition {
  return dim === "escalated" ? { field: "escalated", value: escalatedValueOf(group, ctx.config) } : { field: dim, value: group };
}

/**
 * Spec §9 2.1 `perGroup(soX, g)` for each group of `groups` on one stage, at most `config.INNER_CONCURRENCY`
 * calls in flight (spec §11 inner limiter; OSD-02).
 */
function perGroup(
  stage: ItemStageId,
  groups: readonly string[],
  ctx: GroupCtx,
): Promise<GroupCountValue[]> {
  const set = ctx.sets[STAGE_SET[stage]];
  const tasks = groups.map((group) => async (): Promise<GroupCountValue> => ({
    group,
    ...(await ctx.source.countItems(stageWithOpenAlertWhere(set, ctx.filters, conditionOf(ctx.dim, group, ctx.ctx)), ctx.ctx)),
  }));
  return runLimited(tasks, ctx.ctx.config.INNER_CONCURRENCY, ctx.ctx.signal);
}

/**
 * Alert dim at item grain (spec §9 2.1): candidates = `countOpenAlertsBy(openAlerts(f), dim)`; 2.1 for
 * every candidate (the raw keeps them all, so derive can check the candidate list against `MAX_GROUPS`);
 * 2.2–2.4 for the top `BREAKDOWN_MAX_GROUPS` of the candidates with a 2.1 count above 0 (COR-03). 2.0 absent.
 */
async function alertDimGroups(g: GroupCtx): Promise<ItemGroups> {
  const candidates = await g.source.countOpenAlertsBy(openAlerts(g.filters), g.dim, g.ctx);
  const on21 = await perGroup("2.1", candidates.map((c) => c.group), g);
  const top = topGroups(nonEmptyGroups(on21), g.ctx.config.BREAKDOWN_MAX_GROUPS).map((c) => c.group);
  const later = await Promise.all(LATER_STAGES.map((stage) => perGroup(stage, top, g)));
  return { "2.1": on21, ...Object.fromEntries(LATER_STAGES.map((stage, i) => [stage, later[i]])) };
}

/** Item dim (spec §9 2.0–2.4): `countItemsBy(stage set, dim)` on every stage, in parallel. */
async function itemDimGroups(dim: ItemDim, g: Omit<GroupCtx, "dim">): Promise<ItemGroups> {
  const rows = await Promise.all(ITEM_STAGES.map((stage) => g.source.countItemsBy(g.sets[STAGE_SET[stage]], dim, g.ctx)));
  return Object.fromEntries(ITEM_STAGES.map((stage, i) => [stage, rows[i]]));
}

/**
 * Groups for the dim, or null without one: item dims (`isItemDim`) per stage, AlertOrderFulfillment filter
 * dims (`isOpenAlertFilterDim`) at item grain. Any other dim is outside the item-view registry row (loadCard
 * rejects it) and throws `RangeError` rather than computing something else (TYP-05).
 */
function groupsFor(dim: BreakdownDimension | null, g: Omit<GroupCtx, "dim">): Promise<ItemGroups | null> {
  if (dim === null) return Promise.resolve(null);
  if (isOpenAlertFilterDim(dim)) return alertDimGroups({ ...g, dim });
  if (isItemDim(dim)) return itemDimGroups(dim, g);
  return Promise.reject(new RangeError(`${dim} is not an itemFunnel item-view breakdown`));
}

/**
 * Item view: `countItems` of so20…so24 and both outside paths, plus the dim's groups, all in parallel.
 * @param selection selection (window, filters).
 * @param breakdown validated item-view dim or null.
 * @param deps loader dependencies.
 * @returns `ItemViewRaw` (count + USD value per stage and outside path); status "ok", no caveats (no row
 * fetches; `truncated` is derive's, MOD-02). Rejects on source error or abort.
 */
export async function loadItemView(
  selection: Selection,
  breakdown: BreakdownDimension | null,
  deps: LoaderDeps,
): Promise<LoaderOutput<ItemViewRaw>> {
  const w = resolveWindow(selection.window, deps.now);
  const ctx = sourceCtxOf(deps, deps.signal);
  const sets = itemFunnelSets(w, selection.filters);
  const g = { sets, filters: selection.filters, source: deps.source, ctx };
  const [stageTotals, outside, groups] = await Promise.all([
    Promise.all(ITEM_STAGES.map((stage) => deps.source.countItems(sets[STAGE_SET[stage]], ctx))),
    Promise.all([deps.source.countItems(sets.outside23, ctx), deps.source.countItems(sets.outside24, ctx)]),
    groupsFor(breakdown, g),
  ]);
  const [s20, s21, s22, s23, s24] = stageTotals;
  const raw: ItemViewRaw = {
    view: "item",
    window: w,
    dimension: breakdown,
    generatedAt: deps.now.toISOString(),
    stages: { "2.0": s20, "2.1": s21, "2.2": s22, "2.3": s23, "2.4": s24 },
    outsidePath: { "2.3": outside[0], "2.4": outside[1] },
    groups,
  };
  return loaderOutput(raw);
}
