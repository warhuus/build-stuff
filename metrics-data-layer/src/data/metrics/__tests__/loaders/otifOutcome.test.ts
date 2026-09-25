import { describe, expect, it } from "vitest";
import { deriveOtifOutcome } from "../../compute/deriveOtifOutcome";
import { loadOtifOutcome } from "../../loaders/otifOutcome";
import { workedItems } from "../../query/build";
import { FIXTURE_CONFIG } from "../../source/fake/fixtures";
import type { GroupCount, VerdictRow } from "../../types";
import { AMER, fakeDeps, win } from "../helpers/loaderDeps";
import { sel } from "../helpers/testKit";

/*
 * Worked items = items with a human event in the window (ALERTS table, human tokens vw ac rs es dl wb wt wr):
 *   7 d  I2 I7 I9 I10 I11 I13 I15 I17 I18 I19 I21 I24 I25 I32 I36 I40                          (16)
 *   30 d 7 d + I6 I12 I14 I16 I22 I26 I29 I33 (A47) I38 (A42) I39 (A43)                          (26)
 *   now  30 d + I3 I20 I23 I31 (A45) I34 (A48) I35 (A52)                                         (32)
 * Verdict rows (fixtures.ts VERDICT_ROWS; id, otif, crit, otif gate, crit gate, ship end = VERDICT_DATE_PROPERTY
 * of FIXTURE_CONFIG): 1001 OTIF CRIT No No 08-29 · 1009 OTIF CRIT No No 08-30 · 1011 NotOTIF CRIT No No 08-20 ·
 * 1015 OTIF NotCRIT No Yes 08-26 · 1025 NotOTIF NotCRIT Yes No 08-31 · 1031 OTIF CRIT No No 08-25 ·
 * 1032 OTIF CRIT No No 07-15 · 1038 NotOTIF CRIT No No 09-01 · 1040 OTIF NotCRIT No No 05-01 ·
 * 9001 OTIF CRIT No No 08-28 · 9002 NotOTIF NotCRIT No No 08-15 · 9003 OTIF CRIT Yes Yes 08-27 ·
 * 9004 null CRIT No No 08-27 · 9006 OTIF CRIT No No null.
 */

const id = (n: number): string => `${1000 + n}_10`;
const ids = (ns: readonly number[]): string[] => ns.map(id).sort();
const byGroup = (rows: readonly GroupCount[]): GroupCount[] => [...rows].sort((a, b) => a.group.localeCompare(b.group));
const byId = (rows: readonly VerdictRow[]): string[] => rows.map((r) => r.otifOrderId).sort();

const WORKED_7 = [2, 7, 9, 10, 11, 13, 15, 17, 18, 19, 21, 24, 25, 32, 36, 40];
const WORKED_30 = [...WORKED_7, 6, 12, 14, 16, 22, 26, 29, 33, 38, 39];
const WORKED_NOW = [...WORKED_30, 3, 20, 23, 31, 34, 35];

