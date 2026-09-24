import { describe, expect, it } from "vitest";
import { appSemaphore, createSemaphore, runLimited } from "../../shared/concurrency";
import { deferred, flush } from "./deferred";

describe("createSemaphore", () => {
  it("rejects invalid slot counts", () => {
    expect(() => createSemaphore(0)).toThrow(RangeError);
    expect(() => createSemaphore(1.5)).toThrow(RangeError);
  });

  it("the app semaphore has 4 slots", async () => {
    const releases = await Promise.all([1, 2, 3, 4].map(() => appSemaphore.acquire()));
    expect(appSemaphore.inUse()).toBe(4);
    let fifth = false;
    const p = appSemaphore.acquire().then((r) => {
      fifth = true;
      return r;
    });
    await flush();
    expect(fifth).toBe(false);
    releases[0]();
    (await p)();
    releases.slice(1).forEach((r) => r());
    expect(appSemaphore.inUse()).toBe(0);
  });

  it("never exceeds its slots and grants in FIFO order", async () => {
    const sem = createSemaphore(2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const gates = Array.from({ length: 6 }, () => deferred<void>());
    const runs = gates.map((g, i) =>
      sem.run(async () => {
        order.push(i);
        active += 1;
        peak = Math.max(peak, active);
        await g.promise;
        active -= 1;
      }),
    );
    await flush();
    expect(sem.inUse()).toBe(2);
    expect(sem.waiting()).toBe(4);
    for (const g of gates) {
      g.resolve();
      await flush();
    }
    await Promise.all(runs);
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sem.inUse()).toBe(0);
  });

  it("removes a waiter whose signal aborts while queued", async () => {
    const sem = createSemaphore(1);
    const first = await sem.acquire();
    const c = new AbortController();
    const aborted = sem.acquire(c.signal);
    const third = sem.acquire();
    c.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(sem.waiting()).toBe(1);
    first();
    first();
    const r = await third;
    expect(sem.inUse()).toBe(1);
    r();
    expect(sem.inUse()).toBe(0);
  });

  it("rejects at once when the signal is already aborted", async () => {
    const sem = createSemaphore(1);
    await expect(sem.acquire(AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(sem.inUse()).toBe(0);
  });

  it("releases the slot when a task fails", async () => {
    const sem = createSemaphore(1);
    await expect(sem.run(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(sem.inUse()).toBe(0);
  });

  it("a granted waiter ignores a later abort", async () => {
    const sem = createSemaphore(1);
    const first = await sem.acquire();
    const c = new AbortController();
    const p = sem.acquire(c.signal);
    first();
    const r = await p;
    c.abort();
    expect(sem.inUse()).toBe(1);
    r();
  });
});

describe("runLimited", () => {
  it("returns results in order and never exceeds the limit", async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await flush();
      active -= 1;
      return i * 2;
    });
    expect(await runLimited(tasks, 3)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(peak).toBe(3);
  });

  it("defaults to INNER_CONCURRENCY (4) and handles no tasks", async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 9 }, () => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await flush();
      active -= 1;
    });
    await runLimited(tasks);
    expect(peak).toBe(4);
    expect(await runLimited([], 2)).toEqual([]);
    expect(await runLimited([() => Promise.resolve(1)], 0)).toEqual([1]);
  });

  it("stops starting tasks after an abort", async () => {
    const c = new AbortController();
    const started: number[] = [];
    const tasks = Array.from({ length: 5 }, (_, i) => async () => {
      started.push(i);
      if (i === 1) c.abort();
      await flush();
      return i;
    });
    await expect(runLimited(tasks, 1, c.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(started).toEqual([0, 1]);
  });

  it("rejects with the first error and starts nothing after it", async () => {
    const started: number[] = [];
    const tasks = Array.from({ length: 5 }, (_, i) => async () => {
      started.push(i);
      await flush();
      if (i === 0) throw new Error("bad");
      return i;
    });
    await expect(runLimited(tasks, 2)).rejects.toThrow("bad");
    await flush();
    expect(started).toEqual([0, 1]);
  });
});
