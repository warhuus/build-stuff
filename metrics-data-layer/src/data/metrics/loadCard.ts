/**
 * The non-React entry (instructions §7 `loadCard`, lead decisions D13, D23, D24). One implementation shared
 * with `useMetric`: `precheckCard` (breakdown → stub → placeholder, no calls), `peekCard` (synchronous cached
 * result) and `loadCard` (cache or one load through the app semaphore, then derive). Raw data is cached; derive
 * runs after the cache, so unit and threshold changes never refetch (Appendix A O3).
 */
import { BREAKDOWN_NOT_ALLOWED, METRICS_CONFIG, type MetricsConfig } from "../../config/metrics";
import { isBreakdownAllowed } from "./breakdowns";
import { CARD_IMPL } from "./catalogue";
import { mergeCaveats } from "./compute/caveats";
import { integrationBlock, stubBlocked } from "./loaders/blocked";
import { cacheKey, normalizeSelection } from "./selection";
import { type CacheEntry, getCached, getOrLoad } from "./shared/cache";
import { appSemaphore } from "./shared/concurrency";
import { toErrorResult } from "./shared/errors";
import type { MetricsSource } from "./source/MetricsSource";
import type { BreakdownDimension, CardData, CardId, CardOutput, CardRaw, MetricResult, Progress, Selection } from "./types";
import { resolveWindow } from "./window";

/** The result of card `C`: `MetricResult<CardData<CardOutput[C]>>` (instructions §7). */
export type CardResult<C extends CardId> = MetricResult<CardData<CardOutput[C]>>;

/**
 * Options of `loadCard` (instructions §7). `now` defaults to the current time (window end, `computedAt`);
 * `config` defaults to `METRICS_CONFIG`; `signal` aborts this caller only (a shared load continues while
 * another caller waits for it); `onProgress` receives the cumulative rows loaded by this load (D24).
 */
export interface LoadCardOptions {
  readonly source: MetricsSource;
  readonly now?: Date;
  readonly signal?: AbortSignal;
  readonly config?: MetricsConfig;
  readonly onProgress?: (p: Progress) => void;
}

/**
 * Checks that need no data, in the D13 order: breakdown not allowed for (card, view) → `status: "error"`
 * with message `breakdown-not-allowed`; second-draft stub → `status: "blocked"` with the stub's reason and
 * caveats; integration placeholder unset → `status: "blocked"`, `needs-integration-value`. No network call.
 * @param cardId card.
 * @param selection normalised selection.
 * @param breakdown breakdown dimension or null.
 * @param config config (placeholder check).
 * @param now time of the check (window end, `computedAt`).
 * @returns the final result, or null when the card must be loaded.
 */
export function precheckCard<C extends CardId>(
  cardId: C,
  selection: Selection,
  breakdown: BreakdownDimension | null,
  config: MetricsConfig,
  now: Date,
): CardResult<C> | null {
  const window = resolveWindow(selection.window, now);
  const computedAt = now.toISOString();
  if (breakdown !== null && !isBreakdownAllowed(cardId, selection.view, breakdown)) {
    return toErrorResult(BREAKDOWN_NOT_ALLOWED, window, computedAt);
  }
  const block = stubBlocked(cardId) ?? integrationBlock(cardId, config);
  if (block === null) return null;
  return {
    status: "blocked",
    blocked: { reason: block.reason, unblockedBy: block.unblockedBy },
    caveats: mergeCaveats(block.caveats),
    window,
    computedAt,
  };
}

/**
 * Turns a cache entry into the card result: derive (unit and threshold applied) and the caveat union of
 * loader, derive and every stage (instructions §5 rule 5). `window` is resolved at the entry's `computedAt`
 * (the `now` the loader used). Throws only if derive throws.
 */
function settle<C extends CardId>(
  cardId: C,
  entry: CacheEntry<CardRaw[C]>,
  selection: Selection,
  config: MetricsConfig,
  progress: Progress | undefined,
): CardResult<C> {
  const impl = CARD_IMPL[cardId];
  const derived = impl.derive(entry.output.raw, selection, config);
  const base: CardResult<C> = {
    status: entry.output.status,
    data: derived.data,
    caveats: mergeCaveats(entry.output.caveats, derived.caveats, impl.stageCaveats(derived.data)),
    computedAt: entry.computedAt,
    window: resolveWindow(selection.window, new Date(entry.computedAt)),
  };
  const shown = progress ?? entry.output.progress;
  return shown === undefined ? base : { ...base, progress: shown };
}

