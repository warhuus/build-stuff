/**
 * Row paging and inner batching of the OSDK adapter (spec §9.0 `fetchAllPages`, `itemsById`; instructions §5
 * rule 6; Appendix A X3). Every row fetch goes through `fetchAllPages`: `$pageSize` = `config.PAGE_SIZE`,
 * `$nextPageToken` followed, stop at `config.ROW_CAP` (`capped: true`), `signal.aborted` checked before every
 * page (AbortError), progress after every page. No async iterator (no page size, signal or progress).
 */
import type { PageResult } from "@osdk/client";
import type { Paged, Progress } from "../../types";

/** The per-call context the paging helpers need (a subset of `SourceCtx`). */
export interface PagingCtx {
  readonly signal: AbortSignal;
  readonly onProgress?: (p: Progress) => void;
  readonly config: { readonly ROW_CAP: number };
}

/** One page request: `token` undefined for the first page. The caller closes over a literal `$select`. */
export type PageRequest<T> = (token: string | undefined) => Promise<PageResult<T>>;

/** The rejection used on abort: a `DOMException` named `AbortError`. */
export function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/** Rejects with an AbortError when the signal is aborted. */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/**
 * Cumulative progress sink for one port call: `add(n)` adds n rows and reports `{ loaded }` (rows so far over
 * every page and chunk of the call; loadCard sums over calls, decision D24).
 */
export function createProgress(ctx: PagingCtx): (rows: number) => void {
  let loaded = 0;
  return (rows) => {
    loaded += rows;
    ctx.onProgress?.({ loaded });
  };
}

/**
 * Pages through a set until no `nextPageToken` or `cap` rows. Output: at most `cap` rows; `capped` true when the
 * cap stopped paging (spec §9.0; `row-cap` is added by the loader). Rejects with AbortError before a page when
 * aborted. `onRows` receives each page's row count.
 */
export async function fetchAllPages<T>(
  page: PageRequest<T>,
  signal: AbortSignal,
  cap: number,
  onRows: (rows: number) => void,
): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = [];
  let token: string | undefined;
  do {
    throwIfAborted(signal);
    const result = await page(token);
    const data = Array.isArray(result.data) ? result.data : [];
    const room = cap - rows.length;
    rows.push(...data.slice(0, room));
    onRows(Math.min(data.length, room));
    token = result.nextPageToken ?? undefined;
    if (rows.length >= cap && (token !== undefined || data.length > room)) return { rows, capped: true };
  } while (token !== undefined);
  return { rows, capped: false };
}

/** Splits ids into chunks of `size` (≥ 1); an empty list gives no chunk. */
export function chunkIds(ids: readonly string[], size: number): string[][] {
  const step = Math.max(1, Math.floor(size));
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += step) out.push(ids.slice(i, i + step));
  return out;
}

/**
 * Runs `task` over `inputs` with at most `limit` in flight (the adapter's own limiter, never the app semaphore;
 * Appendix A X3). The signal is checked before each task starts; the first failure stops new tasks and rejects.
 * Output: results in input order.
 */
export async function runLimited<I, R>(
  inputs: readonly I[],
  limit: number,
  signal: AbortSignal,
  task: (input: I) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(inputs.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < inputs.length) {
      const i = next;
      next += 1;
      try {
        throwIfAborted(signal);
        results[i] = await task(inputs[i]);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(limit), inputs.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/**
 * Merges the paged results of several chunks: rows concatenated, cut at `cap` (`capped` when cut or when any
 * chunk was capped). Spec §9.0 row cap.
 */
export function mergePaged<T>(parts: readonly Paged<T>[], cap: number): Paged<T> {
  const all = parts.flatMap((p) => p.rows);
  const capped = all.length > cap || parts.some((p) => p.capped);
  return { rows: all.slice(0, cap), capped };
}

/**
 * Pages a set and maps each OSDK row to a port row (dropping unmappable rows, decision D15).
 * The cap is `config.ROW_CAP`.
 */
export async function fetchMapped<T, R>(
  page: PageRequest<T>,
  map: (row: T) => R | null,
  ctx: PagingCtx,
  onRows: (rows: number) => void,
): Promise<Paged<R>> {
  const { rows, capped } = await fetchAllPages(page, ctx.signal, ctx.config.ROW_CAP, onRows);
  return { rows: rows.flatMap((r) => mapOrDrop(r, map)), capped };
}

function mapOrDrop<T, R>(row: T, map: (row: T) => R | null): R[] {
  const out = map(row);
  return out === null ? [] : [out];
}
