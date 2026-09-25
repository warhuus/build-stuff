/**
 * Raw result cache (lead decision D5, spec §11, instructions §8 item 11, Appendix A X8). One typed map per
 * card of `CacheEntry<CardRaw[C]>` plus one shared in-flight run per key, so `loadCard<C>` and `useMetric`
 * stay cast-free. No TTL. `clearMetricsCache()` empties every card map, every registered shared-loader memo,
 * bumps the version and notifies subscribers (for `useSyncExternalStore`).
 */
import { CARD_IDS } from "../../../config/metrics";
import type { CardId, CardRaw, LoaderOutput } from "../types";
import { abortError } from "./errors";
import { type InFlight, startInFlight } from "./inflight";

/** A cached loader output and when it was computed (ISO-8601 UTC, from the caller's `now`). */
export interface CacheEntry<R> {
  readonly output: LoaderOutput<R>;
  readonly computedAt: string;
}

type EntryMaps = { readonly [C in CardId]: Map<string, CacheEntry<CardRaw[C]>> };
type InFlightMaps = { readonly [C in CardId]: Map<string, InFlight<CacheEntry<CardRaw[C]>>> };

const entries: EntryMaps = {
  userFunnel: new Map(),
  itemFunnel: new Map(),
  riskDistribution: new Map(),
  otifOutcome: new Map(),
  raisedToClosed: new Map(),
  raisedToFirstView: new Map(),
  firstViewToClosure: new Map(),
  ageingBacklog: new Map(),
  closureComposition: new Map(),
  riskMovement: new Map(),
  riskCalibration: new Map(),
  rolledValue: new Map(),
};
const inFlight: InFlightMaps = {
  userFunnel: new Map(),
  itemFunnel: new Map(),
  riskDistribution: new Map(),
  otifOutcome: new Map(),
  raisedToClosed: new Map(),
  raisedToFirstView: new Map(),
  firstViewToClosure: new Map(),
  ageingBacklog: new Map(),
  closureComposition: new Map(),
  riskMovement: new Map(),
  riskCalibration: new Map(),
  rolledValue: new Map(),
};
const memoClears = new Set<() => void>();
const subscribers = new Set<() => void>();
let version = 0;

/**
 * Cached entry of a card (synchronous; a hit needs no fetch, spec §11).
 * @param card card id.
 * @param key raw cache key (`cacheKey` in `selection.ts`).
 * @returns the entry, or `undefined` on a miss.
 */
export function getCached<C extends CardId>(card: C, key: string): CacheEntry<CardRaw[C]> | undefined {
  return entries[card].get(key);
}

/**
 * Stores a loader output.
 * @param card card id.
 * @param key raw cache key.
 * @param output loader output.
 * @param now time of computation (stored as ISO `computedAt`).
 * @returns the stored entry.
 */
export function setCached<C extends CardId>(
  card: C,
  key: string,
  output: LoaderOutput<CardRaw[C]>,
  now: Date,
): CacheEntry<CardRaw[C]> {
  const entry: CacheEntry<CardRaw[C]> = { output, computedAt: now.toISOString() };
  entries[card].set(key, entry);
  return entry;
}

/**
 * Cached entry, or one shared load per key (concurrent callers join the same run; lead decision D7 semantics:
 * the run's signal aborts only when every joined caller's signal has aborted). A successful load is stored
 * unless `clearMetricsCache()` ran meanwhile; a rejected or abandoned load is evicted so the next call retries.
 * @param card card id.
 * @param key raw cache key.
 * @param load the loader; receives the shared run's signal (a zero-argument function is fine too).
 * @param now time of computation (the entry's `computedAt`).
 * @param signal this caller's signal, optional; its abort rejects this caller with an abort error (the run goes
 * on while another caller waits). Absent (undefined): this caller never aborts and pins the run, which is
 * then never abandoned.
 * @returns the entry (the cached one on a hit).
 */
export function getOrLoad<C extends CardId>(
  card: C,
  key: string,
  load: (signal: AbortSignal) => Promise<LoaderOutput<CardRaw[C]>>,
  now: Date,
  signal?: AbortSignal,
): Promise<CacheEntry<CardRaw[C]>> {
  const hit = entries[card].get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  if (signal?.aborted) return Promise.reject(abortError());
  const running = inFlight[card].get(key) ?? startLoad(card, key, load, now);
  return running.join(signal);
}

function startLoad<C extends CardId>(
  card: C,
  key: string,
  load: (signal: AbortSignal) => Promise<LoaderOutput<CardRaw[C]>>,
  now: Date,
): InFlight<CacheEntry<CardRaw[C]>> {
  const started = version;
  const map = inFlight[card];
  const evict = (): void => {
    if (map.get(key) === running) map.delete(key);
  };
  const running = startInFlight(async (runSignal) => {
    const output = await load(runSignal);
    return { output, computedAt: now.toISOString() };
  }, evict);
  map.set(key, running);
  running.promise.then((entry) => {
    evict();
    if (version === started) entries[card].set(key, entry);
  }, evict);
  return running;
}

/**
 * Registers a shared-loader memo's clear function so `clearMetricsCache()` empties it too (D5).
 * @param clear the memo's clear function.
 * @returns an unregister function.
 */
export function registerMemo(clear: () => void): () => void {
  memoClears.add(clear);
  return () => {
    memoClears.delete(clear);
  };
}

/**
 * Clears every card map, forgets in-flight loads (their results are not stored), clears every registered
 * memo, bumps the version and notifies subscribers, so mounted hooks refetch. Instructions §8 item 11.
 * @returns nothing.
 */
export function clearMetricsCache(): void {
  for (const card of CARD_IDS) {
    entries[card].clear();
    inFlight[card].clear();
  }
  for (const clear of memoClears) clear();
  version += 1;
  for (const cb of [...subscribers]) cb();
}

/**
 * Subscribes to cache-version changes (`useSyncExternalStore` subscribe; Appendix A X8).
 * @param cb called after every `clearMetricsCache()`.
 * @returns an unsubscribe function.
 */
export function subscribeCacheVersion(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/**
 * Current cache version (`useSyncExternalStore` snapshot).
 * @returns a counter starting at 0, +1 per `clearMetricsCache()`.
 */
export function getCacheVersion(): number {
  return version;
}
