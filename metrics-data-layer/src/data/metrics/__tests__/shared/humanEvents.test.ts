import { beforeEach, describe, expect, it } from "vitest";
import { humanEvents } from "../../query/build";
import { clearMetricsCache } from "../../shared/cache";
import { loadHumanEvents } from "../../shared/humanEvents";
import { memoKey } from "../../shared/memo";
import { EMPTY_FILTERS } from "../../selection";
import { AMER, callCount, fakeDeps, idsOf, win } from "./loaderDeps";

// Human tokens (fixtureAlerts.ts): vw ac rs es dl wb wt wr; `up` and `ag` are not human.
describe("loadHumanEvents (L1, spec §9.0.1)", () => {
  beforeEach(() => clearMetricsCache());

  it("7 days, no filter: 24 human events of 18 alerts", async () => {
    const deps = fakeDeps();
    const res = await loadHumanEvents(win(7), EMPTY_FILTERS, deps);
    // d < 7: A09 1, A11 1 (vw@18 out), A13 1, A15 2, A18 1 (ac@3), A19 2 (up not human), A21 1, A25 3,
    // A32 1 (ac@5), A44 1, A46 2, A49 2, A53 1, A54 1, A58 1, A62 1, A65 1, A70 1 = 24 rows, 18 alerts.
    expect(res.rows).toHaveLength(24);
    expect(res.capped).toBe(false);
    expect(idsOf(res.rows)).toEqual(
      ["A09", "A11", "A13", "A15", "A18", "A19", "A21", "A25", "A32", "A44", "A46", "A49", "A53", "A54", "A58", "A62", "A65", "A70"],
    );
    expect(deps.source.calls).toEqual([{ method: "fetchEvents", args: [humanEvents(win(7), EMPTY_FILTERS)] }]);
  });

  it("7 days, region AMER: 10 events of 7 alerts", async () => {
    const res = await loadHumanEvents(win(7), AMER, fakeDeps());
    // Of the 18 above, on AMER items (I21–I40, not I29): A21 (I21) 1, A25 (I25) 3, A44 (I40) 1,
    // A46 (I32) 2, A53 (I36) 1, A62 (I21) 1, A65 (I24) 1 = 10 rows.
    expect(res.rows).toHaveLength(10);
    expect(idsOf(res.rows)).toEqual(["A21", "A25", "A44", "A46", "A53", "A62", "A65"]);
  });

  it("14 days: 37 events of 27 alerts", async () => {
    const res = await loadHumanEvents(win(14), EMPTY_FILTERS, fakeDeps());
    // 7-day 24 + A10 vw@9, A16 vw@12 rs@11, A26 vw@11 wt@11, A28 wb@10, A29 vw@9, A42 vw@11,
    // A50 vw ac wb @8, A55 vw@8, A69 vw@10 = 24 + 13 = 37 rows; 18 + 9 = 27 alerts.
    expect(res.rows).toHaveLength(37);
    expect(idsOf(res.rows)).toHaveLength(27);
  });

  it('"now" (all-time up to now): 66 events of 46 alerts; AMER: 24 events of 18 alerts', async () => {
    // Per alert human tokens: A09–A14 7, A15–A20 12, A21–A23 3, A25–A28 9, A29–A30 2, A32–A33 3,
    // A42–A45 4, A46–A49 7, A50–A52 6, A53–A56 4, A58 A60(2) A62 A63 A65 A67 A69 A70 9 = 66.
    const all = await loadHumanEvents(win("now"), EMPTY_FILTERS, fakeDeps());
    expect(all.rows).toHaveLength(66);
    expect(idsOf(all.rows)).toHaveLength(46);
    // AMER: A21 1, A22 1, A23 1, A25 3, A26 2, A42 1, A43 1, A44 1, A45 1, A46 2, A47 1, A48 2, A52 2,
    // A53 1, A62 1, A63 1, A65 1, A67 1 = 24 rows, 18 alerts.
    const amer = await loadHumanEvents(win("now"), AMER, fakeDeps());
    expect(amer.rows).toHaveLength(24);
    expect(idsOf(amer.rows)).toHaveLength(18);
  });

  it("memo key is window.key | filtersKey; the same key is fetched once", async () => {
    expect(memoKey(win(7), AMER)).toBe("7|bl=;pl=;rg=AMER;pt=");
    const deps = fakeDeps();
    await loadHumanEvents(win(7), AMER, deps);
    await loadHumanEvents(win(7), { ...AMER, region: ["AMER", "AMER"] }, deps);
    expect(callCount(deps.source, "fetchEvents")).toBe(1);
    await loadHumanEvents(win(14), AMER, deps);
    expect(callCount(deps.source, "fetchEvents")).toBe(2);
  });

  it("passes onProgress and config to the source", async () => {
    const seen: number[] = [];
    const deps = { ...fakeDeps({ config: { PAGE_SIZE: 10 } }), onProgress: (p: { loaded: number }) => seen.push(p.loaded) };
    await loadHumanEvents(win(7), EMPTY_FILTERS, deps);
    // 24 rows in pages of 10: 10, 20, 24.
    expect(seen).toEqual([10, 20, 24]);
  });
});
