/**
 * Id batching shared by both source adapters (osdk, fake) and by the shared layer's `runLimited` (spec §9.0
 * `itemsById`, row cap; Appendix A X3; instructions §3 host `chunk`). One inner limiter (`mapLimited`, never
 * the app semaphore), one chunker over the host helper `chunk`, one merge of chunk results with the spec
 * §9.0 cap rule (`capped` when `rows.length >= ROW_CAP`), one cumulative progress sink per port call.
 * No OSDK import: this file sits at the port layer so every adapter can use it.
 */
import { chunk } from "../../../lib/osdk";
import { throwIfAborted } from "../compute/abort";
import type { Paged, Progress } from "../types";

/**
 * Splits ids into chunks of `size` with the host helper `chunk` (instructions §3), keeping order.
 * @param ids ids in any order (copied, since `chunk` takes a mutable array).
 * @param size chunk size; values below 1 act as 1 (the host helper would never end on 0).
 * @returns the chunks; no ids → no chunk.
 */
export function idChunks(ids: readonly string[], size: number): string[][] {
  return chunk([...ids], Math.max(1, Math.floor(size)));
}

/**
 * Runs `task` over `inputs` with at most `limit` in flight (the inner id-batch limiter; never the app
 * semaphore, Appendix A X3). The signal is checked before each task starts; the first failure stops new
 * tasks and rejects with that error.
 * @param inputs task inputs.
 * @param limit maximum concurrent tasks; values below 1 act as 1.
 * @param signal optional abort signal (absent = never aborted); an abort rejects with `abortError()`.
 * @param task the work per input.
 * @returns results in input order; no inputs → `[]` without running anything.
 */
export async function mapLimited<I, R>(
  inputs: readonly I[],
  limit: number,
  signal: AbortSignal | undefined,
  task: (input: I) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(inputs.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < inputs.length) {
      throwIfAborted(signal);
      const i = next;
      next += 1;
      try {
        results[i] = await task(inputs[i]);
      } catch (e: unknown) {
        failed = true;
        throw e;
      }
    }
  };
  const workers = Math.min(Math.max(1, Math.floor(limit)), inputs.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/**
 * Merges the paged results of several id chunks (spec §9.0 row cap, `rows.length >= ROW_CAP`).
 * @param parts chunk results in chunk order.
 * @param cap `config.ROW_CAP`.
 * @returns rows concatenated and cut at `cap`; `capped` when the total reaches `cap` or any chunk was capped.
 */
export function mergePaged<T>(parts: readonly Paged<T>[], cap: number): Paged<T> {
  const all = parts.flatMap((p) => p.rows);
  return { rows: all.slice(0, cap), capped: all.length >= cap || parts.some((p) => p.capped) };
}

/**
 * Cumulative progress sink for one port call (decision D24; the port contract: `loaded` = rows so far over
 * every page and chunk of the call).
 * @param ctx the call's context; no `onProgress` → rows are counted but nothing is reported.
 * @returns `add(n)`: adds `n` rows and reports `{ loaded }`.
 */
export function createProgress(ctx: { readonly onProgress?: (p: Progress) => void }): (rows: number) => void {
  let loaded = 0;
  return (rows) => {
    loaded += rows;
    ctx.onProgress?.({ loaded });
  };
}
