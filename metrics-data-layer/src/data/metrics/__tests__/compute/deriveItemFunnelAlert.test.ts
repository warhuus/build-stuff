import { describe, expect, it } from "vitest";
import { carriedPopulation } from "../../compute/deriveItemFunnelAlert";
import { deriveItemFunnel } from "../../compute/deriveItemFunnel";
import type { AlertViewRaw } from "../../types";
import { NOW_ISO, SMALL, daysAgo, ev, fact, openAlert, sel, win } from "./deriveTestUtils";

// Human rows: a1 viewed + acted + written back; a2 viewed; a3 acted without a view; a4 write-back only (also an
// action, source "user"); a5 viewed.
const humanEvents = [
  ev("a1", "opened_by_user"),
  ev("a1", "comment_added"),
  ev("a1", "delivery_block_removed"),
  ev("a2", "opened_by_user"),
  ev("a3", "comment_added"),
  ev("a4", "delivery_block_removed"),
  ev("a5", "opened_by_user"),
];
const attrs = (alertType: string | null) => ({ alertType, routingPersona: "P", priority: "High" });
const open = { isClosed: false, closedAt: null, closureGroup: null };
// 2.1 population at 30 d (COR-01): open now {a1, a2} (L3) ∪ closed in the window {a3, a4}; a5 closed 40 days
// ago (before the 30-day start) is NOT in 2.1, like fixture A53 at 7 d, so its view is not counted.
// The L2 attrs of the open alerts ("Z") differ from their AOF rows: groups must use AOF (COR-02).
const raw: AlertViewRaw = {
  window: win(30),
  dimension: null,
  view: "alert",
  generatedAt: NOW_ISO,
  carried: { lifecycleAlerts: 10, openAlerts: 8, openWithLifecycleEvent: 3 },
  carriedGroups: null,
  humanEvents,
  facts: [
    fact("a1", { ...open, attrs: attrs("Z") }),
    fact("a2", { ...open, attrs: attrs("Z") }),
    fact("a3", { attrs: attrs("B") }),
    fact("a4", { attrs: attrs(null) }),
    fact("a5", { closedAt: daysAgo(40), attrs: attrs("A") }),
  ],
  openAlerts: [openAlert("a1", { riskType: "A", escalated: true }), openAlert("a2", { riskType: "B", escalated: false })],
};

describe("carriedPopulation (spec §9 2.1 alert view, §8; COR-01)", () => {
  it("open now ∪ closed in the window; under now open now only; closedAt = start is inside", () => {
    expect([...carriedPopulation(raw)].sort()).toEqual(["a1", "a2", "a3", "a4"]);
    expect([...carriedPopulation({ ...raw, window: win("now") })].sort()).toEqual(["a1", "a2"]);
    const atStart = { ...raw, facts: [fact("a6", { closedAt: win(30).start })], openAlerts: [] };
    expect([...carriedPopulation(atStart)]).toEqual(["a6"]);
  });
});

