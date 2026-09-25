/**
 * Public API of the Metrics data layer (instructions §7). The ONLY file the UI imports. Values exported are
 * exactly the instructions §7 list; types are the ones those values and the outputs use, plus the spec §10
 * fetch-row types, `Paged`, `SourceCtx` and the port's parameter types so a host can implement or wrap a
 * `MetricsSource` (SPF-03, TYP-03). `loadCard` here is the public wrapper: `opts.source` defaults to the
 * app's OSDK source (SPF-04; index may import `source/osdk`, instructions §5 rule 1).
 */
import { type CardResult, loadCard as loadCardWith, type LoadCardOptions as InternalLoadCardOptions } from "./loadCard";
import type { MetricsSource } from "./source/MetricsSource";
import { getDefaultOsdkSource } from "./source/osdk/defaultSource";
import type { BreakdownDimension, CardId, Selection } from "./types";

export type {
  Selection,
  WindowKey,
  Unit,
  View,
  ItemFunnelView,
  ItemFilters,
  ItemDim,
  OtifMode,
  BreakdownDimension,
  CardId,
  MetricResult,
  MetricStatus,
  Caveat,
  CardOutput,
  CardData,
  BreakdownResult,
  BreakdownGroup,
  BlockedInfo,
  BlockedReason,
  Progress,
  Window,
  Availability,
  StageId,
  RiskBucketId,
  OutsidePath,
  FunnelStageRaw,
  FunnelStage,
  FunnelSeries,
  BucketRow,
  Movement,
  MovementRow,
  CalibrationRow,
  OutcomeHeadline,
  StratumRow,
  DurationBin,
  DurationSeriesKey,
  DurationSeries,
  DurationExclusion,
  DurationResult,
  AgeBin,
  ItemAgeBin,
  AgeingThreshold,
  AgeingBacklog,
  ClosureGroup,
  CompositionRow,
  CompositionResult,
  RolledMonthRow,
  MetricsConfig,
  HumanEvent,
  AlertEventRow,
  OpenAlertRow,
  ItemRow,
  VerdictRow,
  AlertAttrs,
  AlertLifecycleRow,
  CountValue,
  GroupCount,
  GroupCountValue,
  RangeCount,
  Paged,
} from "./types";
export type { CardMeta, StubMeta } from "../../config/metrics";
export type { MetricsSource, SourceCtx, VerdictTotals } from "./source/MetricsSource";
export type * from "./query/specs";
export type { CardResult } from "./loadCard";
export type { MetricsSourceProviderProps } from "./hooks/MetricsSourceContext";
export type { SetSelection } from "./hooks/useMetricsSelection";

export { DEFAULT_SELECTION, parseSelection, serializeSelection } from "./selection";
export { allowedBreakdowns, isBreakdownAllowed, isAdditive } from "./breakdowns";
export { CARDS } from "./catalogue";
export { CAVEAT_TEXT } from "../../config/metrics";
export { useMetric } from "./hooks/useMetric";
export { useMetricsSelection } from "./hooks/useMetricsSelection";
export { MetricsSourceProvider } from "./hooks/MetricsSourceContext";
export { clearMetricsCache } from "./shared/cache";

/**
 * Options of the public `loadCard` (instructions §7): as the internal options, but `source` is optional and
 * defaults to the app's OSDK source (`getDefaultOsdkSource()`, SPF-04). `now` defaults to the current time,
 * `config` to `METRICS_CONFIG`; `signal` aborts this caller only; `onProgress` receives the running total.
 */
export interface LoadCardOptions extends Omit<InternalLoadCardOptions, "source"> {
  /** Data source; default (absent): the app's OSDK source. */
  readonly source?: MetricsSource;
}

/**
 * Loads one card outside React (instructions §7 `loadCard`): the same implementation, result and cache as
 * `useMetric`. Never throws: errors become `status: "error"` (an abort reads `aborted`).
 * @param cardId card; the result type follows it.
 * @param selection selection (invalid fields fall back to defaults).
 * @param breakdown breakdown dimension or null; not allowed for (card, view) → `error: "breakdown-not-allowed"`.
 * @param opts optional source (default: the OSDK source), now, signal, config, onProgress; `{}` when omitted.
 * @returns `MetricResult<CardData<CardOutput[C]>>`.
 */
export function loadCard<C extends CardId>(
  cardId: C,
  selection: Selection,
  breakdown: BreakdownDimension | null,
  opts: LoadCardOptions = {},
): Promise<CardResult<C>> {
  return loadCardWith(cardId, selection, breakdown, { ...opts, source: opts.source ?? getDefaultOsdkSource() });
}
