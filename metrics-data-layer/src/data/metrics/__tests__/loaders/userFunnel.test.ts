import { beforeEach, describe, expect, it } from "vitest";
import { deriveUserFunnel } from "../../compute/deriveUserFunnel";
import { escalatedEvents, events } from "../../query/build";
import { EMPTY_FILTERS } from "../../selection";
import { clearMetricsCache } from "../../shared/cache";
import { loadUserFunnel } from "../../loaders/userFunnel";
import type { BreakdownDimension, ItemFilters, WindowKey } from "../../types";
import { AMER, fakeDeps, win } from "../helpers/loaderDeps";
import { sel } from "../helpers/testKit";

const run = (window: WindowKey, dim: BreakdownDimension | null, filters: ItemFilters = EMPTY_FILTERS) => {
  const deps = fakeDeps();
  return loadUserFunnel(sel({ window: window, filters: filters }), dim, deps).then((out) => ({ out, deps }));
};

// Fixture users (fixtures.ts APP_USAGE_ROWS, fixtureAlerts.ts): app usage u1 d0/d1 Planner + d3 Logistics, u2 d2/d20
// All, u3 d10 CustomerService, u4 d1 (null queue), u5 d40 Logistics, u6 d100 Planner, u7 other app (never counted).
// Human-event persona = queue filter: u1 Planner, u2 All, u3 CustomerService, u4 All, u5 Logistics, u6 null.
// Window d<N: 7 d holds events of days 0..6.
describe("loadUserFunnel (spec §9 1.1–1.4)", () => {
  beforeEach(() => clearMetricsCache());

  it.each<[WindowKey, [number, number, number, number]]>([
    // 1.1: 7 d u1 u2 u4 = 3; 14 d +u3 = 4; 30 d (u2 d20 again) 4; 90 d +u5 = 5; now +u6 = 6.
    // 1.2 (vw actors): 7 d u1 (A09@2) u2 (A19@1) u3 (A11@5) u4 (A13@1) u5 (A49@4) = 5; 14/30 d still 5;
    //   90 d +u6 (A20@65) = 6; now 6.
    // 1.3 (ac/rs/es/dl/wb/wt/wr actors): 7 d u1 (A15@5) u2 (A19@1) u3 (A21@3) u4 (A70 dl@1) u5 (A18@3) = 5;
    //   14/30 d 5; 90 d +u6 (A20 es@65) = 6; now 6.
    // 1.4 (wb/wt/wr actors): 7 d u1 (A25@4) = 1; 14 d +u2 (A26@11) +u4 (A28@10) = 3; 30 d +u3 (A27@24) = 4;
    //   90 d +u6 (A52@58) = 5; now 5.
    [7, [3, 5, 5, 1]],
    [14, [4, 5, 5, 3]],
    [30, [4, 5, 5, 4]],
    [90, [5, 6, 6, 5]],
    ["now", [6, 6, 6, 5]],
  ])("window %s: distinct users per stage; 4 calls, no groups", async (key, [u11, u12, u13, u14]) => {
    const { out, deps } = await run(key, null);
    expect(out).toEqual({
      raw: {
        window: win(key),
        dimension: null,
        generatedAt: "2026-09-01T12:00:00.000Z",
        users: { "1.1": u11, "1.2": u12, "1.3": u13, "1.4": u14 },
        groups: null,
      },
      status: "ok",
      caveats: [],
    });
    expect(deps.source.calls.map((c) => c.method).sort()).toEqual(["countAppUsers", "countEvents", "countEvents", "countEvents"]);
    expect(deps.source.calls.map((c) => c.args)).toContainEqual([events(["writeback"], win(key), EMPTY_FILTERS), "actor"]);
  });

  it("queueFilter (7 d): grouped on every stage 1.1–1.4", async () => {
    const { out, deps } = await run(7, "queueFilter");
    // 1.1: Planner u1, Logistics u1 (d3), All u2; u4 null dropped → 1 each (count desc, name asc).
    // 1.2: All u2 u4 = 2; CustomerService u3, Logistics u5, Planner u1 = 1.
    // 1.3: All u2 u4 = 2; CustomerService u3, Logistics u5, Planner u1 = 1.  1.4: Planner u1.
    expect(out.raw.groups).toEqual({
      "1.1": [{ group: "All", count: 1 }, { group: "Logistics", count: 1 }, { group: "Planner", count: 1 }],
      "1.2": [{ group: "All", count: 2 }, { group: "CustomerService", count: 1 }, { group: "Logistics", count: 1 }, { group: "Planner", count: 1 }],
      "1.3": [{ group: "All", count: 2 }, { group: "CustomerService", count: 1 }, { group: "Logistics", count: 1 }, { group: "Planner", count: 1 }],
      "1.4": [{ group: "Planner", count: 1 }],
    });
    expect(deps.source.calls.map((c) => c.method).sort()).toEqual([
      "countAppUsers", "countAppUsersBy", "countEvents", "countEvents", "countEvents", "countEventsBy", "countEventsBy", "countEventsBy",
    ]);
    expect(deps.source.calls.map((c) => c.args)).toContainEqual([events(["viewed"], win(7), EMPTY_FILTERS), "actor", "queueFilter"]);
  });

  it("alertType (7 d): 1.2–1.4 only", async () => {
    const { out, deps } = await run(7, "alertType");
    // 1.2 vw 7 d by riskType: LateGI u1 (A09/A15/A25/A53) u4 (A13) u2 (A19/A46) u5 (A49/A65) = 4;
    //   CreditBlock u2 (A58) u3 (A62) = 2; Allocation u3 (A11/A44) = 1.
    // 1.3: LateGI u1 (A15/A25/A32) u5 (A18/A49) u2 (A19/A46) = 3; Allocation u3 (A21) u4 (A70) = 2; CreditBlock u2 (A54) = 1.
    // 1.4: LateGI u1 (A25) = 1.
    expect(out.raw.groups).toEqual({
      "1.2": [{ group: "LateGI", count: 4 }, { group: "CreditBlock", count: 2 }, { group: "Allocation", count: 1 }],
      "1.3": [{ group: "LateGI", count: 3 }, { group: "Allocation", count: 2 }, { group: "CreditBlock", count: 1 }],
      "1.4": [{ group: "LateGI", count: 1 }],
    });
    expect(deps.source.calls.filter((c) => c.method === "countEventsBy")).toHaveLength(3);
    expect(deps.source.calls.some((c) => c.method === "countAppUsersBy")).toBe(false);
  });

  it("escalated (7 d): two countEvents per stage 1.2–1.4 over escalatedEvents", async () => {
    const { out, deps } = await run(7, "escalated");
    // Open escalated=true: A03 A10 A14 A17 A22 A26 A31 A59 A65 (A06 null; closed alerts are not in AOF).
    // 1.2 true: A65 vw u5@2 → 1; false: A09 u1, A11 u3, A13 u4, A15 u1, A19 u2, A25 u1, A58 u2, A62 u3 → 4.
    // 1.3 true: none in 7 d (A17 d27, A22 d15, A26 d11) → 0; false: A15 u1, A18 u5, A19 u2, A21 u3, A25 u1,
    //   A32 u1, A70 u4 → 5.  1.4 true 0; false A25 u1 → 1.
    expect(out.raw.groups).toEqual({
      "1.2": [{ group: "true", count: 1 }, { group: "false", count: 4 }],
      "1.3": [{ group: "true", count: 0 }, { group: "false", count: 5 }],
      "1.4": [{ group: "true", count: 0 }, { group: "false", count: 1 }],
    });
    // 1 + 3 totals + 2 × 3 escalated calls; no grouped call.
    expect(deps.source.calls.filter((c) => c.method === "countEvents")).toHaveLength(9);
    expect(deps.source.calls.map((c) => c.args)).toContainEqual([escalatedEvents(false, ["action"], win(7)), "actor"]);
    expect(out.caveats).toEqual([]);
  });

  it("actionType (7 d): 1.3 only, eventType groups", async () => {
    const { out, deps } = await run(7, "actionType");
    // Action events 7 d: status_changed u1 (A15/A25/A32) u5 (A18/A49) u2 (A19/A46/A54) u3 (A21) = 4;
    // delivery_block_removed u1 (A25 wb@4) = 1; deeplink_clicked u4 (A70 dl@1) = 1.
    expect(out.raw.groups).toEqual({
      "1.3": [{ group: "status_changed", count: 4 }, { group: "deeplink_clicked", count: 1 }, { group: "delivery_block_removed", count: 1 }],
    });
    expect(deps.source.calls.filter((c) => c.method === "countEventsBy").map((c) => c.args)).toEqual([
      [events(["action"], win(7), EMPTY_FILTERS), "actor", "actionType"],
    ]);
  });

  it("writebackType (14 d): 1.4 only", async () => {
    const { out } = await run(14, "writebackType");
    // Write-backs 14 d: delivery_block_removed u1 (A25@4, A50@8) u4 (A28@10) = 2; delivery_tolerance_corrected u2 (A26@11) = 1.
    expect(out.raw.groups).toEqual({
      "1.4": [{ group: "delivery_block_removed", count: 2 }, { group: "delivery_tolerance_corrected", count: 1 }],
    });
  });

  it("queueFilter (now): 1.1 all-time groups", async () => {
    const { out } = await run("now", "queueFilter");
    // 1.1 all-time: Planner u1 u6 = 2; Logistics u1 u5 = 2; All u2 = 1; CustomerService u3 = 1.
    expect(out.raw.groups?.["1.1"]).toEqual([
      { group: "Logistics", count: 2 }, { group: "Planner", count: 2 }, { group: "All", count: 1 }, { group: "CustomerService", count: 1 },
    ]);
  });

  it.each<BreakdownDimension | null>([null, "queueFilter", "alertType", "escalated", "actionType", "writebackType"])(
    "item filters never change a call or the raw data (spec §9 section 1, R3): %s",
    async (dim) => {
      const plain = await run(30, dim);
      const filtered = await run(30, dim, AMER);
      expect(filtered.deps.source.calls).toEqual(plain.deps.source.calls);
      expect(filtered.out).toEqual(plain.out);
    },
  );

  it("truncated when a grouped call returns MAX_GROUPS rows; escalated pairs never count", async () => {
    const capped = fakeDeps({ config: { MAX_GROUPS: 3 } });
    // 1.2/1.3 queueFilter 7 d have 4 groups → cut to 3 = MAX_GROUPS.
    // The loader adds no caveat (MOD-02); derive decides from the grouped lists in the raw.
    const out = await loadUserFunnel(sel({ window: 7 }), "queueFilter", capped);
    expect(out).toMatchObject({ status: "ok", caveats: [] });
    expect(deriveUserFunnel(out.raw, sel({ window: 7 }), capped.config).caveats).toContain("truncated");
    const two = fakeDeps({ config: { MAX_GROUPS: 2 } });
    const pairs = await loadUserFunnel(sel({ window: 7 }), "escalated", two);
    expect(deriveUserFunnel(pairs.raw, sel({ window: 7 }), two.config).caveats).not.toContain("truncated"); // SPF-06
  });

  it("end to end with deriveUserFunnel: 1.1–1.4 counts", async () => {
    const { out } = await run(7, null);
    const series = deriveUserFunnel(out.raw, sel({ window: 7 })).data.total;
    expect(series.stages.map((s) => s.count)).toEqual([null, 3, 5, 5, 1]);
  });
});
