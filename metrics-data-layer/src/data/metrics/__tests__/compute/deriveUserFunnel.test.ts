import { describe, expect, it } from "vitest";
import { deriveUserFunnel } from "../../compute/deriveUserFunnel";
import { EMPTY_FILTERS } from "../../selection";
import type { UserFunnelRaw } from "../../types";
import { NOW_ISO, SMALL, sel, win } from "./deriveTestUtils";

const raw: UserFunnelRaw = {
  window: win(30),
  dimension: null,
  generatedAt: NOW_ISO,
  users: { "1.1": 20, "1.2": 10, "1.3": 5, "1.4": 1 },
  groups: null,
};

describe("deriveUserFunnel (section 1)", () => {
  it("total: 1.0 no-source, first stage 1.1, stage caveats", () => {
    const out = deriveUserFunnel(raw, sel());
    const total = out.data.total;
    expect(total).toMatchObject({ section: 1, view: "user", window: 30, unit: "count", firstStageId: "1.1", generatedAt: NOW_ISO });
    expect(total.stages.map((s) => [s.id, s.availability, s.count, s.valueUsd])).toEqual([
      ["1.0", "no-source", null, null],
      ["1.1", "ok", 20, null],
      ["1.2", "ok", 10, null],
      ["1.3", "ok", 5, null],
      ["1.4", "ok", 1, null],
    ]);
    expect(total.stages[2]).toMatchObject({ pctPrev: 0.5, pctFirst: 0.5, trackValue: 20 });
    expect(total.stages[0].caveats).toEqual(["no-source"]);
    expect(total.stages[2].caveats).toEqual(["queue-filter-persona", "id-space-differs"]);
    expect(total.stages[4].caveats).toEqual(["low-volume", "queue-filter-persona"]);
    expect(out.caveats).toEqual(["no-source", "low-volume", "queue-filter-persona", "id-space-differs"]);
    expect(out.data.breakdown).toBeNull();
  });

  it("unit valueUsd falls back to counts with value-item-view-only", () => {
    const out = deriveUserFunnel(raw, sel({ unit: "valueUsd" }));
    expect(out.data.total.unit).toBe("valueUsd");
    expect(out.data.total.stages[2].pctPrev).toBe(0.5);
    expect(out.caveats).toContain("value-item-view-only");
  });

  it("filters-not-applied when a filter is set; now-all-time under now (also on stages)", () => {
    const out = deriveUserFunnel({ ...raw, window: win("now") }, sel({ filters: { ...EMPTY_FILTERS, region: ["EU"] } }));
    expect(out.caveats).toContain("filters-not-applied");
    expect(out.caveats).toContain("now-all-time");
    expect(out.data.total.stages[1].caveats).toContain("now-all-time");
  });

  it("queueFilter breakdown: non-additive, chosen on 1.1, 1.0 not-applicable, overlap + truncated", () => {
    const groups = {
      "1.1": [
        { group: "Q1", count: 15 },
        { group: "Q2", count: 10 },
        { group: "Q3", count: 1 },
      ],
      "1.2": [{ group: "Q2", count: 7 }],
    };
    const out = deriveUserFunnel({ ...raw, dimension: "queueFilter", groups }, sel(), SMALL);
    const bd = out.data.breakdown;
    expect(bd?.additive).toBe(false);
    expect(bd?.other).toBeNull();
    expect(bd?.overlapRatio).toBe(26 / 20);
    expect(bd?.groups.map((g) => [g.group, g.data.stages.map((s) => s.count)])).toEqual([
      ["Q1", [null, 15, 0, 0, 0]],
      ["Q2", [null, 10, 7, 0, 0]],
    ]);
    expect(bd?.groups[0].data.stages[0].availability).toBe("not-applicable");
    // Q1..Q3 = 3 rows = MAX_GROUPS (SMALL) and a top-N cut
    expect(out.caveats).toEqual(expect.arrayContaining(["overlap", "truncated"]));
    expect(out.caveats).not.toContain("escalated-open-only");
  });

  it("escalated breakdown: groups true/false on 1.2–1.4, 1.1 not-applicable, escalated-open-only", () => {
    const groups = {
      "1.2": [
        { group: "true", count: 4 },
        { group: "false", count: 8 },
      ],
      "1.3": [{ group: "true", count: 2 }],
    };
    const out = deriveUserFunnel({ ...raw, dimension: "escalated", groups }, sel());
    const bd = out.data.breakdown;
    expect(bd?.groups.map((g) => [g.group, g.data.stages.map((s) => s.availability)])).toEqual([
      ["false", ["not-applicable", "not-applicable", "ok", "ok", "ok"]],
      ["true", ["not-applicable", "not-applicable", "ok", "ok", "ok"]],
    ]);
    expect(bd?.groups[0].data.firstStageId).toBe("1.2");
    expect(bd?.overlapRatio).toBe(12 / 10);
    expect(out.caveats).toEqual(expect.arrayContaining(["overlap", "escalated-open-only"]));
    expect(out.caveats).not.toContain("truncated");
  });

  it("actionType and writebackType apply to one stage; missing groups → empty", () => {
    const action = deriveUserFunnel({ ...raw, dimension: "actionType", groups: { "1.3": [{ group: "t", count: 5 }] } }, sel());
    expect(action.data.breakdown?.groups[0].data.stages.map((s) => s.availability)).toEqual([
      "not-applicable", "not-applicable", "not-applicable", "ok", "not-applicable",
    ]);
    const wb = deriveUserFunnel({ ...raw, dimension: "writebackType", groups: null }, sel({ unit: "valueUsd" }));
    expect(wb.data.breakdown?.groups).toEqual([]);
    expect(wb.data.breakdown?.overlapRatio).toBe(0);
  });

  it("a dim outside the registry gives an empty breakdown without overlap total", () => {
    const out = deriveUserFunnel({ ...raw, dimension: "plant", groups: {} }, sel());
    expect(out.data.breakdown?.groups).toEqual([]);
    expect(out.data.breakdown?.overlapRatio).toBeNull();
  });
});
