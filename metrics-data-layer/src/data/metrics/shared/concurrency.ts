/**
 * Concurrency limits (instructions §8 item 12, spec §11, Appendix A X3). One app-wide FIFO semaphore
 * (`APP_SEMAPHORE_SLOTS`) acquired only by `loadCard`/`useMetric`; inner id batches use `runLimited`
 * (`INNER_CONCURRENCY`) and never the semaphore, so no deadlock is possible.
 */
import { APP_SEMAPHORE_SLOTS, INNER_CONCURRENCY } from "../../../config/metrics";
import { mapLimited } from "../source/batching";
import { abortError } from "./errors";

/** Releases a held slot; idempotent. */
export type Release = () => void;

/** A counting semaphore with a FIFO wait queue. */
export interface Semaphore {
  /**
   * Waits for a slot (FIFO). Rejects with an abort error when `signal` aborts while waiting (the waiter leaves
   * the queue) or is already aborted.
   * @returns a release function; call it exactly once when done (extra calls are ignored).
   */
  acquire(signal?: AbortSignal): Promise<Release>;
  /**
   * Runs `task` holding a slot; the slot is released when the task settles.
   * @returns the task's result.
   */
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** @returns slots currently held. */
  inUse(): number;
  /** @returns callers waiting in the queue. */
  waiting(): number;
}

/**
 * Creates a FIFO semaphore.
 * @param slots positive integer number of slots; throws `RangeError` otherwise.
 * @returns the semaphore.
 */
export function createSemaphore(slots: number): Semaphore {
  if (!Number.isInteger(slots) || slots < 1) throw new RangeError(`slots must be a positive integer: ${slots}`);
  return new FifoSemaphore(slots);
}

/** Implementation of `Semaphore`; a slot passes directly from a releaser to the next waiter. */
class FifoSemaphore implements Semaphore {
  private held = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly slots: number) {}

  acquire(signal?: AbortSignal): Promise<Release> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.held < this.slots) {
      this.held += 1;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise<Release>((resolve, reject) => {
      const onAbort = (): void => {
        const i = this.queue.indexOf(grant);
        if (i >= 0) this.queue.splice(i, 1);
        reject(abortError());
      };
      const grant = (): void => {
        signal?.removeEventListener("abort", onAbort);
        resolve(this.makeRelease());
      };
      this.queue.push(grant);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await task();
    } finally {
      release();
    }
  }

  inUse(): number {
    return this.held;
  }

  waiting(): number {
    return this.queue.length;
  }

  private makeRelease(): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next === undefined) this.held -= 1;
      else next();
    };
  }
}

/** The one app-wide semaphore (`APP_SEMAPHORE_SLOTS` = 4). Only `loadCard`/`useMetric` acquire it. */
export const appSemaphore: Semaphore = createSemaphore(APP_SEMAPHORE_SLOTS);

/**
 * Runs tasks with at most `limit` in flight (inner id-batch limiter; never the app semaphore). Tasks start in
 * order; no new task starts once `signal` has aborted or a task has failed. Same limiter as the source
 * adapters' id chunks (`source/batching.mapLimited`), so there is one implementation.
 * @param tasks task factories.
 * @param limit maximum concurrent tasks (default `INNER_CONCURRENCY`); values below 1 act as 1.
 * @param signal optional abort signal, checked before each task starts.
 * @returns results in task order; rejects with the first task error or an abort error.
 */
export function runLimited<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number = INNER_CONCURRENCY,
  signal?: AbortSignal,
): Promise<T[]> {
  return mapLimited(tasks, limit, signal, (task) => task());
}