/**
 * The synchronous path (spec §11 "a cache hit returns synchronously"): the precheck result, or the cached
 * raw data derived for this selection. Never throws (a failing derive → `status: "error"`).
 * @param cardId card.
 * @param selection selection (normalised here).
 * @param breakdown breakdown dimension or null.
 * @param config config (default `METRICS_CONFIG`).
 * @param now time used for prechecks (default: the current time).
 * @returns the result, or null when the card is not cached and must be loaded.
 */
export function peekCard<C extends CardId>(
  cardId: C,
  selection: Selection,
  breakdown: BreakdownDimension | null,
  config: MetricsConfig = METRICS_CONFIG,
  now: Date = new Date(),
): CardResult<C> | null {
  const sel = normalizeSelection(selection);
  const pre = precheckCard(cardId, sel, breakdown, config, now);
  if (pre !== null) return pre;
  const entry = getCached(cardId, cacheKey(cardId, sel, breakdown));
  if (entry === undefined) return null;
  try {
    return settle(cardId, entry, sel, config, undefined);
  } catch (e: unknown) {
    return toErrorResult(e, resolveWindow(sel.window, now), now.toISOString());
  }
}

/** Sums per-fetch cumulative progress reports into one card total (D24). */
interface ProgressSum {
  readonly report: (p: Progress) => void;
  readonly last: () => Progress | undefined;
}

/**
 * D24: the port reports cumulative `loaded` per fetch, interleaved when fetches run in parallel, without a
 * fetch id. Each report continues the fetch whose last value is the largest one below it; a report not
 * above any known fetch starts a new fetch. The card total is the sum of every fetch's last value.
 * @param sink the caller's callback (receives the total after each report), optional.
 * @returns the reporter to hand to the loader and an accessor of the last total.
 */
export function createProgressSum(sink: ((p: Progress) => void) | undefined): ProgressSum {
  const fetches: number[] = [];
  let latest: Progress | undefined;
  const report = (p: Progress): void => {
    let best = -1;
    fetches.forEach((v, i) => {
      if (v < p.loaded && (best < 0 || v > fetches[best])) best = i;
    });
    if (best < 0) fetches.push(p.loaded);
    else fetches[best] = p.loaded;
    latest = { loaded: fetches.reduce((a, b) => a + b, 0) };
    sink?.(latest);
  };
  return { report, last: () => latest };
}

/**
 * Loads one card (instructions §7, D13): normalise the selection; precheck (no calls); otherwise the cached
 * raw data or one shared load per raw cache key (spec §11) run inside the app semaphore (4 slots, X3), then
 * derive. Never throws: errors and aborts become `status: "error"` with a message.
 * @param cardId card; the result type follows it.
 * @param selection selection (invalid fields fall back to defaults).
 * @param breakdown breakdown dimension or null.
 * @param opts source, optional now / signal / config / onProgress.
 * @returns `MetricResult<CardData<CardOutput[C]>>`; `progress` = last cumulative total reported by this load.
 */
export async function loadCard<C extends CardId>(
  cardId: C,
  selection: Selection,
  breakdown: BreakdownDimension | null,
  opts: LoadCardOptions,
): Promise<CardResult<C>> {
  const config = opts.config ?? METRICS_CONFIG;
  const now = opts.now ?? new Date();
  const sel = normalizeSelection(selection);
  const pre = precheckCard(cardId, sel, breakdown, config, now);
  if (pre !== null) return pre;
  const progress = createProgressSum(opts.onProgress);
  const load = CARD_IMPL[cardId].load;
  try {
    const entry = await getOrLoad(
      cardId,
      cacheKey(cardId, sel, breakdown),
      (signal) =>
        appSemaphore.run(
          () => load(sel, breakdown, { source: opts.source, now, signal, onProgress: progress.report, config }),
          signal,
        ),
      now,
      opts.signal,
    );
    return settle(cardId, entry, sel, config, progress.last());
  } catch (e: unknown) {
    return toErrorResult(e, resolveWindow(sel.window, now), now.toISOString());
  }
}
