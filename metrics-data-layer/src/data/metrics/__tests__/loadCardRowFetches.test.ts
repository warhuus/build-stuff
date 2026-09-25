import { describe, expect, it } from "vitest";
import { CARD_IDS, ITEM_FUNNEL_VIEWS, WINDOW_KEYS } from "../../../config/metricsCodes";
import { allowedBreakdowns, isItemDim } from "../breakdowns";
import { loadCard } from "../loadCard";
import * as B from "../query/build";
import { EMPTY_FILTERS } from "../selection";
import { clearMetricsCache } from "../shared/cache";
import type { FakeCall } from "../source/fake/fakeSource";
import { createFakeSource } from "../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../source/fake/fixtures";
import type { BreakdownDimension, CardId, ItemFilters, ItemFunnelView, WindowKey } from "../types";
import { resolveWindow } from "../window";
import { AMER } from "./helpers/loaderDeps";
import { sel } from "./helpers/testKit";

// D20 / TST-09 sweep (Appendix A X2, instructions §5 rule 6): for every card × window key × view × allowed
// breakdown (and none) × {no filter, AMER}, every ROW fetch the card makes against the fake must be one of the
// allowed plans, compared with the builder outputs: L1 (humanEvents), L2 (touchedEventsChain, touchedOpenAlerts)
// at the selected window or "now", L3 (l3OpenAlerts, l3OpenedEvents, l3Items), the 4.2 not-worked pair
// (closedNotOpenNow, openedEventsOfItemsOf), the 4.1 worked ids (workedItems) and verdicts by id, and items by
// id (4.2–4.4 item dims only).
const ROW_METHODS = ["fetchEvents", "fetchOpenAlerts", "fetchItems", "fetchItemsByIds", "fetchVerdictsByIds"];
const FIRST_DRAFT = CARD_IDS.filter((c) => !["riskMovement", "riskCalibration", "rolledValue"].includes(c));
const key = (c: FakeCall): string => `${c.method} ${JSON.stringify(c.args)}`;

/** Every allowed row-fetch call for a selection (window `w`, filters `f`), as `method args` keys. */
function allowedCalls(wKey: WindowKey, f: ItemFilters): Set<string> {
  const w = resolveWindow(wKey, FIXTURE_NOW);
  const now = resolveWindow("now", FIXTURE_NOW);
  const out: FakeCall[] = [
    { method: "fetchOpenAlerts", args: [B.l3OpenAlerts(f)] },
    { method: "fetchEvents", args: [B.l3OpenedEvents(f)] },
    { method: "fetchItems", args: [B.l3Items(f)] },
    { method: "fetchEvents", args: [B.closedNotOpenNow(w, f)] },
    { method: "fetchEvents", args: [B.openedEventsOfItemsOf(B.closedNotOpenNow(w, f))] },
    { method: "fetchItems", args: [B.workedItems(w)] },
  ];
  for (const lw of [w, now]) {
    out.push(
      { method: "fetchEvents", args: [B.humanEvents(lw, f)] },
      { method: "fetchEvents", args: [B.touchedEventsChain(lw, f)] },
      { method: "fetchOpenAlerts", args: [B.touchedOpenAlerts(lw, f)] },
    );
  }
  return new Set(out.map(key));
}

const isIdList = (args: readonly unknown[]): boolean =>
  args.length === 1 && Array.isArray(args[0]) && args[0].every((x) => typeof x === "string");

interface Combo {
  readonly card: CardId;
  readonly view: ItemFunnelView;
  readonly window: WindowKey;
  readonly dim: BreakdownDimension | null;
  readonly filters: ItemFilters;
}
const combos: Combo[] = FIRST_DRAFT.flatMap((card) =>
  (card === "itemFunnel" ? ITEM_FUNNEL_VIEWS : (["item"] as const)).flatMap((view) =>
    WINDOW_KEYS.flatMap((window) =>
      [null, ...allowedBreakdowns(card, view)].flatMap((dim) =>
        [EMPTY_FILTERS, AMER].map((filters) => ({ card, view, window, dim, filters })),
      ),
    ),
  ),
);

describe("row fetches per card (D20 sweep; Appendix A X2)", () => {
  it("sweeps every card, window, view and allowed breakdown", () => {
    // 9 cards; itemFunnel has two views. Anti-vacuity: the sweep is not empty and covers every card.
    expect(new Set(combos.map((c) => c.card))).toEqual(new Set(FIRST_DRAFT));
    expect(combos.length).toBeGreaterThan(400);
  });

  it("every row fetch is one of the allowed plans", { timeout: 120_000 }, async () => {
    const bad: string[] = [];
    let rowCalls = 0;
    for (const c of combos) {
      clearMetricsCache();
      const source = createFakeSource();
      const r = await loadCard(c.card, sel({ window: c.window, view: c.view, filters: c.filters }), c.dim, {
        source, now: FIXTURE_NOW, config: FIXTURE_CONFIG,
      });
      const label = `${c.card}/${c.view}/${c.window}/${c.dim ?? "-"}/${c.filters === AMER ? "AMER" : "all"}`;
      if (r.status !== "ok" && r.status !== "partial") bad.push(`${label}: status ${r.status}`);
      const allowed = allowedCalls(c.window, c.card === "userFunnel" ? EMPTY_FILTERS : c.filters);
      for (const call of source.calls.filter((x) => ROW_METHODS.includes(x.method))) {
        rowCalls += 1;
        if (call.method === "fetchItemsByIds") {
          const itemDimDuration = ["raisedToClosed", "raisedToFirstView", "firstViewToClosure"].includes(c.card);
          if (!itemDimDuration || c.dim === null || !isItemDim(c.dim) || !isIdList(call.args)) bad.push(`${label}: ${key(call)}`);
        } else if (call.method === "fetchVerdictsByIds") {
          if (c.card !== "otifOutcome" || !isIdList(call.args)) bad.push(`${label}: ${key(call)}`);
        } else if (!allowed.has(key(call))) {
          bad.push(`${label}: ${call.method}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(rowCalls).toBeGreaterThan(1000);
  });

  it("section 1, the item view and 3.1 make no row fetch at all", async () => {
    for (const [card, view] of [["userFunnel", "item"], ["itemFunnel", "item"], ["riskDistribution", "item"]] as const) {
      clearMetricsCache();
      const source = createFakeSource();
      await loadCard(card, sel({ window: 7, view }), null, { source, now: FIXTURE_NOW, config: FIXTURE_CONFIG });
      expect(source.calls.filter((x) => ROW_METHODS.includes(x.method))).toEqual([]);
      expect(source.calls.length).toBeGreaterThan(0);
    }
  });
});
