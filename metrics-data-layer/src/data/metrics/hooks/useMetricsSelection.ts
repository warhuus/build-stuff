/**
 * Selection state synced to the URL search params (instructions §7 `useMetricsSelection`, Appendix A X7):
 * short keys `w,u,v,bl,pl,rg,pt,om,n`, arrays as repeated params, defaults omitted, invalid values fall back
 * to the defaults, unrelated params kept.
 */
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { mergeSelectionParams, parseSelection } from "../selection";
import type { Selection } from "../types";

/** Setter of `useMetricsSelection`: a new selection or an updater of the current one. */
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
  const setSelection = useCallback<SetSelection>(
    (next) => {
      setParams((prev) => mergeSelectionParams(prev, typeof next === "function" ? next(parseSelection(prev)) : next));
    },
    [setParams],
  );
  return [selection, setSelection];
}
