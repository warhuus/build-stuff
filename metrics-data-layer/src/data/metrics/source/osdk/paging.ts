/**
 * Row paging and inner batching of the OSDK adapter (spec §9.0 `fetchAllPages`, `itemsById`; instructions §5
 * rule 6; Appendix A X3). Every row fetch goes through `fetchAllPages`: `$pageSize` = `config.PAGE_SIZE`,
 * `$nextPageToken` followed, stop at `config.ROW_CAP` (`capped: true` once `rows.length >= ROW_CAP`, spec §9.0
 * pseudocode; lead note L1), `signal.aborted` checked before every page (AbortError from `compute/abort.ts`),
 * progress after every page. No async iterator (no page size, signal or progress). Id chunking, the inner
 * limiter, chunk merging and the progress sink are shared with the fake in `source/batching.ts`.
 */
import type { PageResult } from "@osdk/client";
import { throwIfAborted } from "../../compute/abort";
import type { Paged, Progress } from "../../types";

/** The per-call context the paging helpers need (a subset of `SourceCtx`). */
export interface PagingCtx {
  readonly signal: AbortSignal;
  readonly onProgress?: (p: Progress) => void;
  readonly config: { readonly ROW_CAP: number };
}

/** One page request: `token` undefined for the first page. The caller closes over a literal `$select`. */
export type PageRequest<T> = (token: string | undefined) => Promise<PageResult<T>>;

/**
 * Pages through a set until no `nextPageToken` or `cap` rows. Output: at most `cap` rows; `capped` true when
 * `rows.length >= cap` (spec §9.0 `if rows.length >= ROW_CAP: capped = true; break`, lead note L1: also when
 * the last page ends exactly at the cap). `row-cap` is added by the loader. Rejects with AbortError before a
 * page when aborted. `onRows` receives each page's kept row count.
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
    if (rows.length >= cap) return { rows, capped: true };
  } while (token !== undefined);
  return { rows, capped: false };
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

/**
 * One page only, for a lookup whose page holds the whole answer (`"eq"` verdict lookup: `$pageSize: 1` on the
 * primary key; spec §9 4.1 step 3). Abort is checked before the request; progress reports the kept rows.
 * @param page the request (called once, without a token).
 * @param map OSDK row → port row; `null` drops the row (decision D15).
 * @param limit rows kept from the page (the `$pageSize` sent).
 * @returns the mapped rows; `capped` is always false (one row per id can never reach ROW_CAP alone).
 */
export async function fetchFirstPage<T, R>(
  page: PageRequest<T>,
  map: (row: T) => R | null,
  signal: AbortSignal,
  limit: number,
  onRows: (rows: number) => void,
): Promise<Paged<R>> {
  throwIfAborted(signal);
  const result = await page(undefined);
  const data = (Array.isArray(result.data) ? result.data : []).slice(0, limit);
  onRows(data.length);
  return { rows: data.flatMap((r) => mapOrDrop(r, map)), capped: false };
}
