import { beforeEach, describe, expect, it } from "vitest";
import { loadCard } from "../loadCard";
import { clearMetricsCache } from "../shared/cache";
import { createFakeSource } from "../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../source/fake/fixtures";
import type { BreakdownDimension, CompositionResult, Selection } from "../types";
import { sel } from "./helpers/testKit";

// 4.5 and 4.6 end to end on the fixtures (TST-03): loadCard → loader → derive, hand-derived from the ALERTS
// table (fixtureAlerts.ts). `@d` = d days before 09-01 at 06:00Z; FIXTURE_NOW = 09-01T12:00Z, so an alert raised
// at op@d is d + 0.25 days old (A59 op@7:12 exactly 7.0).

const opts = () => ({ source: createFakeSource(), now: FIXTURE_NOW, config: FIXTURE_CONFIG });
const ageing = (s: Selection, bd: BreakdownDimension | null = null) => loadCard("ageingBacklog", s, bd, opts());
const closure = (s: Selection, bd: BreakdownDimension | null = null) => loadCard("closureComposition", s, bd, opts());
/** Composition as [closedTotal, noHuman, viewOnly, action, writeBack]. */
const comp = (c: CompositionResult | null | undefined) => [c?.closedTotal, ...(c?.rows.map((r) => r.count) ?? [])];

beforeEach(() => clearMetricsCache());

describe("ageingBacklog (spec §9 4.5) on the fixtures", () => {
  // Open alerts (48) by raise (min op): unknown A32 A33 A34 (no op) → 45 known.
  // [0,1) A08 · [1,2) A05 A13 A57 A58 A68 · [2,3) A01 A19 A70 · [3,4) A06 A09 · [4,5) A21 · [5,6) A24 A25 ·
  // [6,7) A15 · [7,8) A59 · [8,9) A31 (min op@8) · [10,11) A10 · [11,12) A69 · [12,13) A02 A26 · [13,14) A16 ·
  // [16,17) A22 · [20,21) A11 A60 · [22,23) A61 · [25,26) A03 A27 · [28,29) A17 ·
  // [30,60) A29 (min op@30 → 30.25) A12 A18 A23 A62 A63 A64 = 7 · [60,90) A04 A30 A20 A28 A65 A66 A67 = 7 ·
  // [90,∞) A07 A14 = 2.
  const ALERT_BINS: readonly (readonly [number, number])[] = [
    [0, 1], [1, 5], [2, 3], [3, 2], [4, 1], [5, 2], [6, 1], [7, 1], [8, 1], [10, 1], [11, 1], [12, 2], [13, 1],
    [16, 1], [20, 2], [22, 1], [25, 2], [28, 1], [30, 7], [60, 7], [90, 2],
  ];

  it("N = 30: open alerts, unknownAge, alert bins, threshold tile", async () => {
    const r = await ageing(sel({ ageingThresholdDays: 30 }));
    const t = r.data?.total;
    expect(t).toMatchObject({ openAlerts: 48, unknownAge: 3, asOf: FIXTURE_NOW.toISOString() });
    expect(t?.alertBins.filter((b) => b.alertCount > 0).map((b) => [b.binStart, b.alertCount])).toEqual(ALERT_BINS);
    expect(t?.alertBins.at(-1)).toMatchObject({ binStart: 90, binEnd: null });
    // age > 30: the 16 alerts of [30,60), [60,90), [90,∞); pct over known ages 16/45. Value over their distinct
    // items I29 (null) I12 I23 I18 I21 I22 I4 I20 I16 I24 I25 I26 I7 I14 (A64 shares I23, A30/A20 share I20)
    // = 12+23+18+21+22+4+20+16+24+25+26+7+14 = 232 → 232 000.
    expect(t?.threshold).toEqual({ days: 30, alerts: 16, valueUsd: 232_000, pct: 16 / 45 });
    expect(r.caveats).toEqual(["opened-events-since-pipeline-start", "no-target-property"]);
  });

  it("item bins: each item once, at its oldest open alert", async () => {
    const t = (await ageing(sel())).data?.total;
    // Items with a known-age open alert: I1–I26 and I29 = 27. [0,1) I8 (A08) 8 000; [1,2) I5 (A05, A68) and I13
    // (A13) = 18 000; I16 (A57 1.25 d) sits at A28 80 d and I17 (A58) at A17 28 d.
    expect(t?.itemBins.reduce((s, b) => s + b.itemCount, 0)).toBe(27);
    expect(t?.itemBins.slice(0, 2)).toEqual([
      { binStart: 0, binEnd: 1, itemCount: 1, valueUsd: 8000 },
      { binStart: 1, binEnd: 2, itemCount: 2, valueUsd: 18_000 },
    ]);
  });

  it("N = 10 re-derives from the cache: 28 alerts, 28/45 (no refetch)", async () => {
    const source = createFakeSource();
    const o = { source, now: FIXTURE_NOW, config: FIXTURE_CONFIG };
    await loadCard("ageingBacklog", sel(), null, o);
    const calls = source.calls.length;
    const r = await loadCard("ageingBacklog", sel({ ageingThresholdDays: 10 }), null, o);
    // age > 10: bins from [10,11) on: 1+1+2+1+1+2+1+2+1 + 7+7+2 = 28.
    expect(r.data?.total.threshold).toMatchObject({ days: 10, alerts: 28, pct: 28 / 45 });
    expect(source.calls).toHaveLength(calls);
  });
});

