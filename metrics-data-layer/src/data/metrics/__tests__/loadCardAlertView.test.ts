import { beforeEach, describe, expect, it } from "vitest";
import { loadCard } from "../loadCard";
import { clearMetricsCache } from "../shared/cache";
import { createFakeSource } from "../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../source/fake/fixtures";
import type { BreakdownDimension, FunnelSeries, Selection } from "../types";
import { sel } from "./helpers/testKit";

// itemFunnel alert view end to end on the fixtures (TST-03): loadCard → loader → deriveItemFunnel. Expected
// values are hand-derived from the ALERTS table (fixtureAlerts.ts); 7 d start = 08-25T12:00Z (`@d` = d days
// before 09-01 at 06:00Z, so a token is in 7 d iff d < 7). COR-01: 2.2–2.4 and the outside paths count only the
// 2.1 population (open now, or closed at/after the window start). COR-02: an open alert is grouped by its AOF row.
//
// 2.1 population at 7 d = 48 open + 9 closed in the window (A35 cl@2, A36 @5, A40 @6, A42 @4, A44 @6, A46 @3,
//   A49 @1, A50 @2, A55 @4) = 57.
// viewed in 7 d (vw token d < 7): A09 A11 A13 A15 A19 A25 A44 A46 A49 A53 A58 A62 A65; A53 closed @8 (before
//   the start) → 2.2 = 12.
// acted in 7 d (ac rs es dl wb wt wr): A15 A18 A19 A21 A25 A32 A46 A49 A54 A70; A54 closed @13 → 9 in 2.1.
//   2.3 = acted ∩ viewed = A15 A19 A25 A46 A49 = 5; outside = A18 A21 A32 A70 = 4.
// written back in 7 d: A25 (wb@4:11) → 2.4 = 1; outside 0.
// now: population = the 48 open alerts; viewed ever: A09–A20, A25, A26, A28–A30, A32, A33, A58, A60, A62, A65,
//   A67, A69 = 25; acted ever: A15–A23, A25–A28, A32, A60, A63, A70 = 17 → 2.3 = A15–A20, A25, A26, A28, A32,
//   A60 = 11, outside A21 A22 A23 A27 A63 A70 = 6; written back: A25 A26 A27 A28 → 2.4 = A25 A26 A28 = 3,
//   outside A27 = 1.

const load = (s: Selection, bd: BreakdownDimension | null = null) =>
  loadCard("itemFunnel", s, bd, { source: createFakeSource(), now: FIXTURE_NOW, config: FIXTURE_CONFIG });
const counts = (fs: FunnelSeries | undefined) => fs?.stages.map((s) => s.count);
const groupCounts = (r: Awaited<ReturnType<typeof load>>) =>
  r.data?.breakdown?.groups.map((g) => [g.group, counts(g.data)]);
const A7 = sel({ view: "alert", window: 7 });
const ANOW = sel({ view: "alert", window: "now" });

beforeEach(() => clearMetricsCache());

