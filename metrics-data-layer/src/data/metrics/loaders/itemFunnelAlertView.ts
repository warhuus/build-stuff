/**
 * itemFunnel alert view loader (spec §9 2.1–2.4 alert view; lead decision D12; Appendix A F3, F6).
 * 2.1 terms from `query/buildFunnel.carriedAlertSets` (under "now" only the open-alert count; the lifecycle
 * terms are 0 and not queried); 2.2–2.4 come from L1 rows in derive; L2 facts only for alertType /
 * routingPersona / priority; L3 alerts only under "now" or with escalated. actionType / writebackType need
 * no extra call (derive groups the L1 rows by eventType).
 */
import { carriedAlertSets } from "../query/buildFunnel";
import type { CarriedAlertSets } from "../query/buildFunnel";
import { loadHumanEvents } from "../shared/humanEvents";
import { loadOpenAlerts } from "../shared/openAlerts";
import { loadTouchedAlerts } from "../shared/touchedAlerts";
import { sourceCtxOf } from "../shared/sourceCtx";
import type { LoaderDeps, MetricsSource, SourceCtx } from "../source/MetricsSource";
import type {
  AlertLifecycleRow,
  AlertViewRaw,
  BreakdownDimension,
  CarriedAlertGroupsRaw,
  CarriedAlertsRaw,
  GroupCount,
  LoaderOutput,
  OpenAlertRow,
  Paged,
  Selection,
} from "../types";
import { resolveWindow } from "../window";
import { funnelLoaderOutput } from "./funnelLoaderOutput";

/** Alert attributes present on both AlertHistory (pipeline events) and AlertOrderFulfillment (spec §9 2.1). */
type AttrDim = "alertType" | "routingPersona" | "priority";
const isAttrDim = (dim: BreakdownDimension | null): dim is AttrDim =>
  dim === "alertType" || dim === "routingPersona" || dim === "priority";

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
  if (dim === "escalated" || (isAttrDim(dim) && !bounded)) {
    const openAlerts = await source.countOpenAlertsBy(sets.open, dim, ctx);
    return { lifecycleAlerts: NO_GROUPS, openAlerts, openWithLifecycleEvent: NO_GROUPS };
  }
  if (!isAttrDim(dim)) return null;
  const [lifecycleAlerts, openAlerts, openWithLifecycleEvent] = await Promise.all([
    source.countEventsBy(sets.life, "alert", dim, ctx),
    source.countOpenAlertsBy(sets.open, dim, ctx),
    source.countOpenAlertsBy(sets.openWithLifecycle, dim, ctx),
  ]);
  return { lifecycleAlerts, openAlerts, openWithLifecycleEvent };
}

/** Resolves to null when `load` is false (fetch not needed). */
const optional = <T>(load: boolean, run: () => Promise<T>): Promise<T | null> => (load ? run() : Promise.resolve(null));

/**
 * Alert view: the 2.1 terms (and grouped terms), L1(selected window, f), L2(selected window, f) for
 * attribute dims and L3 alerts under "now" or escalated — all in parallel.
 * @param selection selection (window, filters).
 * @param breakdown validated alert-view dim or null.
 * @param deps loader dependencies.
 * @returns `AlertViewRaw`; status "partial" + `row-cap` when any L1/L2/L3 fetch was capped (D11); `truncated`
 * when a grouped call returned `MAX_GROUPS` rows. Rejects on source error or abort.
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
    optional<Paged<AlertLifecycleRow>>(isAttrDim(breakdown), () => loadTouchedAlerts(w, f, deps)),
    optional<Paged<OpenAlertRow>>(!bounded || breakdown === "escalated", () => loadOpenAlerts(f, deps)),
  ]);
  const raw: AlertViewRaw = {
    view: "alert",
    window: w,
    dimension: breakdown,
    generatedAt: deps.now.toISOString(),
    carried,
    carriedGroups,
    humanEvents: human.rows,
    facts: facts?.rows ?? null,
    openAlerts: open?.rows ?? null,
  };
  const capped = [human, facts, open].some((p) => p !== null && p.capped);
  const grouped = carriedGroups === null ? [] : [carriedGroups.lifecycleAlerts, carriedGroups.openAlerts, carriedGroups.openWithLifecycleEvent];
  return funnelLoaderOutput(raw, { capped, grouped }, deps.config);
}
