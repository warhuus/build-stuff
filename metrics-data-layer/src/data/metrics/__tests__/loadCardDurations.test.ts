import { beforeEach, describe, expect, it } from "vitest";
import { loadCard } from "../loadCard";
import { clearMetricsCache } from "../shared/cache";
import { createFakeSource } from "../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../source/fake/fixtures";
import type { BreakdownDimension, DurationResult, DurationSeries, Selection } from "../types";
import { sel } from "./helpers/testKit";

// 4.2–4.4 end to end on the fixtures (TST-03): loadCard → loader → derive. Hand-derived from the ALERTS table
// (fixtureAlerts.ts): `@d` = d days before 09-01 at 06:00Z, so op@a … cl@b lasts (a − b) × 24 h; a `:hh` suffix
// shifts the stamp to hh:00. Quantiles (Appendix A O7): position q·n, linear inside the bin that reaches it:
// value = binStart + (position − count before the bin) / binCount × binWidth; null in the open-ended bin.
// Duration edges (h): 0 1 2 4 8 24 48 96 168 336 720 2160.

type DurationCard = "raisedToClosed" | "raisedToFirstView" | "firstViewToClosure";
const load = (card: DurationCard, s: Selection, bd: BreakdownDimension | null = null) =>
  loadCard(card, s, bd, { source: createFakeSource(), now: FIXTURE_NOW, config: FIXTURE_CONFIG });
/** A series as [key, n, non-empty bins as [binStart, count], median, p90]. */
const brief = (s: DurationSeries) => [s.key, s.n, s.bins.filter((b) => b.count > 0).map((b) => [b.binStart, b.count]), s.median, s.p90];
const series = (d: DurationResult | undefined) => d?.series.map(brief);
const close = (a: number | null | undefined, b: number): void => expect(a ?? Number.NaN).toBeCloseTo(b, 6);

beforeEach(() => clearMetricsCache());

describe("raisedToClosed (spec §9 4.2) on the fixtures", () => {
  it("7 d: worked and not-worked series, noRaise, no clamping", async () => {
    const r = await load("raisedToClosed", sel({ window: 7 }));
    // Closed in 7 d (cl d < 7), not open now. Worked (in L2 "now"): A42 op@12 cl@4 = 192 h, A44 op@8 cl@6 = 48,
    // A46 op@6 cl@3 = 72, A49 op@5 cl@1 = 96, A50 op@9 cl@2 = 168, A55 op@9 cl@4 = 120.
    //   bins [48,96) 48 72; [96,168) 96 120; [168,336) 168 192. median pos 3 → 96 + (3−2)/2·72 = 132;
    //   p90 pos 5.4 → 168 + (5.4−4)/2·168 = 285.6.
    // Not worked (no human event ever): A35 op@10 cl@2 = 192, A36 op@20 cl@5 = 360; A40 (cl@6, no op) → noRaise.
    //   median pos 1 → 168 + 1/1·168 = 336; p90 pos 1.8 → 336 + 0.8·384 = 643.2.
    expect(r.status).toBe("ok");
    const [worked, notWorked] = r.data?.total.series ?? [];
    expect([worked, notWorked].map((s) => brief(s).slice(0, 3))).toEqual([
      ["worked", 6, [[48, 2], [96, 2], [168, 2]]],
      ["notWorked", 2, [[168, 1], [336, 1]]],
    ]);
    close(worked.median, 132);
    close(worked.p90, 285.6);
    close(notWorked.median, 336);
    close(notWorked.p90, 643.2);
    expect(r.data?.total.excluded).toEqual([{ reason: "noRaise", count: 1 }]);
    expect(r.data?.total.clampedNegative).toBe(0);
    expect(r.caveats).toEqual(["build-stamp", "opened-events-since-pipeline-start"]);
  });

  it("14 d: adds A47, A53, A54 (worked) and A37, A41 (not worked; op = cl gives 0 h)", async () => {
    const r = await load("raisedToClosed", sel({ window: 14 }));
    // Worked + A47 op@18 cl@11 = 168, A53 op@10 cl@8 = 48, A54 op@14 cl@13 = 24 (its only human event is after
    // closure: still worked, W5). Sorted 24 48 48 72 96 120 168 168 192: bins [24,48) 1, [48,96) 3, [96,168) 2,
    // [168,336) 3. median pos 4.5 → 96 + 0.5/2·72 = 114; p90 pos 8.1 → 168 + 2.1/3·168 = 285.6.
    // Not worked + A37 op@15 cl@12 = 72, A41 op@9 cl@9 = 0: bins [0,1) 1, [48,96) 1, [168,336) 1, [336,720) 1.
    // median pos 2 → 48 + 1/1·48 = 96; p90 pos 3.6 → 336 + 0.6·384 = 566.4. noRaise A40.
    const [worked, notWorked] = r.data?.total.series ?? [];
    expect(brief(worked).slice(0, 3)).toEqual(["worked", 9, [[24, 1], [48, 3], [96, 2], [168, 3]]]);
    expect(brief(notWorked).slice(0, 3)).toEqual(["notWorked", 4, [[0, 1], [48, 1], [168, 1], [336, 1]]]);
    close(worked.median, 114);
    close(worked.p90, 285.6);
    close(notWorked.median, 96);
    close(notWorked.p90, 566.4);
    expect(r.data?.total.excluded).toEqual([{ reason: "noRaise", count: 1 }]);
  });

  it("7 d priority: groups by the closed event's priority (A55 → Medium), top-N over the whole population", async () => {
    const r = await load("raisedToClosed", sel({ window: 7 }), "priority");
    // High: worked A42 192, A46 72, A50 168 (median pos 1.5 → 168 + 0.5/2·168 = 210; p90 2.7 → 168 + 1.7/2·168 =
    // 310.8); not worked A35 192 (median 168 + 0.5·168 = 252); noRaise A40 → population 5.
    // Low: worked A44 48, A49 96 (median pos 1 → 96; p90 1.8 → 96 + 0.8·72 = 153.6) → 2.
    // Medium: worked A55 120 (median 96 + 0.5·72 = 132), not worked A36 360 (median 336 + 0.5·384 = 528) → 2.
    const groups = r.data?.breakdown?.groups ?? [];
    expect(groups.map((g) => g.group)).toEqual(["High", "Low", "Medium"]);
    const [high, low, medium] = groups.map((g) => g.data);
    expect(series(high)?.map((s) => s.slice(0, 3))).toEqual([["worked", 3, [[48, 1], [168, 2]]], ["notWorked", 1, [[168, 1]]]]);
    close(high.series[0].median, 210);
    close(high.series[0].p90, 310.8);
    close(high.series[1].median, 252);
    expect(high.excluded).toEqual([{ reason: "noRaise", count: 1 }]);
    close(low.series[0].median, 96);
    close(low.series[0].p90, 153.6);
    expect(low.series[1]).toMatchObject({ n: 0, median: null, p90: null });
    close(medium.series[0].median, 132);
    close(medium.series[1].median, 528);
    expect(r.data?.breakdown?.other?.series.map((s) => s.n)).toEqual([0, 0]);
  });
});

