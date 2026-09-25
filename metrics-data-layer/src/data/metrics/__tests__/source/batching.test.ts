import { describe, expect, it } from "vitest";
import { createProgress, idChunks, mapLimited, mergePaged } from "../../source/batching";
import type { Progress } from "../../types";

describe("source batching (spec §9.0 itemsById, row cap; Appendix A X3)", () => {
  it("idChunks splits with the host chunk helper; no ids → no chunk; size below 1 acts as 1", () => {
    expect(idChunks(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
    expect(idChunks([], 2)).toEqual([]);
    expect(idChunks(["a", "b"], 0)).toEqual([["a"], ["b"]]);
  });

  it("mapLimited keeps order and never exceeds the limit", async () => {
    let inFlight = 0;
    let max = 0;
    const out = await mapLimited([1, 2, 3, 4, 5, 6], 2, new AbortController().signal, async (n: number) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 7 - n));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(max).toBe(2);
    expect(await mapLimited([], 2, undefined, async (n: number) => n)).toEqual([]);
  });

  it("mapLimited stops starting tasks after a failure or an abort", async () => {
    const started: number[] = [];
    const run = mapLimited([1, 2, 3, 4], 1, undefined, async (n: number) => {
      started.push(n);
      if (n === 2) throw new Error("boom");
      return n;
    });
    await expect(run).rejects.toThrow("boom");
    expect(started).toEqual([1, 2]);
    const c = new AbortController();
    const aborted = mapLimited([1, 2, 3], 1, c.signal, async (n: number) => {
      c.abort();
      return n;
    });
    await expect(aborted).rejects.toMatchObject({ name: "AbortError", message: "aborted" });
  });

  it("mergePaged: capped when a chunk capped or the total reaches the cap (rows.length >= ROW_CAP)", () => {
    expect(mergePaged([{ rows: [1], capped: true }, { rows: [2], capped: false }], 10)).toEqual({ rows: [1, 2], capped: true });
    expect(mergePaged([{ rows: [1, 2], capped: false }, { rows: [3], capped: false }], 2)).toEqual({ rows: [1, 2], capped: true });
    expect(mergePaged([{ rows: [1], capped: false }, { rows: [2], capped: false }], 2)).toEqual({ rows: [1, 2], capped: true });
    expect(mergePaged([{ rows: [1], capped: false }], 2)).toEqual({ rows: [1], capped: false });
  });

  it("createProgress reports the cumulative rows of one call", () => {
    const seen: Progress[] = [];
    const add = createProgress({ onProgress: (p) => seen.push(p) });
    add(3);
    add(2);
    expect(seen).toEqual([{ loaded: 3 }, { loaded: 5 }]);
    expect(() => createProgress({})(4)).not.toThrow();
  });
});
