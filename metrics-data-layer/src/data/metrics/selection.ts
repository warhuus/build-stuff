/**
 * Selection: defaults, normalisation, URL search-param parse/serialise and the raw cache key
 * (pure layer: imports config and types only). Instructions §7, Appendix A X7, spec §11, lead decision D6.
 */
import {
  AGEING_THRESHOLD_MAX_DAYS,
  AGEING_THRESHOLD_MIN_DAYS,
  DEFAULT_AGEING_THRESHOLD_DAYS,
  DEFAULT_OTIF_MODE,
  DEFAULT_UNIT,
  DEFAULT_VIEW,
  DEFAULT_WINDOW,
  ITEM_DIMS,
  ITEM_FUNNEL_VIEWS,
  OTIF_MODES,
  UNITS,
  URL_KEYS,
  WINDOW_KEYS,
} from "../../config/metrics";
import type {
  BreakdownDimension,
  CardId,
  ItemDim,
  ItemFilters,
  ItemFunnelView,
  OtifMode,
  Selection,
  Unit,
  WindowKey,
} from "./types";

/** Empty filters: no restriction on any item dimension. Spec §5 R1. */
export const EMPTY_FILTERS: ItemFilters = { businessLine: [], productLine: [], region: [], plant: [] };

/** Default selection (instructions §7): 30 days, count, item view, no filters, OTIF, threshold 30 days. */
export const DEFAULT_SELECTION: Selection = {
  window: DEFAULT_WINDOW,
  unit: DEFAULT_UNIT,
  view: DEFAULT_VIEW,
  filters: EMPTY_FILTERS,
  otifMode: DEFAULT_OTIF_MODE,
  ageingThresholdDays: DEFAULT_AGEING_THRESHOLD_DAYS,
};

