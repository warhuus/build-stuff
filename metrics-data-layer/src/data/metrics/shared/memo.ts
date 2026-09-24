/**
 * Shared-loader memo (lead decision D7, spec §11 "Shared loaders"). One in-flight promise per key shared by
 * concurrent callers; the run's internal `AbortController` aborts only when every subscribed caller's signal
 * has aborted; rejected or aborted entries are evicted so the next caller retries; resolved values are kept
 * until `clearMetricsCache()` (the memo registers its `clear` with `cache.registerMemo`). Shared loaders never
 * acquire the app semaphore (Appendix A X3).
 */
import { registerMemo } from "./cache";
import { abortError } from "./errors";
import { type InFlight, startInFlight } from "./inflight";

/** A keyed memo of shared-loader results. */
export interface SharedMemo<K extends string, V> {
  /**
   * The memoised value for `key`, joining the in-flight run or starting `run`.
   * @param key memo key (e.g. `L2|<window.key>|<filtersKey>`).
   * @param run the fetch; receives the shared internal signal.
   * @param signal this caller's signal; its abort rejects this caller only (with an abort error).
   * @returns the value; rejects with the run's error (entry evicted) or an abort error.
   */
  get(key: K, run: (signal: AbortSignal) => Promise<V>, signal?: AbortSignal): Promise<V>;
  /** @returns the resolved value for `key`, or `undefined` when absent or still in flight. */
  peek(key: K): V | undefined;
  /** Forgets every value and in-flight run (in-flight runs finish but are not stored). */
  clear(): void;
  /** @returns the number of keys held (resolved plus in flight). */
  size(): number;
}

type Slot<V> = { readonly done: true; readonly value: V } | { readonly done: false; readonly run: InFlight<V> };

/**
 * Creates a memo and registers its `clear` with the metrics cache.
 * @returns the memo (module-level in each shared loader).
 */
export function createSharedMemo<K extends string, V>(): SharedMemo<K, V> {
  const slots = new Map<K, Slot<V>>();
  let generation = 0;

  const start = (key: K, run: (signal: AbortSignal) => Promise<V>): InFlight<V> => {
    const gen = generation;
    const evict = (): void => {
      const slot = slots.get(key);
      if (slot !== undefined && !slot.done && slot.run === running) slots.delete(key);
    };
    const running = startInFlight(run, evict);
    slots.set(key, { done: false, run: running });
    running.promise.then((value) => {
      const slot = slots.get(key);
      const ours = slot !== undefined && !slot.done && slot.run === running;
      if (ours && gen === generation) slots.set(key, { done: true, value });
    }, evict);
    return running;
  };

  const get = (key: K, run: (signal: AbortSignal) => Promise<V>, signal?: AbortSignal): Promise<V> => {
    const slot = slots.get(key);
    if (slot?.done) return Promise.resolve(slot.value);
    if (signal?.aborted) return Promise.reject(abortError());
    return (slot?.run ?? start(key, run)).join(signal);
  };

  const peek = (key: K): V | undefined => {
    const slot = slots.get(key);
    return slot?.done ? slot.value : undefined;
  };

  const clear = (): void => {
    generation += 1;
    slots.clear();
  };

  registerMemo(clear);
  return { get, peek, clear, size: () => slots.size };
}
