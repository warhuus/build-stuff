/**
 * otifOutcome loader, 4.1 realised OTIF / CRIT, worked vs not worked (spec §9 4.1, interim A).
 * Step 1 (gated verdict totals, server aggregate) runs in parallel with steps 2–3 (worked item ids, then
 * their verdict rows by id; one fetch serves both modes). Item filters are never applied (spec §5 R3):
 * the not-worked side comes from verdict aggregates that cannot reach item properties. The client-side gate,
 * window and combine are derive's job. `VERDICT_DATE_PROPERTY` placeholder blocking happens in loadCard (D13).
 */
import { workedItems } from "../query/build";
import { sortedDistinct } from "../compute/stats";
import { sourceCtxOf } from "../shared/sourceCtx";
import type { Loader, MetricsSource, SourceCtx } from "../source/MetricsSource";
import type { ItemRow, OtifOutcomeRaw, Paged, VerdictRow, Window } from "../types";
import { resolveWindow } from "../window";
import { loaderOutput } from "./loaderOutput";

/** Worked ids and their verdict rows, plus the two paged fetches (for `row-cap`). */
interface WorkedVerdicts {
  readonly workedIds: readonly string[];
  readonly items: Paged<ItemRow>;
  readonly verdicts: Paged<VerdictRow>;
}

/**
 * Spec §9 4.1 steps 2–3: salesOrderIds of items with a human event in `window` (all-time under "now"), then
 * their verdicts by otifOrderId (`VERDICT_ID_LOOKUP` "in" chunks or "eq" per id, handled by the source).
 * @returns distinct sorted worked ids and the verdict rows (ids without a verdict are absent).
 */
async function workedVerdicts(window: Window, source: MetricsSource, ctx: SourceCtx): Promise<WorkedVerdicts> {
  const items = await source.fetchItems(workedItems(window), ctx);
  const workedIds = sortedDistinct(items.rows.map((row) => row.salesOrderId));
  const verdicts = await source.fetchVerdictsByIds(workedIds, ctx);
  return { workedIds, items, verdicts };
}

/**
 * Loads the 4.1 raw data.
 * @param selection `window` and `otifMode`; `filters` are ignored (spec §5 R3; derive adds `filters-not-applied`).
 * @param _breakdown ignored: 4.1 has no breakdowns (registry; loadCard rejects any).
 * @param deps source, now, signal, onProgress (paged id fetch and verdict chunks), config.
 * @returns raw `{ window, dimension: null, mode, totals, workedIds, verdicts }`; status "partial" with
 * `row-cap` when the worked-id fetch or the verdict lookup was capped (D11; `truncated` of the totals
 * aggregate is derive's, MOD-02). Rejects on source error or abort.
 */
export const loadOtifOutcome: Loader<OtifOutcomeRaw> = async (selection, _breakdown, deps) => {
  const window = resolveWindow(selection.window, deps.now);
  const ctx = sourceCtxOf(deps, deps.signal);
  const [totals, worked] = await Promise.all([
    deps.source.countVerdictsBy({ mode: selection.otifMode, window }, ctx),
    workedVerdicts(window, deps.source, ctx),
  ]);
  const raw: OtifOutcomeRaw = {
    window,
    dimension: null,
    mode: selection.otifMode,
    totals,
    workedIds: worked.workedIds,
    verdicts: worked.verdicts.rows,
  };
  return loaderOutput(raw, [worked.items, worked.verdicts]);
};