/** Loosely typed selection input (e.g. from untyped callers); every field optional and validated. */
export interface SelectionInput {
  readonly window?: unknown;
  readonly unit?: unknown;
  readonly view?: unknown;
  readonly filters?: { readonly [D in ItemDim]?: unknown };
  readonly otifMode?: unknown;
  readonly ageingThresholdDays?: unknown;
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Canonical filter values: strings only, empty strings dropped, de-duplicated, sorted by code unit.
 * @param values any value; a non-array gives `[]`.
 * @returns the canonical, sorted string array.
 */
export function normalizeFilterValues(values: unknown): readonly string[] {
  if (!Array.isArray(values)) return [];
  const strings = values.filter((v): v is string => typeof v === "string" && v !== "");
  return [...new Set(strings)].sort(compareStrings);
}

/**
 * Canonical filters for every item dimension (missing or invalid dimension → `[]`).
 * @param filters partial, untrusted filters.
 * @returns complete `ItemFilters` with canonical arrays.
 */
export function normalizeFilters(filters: SelectionInput["filters"]): ItemFilters {
  return {
    businessLine: normalizeFilterValues(filters?.businessLine),
    productLine: normalizeFilterValues(filters?.productLine),
    region: normalizeFilterValues(filters?.region),
    plant: normalizeFilterValues(filters?.plant),
  };
}

/** @returns the matching window key, or `null` when `v` is none of `WINDOW_KEYS`. */
export const toWindowKey = (v: unknown): WindowKey | null => WINDOW_KEYS.find((k) => k === v) ?? null;
/** @returns the matching unit, or `null`. */
export const toUnit = (v: unknown): Unit | null => UNITS.find((k) => k === v) ?? null;
/** @returns the matching itemFunnel view, or `null`. */
export const toView = (v: unknown): ItemFunnelView | null => ITEM_FUNNEL_VIEWS.find((k) => k === v) ?? null;
/** @returns the matching OTIF mode, or `null`. */
export const toOtifMode = (v: unknown): OtifMode | null => OTIF_MODES.find((k) => k === v) ?? null;

/**
 * Validates an ageing threshold (instructions §7).
 * @param v candidate value, in days.
 * @returns `v` when it is an integer in `AGEING_THRESHOLD_MIN_DAYS..AGEING_THRESHOLD_MAX_DAYS`, else `null`.
 */
export function toThresholdDays(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  return v >= AGEING_THRESHOLD_MIN_DAYS && v <= AGEING_THRESHOLD_MAX_DAYS ? v : null;
}

/**
 * Normalises and validates a selection; every missing or invalid field falls back to its default.
 * @param input untrusted, partial selection.
 * @returns a valid `Selection` with canonical filters.
 */
export function normalizeSelection(input: SelectionInput): Selection {
  return {
    window: toWindowKey(input.window) ?? DEFAULT_SELECTION.window,
    unit: toUnit(input.unit) ?? DEFAULT_SELECTION.unit,
    view: toView(input.view) ?? DEFAULT_SELECTION.view,
    filters: normalizeFilters(input.filters),
    otifMode: toOtifMode(input.otifMode) ?? DEFAULT_SELECTION.otifMode,
    ageingThresholdDays: toThresholdDays(input.ageingThresholdDays) ?? DEFAULT_SELECTION.ageingThresholdDays,
  };
}

/** Parses a URL window value: `"now"` or a decimal day count. */
function parseWindowParam(raw: string | null): unknown {
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : raw;
}

/** Parses a URL threshold value: decimal digits only (no sign, no fraction, no exponent). */
function parseIntParam(raw: string | null): number | null {
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
}

/**
 * Reads a selection from URL search params (short keys `w,u,v,bl,pl,rg,pt,om,n`; arrays are repeated
 * params). Instructions §7, Appendix A X7. Unknown params are ignored; for scalar keys the first value wins.
 * @param params URL search params.
 * @returns a valid `Selection`; missing or invalid values fall back to the defaults.
 */
export function parseSelection(params: URLSearchParams): Selection {
  return normalizeSelection({
    window: parseWindowParam(params.get(URL_KEYS.window)),
    unit: params.get(URL_KEYS.unit),
    view: params.get(URL_KEYS.view),
    filters: {
      businessLine: params.getAll(URL_KEYS.businessLine),
      productLine: params.getAll(URL_KEYS.productLine),
      region: params.getAll(URL_KEYS.region),
      plant: params.getAll(URL_KEYS.plant),
    },
    otifMode: params.get(URL_KEYS.otifMode),
    ageingThresholdDays: parseIntParam(params.get(URL_KEYS.ageingThresholdDays)),
  });
}

/**
 * Writes a selection as URL search params, omitting every default (instructions §7). The selection is
 * normalised first, so filter arrays come out sorted and de-duplicated, one repeated param per value.
 * @param sel selection.
 * @returns new params in `URL_KEYS` order; empty for the default selection.
 */
export function serializeSelection(sel: Selection): URLSearchParams {
  const s = normalizeSelection(sel);
  const out = new URLSearchParams();
  if (s.window !== DEFAULT_SELECTION.window) out.set(URL_KEYS.window, String(s.window));
  if (s.unit !== DEFAULT_SELECTION.unit) out.set(URL_KEYS.unit, s.unit);
  if (s.view !== DEFAULT_SELECTION.view) out.set(URL_KEYS.view, s.view);
  for (const dim of ITEM_DIMS) for (const v of s.filters[dim]) out.append(URL_KEYS[dim], v);
  if (s.otifMode !== DEFAULT_SELECTION.otifMode) out.set(URL_KEYS.otifMode, s.otifMode);
  if (s.ageingThresholdDays !== DEFAULT_SELECTION.ageingThresholdDays) {
    out.set(URL_KEYS.ageingThresholdDays, String(s.ageingThresholdDays));
  }
  return out;
}

/**
 * Replaces the selection params inside existing URL params, keeping every unrelated param (for the
 * `useMetricsSelection` hook). Instructions §7.
 * @param base current params (not mutated).
 * @param sel selection to write.
 * @returns new params: unrelated params of `base` first, then `serializeSelection(sel)`.
 */
export function mergeSelectionParams(base: URLSearchParams, sel: Selection): URLSearchParams {
  const own: readonly string[] = Object.values(URL_KEYS);
  const out = new URLSearchParams();
  for (const [k, v] of base) if (!own.includes(k)) out.append(k, v);
  for (const [k, v] of serializeSelection(sel)) out.append(k, v);
  return out;
}

/**
 * Whether any item filter is set (drives `filters-not-applied`, spec §5 R3).
 * @param filters item filters.
 * @returns true when at least one dimension has a value.
 */
export function hasFilters(filters: ItemFilters): boolean {
  return ITEM_DIMS.some((dim) => filters[dim].length > 0);
}

/**
 * Canonical, dimension-qualified filters key (lead decision D6), e.g. `bl=a,b;pl=;rg=x;pt=`.
 * Values are sorted, de-duplicated and URI-encoded, so `,`/`;` inside a value cannot collide.
 * @param filters item filters (any order, duplicates allowed).
 * @returns the key; equal for filters that select the same items.
 */
export function filtersKey(filters: ItemFilters): string {
  return ITEM_DIMS.map(
    (dim) => `${URL_KEYS[dim]}=${normalizeFilterValues(filters[dim]).map(encodeURIComponent).join(",")}`,
  ).join(";");
}

/**
 * Raw cache key of a card load (spec §11, lead decision D6):
 * `card | window.key | view (itemFunnel only) | otifMode (otifOutcome only) | filtersKey (all but userFunnel)
 * | breakdown`. Unit and `ageingThresholdDays` are never part of it (Appendix A O3).
 * @param cardId card.
 * @param selection current selection.
 * @param breakdown breakdown dimension, or `null`.
 * @returns the key string (fields labelled, `|`-separated).
 */
export function cacheKey(cardId: CardId, selection: Selection, breakdown: BreakdownDimension | null): string {
  const parts = [cardId, `w=${selection.window}`];
  if (cardId === "itemFunnel") parts.push(`v=${selection.view}`);
  if (cardId === "otifOutcome") parts.push(`om=${selection.otifMode}`);
  if (cardId !== "userFunnel") parts.push(`f=${filtersKey(selection.filters)}`);
  parts.push(`b=${breakdown ?? ""}`);
  return parts.join("|");
}
