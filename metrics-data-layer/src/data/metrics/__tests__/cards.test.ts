import { beforeEach, describe, expect, it } from "vitest";
import { METRICS_CONFIG } from "../../../config/metrics";
import { loadCard } from "../loadCard";
import { DEFAULT_SELECTION } from "../selection";
import { clearMetricsCache } from "../shared/cache";
import { createFakeSource } from "../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../source/fake/fixtures";
import type { CardId, DurationSeries, Selection } from "../types";
import { resolveWindow } from "../window";

// One end-to-end golden per first-draft card: loadCard → loader → fake source → derive, at 7 d on the shared
// fixtures (fixtures.ts, fixtureAlerts.ts; FIXTURE_NOW = 2026-09-01T12:00Z). Every number is hand-derived from
// the fixture tables (process/phase3-correctness.md, phase4-G1.md). `@d` = d days before 09-01 at 06:00Z, so a
// token is inside 7 d iff d < 7. Quantiles (Appendix A O7): position q·n, linear inside the bin reaching it.

const S7: Selection = { ...DEFAULT_SELECTION, window: 7 };
const load = <C extends CardId>(card: C, s: Selection = S7, config = FIXTURE_CONFIG) =>
  loadCard(card, s, null, { source: createFakeSource(), now: FIXTURE_NOW, config });
/** A duration series as [key, n, non-empty bins as [binStart, count]]. */
const brief = (s: DurationSeries) => [s.key, s.n, s.bins.filter((b) => b.count > 0).map((b) => [b.binStart, b.count])];
const close = (a: number | null | undefined, b: number): void => expect(a ?? Number.NaN).toBeCloseTo(b, 6);

beforeEach(() => clearMetricsCache());