describe("itemFunnel alert view on the fixtures (spec §9 2.1–2.4 alert view; COR-01, COR-02)", () => {
  it("7 d: stages, percentages, trackValue and outside paths", async () => {
    const r = await load(A7);
    expect(r.status).toBe("ok");
    const t = r.data?.total;
    expect(t?.firstStageId).toBe("2.1");
    expect(t?.stages.map((s) => [s.id, s.availability, s.count, s.valueUsd])).toEqual([
      ["2.0", "not-applicable", null, null],
      ["2.1", "ok", 57, null],
      ["2.2", "ok", 12, null],
      ["2.3", "ok", 5, null],
      ["2.4", "ok", 1, null],
    ]);
    // pctPrev 12/57, 5/12, 1/5; pctFirst over 2.1; trackValue = previous applicable stage.
    expect(t?.stages.map((s) => s.pctPrev)).toEqual([null, null, 12 / 57, 5 / 12, 1 / 5]);
    expect(t?.stages.map((s) => s.pctFirst)).toEqual([null, 1, 12 / 57, 5 / 57, 1 / 57]);
    expect(t?.stages.map((s) => s.trackValue)).toEqual([null, null, 57, 12, 5]);
    expect(t?.stages.map((s) => s.outsidePath?.count ?? null)).toEqual([null, null, null, 4, 0]);
    // Window ≤ 7 d → build-stamp on 2.1 (spec §9 2.1).
    expect(r.caveats).toEqual(["not-a-conversion", "low-volume", "build-stamp"]);
  });

  it("now: open alerts only, all-time events", async () => {
    const r = await load(ANOW);
    expect(counts(r.data?.total)).toEqual([null, 48, 25, 11, 3]);
    expect(r.data?.total.stages.map((s) => s.outsidePath?.count ?? null)).toEqual([null, null, null, 6, 1]);
    expect(r.caveats).toEqual(["not-a-conversion", "low-volume", "now-all-time", "now-open-only"]);
  });

  it("unit valueUsd falls back to counts with value-item-view-only (SPF-01)", async () => {
    const r = await load(sel({ view: "alert", window: 7, unit: "valueUsd" }));
    expect(r.data?.total.unit).toBe("count");
    expect(counts(r.data?.total)).toEqual([null, 57, 12, 5, 1]);
    expect(r.caveats).toContain("value-item-view-only");
  });

  it("7 d alertType: 2.1 from the grouped terms; 2.2–2.4 within 2.1", async () => {
    const r = await load(A7, "alertType");
    // 2.1: open LateGI 21 + closed-in-window LateGI (A35 A42 A46 A49 A50 A55) 6 = 27; CreditBlock 14 + A36 A40 = 16;
    // Allocation 13 + A44 = 14. 2.2: LateGI A09 A13 A15 A19 A25 A46 A49 A65 = 8; CreditBlock A58 A62 = 2;
    // Allocation A11 A44 = 2. 2.3: A15 A19 A25 A46 A49 all LateGI; 2.4 A25 LateGI.
    expect(groupCounts(r)).toEqual([
      ["LateGI", [null, 27, 8, 5, 1]],
      ["CreditBlock", [null, 16, 2, 0, 0]],
      ["Allocation", [null, 14, 2, 0, 0]],
    ]);
    expect(counts(r.data?.breakdown?.other ?? undefined)).toEqual([null, 0, 0, 0, 0]);
    expect(r.data?.breakdown).toMatchObject({ additive: true, truncated: null, overlapRatio: null });
  });

  it("7 d routingPersona: open alerts by AOF persona, closed by their closed event (A55 → Logistics)", async () => {
    const r = await load(A7, "routingPersona");
    // 2.1 (phase-3 table): Planner 12 + 12 = 24, Logistics 10 + 9 = 19, CustomerService 5 + 9 = 14.
    // 2.2: Planner A09 A15 A25 = 3; Logistics A13 A19 A46 A49 A58 = 5; CustomerService A11 A44 A62 A65 = 4.
    // 2.3: Planner A15 A25, Logistics A19 A46 A49; 2.4: Planner A25.
    expect(groupCounts(r)).toEqual([
      ["Planner", [null, 24, 3, 2, 1]],
      ["Logistics", [null, 19, 5, 3, 0]],
      ["CustomerService", [null, 14, 4, 0, 0]],
    ]);
    expect(counts(r.data?.breakdown?.other ?? undefined)).toEqual([null, 0, 0, 0, 0]);
  });

  it("now routingPersona: every open alert keeps its AOF group, even without a pipeline event (A32, A33)", async () => {
    const r = await load(ANOW, "routingPersona");
    // 2.1 AOF: Planner 21, Logistics 15, CustomerService 12. 2.2 (viewed ever): Planner A09 A12 A14 A15 A18 A20
    // A25 A28 A29 A32 A60 = 11; Logistics A10 A13 A16 A19 A26 A30 A33 A58 A67 = 9; CustomerService A11 A17 A62 A65
    // A69 = 5. 2.3: Planner A15 A18 A20 A25 A28 A32 A60 = 7; Logistics A16 A19 A26 = 3; CustomerService A17 = 1.
    // 2.4: Planner A25 A28 = 2, Logistics A26 = 1.
    expect(groupCounts(r)).toEqual([
      ["Planner", [null, 21, 11, 7, 2]],
      ["Logistics", [null, 15, 9, 3, 1]],
      ["CustomerService", [null, 12, 5, 1, 0]],
    ]);
    expect(counts(r.data?.breakdown?.other ?? undefined)).toEqual([null, 0, 0, 0, 0]);
  });

  it("7 d escalated: open alerts only; closed alerts and A06 (null flag) land in other", async () => {
    const r = await load(A7, "escalated");
    // 2.1: false 38, true 9 (AOF), other = 57 − 47 = 10 (9 closed + A06). 2.2: false A09 A11 A13 A15 A19 A25 A58
    // A62 = 8, true A65 = 1, other A44 A46 A49 = 3. 2.3: false A15 A19 A25, other A46 A49. 2.4: false A25.
    expect(groupCounts(r)).toEqual([
      ["false", [null, 38, 8, 3, 1]],
      ["true", [null, 9, 1, 0, 0]],
    ]);
    expect(counts(r.data?.breakdown?.other ?? undefined)).toEqual([null, 10, 3, 2, 0]);
    expect(r.caveats).toContain("escalated-open-only");
  });

  it("7 d actionType and writebackType: non-additive groups on their first stage (B10)", async () => {
    const act = await load(A7, "actionType");
    // 2.3 alerts A15 A19 A25 A46 A49 all have status_changed (ac) = 5; A25's wb is also an action (eventSource user)
    // → delivery_block_removed 1. overlapRatio = 6 / 5.
    expect(groupCounts(act)).toEqual([
      ["status_changed", [null, null, null, 5, null]],
      ["delivery_block_removed", [null, null, null, 1, null]],
    ]);
    expect(act.data?.breakdown).toMatchObject({ additive: false, other: null, overlapRatio: 6 / 5, truncated: null });
    expect(act.caveats).toContain("overlap");
    const wb = await load(A7, "writebackType");
    // 2.4 = {A25}: delivery_block_removed 1; overlap 1 / 1.
    expect(groupCounts(wb)).toEqual([["delivery_block_removed", [null, null, null, null, 1]]]);
    expect(wb.data?.breakdown?.overlapRatio).toBe(1);
  });
});
