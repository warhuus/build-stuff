// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { loadCard } from "../../../loadCard";
import { clearMetricsCache } from "../../../shared/cache";
import type { CardId, Selection } from "../../../types";
import { TEST_CONFIG, setup } from "../../helpers/osdkHarness";
import { sel } from "../../helpers/testKit";

// TST-02: every first-draft card loaded end to end through the OSDK adapter over the recording client (empty
// replies). The request mix per card must match the spec §9 "Cost" lines (aggregates vs paged row fetches, X2).
const NOW = new Date("2026-09-24T10:30:00.000Z");

beforeEach(() => clearMetricsCache());

describe("card loads against the recording client (spec §9 cost lines; Appendix A X2)", () => {
  it.each<[CardId, Partial<Selection>, number, number, string]>([
    ["userFunnel", { window: 7 }, 4, 0, "1.1–1.4: one aggregate each (1.0 no query)"],
    ["itemFunnel", { window: 7 }, 7, 0, "item view: 5 stage totals + 2 outside paths"],
    ["itemFunnel", { window: "now", view: "alert" }, 1, 4, "alert view now: 1 AOF count; L1, L2 chain, L2 open ids, L3 alerts"],
    ["itemFunnel", { window: 7, view: "alert" }, 3, 4, "alert view 7 d: 3 term aggregates; same 4 shared row fetches"],
    ["riskDistribution", { window: 7 }, 20, 0, "3.1: 6 count calls + 14 value calls"],
    ["otifOutcome", { window: 7 }, 1, 1, "4.1: gated totals + worked ids (no ids → no verdict lookup, D14)"],
    ["raisedToClosed", { window: 7 }, 0, 5, "4.2: L2(now) 3 fetches + not-worked 2 fetches"],
    ["raisedToClosed", { window: 30 }, 0, 3, "4.2 at 30 d: worked side only (not-worked-window-cap)"],
    ["raisedToFirstView", { window: 7 }, 0, 3, "4.3: L2(w) only"],
    ["firstViewToClosure", { window: 7 }, 0, 3, "4.4: L2(now) only"],
    ["ageingBacklog", {}, 0, 3, "4.5: L3 alerts, opened events, items"],
    ["closureComposition", { window: 7 }, 1, 3, "4.6: closedTotal aggregate + L2(now)"],
  ])("%s %j: %i aggregates, %i paged fetches (%s)", async (card, over, aggregates, loads) => {
    const t = setup();
    const r = await loadCard(card, sel(over), null, { source: t.source, now: NOW, config: TEST_CONFIG });
    expect(["ok", "partial"]).toContain(r.status);
    expect(t.requests.filter((q) => q.kind === "aggregate")).toHaveLength(aggregates);
    expect(t.requests.filter((q) => q.kind === "loadObjects")).toHaveLength(loads);
  });
});
