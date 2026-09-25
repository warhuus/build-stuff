/**
 * Public API of the Metrics data layer (instructions §7). The ONLY file the UI imports. Values exported are
 * exactly the instructions §7 list; types are the ones those values and the outputs use.
 */
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
} from "./types";
export type { CardMeta, StubMeta } from "../../config/metrics";
export type { MetricsSource } from "./source/MetricsSource";
export type { CardResult, LoadCardOptions } from "./loadCard";
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
export { loadCard } from "./loadCard";
