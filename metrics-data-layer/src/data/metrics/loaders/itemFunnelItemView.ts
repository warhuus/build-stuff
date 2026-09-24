/**
 * itemFunnel item view loader (spec §9 2.0–2.4 item view, §11 "2.2–2.4 are issued in parallel with 2.1").
 * Stage sets and outside paths from `query/buildFunnel.itemFunnelSets`; item dims via `countItemsBy` per
 * stage; alert dims (routingPersona, priority, escalated) at item grain via one `countItems` per candidate
 * group, all candidates on 2.1 and the top `BREAKDOWN_MAX_GROUPS` (ranked with compute `topGroups`, the one
 * allowed loader ranking, spec §9 2.1) on 2.2–2.4.
 */
import { isItemDim } from "../breakdowns";
import { topGroups } from "../compute/breakdown";
import { openAlerts } from "../query/build";
import { itemFunnelSets, stageWithOpenAlertWhere } from "../query/buildFunnel";
import type { ItemFunnelSets } from "../query/buildFunnel";
import type { OpenAlertCondition } from "../query/specs";
import { sourceCtxOf } from "../shared/sourceCtx";
import type { LoaderDeps, MetricsSource, SourceCtx } from "../source/MetricsSource";
import type {
  BreakdownDimension,
  GroupCountValue,
  ItemFilters,
  ItemStageId,
  ItemViewRaw,
  LoaderOutput,
  Selection,
} from "../types";
import { resolveWindow } from "../window";
import { funnelLoaderOutput } from "./funnelLoaderOutput";

/** Stage id → its set in `ItemFunnelSets`. */
const STAGE_SET: Readonly<Record<ItemStageId, keyof ItemFunnelSets>> = {
  "2.0": "so20",
  "2.1": "so21",
  "2.2": "so22",
  "2.3": "so23",
  "2.4": "so24",
};
const ITEM_STAGES: readonly ItemStageId[] = ["2.0", "2.1", "2.2", "2.3", "2.4"];
const LATER_STAGES: readonly ItemStageId[] = ["2.2", "2.3", "2.4"];

/** Item-view alert dims (Appendix A registry): the AlertOrderFulfillment fields that are filterable. */
type ItemViewAlertDim = "routingPersona" | "priority" | "escalated";

/** Grouped stage rows plus the rows of every grouped port call (for `truncated`). */
interface ItemGroups {
  readonly groups: Partial<Record<ItemStageId, readonly GroupCountValue[]>>;
  readonly grouped: readonly (readonly unknown[])[];
}

/** What the alert-dim group queries need. */
interface GroupCtx {
  readonly dim: ItemViewAlertDim;
  readonly sets: ItemFunnelSets;
  readonly filters: ItemFilters;
  readonly source: MetricsSource;
  readonly ctx: SourceCtx;
}

/** Spec §9.0 `aofWhere(d, g)`: escalated compares the boolean whose label is `g`. */
function conditionOf(dim: ItemViewAlertDim, group: string, ctx: SourceCtx): OpenAlertCondition {
  return dim === "escalated"
    ? { field: "escalated", value: group === ctx.config.ESCALATED_GROUP_LABELS.true }
    : { field: dim, value: group };
}

/** Spec §9 2.1 `perGroup(soX, g)` for each group of `groups` on one stage (parallel). */
function perGroup(
  stage: ItemStageId,
  groups: readonly string[],
  ctx: GroupCtx,
): Promise<GroupCountValue[]> {
  const set = ctx.sets[STAGE_SET[stage]];
  return Promise.all(
    groups.map(async (group) => ({
      group,
      ...(await ctx.source.countItems(stageWithOpenAlertWhere(set, ctx.filters, conditionOf(ctx.dim, group, ctx.ctx)), ctx.ctx)),
    })),
  );
}

/**
 * Alert dim at item grain (spec §9 2.1): candidates = `countOpenAlertsBy(openAlerts(f), dim)`; 2.1 for
 * every candidate; 2.2–2.4 for the top `BREAKDOWN_MAX_GROUPS` of 2.1 only. 2.0 absent.
 */
async function alertDimGroups(g: GroupCtx): Promise<ItemGroups> {
  const candidates = await g.source.countOpenAlertsBy(openAlerts(g.filters), g.dim, g.ctx);
  const on21 = await perGroup("2.1", candidates.map((c) => c.group), g);
  const top = topGroups(on21, g.ctx.config.BREAKDOWN_MAX_GROUPS).map((c) => c.group);
  const later = await Promise.all(LATER_STAGES.map((stage) => perGroup(stage, top, g)));
  const groups: Partial<Record<ItemStageId, readonly GroupCountValue[]>> = { "2.1": on21 };
  LATER_STAGES.forEach((stage, i) => {
    groups[stage] = later[i];
  });
  return { groups, grouped: [candidates] };
}

/** Item dim (spec §9 2.0–2.4): `countItemsBy(stage set, dim)` on every stage, in parallel. */
async function itemDimGroups(dim: BreakdownDimension, g: Omit<GroupCtx, "dim">): Promise<ItemGroups> {
  if (!isItemDim(dim)) return { groups: {}, grouped: [] };
  const rows = await Promise.all(ITEM_STAGES.map((stage) => g.source.countItemsBy(g.sets[STAGE_SET[stage]], dim, g.ctx)));
  return { groups: Object.fromEntries(ITEM_STAGES.map((stage, i) => [stage, rows[i]])), grouped: rows };
}

/** Narrows a dim to an item-view alert dim. */
const isItemViewAlertDim = (dim: BreakdownDimension): dim is ItemViewAlertDim =>
  dim === "routingPersona" || dim === "priority" || dim === "escalated";

/** Groups for the dim, or null without one. */
function groupsFor(dim: BreakdownDimension | null, g: Omit<GroupCtx, "dim">): Promise<ItemGroups | null> {
  if (dim === null) return Promise.resolve(null);
  return isItemViewAlertDim(dim) ? alertDimGroups({ ...g, dim }) : itemDimGroups(dim, g);
}

/**
 * Item view: `countItems` of so20…so24 and both outside paths, plus the dim's groups, all in parallel.
 * @param selection selection (window, filters).
 * @param breakdown validated item-view dim or null.
 * @param deps loader dependencies.
 * @returns `ItemViewRaw` (count + USD value per stage and outside path); caveat `truncated` when a grouped
 * call returned `MAX_GROUPS` rows; status "ok" (no row fetches). Rejects on source error or abort.
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
    groups: groups?.groups ?? null,
  };
  return funnelLoaderOutput(raw, { capped: false, grouped: groups?.grouped ?? [] }, deps.config);
}