describe("deriveItemFunnel alert view", () => {
  it("total: 2.0 not-applicable, 2.1 = a + (open − openWith), 2.2–2.4 and outside paths within 2.1 only", () => {
    // population {a1..a4}: viewed {a1, a2} = 2 (a5 excluded); acted {a1, a3, a4}; stage23 {a1}; outside23
    // {a3, a4}; written back {a1, a4}; stage24 {a1}; outside24 {a4}. 2.1 = 10 + (8 − 3) = 15.
    const out = deriveItemFunnel(raw, sel());
    const t = out.data.total;
    expect(t).toMatchObject({ view: "alert", firstStageId: "2.1", unit: "count" });
    expect(t.stages.map((s) => [s.availability, s.count, s.valueUsd])).toEqual([
      ["not-applicable", null, null],
      ["ok", 15, null],
      ["ok", 2, null],
      ["ok", 1, null],
      ["ok", 1, null],
    ]);
    expect(t.stages[3].outsidePath).toEqual({ count: 2, valueUsd: null, label: "Acted without a view" });
    expect(t.stages[4].outsidePath).toEqual({ count: 1, valueUsd: null, label: "Written back outside the path" });
    expect(t.stages[2].pctFirst).toBe(2 / 15);
    expect(out.caveats).toEqual(["not-a-conversion", "low-volume"]);
    expect(out.data.breakdown).toBeNull();
  });

  it("unit valueUsd falls back to counts: series unit is count (SPF-01) + value-item-view-only", () => {
    const out = deriveItemFunnel(raw, sel({ unit: "valueUsd", view: "alert" }));
    expect(out.data.total.stages[2].pctFirst).toBe(2 / 15);
    expect(out.data.total.unit).toBe("count");
    expect(out.caveats).toContain("value-item-view-only");
  });

  it("under now: only alerts open now; no open alerts → none", () => {
    const now = { ...raw, window: win("now"), carried: { lifecycleAlerts: 0, openAlerts: 8, openWithLifecycleEvent: 0 } };
    // open now {a1, a2}: viewed 2, stage23 {a1}, stage24 {a1}; a3, a4 closed are outside 2.1 under now
    const out = deriveItemFunnel(now, sel());
    expect(out.data.total.stages.map((s) => s.count)).toEqual([null, 8, 2, 1, 1]);
    expect(out.data.total.stages[3].outsidePath?.count).toBe(0);
    expect(out.caveats).toEqual(expect.arrayContaining(["now-all-time", "now-open-only"]));
    expect(deriveItemFunnel({ ...now, openAlerts: [] }, sel()).data.total.stages.map((s) => s.count)).toEqual([null, 8, 0, 0, 0]);
  });

  it("build-stamp on 2.1 at 7 days", () => {
    expect(deriveItemFunnel({ ...raw, window: win(7) }, sel()).data.total.stages[1].caveats).toEqual(["build-stamp"]);
  });

  it("alertType: additive, 2.1 from summed grouped terms, open alerts by AOF, closed by attrs, other, cap truncation", () => {
    const out = deriveItemFunnel(
      {
        ...raw,
        dimension: "alertType",
        carriedGroups: {
          lifecycleAlerts: [{ group: "A", count: 6 }, { group: "B", count: 3 }],
          openAlerts: [{ group: "A", count: 4 }, { group: "C", count: 1 }],
          openWithLifecycleEvent: [{ group: "A", count: 2 }, { group: "C", count: 1 }, { group: "D", count: 1 }],
        },
      },
      sel(),
      SMALL,
    );
    const bd = out.data.breakdown;
    // 2.1: A = 6 + (4 − 2) = 8; B = 3; C = 0 + (1 − 1) = 0 and D = 0 + max(0, −1) = 0 are dropped.
    // keys: a1 → AOF "A" (not attrs "Z"), a2 → AOF "B", a3 → attrs "B", a4 → null (other).
    // A {a1}: viewed 1, stage23 1, stage24 1. B {a2, a3}: viewed {a2} 1, stage23 ∅, stage24 ∅.
    expect(bd?.groups.map((g) => [g.group, g.data.stages.map((s) => s.count)])).toEqual([
      ["A", [null, 8, 1, 1, 1]],
      ["B", [null, 3, 1, 0, 0]],
    ]);
    expect(bd?.groups[0].data.stages[3].outsidePath).toBeNull();
    // other: 15 − 11 = 4; 2 − 2 = 0; 1 − 1 = 0; 1 − 1 = 0
    expect(bd?.other?.stages.map((s) => s.count)).toEqual([null, 4, 0, 0, 0]);
    expect(bd?.additive).toBe(true);
    expect(bd?.truncated).toBeNull();
    expect(out.caveats).toContain("truncated"); // openWithLifecycleEvent returned MAX_GROUPS (3) rows
    expect(out.caveats).not.toContain("overlap");
  });

  it("group without population alerts, or no grouped terms at all", () => {
    const out = deriveItemFunnel(
      { ...raw, dimension: "priority", carriedGroups: { lifecycleAlerts: [{ group: "Low", count: 2 }], openAlerts: [], openWithLifecycleEvent: [] } },
      sel(),
    );
    // every population alert is "High" (AOF and attrs); only "Low" is ranked
    expect(out.data.breakdown?.groups.map((g) => g.data.stages.map((s) => s.count))).toEqual([[null, 2, 0, 0, 0]]);
    const empty = deriveItemFunnel({ ...raw, dimension: "routingPersona" }, sel());
    expect(empty.data.breakdown?.groups).toEqual([]);
    expect(empty.data.breakdown?.other?.stages.map((s) => s.count)).toEqual([null, 15, 2, 1, 1]);
  });

  it("escalated: groups from open alerts only, escalated-open-only; under now ∩ open now", () => {
    const openAlerts = [openAlert("a1", { escalated: true }), openAlert("a2", { escalated: false }), openAlert("a9", { escalated: true })];
    const carriedGroups = { lifecycleAlerts: [], openAlerts: [{ group: "true", count: 2 }, { group: "false", count: 1 }], openWithLifecycleEvent: [] };
    const out = deriveItemFunnel({ ...raw, dimension: "escalated", openAlerts, carriedGroups }, sel());
    // true {a1, a9}: a1 viewed, acted, written back; false {a2}: viewed; closed a3, a4 have no flag → other
    expect(out.data.breakdown?.groups.map((g) => [g.group, g.data.stages.map((s) => s.count)])).toEqual([
      ["true", [null, 2, 1, 1, 1]],
      ["false", [null, 1, 1, 0, 0]],
    ]);
    expect(out.caveats).toContain("escalated-open-only");
    const now = deriveItemFunnel(
      { ...raw, window: win("now"), dimension: "escalated", openAlerts: openAlerts.slice(1), carriedGroups },
      sel(),
    );
    // open now: a2, a9 → true group {a9}: no human events; false {a2}: viewed
    expect(now.data.breakdown?.groups.map((g) => g.data.stages.map((s) => s.count))).toEqual([
      [null, 2, 0, 0, 0],
      [null, 1, 1, 0, 0],
    ]);
    const noOpen = deriveItemFunnel({ ...raw, dimension: "escalated", openAlerts: [], carriedGroups }, sel());
    expect(noOpen.data.breakdown?.groups.map((g) => g.data.stages.map((s) => s.count))).toEqual([
      [null, 2, 0, 0, 0],
      [null, 1, 0, 0, 0],
    ]);
  });

  it("actionType: non-additive on 2.3 only (B10), overlap", () => {
    const out = deriveItemFunnel({ ...raw, dimension: "actionType" }, sel());
    const bd = out.data.breakdown;
    // stage23 {a1} has two action types → overlapRatio 2 / 1
    expect(bd?.groups.map((g) => [g.group, g.data.stages.map((s) => s.availability)])).toEqual([
      ["comment_added", ["not-applicable", "not-applicable", "not-applicable", "ok", "not-applicable"]],
      ["delivery_block_removed", ["not-applicable", "not-applicable", "not-applicable", "ok", "not-applicable"]],
    ]);
    expect(bd?.groups[0].data.stages[3].count).toBe(1);
    expect(bd?.overlapRatio).toBe(2);
    expect(bd?.other).toBeNull();
    expect(out.caveats).toContain("overlap");
  });

  it("writebackType: non-additive on 2.4 only", () => {
    const out = deriveItemFunnel({ ...raw, dimension: "writebackType" }, sel());
    const bd = out.data.breakdown;
    expect(bd?.groups.map((g) => [g.group, g.data.stages[4].count, g.data.stages[3].availability])).toEqual([
      ["delivery_block_removed", 1, "not-applicable"],
    ]);
    expect(bd?.overlapRatio).toBe(1);
    expect(out.caveats).toContain("overlap");
  });

  it("a dim outside the alert-view registry row throws instead of computing something else (TYP-05)", () => {
    expect(() => deriveItemFunnel({ ...raw, dimension: "plant" }, sel())).toThrow(RangeError);
  });
});
