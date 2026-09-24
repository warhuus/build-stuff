/**
 * userFunnel loader, section 1 (spec §9 1.0–1.4; Appendix A F5, F7 and the breakdown registry).
 * Section 1 ignores item filters: every event set is `events(pred, w, EMPTY_FILTERS)` (spec §9 note before
 * 1.1). 1.0 has no source and is not queried. `ALERT_APP_ID` placeholder blocking happens in loadCard (D13).
 */
import { stagesForDim } from "../breakdowns";
import { escalatedEvents, events } from "../query/build";
import type { EventGroupField, EventPredicate, EventSet } from "../query/specs";
import { EMPTY_FILTERS } from "../selection";
import { sourceCtxOf } from "../shared/sourceCtx";
import type { Loader, MetricsSource, SourceCtx } from "../source/MetricsSource";
import type { BreakdownDimension, GroupCount, UserFunnelRaw, UserStageId, Window } from "../types";
import { resolveWindow } from "../window";
import { funnelLoaderOutput } from "./funnelLoaderOutput";

/** Event stages of section 1 and their named predicate (spec §9 1.2–1.4). */
type EventStageId = Exclude<UserStageId, "1.1">;
const EVENT_STAGES: readonly EventStageId[] = ["1.2", "1.3", "1.4"];
const PREDICATE: Readonly<Record<EventStageId, EventPredicate>> = {
  "1.2": "viewed",
  "1.3": "action",
  "1.4": "writeback",
};
const USER_STAGES: readonly UserStageId[] = ["1.1", ...EVENT_STAGES];

/** Section 1 event set of a stage, never item-filtered (spec §9 1.2–1.4). */
const stageEvents = (stage: EventStageId, w: Window): EventSet => events([PREDICATE[stage]], w, EMPTY_FILTERS);

/** The AlertHistory group-by field of a section-1 dim (queueFilter, alertType, actionType, writebackType). */
function eventGroupField(dim: BreakdownDimension): EventGroupField | null {
  switch (dim) {
    case "queueFilter":
    case "alertType":
    case "actionType":
    case "writebackType":
      return dim;
    default:
      return null;
  }
}

/** One stage's grouped users; `grouped` = the rows came from one grouped call (truncation check). */
interface StageGroups {
  readonly stage: UserStageId;
  readonly rows: readonly GroupCount[];
  readonly grouped: boolean;
}

/**
 * Spec §9 1.2–1.4 escalated: distinct actors of the stage's events on open alerts with `escalated = v`, one
 * `countEvents` per value; groups labelled `config.ESCALATED_GROUP_LABELS` (both always present).
 */
async function escalatedGroups(stage: EventStageId, w: Window, source: MetricsSource, ctx: SourceCtx): Promise<GroupCount[]> {
  const count = (v: boolean): Promise<number> => source.countEvents(escalatedEvents(v, [PREDICATE[stage]], w), "actor", ctx);
  const [yes, no] = await Promise.all([count(true), count(false)]);
  const labels = ctx.config.ESCALATED_GROUP_LABELS;
  return [
    { group: labels.true, count: yes },
    { group: labels.false, count: no },
  ];
}

/** Grouped users of one applicable stage (spec §9 1.1 queueFilter via AppUsageEvent; 1.2–1.4 per dim). */
async function stageGroups(
  stage: UserStageId,
  dim: BreakdownDimension,
  w: Window,
  source: MetricsSource,
  ctx: SourceCtx,
): Promise<StageGroups> {
  if (stage === "1.1") return { stage, rows: await source.countAppUsersBy(w, "queueFilter", ctx), grouped: true };
  const field = eventGroupField(dim);
  if (field === null) return { stage, rows: await escalatedGroups(stage, w, source, ctx), grouped: false };
  return { stage, rows: await source.countEventsBy(stageEvents(stage, w), "actor", field, ctx), grouped: true };
}

/** Grouped users of every stage the dim applies to (`stagesForDim`), in parallel; `[]` without a dim. */
function allStageGroups(dim: BreakdownDimension | null, w: Window, source: MetricsSource, ctx: SourceCtx): Promise<StageGroups[]> {
  if (dim === null) return Promise.resolve([]);
  const applicable: readonly string[] = stagesForDim("userFunnel", "item", dim);
  const stages = USER_STAGES.filter((s) => applicable.includes(s));
  return Promise.all(stages.map((s) => stageGroups(s, dim, w, source, ctx)));
}

/**
 * userFunnel: 1.1 `countAppUsers(w)`; 1.2–1.4 `countEvents(events(pred, w, ∅), "actor")`; with a dim, the
 * grouped call(s) on each stage the dim applies to; every call in parallel.
 * @param selection selection (only `window` is read; item filters never change a call, spec §5 R3).
 * @param breakdown validated dim or null.
 * @param deps loader dependencies.
 * @returns raw distinct users per stage and groups per applicable stage (null without a dim); caveat
 * `truncated` when a grouped call returned `MAX_GROUPS` rows; status always "ok" (no row fetches).
 * Rejects on source error or abort.
 */
export const loadUserFunnel: Loader<UserFunnelRaw> = async (selection, breakdown, deps) => {
  const w = resolveWindow(selection.window, deps.now);
  const ctx = sourceCtxOf(deps, deps.signal);
  const source = deps.source;
  const [users11, eventUsers, grouped] = await Promise.all([
    source.countAppUsers(w, ctx),
    Promise.all(EVENT_STAGES.map((s) => source.countEvents(stageEvents(s, w), "actor", ctx))),
    allStageGroups(breakdown, w, source, ctx),
  ]);
  const [users12, users13, users14] = eventUsers;
  const raw: UserFunnelRaw = {
    window: w,
    dimension: breakdown,
    generatedAt: deps.now.toISOString(),
    users: { "1.1": users11, "1.2": users12, "1.3": users13, "1.4": users14 },
    groups: breakdown === null ? null : Object.fromEntries(grouped.map((g) => [g.stage, g.rows])),
  };
  const groupedRows = grouped.filter((g) => g.grouped).map((g) => g.rows);
  return funnelLoaderOutput(raw, { capped: false, grouped: groupedRows }, deps.config);
};
