/**
 * Selection state synced to the URL search params (instructions §7 `useMetricsSelection`, Appendix A X7):
 * short keys `w,u,v,bl,pl,rg,pt,om,n`, arrays as repeated params, defaults omitted, invalid values fall back
 * to the defaults, unrelated params kept.
 */
import { useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { mergeSelectionParams, parseSelection } from "../selection";
import type { Selection } from "../types";

/**
 * Setter of `useMetricsSelection`: a new selection or an updater of the latest one. Updaters queue like
 * React's `SetStateAction`: two calls in one event both apply (the second sees the first's result).
 */
export type SetSelection = (next: Selection | ((prev: Selection) => Selection)) => void;

/**
 * The page selection read from and written to the URL (needs a react-router context).
 * @returns `[selection, setSelection]`; `selection` is a stable object while the URL params are unchanged;
 * `setSelection` rewrites only the selection params (defaults omitted) and keeps every other param.
 */
export function useMetricsSelection(): [Selection, SetSelection] {
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const selection = useMemo(() => parseSelection(new URLSearchParams(query)), [query]);
  // The latest selection, pending or rendered (TYP-02); follows the URL whenever the query changes.
  const latest = useRef<{ readonly query: string; selection: Selection }>({ query, selection });
  if (latest.current.query !== query) latest.current = { query, selection };
  const setSelection = useCallback<SetSelection>(
    (next) => {
      const resolved = typeof next === "function" ? next(latest.current.selection) : next;
      latest.current.selection = resolved;
      setParams((prev) => mergeSelectionParams(prev, resolved));
    },
    [setParams],
  );
  return [selection, setSelection];
}
