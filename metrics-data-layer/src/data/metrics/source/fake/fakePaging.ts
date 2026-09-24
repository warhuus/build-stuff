/**
 * Paging and id-lookup mechanics of the fake source, mirroring the OSDK adapter (spec §9.0
 * `fetchAllPages`, `itemsById`; instructions §6): pages of `config.PAGE_SIZE`, stop at `config.ROW_CAP`
 * (`capped: true`, rows truncated to the cap), abort checked before every page and chunk, progress after
 * every page, id chunks of a given size with at most `config.INNER_CONCURRENCY` in flight.
 */
import type { Paged } from "../../types";
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

/** Rejects like `fetch` does on abort: a DOMException named "AbortError". */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Yields once (a microtask, so fake timers in callers' tests never stall it): aborts raised from a progress
 * callback and concurrent chunks interleave as with a real server.
 */
const nextTurn = (): Promise<void> => Promise.resolve();

/** Cumulative rows loaded by one port call (shared by its pages and chunks). */
interface Loaded {
  count: number;
}

/**
 * Serves `rows` page by page. Abort is checked before each page; `onProgress({ loaded })` fires after each
 * page with the cumulative count of the call. Reaching `ROW_CAP` stops with `capped: true`.
 */
export async function pageRows<T>(rows: readonly T[], ctx: SourceCtx, stats: FakeStats, loaded: Loaded = { count: 0 }): Promise<Paged<T>> {
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
    loaded.count += page.length;
    ctx.onProgress?.({ loaded: loaded.count });
    if (out.length >= ROW_CAP) return { rows: out.slice(0, ROW_CAP), capped: true };
  } while (offset < rows.length);
  return { rows: out, capped: false };
}

/** Splits ids into chunks of `size` (≥ 1), keeping order. */
export function chunkIds(ids: readonly string[], size: number): string[][] {
  const step = Math.max(1, size);
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += step) out.push(ids.slice(i, i + step));
  return out;
}

/**
 * Id lookup: zero ids → `{ rows: [], capped: false }` with no fetch (decision D14). Otherwise chunks of
 * `chunkSize`, each paged, at most `INNER_CONCURRENCY` in flight; rows concatenated in chunk order, truncated
 * to `ROW_CAP` (`capped` when any chunk capped or the total reaches the cap). Missing ids are absent.
 */
export async function lookupByIds<T>(
  ids: readonly string[],
  chunkSize: number,
  rowsOf: (chunk: ReadonlySet<string>) => readonly T[],
  ctx: SourceCtx,
  stats: FakeStats,
): Promise<Paged<T>> {
  if (ids.length === 0) return { rows: [], capped: false };
  const chunks = chunkIds(ids, chunkSize);
  const results: Paged<T>[] = [];
  const loaded: Loaded = { count: 0 };
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < chunks.length) {
      const index = next++;
      throwIfAborted(ctx.signal);
      stats.idBatches += 1;
      stats.inFlight += 1;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      try {
        results[index] = await pageRows(rowsOf(new Set(chunks[index])), ctx, stats, loaded);
      } finally {
        stats.inFlight -= 1;
      }
    }
  };
  const workers = Math.min(Math.max(1, ctx.config.INNER_CONCURRENCY), chunks.length);
  await Promise.all(Array.from({ length: workers }, worker));
  const rows = results.flatMap((r) => r.rows);
  const cap = ctx.config.ROW_CAP;
  return { rows: rows.slice(0, cap), capped: results.some((r) => r.capped) || rows.length >= cap };
}