describe("closureComposition (spec §9 4.6) on the fixtures", () => {
  // Closed in 7 d, not open now (A31 cl@6 reopened → excluded): A35 A36 A40 (no human) · A42, A44 (view at the
  // close stamp), A55 (view only) · A46, A49 (action) · A50 (write-back) = 9.
  it("7 d total: 9 closed → noHuman 3, viewOnly 3, action 2, writeBack 1", async () => {
    const r = await closure(sel({ window: 7 }));
    expect(comp(r.data?.total)).toEqual([9, 3, 3, 2, 1]);
    expect(r.data?.total.rows.map((x) => x.group)).toEqual(["noHuman", "viewOnly", "action", "writeBack"]);
    expect(r.caveats).toEqual(["closure-actor-unknown", "precedence"]);
  });

  it.each<[BreakdownDimension, [string, number[]][]]>([
    // Closed-event riskType: LateGI A35 nH, A42 vO, A46 ac, A49 ac, A50 wb, A55 vO; CreditBlock A36 A40 nH;
    // Allocation A44 vO.
    ["alertType", [["LateGI", [6, 1, 2, 2, 1]], ["CreditBlock", [2, 2, 0, 0, 0]], ["Allocation", [1, 0, 1, 0, 0]]]],
    // Closed-event persona (A55 → Logistics): Logistics A36 nH, A46 A49 ac, A55 vO; Planner A35 nH, A42 vO, A50 wb;
    // CustomerService A40 nH, A44 vO.
    ["routingPersona", [["Logistics", [4, 1, 1, 2, 0]], ["Planner", [3, 1, 1, 0, 1]], ["CustomerService", [2, 1, 1, 0, 0]]]],
    // Closed-event priority (A55 → Medium): High A35 A40 nH, A42 vO, A46 ac, A50 wb; Low A44 vO, A49 ac;
    // Medium A36 nH, A55 vO. Low and Medium tie at 2 → by name.
    ["priority", [["High", [5, 2, 1, 1, 1]], ["Low", [2, 0, 1, 1, 0]], ["Medium", [2, 1, 1, 0, 0]]]],
  ])("7 d by %s: groups sum to the total; other empty", async (dim, expected) => {
    const r = await closure(sel({ window: 7 }), dim);
    const b = r.data?.breakdown;
    expect(b?.groups.map((g) => [g.group, comp(g.data)])).toEqual(expected);
    expect(comp(b?.other)).toEqual([0, 0, 0, 0, 0]);
    expect(b).toMatchObject({ additive: true, truncated: null, overlapRatio: null });
  });

  it("14 d: A53 and A54 have human events only after closure → noHuman", async () => {
    const r = await closure(sel({ window: 14 }));
    // + A37 cl@12, A41 cl@9 (no human), A47 cl@11 (action), A53 cl@8, A54 cl@13 (human only after closure) = 14;
    // noHuman A35 A36 A37 A40 A41 A53 A54 = 7, viewOnly 3, action A46 A47 A49 = 3, writeBack 1.
    expect(comp(r.data?.total)).toEqual([14, 7, 3, 3, 1]);
  });
});
