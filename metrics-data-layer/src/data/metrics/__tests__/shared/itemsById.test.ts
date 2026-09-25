import { describe, expect, it } from "vitest";
import { loadItemsByIds } from "../../shared/itemsById";
import { fakeDeps } from "../helpers/loaderDeps";

describe("loadItemsByIds (spec §9.0 itemsById)", () => {
  it("de-duplicates and sorts the ids; missing ids are absent", async () => {
    const deps = fakeDeps();
    const res = await loadItemsByIds(["1021_10", "1002_10", "1021_10", "9999_10"], deps);
    expect(deps.source.calls).toEqual([{ method: "fetchItemsByIds", args: [["1002_10", "1021_10", "9999_10"]] }]);
    // I2 value 2000 BL-B PL-1 EMEA P200; I21 value 21000 BL-A PL-2 AMER P300.
    expect(res).toEqual({
      rows: [
        { salesOrderId: "1002_10", businessLine: "BL-B", productLine: "PL-1", region: "EMEA", plant: "P200", valueUsd: 2000, isOpen: true },
        { salesOrderId: "1021_10", businessLine: "BL-A", productLine: "PL-2", region: "AMER", plant: "P300", valueUsd: 21000, isOpen: true },
      ],
      capped: false,
    });
  });

  it("no ids → empty result without a call (D14)", async () => {
    const deps = fakeDeps();
    expect(await loadItemsByIds(new Set<string>(), deps)).toEqual({ rows: [], capped: false });
    expect(deps.source.calls).toHaveLength(0);
  });

  it("propagates capped and rejects on abort", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `${1001 + i}_10`);
    expect((await loadItemsByIds(ids, fakeDeps({ config: { ROW_CAP: 10 } }))).capped).toBe(true);
    const ac = new AbortController();
    ac.abort();
    await expect(loadItemsByIds(ids, fakeDeps({ signal: ac.signal }))).rejects.toMatchObject({ name: "AbortError" });
  });
});