describe("raisedToFirstView (spec §9 4.3) on the fixtures", () => {
  it("30 d: population by first view in the window; bins, median and p90", async () => {
    const r = await load("raisedToFirstView", sel({ window: 30 }));
    // First view (vw, all-time first) at d ≤ 29. vw@x:09 one day after op@x+1 = 27 h: A09 A15 A16 A17 A19 A25
    // A26 A42 A43 A46 A49 A50 A55 A58 A60 A69, plus A10 (vw@9:10) 28 h → [24,48) 17. A13 vw at its op stamp 0 h
    // → [0,1). A11 op@20 vw@18:10 = 52 h and A44 op@8 vw@6 = 48 h → [48,96) 2. A53 op@10 vw@5:09 = 123 h →
    // [96,168). A29 (raised at its first op@30) vw@9:09 = 507 h → [336,720). A62 op@33 vw@1:09 = 771 h and A65
    // op@66 vw@2:09 = 1539 h → [720,2160) 2. n = 24 (A18, A28, A32 first viewed before the window).
    // median pos 12 → 24 + (12−1)/17·24 = 39.529…; p90 pos 21.6 → 336 + 0.6·384 = 566.4.
    const [all] = r.data?.total.series ?? [];
    expect(brief(all).slice(0, 3)).toEqual(["all", 24, [[0, 1], [24, 17], [48, 2], [96, 1], [336, 1], [720, 2]]]);
    close(all.median, 24 + (11 / 17) * 24);
    close(all.p90, 566.4);
    expect(r.data?.total).toMatchObject({ excluded: [{ reason: "noRaise", count: 0 }], clampedNegative: 0 });
    expect(r.caveats).toEqual(["build-stamp", "censored-unviewed", "opened-events-since-pipeline-start"]);
  });
});

describe("firstViewToClosure (spec §9 4.4) on the fixtures", () => {
  it.each<[7 | 14, number]>([
    [7, 0],
    [14, 1],
  ])("%s d: kept durations and closeBeforeView %s", async (key, closeBeforeView) => {
    const r = await load("firstViewToClosure", sel({ window: key }));
    // Closed in the window and viewed: A44 vw@6 = cl@6 → 0 h (tie kept), A46 vw@5:09 cl@3 = 45, A49 vw@4:09 cl@1 =
    // 69, A55 vw@8:09 cl@4 = 93, A50 vw@8:09 cl@2 = 141, A42 vw@11:09 cl@4 = 165. bins [0,1) 1, [24,48) 1,
    // [48,96) 2, [96,168) 2; median pos 3 → 48 + 1/2·48 = 72; p90 pos 5.4 → 96 + 1.4/2·72 = 146.4.
    // 14 d adds A47 and A54 (never viewed: not in the population) and A53 (cl@8 before its view @5) → excluded.
    const [all] = r.data?.total.series ?? [];
    expect(brief(all).slice(0, 3)).toEqual(["all", 6, [[0, 1], [24, 1], [48, 2], [96, 2]]]);
    close(all.median, 72);
    close(all.p90, 146.4);
    expect(r.data?.total.excluded).toEqual([{ reason: "closeBeforeView", count: closeBeforeView }]);
    expect(r.caveats).toEqual(["build-stamp", "excludes-close-before-view"]);
  });
});
