// Funnel maths (sections 1–2): percentages, first ok stage, value fallback, outside paths, alert-view nesting,
// one breakdown of each kind.
import { describe, expect, it } from "vitest";
import { deriveItemFunnel } from "../../compute/deriveItemFunnel";
import { deriveUserFunnel } from "../../compute/deriveUserFunnel";
import { deriveFunnel, okStage, outsidePathOf } from "../../compute/funnel";
import type { AlertViewRaw, FunnelStageRaw, ItemViewRaw, UserFunnelRaw } from "../../types";
import { NOW_ISO, SMALL, daysAgo, ev, fact, openAlert, win } from "../helpers/deriveRows";
import { sel } from "../helpers/testKit";

const cv = (count: number, valueUsd: number) => ({ count, valueUsd });

const itemStages: FunnelStageRaw[] = [
  okStage("2.0", cv(100, 10_000), ["proxy"]),
  okStage("2.1", cv(50, 8_000)),
  okStage("2.2", cv(20, 2_000)),
  okStage("2.3", cv(10, 1_600), ["not-a-conversion"], outsidePathOf("2.3", cv(4, 300))),
  okStage("2.4", cv(0, 0), ["low-volume"], outsidePathOf("2.4", cv(1, 50))),
];

const userRaw: UserFunnelRaw = {
  window: win(30),
  dimension: null,
  generatedAt: NOW_ISO,
  users: { "1.1": 20, "1.2": 10, "1.3": 5, "1.4": 1 },
  groups: null,
};

const itemRaw: ItemViewRaw = {
  window: win(30),
  dimension: null,
  view: "item",
  generatedAt: NOW_ISO,
  stages: { "2.0": cv(100, 10000), "2.1": cv(50, 6000), "2.2": cv(20, 3000), "2.3": cv(10, 1000), "2.4": cv(2, 100) },
  outsidePath: { "2.3": cv(5, 500), "2.4": cv(1, 50) },
  groups: null,
};

// Alert view. Human rows: a1 viewed + acted + written back; a2 viewed; a3 acted without a view; a4 write-back
// only (source "user", also an action); a5 viewed. 2.1 population at 30 d (COR-01) = open now {a1, a2} ∪ closed
// in the window {a3, a4}; a5 closed 40 days ago is outside 2.1, so its view is not counted.
const open = { isClosed: false, closedAt: null, closureGroup: null };
const alertRaw: AlertViewRaw = {
  window: win(30),
  dimension: null,
  view: "alert",
  generatedAt: NOW_ISO,
  carried: { lifecycleAlerts: 10, openAlerts: 8, openWithLifecycleEvent: 3 },
  carriedGroups: null,
  humanEvents: [
    ev("a1", "opened_by_user"),
    ev("a1", "comment_added"),
    ev("a1", "delivery_block_removed"),
    ev("a2", "opened_by_user"),
    ev("a3", "comment_added"),
    ev("a4", "delivery_block_removed"),
    ev("a5", "opened_by_user"),
  ],
  facts: [fact("a1", open), fact("a2", open), fact("a3"), fact("a4"), fact("a5", { closedAt: daysAgo(40) })],
  openAlerts: [openAlert("a1"), openAlert("a2")],
};

describe("deriveFunnel percentages (spec §9.0, F2–F3)", () => {
  it.each([
    ["count", [null, 0.5, 0.4, 0.5, 0], [1, 0.5, 0.2, 0.1, 0], [null, 100, 50, 20, 10]],
    // same raw numbers in USD: 8000/10000, 2000/8000, 1600/2000, 0/1600; trackValue = previous stage's value
    ["valueUsd", [null, 0.8, 0.25, 0.8, 0], [1, 0.8, 0.2, 0.16, 0], [null, 10_000, 8_000, 2_000, 1_600]],
  ] as const)("unit %s: pctPrev, pctFirst, trackValue", (unit, pctPrev, pctFirst, trackValue) => {
    const { stages } = deriveFunnel(itemStages, unit);
    expect(stages.map((s) => s.pctPrev)).toEqual(pctPrev);
    expect(stages.map((s) => s.pctFirst)).toEqual(pctFirst);
    expect(stages.map((s) => s.trackValue)).toEqual(trackValue);
  });

  it("zero previous stage → null pctPrev; zero first → null pctFirst", () => {
    const [, second] = deriveFunnel([okStage("2.0", cv(0, 0)), okStage("2.1", cv(0, 0))], "count").stages;
    expect(second).toMatchObject({ pctPrev: null, pctFirst: null, trackValue: 0 });
  });
});

