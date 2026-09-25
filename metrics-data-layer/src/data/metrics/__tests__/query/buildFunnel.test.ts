import { describe, expect, it } from "vitest";
import { itemsWithEvent, openAlerts, itemsOpenInWindow } from "../../query/build";
import { alertedItems, carriedAlertSets, itemFunnelSets, stageWithOpenAlertWhere } from "../../query/buildFunnel";
import { createFakeSource } from "../../source/fake/fakeSource";
import { FIXTURE_CONFIG } from "../../source/fake/fixtures";
import type { ItemFilters, Window } from "../../types";

const NONE: ItemFilters = { businessLine: [], productLine: [], region: [], plant: [] };
const BL: ItemFilters = { ...NONE, businessLine: ["BL-A"] };
const W7: Window = { key: 7, start: "2026-08-25T12:00:00.000Z", end: "2026-09-01T12:00:00.000Z" };
const NOW: Window = { key: "now", start: null, end: "2026-09-01T12:00:00.000Z" };
const OPEN_ALERT_ITEMS = { kind: "ofOpenAlerts", alerts: { kind: "all" } } as const;
const ctx = () => ({ signal: new AbortController().signal, config: FIXTURE_CONFIG });

describe("itemFunnel stage sets (spec §9 2.0–2.4)", () => {
  it("alerted items: open-alert items only under now, ∪ closed-in-window items otherwise", () => {
    expect(alertedItems(NOW)).toEqual(OPEN_ALERT_ITEMS);
    expect(alertedItems(W7)).toEqual({ kind: "union", a: OPEN_ALERT_ITEMS, b: itemsWithEvent(["closed"], W7) });
  });

  it("chains so20 → so24 by intersection and builds both outside paths", () => {
    const s = itemFunnelSets(W7, NONE);
    expect(s.so20).toEqual(itemsOpenInWindow(W7));
    expect(s.so21).toEqual({ kind: "intersect", a: s.so20, b: alertedItems(W7) });
    expect(s.so22).toEqual({ kind: "intersect", a: s.so21, b: itemsWithEvent(["viewed"], W7) });
    expect(s.so23).toEqual({ kind: "intersect", a: s.so22, b: itemsWithEvent(["action"], W7) });
    expect(s.so24).toEqual({ kind: "intersect", a: s.so23, b: itemsWithEvent(["writeback"], W7) });
    expect(s.outside23).toEqual({
      kind: "subtract",
      a: { kind: "intersect", a: s.so21, b: itemsWithEvent(["action"], W7) },
      b: s.so22,
    });
    expect(s.outside24).toEqual({
      kind: "subtract",
      a: { kind: "intersect", a: s.so21, b: itemsWithEvent(["writeback"], W7) },
      b: s.so23,
    });
  });

  it("filters enter once, through so20", () => {
    expect(itemFunnelSets(W7, BL).so20).toEqual({ kind: "filtered", base: itemsOpenInWindow(W7), filters: BL });
  });

  it("stage ∩ items with an open alert matching the condition (perGroup)", () => {
    const stage = itemFunnelSets(W7, BL).so22;
    expect(stageWithOpenAlertWhere(stage, BL, { field: "escalated", value: false })).toEqual({
      kind: "intersect",
      a: stage,
      b: { kind: "ofOpenAlerts", alerts: { kind: "where", base: openAlerts(BL), condition: { field: "escalated", value: false } } },
    });
  });

  it("2.1 alert-view terms: life, open alerts, open alerts of life", () => {
    const t = carriedAlertSets(W7, NONE);
    expect(t.life).toEqual({ kind: "where", base: { kind: "all" }, filter: { predicates: ["lifecycle"], window: W7 } });
    expect(t.open).toEqual({ kind: "all" });
    expect(t.openWithLifecycle).toEqual({ kind: "ofEvents", events: t.life });
  });

  it("evaluates on the fixtures (hand-computed in fixtures.ts / fixtureAlerts.ts)", async () => {
    const src = createFakeSource();
    // 2.0 now: isOpen items I1–I30 = 30; value Σ1..30 × 1000 − I29 (null) = 465000 − 29000.
    expect(await src.countItems(itemFunnelSets(NOW, NONE).so20, ctx())).toEqual({ count: 30, valueUsd: 436000 });
    const s7 = itemFunnelSets(W7, NONE);
    // 2.0 7 d: open I1–I30 except I27 (null creation) = 29, + closed I31 (08-30), I32 (08-25) = 31.
    expect((await src.countItems(s7.so20, ctx())).count).toBe(31);
    // 2.1 7 d: open-alert items I1–I26, I29 ∪ closed-in-7d items I1, I10, I11, I14, I31, I32, I36, I38, I40,
    // ∩ so20 → I1–I26, I29, I31, I32 = 29; value Σ1..26 × 1000 + 31000 + 32000 (I29 null).
    expect(await src.countItems(s7.so21, ctx())).toEqual({ count: 29, valueUsd: 414000 });
    // 2.2 7 d: viewed-in-7d items ∩ so21 → I9, I10, I11, I13, I15, I17, I19, I21, I24, I25, I32 = 11.
    expect((await src.countItems(s7.so22, ctx())).count).toBe(11);
  });
});
