import { describe, expect, it, vi } from "vitest";
import { startInFlight } from "../../shared/inflight";
import { deferred } from "../helpers/deferred";

describe("startInFlight", () => {
  it("an already aborted joiner is rejected and, alone, abandons the run", async () => {
    const d = deferred<number>();
    const onAbandon = vi.fn();
    let internal: AbortSignal | undefined;
    const run = startInFlight((s) => {
      internal = s;
      return d.promise;
    }, onAbandon);
    await expect(run.join(AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(onAbandon).toHaveBeenCalledTimes(1);
    expect(internal?.aborted).toBe(true);
  });

  it("an already aborted joiner does not abandon a run others wait on", async () => {
    const d = deferred<number>();
    const onAbandon = vi.fn();
    const run = startInFlight(() => d.promise, onAbandon);
    const live = run.join(new AbortController().signal);
    await expect(run.join(AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(onAbandon).not.toHaveBeenCalled();
    d.resolve(4);
    expect(await live).toBe(4);
  });

  it("aborts after settling do not abandon", async () => {
    const onAbandon = vi.fn();
    const run = startInFlight(() => Promise.resolve(1), onAbandon);
    const c = new AbortController();
    expect(await run.join(c.signal)).toBe(1);
    c.abort();
    expect(onAbandon).not.toHaveBeenCalled();
  });
});
