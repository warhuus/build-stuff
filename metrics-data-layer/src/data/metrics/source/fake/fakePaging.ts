/**
 * Paging and id-lookup mechanics of the fake source, mirroring the OSDK adapter (spec §9.0
 * `fetchAllPages`, `itemsById`; instructions §6): pages of `config.PAGE_SIZE`, stop at `config.ROW_CAP`
 * (`capped: true`, rows truncated to the cap), abort checked before every page and chunk, progress after
 * every page, id chunks of a given size with at most `config.INNER_CONCURRENCY` in flight. Chunking, the limiter,
 * the chunk merge and the progress sink are the OSDK adapter's own (`source/batching.ts`); aborts use
 * `compute/abort.ts`.
 */
import { throwIfAborted } from "../../compute/abort";
import type { Paged } from "../../types";
import { createProgress, idChunks, mapLimited, mergePaged } from "../batching";
import type { SourceCtx } from "../MetricsSource";

/** Observable counters so tests can assert the inner limiter (Appendix A X3). */
export interface FakeStats {
  /** Id chunks currently being fetched. */
  inFlight: number;
  /** Highest `inFlight` seen since creation (or the last `resetStats`). */
  maxInFlight: number;
  /** Id chunks started. */
  idBatches: number;
  /** Pages served (every paged fetch, including inside id chunks). */
  pages: number;
}

/** A fresh zeroed counter set. */
export const createStats = (): FakeStats => ({ inFlight: 0, maxInFlight: 0, idBatches: 0, pages: 0 });

/**
 * Yields once (a microtask, so fake timers in callers' tests never stall it): aborts raised from a progress
 * callback and concurrent chunks interleave as with a real server.
 */
const nextTurn = (): Promise<void> => Promise.resolve();

/**
 * Serves `rows` page by page. Abort is checked before each page; `onProgress({ loaded })` fires after each
 * page with the cumulative count of the call (`progress` shared by every page and chunk of the call).
 * Reaching `ROW_CAP` stops with `capped: true` and the rows cut to the cap (spec §9.0 `rows.length >= ROW_CAP`).
 */
export async function pageRows<T>(
  rows: readonly T[],
  ctx: SourceCtx,
  stats: FakeStats,
  progress: (rows: number) => void = createProgress(ctx),
): Promise<Paged<T>> {
  const { PAGE_SIZE, ROW_CAP } = ctx.config;
  const out: T[] = [];
  let offset = 0;
  do {
    throwIfAborted(ctx.signal);
    await nextTurn();
    const page = rows.slice(offset, offset + PAGE_SIZE);
    offset += PAGE_SIZE;
    out.push(...page);
    stats.pages += 1;
    progress(page.length);
    if (out.length >= ROW_CAP) return { rows: out.slice(0, ROW_CAP), capped: true };
  } while (offset < rows.length);
  return { rows: out, capped: false };
}

/**
 * Id lookup: zero ids → `{ rows: [], capped: false }` with no fetch (decision D14). Otherwise chunks of
 * `chunkSize`, each paged, at most `INNER_CONCURRENCY` in flight (`batching.mapLimited`); rows concatenated in
 * chunk order, cut to `ROW_CAP` (`capped` when any chunk capped or the total reaches the cap,
 * `batching.mergePaged`). Missing ids are absent.
 */
export async function lookupByIds<T>(
  ids: readonly string[],
  chunkSize: number,
  rowsOf: (chunk: ReadonlySet<string>) => readonly T[],
  ctx: SourceCtx,
  stats: FakeStats,
): Promise<Paged<T>> {
  if (ids.length === 0) return { rows: [], capped: false };
  const progress = createProgress(ctx);
  const results = await mapLimited(idChunks(ids, chunkSize), ctx.config.INNER_CONCURRENCY, ctx.signal, async (batch) => {
    stats.idBatches += 1;
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      return await pageRows(rowsOf(new Set(batch)), ctx, stats, progress);
    } finally {
      stats.inFlight -= 1;
    }
  });
  return mergePaged(results, ctx.config.ROW_CAP);
}
