/**
 * itemFunnel alert view loader (spec §9 2.1–2.4 alert view; lead decision D12; Appendix A F3, F6).
 * 2.1 terms from `query/buildFunnel.carriedAlertSets` (under "now" only the open-alert count; the lifecycle
 * terms are 0 and not queried); 2.2–2.4 come from L1 rows in derive. L2(selected window) facts and L3 open
 * alerts are ALWAYS loaded (lead decisions COR-01, COR-02): derive restricts 2.2–2.4 and the outside paths to
 * the 2.1 population (open now, or closed in the window) and groups open alerts by their AOF row. Both are
 * shared, memoised fetches (L3 shared with 4.5). actionType / writebackType need no extra call.
 */
import { isAlertAttrDim } from "../breakdowns";
import { carriedAlertSets } from "../query/buildFunnel";
import type { CarriedAlertSets } from "../query/buildFunnel";
import { loadHumanEvents } from "../shared/humanEvents";
import { loadOpenAlerts } from "../shared/openAlerts";
import { loadTouchedAlerts } from "../shared/touchedAlerts";
import { sourceCtxOf } from "../shared/sourceCtx";
import type { LoaderDeps, MetricsSource, SourceCtx } from "../source/MetricsSource";
import type {
  AlertViewRaw,
  BreakdownDimension,
  CarriedAlertGroupsRaw,
  CarriedAlertsRaw,
  GroupCount,
  LoaderOutput,
  Selection,
} from "../types";
import { resolveWindow } from "../window";
import { loaderOutput } from "./loaderOutput";

const NO_GROUPS: readonly GroupCount[] = [];

/** Spec §9 2.1 alert view terms: under "now" (`bounded` false) only `openAlerts` is queried. */
async function carriedTerms(sets: CarriedAlertSets, bounded: boolean, source: MetricsSource, ctx: SourceCtx): Promise<CarriedAlertsRaw> {
  if (!bounded) return { lifecycleAlerts: 0, openAlerts: await source.countOpenAlerts(sets.open, ctx), openWithLifecycleEvent: 0 };
  const [lifecycleAlerts, openAlerts, openWithLifecycleEvent] = await Promise.all([
    source.countEvents(sets.life, "alert", ctx),
    source.countOpenAlerts(sets.open, ctx),
    source.countOpenAlerts(sets.openWithLifecycle, ctx),
  ]);
  return { lifecycleAlerts, openAlerts, openWithLifecycleEvent };
}

/**
 * Spec §9 2.1 alert view grouped terms: attribute dims group `life` by the pipeline event's attribute
 * (`countEventsBy(…, "alert", dim)`) and both open-alert terms by the AlertOrderFulfillment property; under
 * "now" only the open term. escalated: open alerts only (`countOpenAlertsBy(openAlerts(f), "escalated")`).
 * Other dims: null.
 */
async function carriedGroupTerms(
  sets: CarriedAlertSets,
  bounded: boolean,
  dim: BreakdownDimension | null,
  source: MetricsSource,
  ctx: SourceCtx,
): Promise<CarriedAlertGroupsRaw | null> {
  if (dim === "escalated" || (isAlertAttrDim(dim) && !bounded)) {
    const openAlerts = await source.countOpenAlertsBy(sets.open, dim, ctx);
    return { lifecycleAlerts: NO_GROUPS, openAlerts, openWithLifecycleEvent: NO_GROUPS };
  }
  if (!isAlertAttrDim(dim)) return null;
  const [lifecycleAlerts, openAlerts, openWithLifecycleEvent] = await Promise.all([
    source.countEventsBy(sets.life, "alert", dim, ctx),
    source.countOpenAlertsBy(sets.open, dim, ctx),
    source.countOpenAlertsBy(sets.openWithLifecycle, dim, ctx),
  ]);
  return { lifecycleAlerts, openAlerts, openWithLifecycleEvent };
}

/**
 * Alert view: the 2.1 terms (and grouped terms), L1(selected window, f), L2(selected window, f) and L3 open
 * alerts(f) — all in parallel; `facts` and `openAlerts` are always filled (COR-01, COR-02).
 * @param selection selection (window, filters).
 * @param breakdown validated alert-view dim or null.
 * @param deps loader dependencies.
 * @returns `AlertViewRaw`; status "partial" + `row-cap` when any L1/L2/L3 fetch was capped (D11; `truncated`
 * is derive's, MOD-02). Rejects on source error or abort.
 */
export async function loadAlertView(
  selection: Selection,
  breakdown: BreakdownDimension | null,
  deps: LoaderDeps,
): Promise<LoaderOutput<AlertViewRaw>> {
  const w = resolveWindow(selection.window, deps.now);
  const f = selection.filters;
  const ctx = sourceCtxOf(deps, deps.signal);
  const sets = carriedAlertSets(w, f);
  const bounded = w.start !== null;
  const [carried, carriedGroups, human, facts, open] = await Promise.all([
    carriedTerms(sets, bounded, deps.source, ctx),
    carriedGroupTerms(sets, bounded, breakdown, deps.source, ctx),
    loadHumanEvents(w, f, deps),
    loadTouchedAlerts(w, f, deps),
    loadOpenAlerts(f, deps),
  ]);
  const raw: AlertViewRaw = {
    view: "alert",
    window: w,
    dimension: breakdown,
    generatedAt: deps.now.toISOString(),
    carried,
    carriedGroups,
    humanEvents: human.rows,
    facts: facts.rows,
    openAlerts: open.rows,
  };
  return loaderOutput(raw, [human, facts, open]);
}