describe("loadOtifOutcome (spec §9 4.1)", () => {
  it("7 d otif: totals, worked ids, their verdicts (both modes' fields); 3 port calls", async () => {
    const deps = fakeDeps();
    const out = await loadOtifOutcome(sel({ window: 7, otifMode: "otif" }), null, deps);
    expect(out).toMatchObject({ status: "ok", caveats: [] });
    expect(out.raw).toMatchObject({ window: win(7), dimension: null, mode: "otif" });
    // Otif gate No, ship end in [08-25, 09-01]: OTIF 1001 1009 1015 1031 9001 = 5; Not OTIF 1038 = 1
    // (9004 null class dropped; 1011 1032 1040 9002 out of window; 9006 no date; 1025 9003 gated out).
    expect(byGroup(out.raw.totals)).toEqual([{ group: "Not OTIF", count: 1 }, { group: "OTIF", count: 5 }]);
    expect(out.raw.workedIds).toEqual(ids(WORKED_7));
    // Worked ids with a verdict row: 1009 1011 1015 1025 1032 1040 (no row for the other 10).
    expect(byId(out.raw.verdicts)).toEqual(ids([9, 11, 15, 25, 32, 40]));
    expect(out.raw.verdicts.find((r) => r.otifOrderId === id(15))).toEqual({
      otifOrderId: id(15),
      otifVerdict: "OTIF",
      critVerdict: "Not CRIT",
      otifExclusion: "No",
      critExclusion: "Yes",
      verdictDate: "2026-08-26",
    });
    expect(deps.source.calls).toEqual([
      { method: "countVerdictsBy", args: [{ mode: "otif", window: win(7) }] },
      { method: "fetchItems", args: [workedItems(win(7))] },
      { method: "fetchVerdictsByIds", args: [ids(WORKED_7)] },
    ]);
  });

  it("7 d crit: totals grouped by the CRIT classification; same worked fetches", async () => {
    const out = await loadOtifOutcome(sel({ window: 7, otifMode: "crit" }), null, fakeDeps());
    // Crit gate No, date in [08-25, 09-01]: CRIT 1001 1009 1031 1038 9001 9004 = 6; Not CRIT 1025 = 1 (1015 gated out).
    expect(byGroup(out.raw.totals)).toEqual([{ group: "CRIT", count: 6 }, { group: "Not CRIT", count: 1 }]);
    expect(out.raw.mode).toBe("crit");
    expect(byId(out.raw.verdicts)).toEqual(ids([9, 11, 15, 25, 32, 40]));
  });

  it("30 d, both modes", async () => {
    const otif = await loadOtifOutcome(sel({ window: 30, otifMode: "otif" }), null, fakeDeps());
    // Otif, [08-02, 09-01]: OTIF 1001 1009 1015 1031 9001 = 5; Not OTIF 1011 1038 9002 = 3 (1032 1040 too old).
    expect(byGroup(otif.raw.totals)).toEqual([{ group: "Not OTIF", count: 3 }, { group: "OTIF", count: 5 }]);
    expect(otif.raw.workedIds).toEqual(ids(WORKED_30));
    // + 1038 (I38 worked via A42) → 7 rows.
    expect(byId(otif.raw.verdicts)).toEqual(ids([9, 11, 15, 25, 32, 38, 40]));
    const crit = await loadOtifOutcome(sel({ window: 30, otifMode: "crit" }), null, fakeDeps());
    // Crit: CRIT 1001 1009 1011 1031 1038 9001 9004 = 7; Not CRIT 1025 9002 = 2.
    expect(byGroup(crit.raw.totals)).toEqual([{ group: "CRIT", count: 7 }, { group: "Not CRIT", count: 2 }]);
  });

  it('"now", both modes: no lower date bound, worked ids all-time', async () => {
    const otif = await loadOtifOutcome(sel({ window: "now", otifMode: "otif" }), null, fakeDeps());
    // Otif, date ≤ 09-01: 30 d + 1032 1040 → OTIF 7; Not OTIF 3 (9006 has no date).
    expect(byGroup(otif.raw.totals)).toEqual([{ group: "Not OTIF", count: 3 }, { group: "OTIF", count: 7 }]);
    expect(otif.raw.window).toEqual(win("now"));
    expect(otif.raw.workedIds).toEqual(ids(WORKED_NOW));
    // + 1031 (I31 worked via A45 @69) → 8 rows.
    expect(byId(otif.raw.verdicts)).toEqual(ids([9, 11, 15, 25, 31, 32, 38, 40]));
    const crit = await loadOtifOutcome(sel({ window: "now", otifMode: "crit" }), null, fakeDeps());
    // Crit: 30 d + 1032 CRIT + 1040 Not CRIT → CRIT 8; Not CRIT 3.
    expect(byGroup(crit.raw.totals)).toEqual([{ group: "CRIT", count: 8 }, { group: "Not CRIT", count: 3 }]);
  });

  it("item filters are ignored (R3): identical calls and raw with and without AMER", async () => {
    const plain = fakeDeps();
    const filtered = fakeDeps();
    for (const mode of ["otif", "crit"] as const) {
      const a = await loadOtifOutcome(sel({ window: 7, otifMode: mode }), null, plain);
      const b = await loadOtifOutcome(sel({ window: 7, otifMode: mode, filters: AMER }), null, filtered);
      expect(b).toEqual(a);
    }
    expect(filtered.source.calls).toEqual(plain.source.calls);
  });

  it('VERDICT_ID_LOOKUP "eq": the same rows, one lookup per id', async () => {
    const inDeps = fakeDeps();
    const eqDeps = fakeDeps({ config: { VERDICT_ID_LOOKUP: "eq" } });
    const a = await loadOtifOutcome(sel({ window: 7, otifMode: "otif" }), null, inDeps);
    const b = await loadOtifOutcome(sel({ window: 7, otifMode: "otif" }), null, eqDeps);
    expect(byId(b.raw.verdicts)).toEqual(byId(a.raw.verdicts));
    expect(b.raw.totals).toEqual(a.raw.totals);
    // "in": 16 ids in one ID_BATCH chunk; "eq": 16 single-id lookups, at most INNER_CONCURRENCY in flight.
    expect(inDeps.source.stats.idBatches).toBe(1);
    expect(eqDeps.source.stats.idBatches).toBe(16);
    expect(eqDeps.source.stats.maxInFlight).toBeLessThanOrEqual(FIXTURE_CONFIG.INNER_CONCURRENCY);
  });

  it("row cap on the worked-id fetch → partial + row-cap (D11)", async () => {
    // 7 d worked items: 16 rows (one per item) > ROW_CAP 10.
    const out = await loadOtifOutcome(sel({ window: 7, otifMode: "otif" }), null, fakeDeps({ config: { ROW_CAP: 10, PAGE_SIZE: 5 } }));
    expect(out).toMatchObject({ status: "partial", caveats: ["row-cap"] });
    expect(out.raw.workedIds).toHaveLength(10);
  });

  it("truncated when the totals aggregate returns exactly MAX_GROUPS groups", async () => {
    // The loader adds no caveat; deriveOtifOutcome now checks the totals list (MOD-02).
    const deps = fakeDeps({ config: { MAX_GROUPS: 2 } });
    const out = await loadOtifOutcome(sel({ window: 7, otifMode: "otif" }), null, deps);
    expect(out.caveats).toEqual([]);
    expect(deriveOtifOutcome(out.raw, sel({ window: 7, otifMode: "otif" }), deps.config).caveats).toContain("truncated");
  });

  it("rejects on abort", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(loadOtifOutcome(sel({ window: 7, otifMode: "otif" }), null, fakeDeps({ signal: ac.signal }))).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("end to end with the derive (7 d otif)", async () => {
    const out = await loadOtifOutcome(sel({ window: 7, otifMode: "otif" }), null, fakeDeps());
    const h = deriveOtifOutcome(out.raw, sel({ window: 7, otifMode: "otif" }), FIXTURE_CONFIG).data.total;
    // Worked rows passing the otif gate and window: 1009 OTIF, 1015 OTIF → 2 / 2 made.
    // Not worked: totals 6 − 2 = 4, made 5 − 2 = 3. Missing verdict: 16 ids − 6 rows = 10.
    expect(h).toMatchObject({ workedN: 2, workedMade: 2, notWorkedN: 4, notWorkedMade: 3, missingVerdict: 10 });
    expect(h.workedRate).toBe(1);
    expect(h.notWorkedRate).toBe(0.75);
  });
});