describe("first ok stage and the value fallback", () => {
  it.each([
    // 1.2 / 1.1 = 10 / 20
    ["section 1 (1.0 no-source)", () => deriveUserFunnel(userRaw, sel({ unit: "valueUsd" })), "1.1", "no-source", 0.5],
    // 2.2 / 2.1 = viewed {a1, a2} / (10 + (8 − 3))
    ["alert view (2.0 not-applicable)", () => deriveItemFunnel(alertRaw, sel({ unit: "valueUsd", view: "alert" })), "2.1", "not-applicable", 2 / 15],
  ] as const)("%s: starts at %s, unit valueUsd falls back to counts", (_, derive, firstId, firstAvailability, pct) => {
    const out = derive();
    const t = out.data.total;
    expect(t.firstStageId).toBe(firstId);
    expect(t.unit).toBe("count"); // SPF-01: the unit the numbers are in
    expect(t.stages[0]).toMatchObject({ availability: firstAvailability, count: null, pctFirst: null });
    expect(t.stages[1]).toMatchObject({ pctPrev: null, pctFirst: 1, trackValue: null });
    expect(t.stages[2].pctFirst).toBe(pct);
    expect(out.caveats).toContain("value-item-view-only");
  });

  it("item view: first stage 2.0, value percentages, outside paths on 2.3 / 2.4 only, no fallback", () => {
    const count = deriveItemFunnel(itemRaw, sel()).data.total;
    expect(count.firstStageId).toBe("2.0");
    expect(count.stages[1]).toMatchObject({ pctPrev: 0.5, pctFirst: 0.5, trackValue: 100 });
    expect(count.stages.map((s) => s.outsidePath)).toEqual([
      null,
      null,
      null,
      { count: 5, valueUsd: 500, label: "Acted without a view" },
      { count: 1, valueUsd: 50, label: "Written back outside the path" },
    ]);
    const value = deriveItemFunnel(itemRaw, sel({ unit: "valueUsd" }));
    expect(value.data.total.stages[1]).toMatchObject({ pctPrev: 0.6, pctFirst: 0.6, trackValue: 10000 });
    expect(value.caveats).not.toContain("value-item-view-only");
  });
});

describe("alert-view nesting (COR-01): 2.2–2.4 and outside paths count only alerts in 2.1", () => {
  it.each([
    // 2.1 = 10 + (8 − 3) = 15; viewed {a1, a2}; acted {a1, a3, a4} → 2.3 {a1}, outside {a3, a4}; written back {a1, a4}
    // → 2.4 {a1}, outside {a4}
    ["30 days", alertRaw, [null, 15, 2, 1, 1], 2, 1],
    // now: open now {a1, a2} only; a3, a4 closed are outside 2.1 → no outside-path alerts; 2.1 = 0 + (8 − 0)
    ["now", { ...alertRaw, window: win("now"), carried: { lifecycleAlerts: 0, openAlerts: 8, openWithLifecycleEvent: 0 } }, [null, 8, 2, 1, 1], 0, 0],
  ] as const)("%s", (_, raw, counts, outside23, outside24) => {
    const t = deriveItemFunnel(raw, sel()).data.total;
    expect(t.stages.map((s) => s.count)).toEqual(counts);
    expect(t.stages[3].outsidePath?.count).toBe(outside23);
    expect(t.stages[4].outsidePath?.count).toBe(outside24);
  });
});

describe("funnel breakdowns", () => {
  it("additive (item dim): top-2 groups, other = total − Σ shown per stage, truncated", () => {
    const g = (x: number, y: number, z: number) => [
      { group: "X", ...cv(x, x * 100) },
      { group: "Y", ...cv(y, y * 100) },
      { group: "Z", ...cv(z, z * 100) },
    ];
    const groups = { "2.0": g(60, 30, 5), "2.1": g(30, 15, 1), "2.2": g(10, 5, 0), "2.3": g(5, 2, 0), "2.4": g(1, 0, 0) };
    const out = deriveItemFunnel({ ...itemRaw, dimension: "plant", groups }, sel({ unit: "valueUsd" }), SMALL);
    const bd = out.data.breakdown;
    expect(bd).toMatchObject({ additive: true, overlapRatio: null });
    expect(bd?.groups.map((x) => [x.group, x.data.stages.map((s) => s.count)])).toEqual([
      ["X", [60, 30, 10, 5, 1]],
      ["Y", [30, 15, 5, 2, 0]],
    ]);
    // other 2.0: 100 − 90 = 10 items, 10000 − 9000 = 1000; 2.4: 2 − 1 = 1 item, 100 − 100 = 0
    expect(bd?.other?.stages[0]).toMatchObject({ count: 10, valueUsd: 1000 });
    expect(bd?.other?.stages[4]).toMatchObject({ count: 1, valueUsd: 0 });
    expect(out.caveats).toContain("truncated");
  });

  it("non-additive (alert dim): no other, overlapRatio = Σ groups / total on the chosen stage 2.1", () => {
    const groups = { "2.1": [{ group: "High", ...cv(40, 5000) }, { group: "Low", ...cv(20, 2000) }], "2.2": [{ group: "High", ...cv(15, 2000) }] };
    const out = deriveItemFunnel({ ...itemRaw, dimension: "priority", groups }, sel());
    const bd = out.data.breakdown;
    expect(bd).toMatchObject({ additive: false, other: null, overlapRatio: 60 / 50 });
    expect(bd?.groups[0].data.stages.map((s) => s.count)).toEqual([null, 40, 15, 0, 0]);
    expect(bd?.groups[0].data.firstStageId).toBe("2.1");
    expect(out.caveats).toContain("overlap");
  });

  it("top-N cut: overlapRatio over ALL groups (15 + 10 + 1) / 20, only 2 shown", () => {
    const groups = { "1.1": [{ group: "Q1", count: 15 }, { group: "Q2", count: 10 }, { group: "Q3", count: 1 }], "1.2": [{ group: "Q2", count: 7 }] };
    const out = deriveUserFunnel({ ...userRaw, dimension: "queueFilter", groups }, sel(), SMALL);
    const bd = out.data.breakdown;
    expect(bd?.overlapRatio).toBe(26 / 20);
    expect(bd?.groups.map((g) => [g.group, g.data.stages.map((s) => s.count)])).toEqual([
      ["Q1", [null, 15, 0, 0, 0]],
      ["Q2", [null, 10, 7, 0, 0]],
    ]);
    expect(out.caveats).toEqual(expect.arrayContaining(["overlap", "truncated"]));
  });
});
