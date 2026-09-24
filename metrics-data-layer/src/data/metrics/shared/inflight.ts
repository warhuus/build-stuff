/**
 * One in-flight run shared by several callers (lead decision D7), used by `memo.ts` and `cache.ts`.
 * The run gets an internal `AbortSignal` that aborts only when every subscribed caller has aborted;
 * a caller whose own signal aborts is rejected with an abort error at once while the others keep waiting.
 */
import { abortError } from "./errors";

/** A shared run. `promise` is the run itself; `join` subscribes one caller. */
export interface InFlight<V> {
  /** The underlying run (settles regardless of caller aborts, unless abandoned by all). */
  readonly promise: Promise<V>;
  /**
   * Subscribes a caller. Without a signal the caller never aborts, so the run is never abandoned.
   * @returns the run's result, or a rejection with an abort error once `signal` aborts.
   */
  join(signal?: AbortSignal): Promise<V>;
}

/**
 * Starts a shared run.
 * @param run the work; receives the internal signal (aborted when every subscriber has aborted).
 * @param onAbandon called once, synchronously, before the internal abort, so the owner can evict the entry.
 * @returns the in-flight handle; callers must `join` it (a run nobody joins is never abandoned).
 */
export function startInFlight<V>(run: (signal: AbortSignal) => Promise<V>, onAbandon: () => void): InFlight<V> {
  return new SharedRun(run, onAbandon);
}

/** Implementation of `InFlight`: counts subscribed signals; aborts the run when the last one leaves. */
class SharedRun<V> implements InFlight<V> {
  readonly promise: Promise<V>;
  private readonly controller = new AbortController();
  private active = 0;
  private pinned = false;
  private settled = false;

  constructor(run: (signal: AbortSignal) => Promise<V>, private readonly onAbandon: () => void) {
    this.promise = startRun(run, this.controller.signal);
    const done = (): void => {
      this.settled = true;
    };
    this.promise.then(done, done);
  }

  join(signal?: AbortSignal): Promise<V> {
    if (signal === undefined) {
      this.pinned = true;
      return this.promise;
    }
    this.active += 1;
    if (signal.aborted) {
      this.leave();
      return Promise.reject(abortError());
    }
    return new Promise<V>((resolve, reject) => {
      const onAbort = (): void => {
        this.leave();
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const detach = (): void => signal.removeEventListener("abort", onAbort);
      this.promise.then(
        (v) => {
          detach();
          resolve(v);
        },
        (e: unknown) => {
          detach();
          reject(e);
        },
      );
    });
  }

  private leave(): void {
    this.active -= 1;
    if (this.active === 0 && !this.pinned && !this.settled && !this.controller.signal.aborted) {
      this.onAbandon();
      this.controller.abort();
    }
  }
}

/** Runs `run`, turning a synchronous throw into a rejected promise. */
function startRun<V>(run: (signal: AbortSignal) => Promise<V>, signal: AbortSignal): Promise<V> {
  try {
    return run(signal);
  } catch (e: unknown) {
    return Promise.reject(e);
  }
}
