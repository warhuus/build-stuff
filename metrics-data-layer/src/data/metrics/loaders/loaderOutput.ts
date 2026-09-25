/**
 * The one loader envelope of every card loader (instructions §5 rule 5; lead decisions D11, L6): wraps the
 * raw data with the fetch-level caveats only — `row-cap` (spec §9.0 `fetchAllPages`) and
 * `not-worked-window-cap` (spec §9 4.2). No arithmetic; `truncated` (MAX_GROUPS) is decided by derive (MOD-02).
 */
import { mergeCaveats } from "../compute/caveats";
import type { LoaderOutput } from "../types";

/** Loader-level facts beyond the row cap. */
export interface LoaderFlags {
  /** 4.2 under a window key outside `config.NOT_WORKED_WINDOW_KEYS` (spec §9 4.2). */
  readonly notWorkedWindowCap?: boolean;
}

/**
 * Builds the `LoaderOutput` of a card loader.
 * @param raw the card's raw data.
 * @param fetches every `Paged` result the loader used (null entries = fetch not made, skipped); `[]` for
 * aggregate-only loaders.
 * @param flags extra loader caveats (default none).
 * @returns `{ raw, status, caveats }`: `row-cap` when any fetch was capped (D11), `not-worked-window-cap` per
 * `flags`; status "partial" on either, else "ok"; caveats de-duplicated in config order.
 */
export function loaderOutput<R>(
  raw: R,
  fetches: readonly ({ readonly capped: boolean } | null)[] = [],
  flags: LoaderFlags = {},
): LoaderOutput<R> {
  const capped = fetches.some((p) => p !== null && p.capped);
  const notWorkedCap = flags.notWorkedWindowCap === true;
  return {
    raw,
    status: capped || notWorkedCap ? "partial" : "ok",
    caveats: mergeCaveats(capped ? ["row-cap"] : [], notWorkedCap ? ["not-worked-window-cap"] : []),
  };
}
