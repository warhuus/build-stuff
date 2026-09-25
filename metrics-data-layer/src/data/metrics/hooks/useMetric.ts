/**
 * `useMetric(cardId, selection, breakdown)` (instructions §7, spec §11). Shares `peekCard` / `loadCard` with
 * the non-React entry, so the hook and `loadCard` give the same result from the same cache.
 */
import { type MutableRefObject, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type CardResult, loadCard, peekCard } from "../loadCard";
import { cacheKey, normalizeSelection } from "../selection";
import { getCacheVersion, subscribeCacheVersion } from "../shared/cache";
import type { BreakdownDimension, CardId, Progress, Selection, Window } from "../types";
import { resolveWindow } from "../window";
import { type MetricsEnvironment, useMetricsEnvironment } from "./MetricsSourceContext";

/** A result delivered by `loadCard` to this hook instance, tagged with what it was loaded for. */
interface Loaded<C extends CardId> {
  readonly cardId: CardId;
  readonly rawKey: string;
  readonly deriveKey: string;
  readonly version: number;
  readonly result: CardResult<C>;
}

/** Identity of one request: what to load and the keys it answers. */
interface Request<C extends CardId> {
  readonly cardId: C;
  readonly selection: Selection;
  readonly breakdown: BreakdownDimension | null;
  readonly rawKey: string;
  readonly deriveKey: string;
  readonly version: number;
}

/**
 * The loading shape (instructions §7): status `loading`, the previous result's data, caveats and
 * `computedAt` kept; without a previous result no data, `[]` caveats and `computedAt` = the request time
 * (ISO, SPF-02); the new selection's window (resolved at the request time); the load's progress if any.
 */
function loadingResult<C extends CardId>(
  previous: CardResult<C> | null,
  window: Window,
  requestedAt: Date,
  progress: Progress | null,
): CardResult<C> {
  const base: CardResult<C> = {
    status: "loading",
    caveats: previous?.caveats ?? [],
    computedAt: previous?.computedAt ?? requestedAt.toISOString(),
    window,
  };
  const withData = previous?.data === undefined ? base : { ...base, data: previous.data };
  return progress === null ? withData : { ...withData, progress };
}

/** Whether a delivered result answers the current request (errors do not depend on unit or threshold). */
function answers<C extends CardId>(loaded: Loaded<C> | null, req: Request<C>): loaded is Loaded<C> {
  return (
    loaded !== null &&
    loaded.cardId === req.cardId &&
    loaded.rawKey === req.rawKey &&
    loaded.version === req.version &&
    (loaded.deriveKey === req.deriveKey || loaded.result.status === "error")
  );
}

/**
 * Runs `loadCard` for the request whenever it is not settled, with `now` = the request time; aborts on key
 * change, environment change and unmount; drops stale responses with a per-instance monotonic request id.
 */
function useCardLoad<C extends CardId>(
  req: Request<C>,
  needsLoad: boolean,
  env: MetricsEnvironment,
  requestedAt: Date,
  onLoaded: (loaded: Loaded<C>) => void,
  onProgress: (p: { readonly request: number; readonly value: Progress }) => void,
): MutableRefObject<number> {
  const requestId = useRef(0);
  useEffect(
    () => {
      if (!needsLoad) return undefined;
      requestId.current += 1;
      const id = requestId.current;
      const controller = new AbortController();
      const report = (value: Progress): void => {
        if (id === requestId.current && !controller.signal.aborted) onProgress({ request: id, value });
      };
      const opts = { source: env.source, config: env.config, now: requestedAt, signal: controller.signal };
      void loadCard(req.cardId, req.selection, req.breakdown, { ...opts, onProgress: report }).then((result) => {
        if (id !== requestId.current || controller.signal.aborted) return;
        onLoaded({ ...req, result });
      });
      return () => controller.abort();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the raw cache key and cache version: `req.selection` and `req.deriveKey` change with unit/threshold, which must not refetch (Appendix A O3); the setters are stable.
    [needsLoad, req.cardId, req.rawKey, req.breakdown, req.version, env],
  );
  return requestId;
}

/**
 * Card result for React (instructions §7). The return type follows `cardId` (no casts at the call site).
 * - cached key → the derived cached result, synchronously (no fetch);
 * - otherwise `status: "loading"` keeping the previous data, while `loadCard` runs through the app semaphore;
 * - stale responses are ignored (per-instance request id); the load aborts on unmount or key change;
 * - never throws: errors become `status: "error"` with a message;
 * - `clearMetricsCache()` bumps the cache version (`useSyncExternalStore`) and the card refetches.
 * Unit and `ageingThresholdDays` changes re-derive from the cache without a refetch (Appendix A O3).
 * @param cardId card id.
 * @param selection current selection (invalid fields fall back to defaults).
 * @param breakdown breakdown dimension, default null; not allowed for (card, view) → `status: "error"`.
 * @returns `MetricResult<CardData<CardOutput[C]>>`.
 */
export function useMetric<C extends CardId>(
  cardId: C,
  selection: Selection,
  breakdown: BreakdownDimension | null = null,
): CardResult<C> {
  const env = useMetricsEnvironment();
  const version = useSyncExternalStore(subscribeCacheVersion, getCacheVersion, getCacheVersion);
  const sel = normalizeSelection(selection);
  const rawKey = cacheKey(cardId, sel, breakdown);
  const deriveKey = `${rawKey}|u=${sel.unit}|n=${sel.ageingThresholdDays}`;
  const req: Request<C> = { cardId, selection: sel, breakdown, rawKey, deriveKey, version };
  const [loaded, setLoaded] = useState<Loaded<C> | null>(null);
  const [progress, setProgress] = useState<{ readonly request: number; readonly value: Progress } | null>(null);
  const previous = useRef<{ readonly cardId: CardId; readonly result: CardResult<C> } | null>(null);
  const settled = useMemo(
    () => (answers(loaded, req) ? loaded.result : peekCard(cardId, sel, breakdown, env.config, env.now())),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `req` and `sel` are rebuilt every render; `deriveKey` + `version` identify them.
    [cardId, deriveKey, version, loaded, env],
  );
  // The request time: the load's `now` and, without a previous result, the loading `computedAt` (SPF-02).
  const requestedAt = useMemo(
    () => env.now(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one request time per raw key and cache version (what one load answers); `cardId` is part of `rawKey`.
    [rawKey, version, env],
  );
  const requestId = useCardLoad(req, settled === null, env, requestedAt, setLoaded, setProgress);
  const current = progress !== null && progress.request === requestId.current ? progress.value : null;
  const result = useMemo(() => {
    if (settled !== null) return settled;
    const prev = previous.current?.cardId === cardId ? previous.current.result : null;
    return loadingResult(prev, resolveWindow(sel.window, requestedAt), requestedAt, current);
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the loading shape changes only with the settled result, the key, the request time and progress; `previous` is a ref read at that moment.
    [settled, cardId, deriveKey, current, requestedAt],
  );
  useEffect(() => {
    if (result.status !== "loading") previous.current = { cardId, result };
  }, [cardId, result]);
  return result;
}