describe("first-draft cards at 7 d (golden, fake source)", () => {
  it("1.x userFunnel: 1.1 u1 u2 u4 = 3; 1.2 viewers 5; 1.3 actors 5; 1.4 write-back u1 (A25) = 1", async () => {
    const r = await load("userFunnel");
    expect(r).toMatchObject({ status: "ok", computedAt: FIXTURE_NOW.toISOString(), window: resolveWindow(7, FIXTURE_NOW) });
    expect(r.data?.total.view).toBe("user");
    expect(r.data?.total.stages.map((st) => st.count)).toEqual([null, 3, 5, 5, 1]);
  });

  it("2.x itemFunnel item view: stage counts and outside paths", async () => {
    // 2.0 I1–I26, I28–I32 = 31; 2.1 ∩ alerted = 29; 2.2 {9,10,11,13,15,17,19,21,24,25,32} = 11;
    // 2.3 {10,13,15,19,21,25,32} = 7; 2.4 {25} = 1; out 2.3 = acted − 2.2 = {2,7,18} = 3; out 2.4 = ∅.
    const r = await load("itemFunnel");
    expect(r.status).toBe("ok");
    expect(r.data?.total.firstStageId).toBe("2.0");
    expect(r.data?.total.stages.map((st) => st.count)).toEqual([31, 29, 11, 7, 1]);
    expect(r.data?.total.stages.map((st) => st.outsidePath?.count ?? null)).toEqual([null, null, null, 3, 0]);
    expect(r.caveats).toEqual(["proxy", "not-a-conversion", "low-volume", "build-stamp"]);
  });

  it("2.x itemFunnel alert view: population 57, viewed 12, acted 5, written back 1", async () => {
    // 2.1 = 48 open + 9 closed in 7 d (A35 A36 A40 A42 A44 A46 A49 A50 A55). Viewed in 7 d: A09 A11 A13 A15 A19
    // A25 A44 A46 A49 A58 A62 A65 (A53 closed @8, outside 2.1) = 12. Acted ∩ viewed: A15 A19 A25 A46 A49 = 5;
    // acted outside 2.2: A18 A21 A32 A70 = 4. Written back: A25 = 1.
    const r = await load("itemFunnel", { ...S7, view: "alert" });
    const t = r.data?.total;
    expect(t?.firstStageId).toBe("2.1");
    expect(t?.stages.map((st) => [st.id, st.availability, st.count])).toEqual([
      ["2.0", "not-applicable", null], ["2.1", "ok", 57], ["2.2", "ok", 12], ["2.3", "ok", 5], ["2.4", "ok", 1],
    ]);
    expect(t?.stages.map((st) => st.pctPrev)).toEqual([null, null, 12 / 57, 5 / 12, 1 / 5]);
    expect(t?.stages.map((st) => st.outsidePath?.count ?? null)).toEqual([null, null, null, 4, 0]);
    expect(r.caveats).toEqual(["not-a-conversion", "low-volume", "build-stamp"]);
  });

  it("3.1 riskDistribution: worked / not-worked open items per bucket", async () => {
    // 30 evaluated open items: unscored 8, b15_30 5, b31_50 4, b51_70 4, b71_90 3, b91_100 3, delayed 3.
    // Worked in 7 d (human event on the item): unscored I7 I18 I24, b15_30 I15 I17, b31_50 I2 I19,
    // b51_70 I9 I10 I21, b71_90 I11, b91_100 I13 I25, delayed none = 13; not worked = the rest (17).
    const r = await load("riskDistribution");
    const rows = r.data?.total ?? [];
    expect(rows).toHaveLength(14);
    const count = (worked: boolean) => ["unscored", "b15_30", "b31_50", "b51_70", "b71_90", "b91_100", "delayed"]
      .map((b) => rows.find((x) => x.bucket === b && x.worked === worked)?.count);
    expect(count(true)).toEqual([3, 2, 2, 3, 1, 2, 0]);
    expect(count(false)).toEqual([5, 3, 2, 1, 2, 1, 3]);
    // Worked b51_70 value: I9 + I10 + I21 = 40 000 USD.
    expect(rows.find((x) => x.bucket === "b51_70" && x.worked)?.valueUsd).toBe(40_000);
  });

  it("4.1 otifOutcome: worked 2 / 2 made; not worked 3 / 4; 10 worked ids without a verdict", async () => {
    // Gated in-window totals: OTIF 5, Not OTIF 1. Worked verdicts 1009 1015 (both OTIF) → 2 / 2; not worked
    // (5 + 1) − 2 = 4, made 5 − 2 = 3; 16 worked ids − 6 with a verdict row = 10 missing.
    const r = await load("otifOutcome");
    expect(r.data?.total).toEqual({
      mode: "otif", workedRate: 1, notWorkedRate: 0.75, workedN: 2, notWorkedN: 4, workedMade: 2, notWorkedMade: 3, missingVerdict: 10,
    });
  });

  it("4.2 raisedToClosed: worked 6 (median 132 h, p90 285.6 h), not worked 2 (336 h, 643.2 h), noRaise 1", async () => {
    // Worked: A42 192 h, A44 48, A46 72, A49 96, A50 168, A55 120 → median pos 3 → 96 + 1/2·72 = 132;
    // p90 pos 5.4 → 168 + 1.4/2·168 = 285.6. Not worked: A35 192, A36 360 → median 168 + 1·168 = 336;
    // p90 pos 1.8 → 336 + 0.8·384 = 643.2. A40 has no opened event → noRaise.
    const r = await load("raisedToClosed");
    const [worked, notWorked] = r.data?.total.series ?? [];
    expect([brief(worked), brief(notWorked)]).toEqual([
      ["worked", 6, [[48, 2], [96, 2], [168, 2]]],
      ["notWorked", 2, [[168, 1], [336, 1]]],
    ]);
    close(worked.median, 132);
    close(worked.p90, 285.6);
    close(notWorked.median, 336);
    close(notWorked.p90, 643.2);
    expect(r.data?.total).toMatchObject({ excluded: [{ reason: "noRaise", count: 1 }], clampedNegative: 0 });
    expect(r.caveats).toEqual(["build-stamp", "opened-events-since-pipeline-start"]);
  });

  it("4.3 raisedToFirstView: 12 first views in 7 d", async () => {
    // A13 0 h; A09 A15 A19 A25 A46 A49 A58 27 h; A44 48 h; A53 123 h; A62 771 h; A65 1539 h → n 12.
    // median pos 6 → 24 + (6 − 1)/7·24; p90 pos 10.8 → 720 + 0.8/2·1440 = 1296.
    const r = await load("raisedToFirstView");
    const [all] = r.data?.total.series ?? [];
    expect(brief(all)).toEqual(["all", 12, [[0, 1], [24, 7], [48, 1], [96, 1], [720, 2]]]);
    close(all.median, 24 + (5 / 7) * 24);
    close(all.p90, 1296);
    expect(r.caveats).toEqual(["build-stamp", "censored-unviewed", "opened-events-since-pipeline-start"]);
  });

  it("4.4 firstViewToClosure: 6 closed and viewed (median 72 h, p90 146.4 h)", async () => {
    // A44 0 h (view at the close stamp), A46 45, A49 69, A55 93, A50 141, A42 165 → median pos 3 → 48 + 1/2·48;
    // p90 pos 5.4 → 96 + 1.4/2·72 = 146.4.
    const r = await load("firstViewToClosure");
    const [all] = r.data?.total.series ?? [];
    expect(brief(all)).toEqual(["all", 6, [[0, 1], [24, 1], [48, 2], [96, 2]]]);
    close(all.median, 72);
    close(all.p90, 146.4);
    expect(r.data?.total.excluded).toEqual([{ reason: "closeBeforeView", count: 0 }]);
  });

  it("4.5 ageingBacklog: 48 open, 3 of unknown age, 16 older than 30 d", async () => {
    // Age > 30: the 7 + 7 + 2 alerts of [30,60), [60,90), [90,∞); pct over the 45 known ages; value over their
    // 12 distinct valued items (I29 null) = 232 000 USD.
    const r = await load("ageingBacklog");
    const t = r.data?.total;
    expect(t).toMatchObject({ openAlerts: 48, unknownAge: 3, asOf: FIXTURE_NOW.toISOString() });
    expect(t?.threshold).toEqual({ days: 30, alerts: 16, valueUsd: 232_000, pct: 16 / 45 });
    expect(t?.alertBins.at(-1)).toMatchObject({ binStart: 90, binEnd: null, alertCount: 2 });
    expect(t?.itemBins.reduce((s, b) => s + b.itemCount, 0)).toBe(27);
  });

  it("4.6 closureComposition: 9 closed → noHuman 3, viewOnly 3, action 2, writeBack 1", async () => {
    // A35 A36 A40 no human · A42 A44 A55 view only · A46 A49 action · A50 write-back (A31 reopened: excluded).
    const r = await load("closureComposition");
    expect(r.data?.total.closedTotal).toBe(9);
    expect(r.data?.total.rows.map((x) => [x.group, x.count])).toEqual([
      ["noHuman", 3], ["viewOnly", 3], ["action", 2], ["writeBack", 1],
    ]);
    expect(r.caveats).toEqual(["closure-actor-unknown", "precedence"]);
  });
});

describe("cards that never load", () => {
  it.each<[CardId, string, string[]]>([
    ["riskMovement", "not-captured", ["not-captured"]],
    ["riskCalibration", "not-captured", ["delayed-forced-100", "not-captured"]],
    ["rolledValue", "no-source", ["no-source"]],
  ])("stub %s is blocked (%s) without a call", async (card, reason, caveats) => {
    const source = createFakeSource();
    const r = await loadCard(card, S7, null, { source, now: FIXTURE_NOW, config: FIXTURE_CONFIG });
    expect(r).toMatchObject({ status: "blocked", blocked: { reason } });
    expect([...r.caveats].sort()).toEqual(caveats);
    expect(source.calls).toEqual([]);
  });

  it("a card with a placeholder integration value is blocked: needs-integration-value", async () => {
    const r = await load("userFunnel", S7, METRICS_CONFIG);
    expect(r).toMatchObject({ status: "blocked", caveats: ["needs-integration-value"], blocked: { reason: "needs-integration-value" } });
    expect(r.blocked?.unblockedBy).toMatch(/ALERT_APP_ID/);
  });
});
