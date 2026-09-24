/**
 * Every exported type of the Metrics data layer (types layer: imports only types from config).
 * Union types are derived from the config code lists so the lists and the types cannot drift.
 * Output types: `outputTypes.ts`; raw fetch rows: `rowTypes.ts`; per-card raw loader data: `rawTypes.ts`.
 * All re-exported here; the barrel imports from this file only.
 */
import type { MetricsConfig } from "../../config/metrics";
import type {
  BLOCKED_REASONS,
  BREAKDOWN_DIMENSIONS,
  CARD_IDS,
  CAVEATS,
  ITEM_DIMS,
  ITEM_FUNNEL_VIEWS,
  OTIF_MODES,
  RISK_BUCKETS,
  STAGE_IDS,
  UNITS,
  WINDOW_KEYS,
} from "../../config/metrics";
import type {
  AgeingBacklog,
  BucketRow,
  CalibrationRow,
  CompositionResult,
  DurationResult,
  FunnelSeries,
  MovementRow,
  OutcomeHeadline,
  RolledMonthRow,
} from "./outputTypes";

export type * from "./outputTypes";
export type * from "./rowTypes";
export type * from "./rawTypes";
export type { MetricsConfig, VerdictDateProperty, VerdictIdLookup } from "../../config/metrics";

/** Window key: `"now"` or days back from now (7, 14, 30, 90). Spec §10. */
export type WindowKey = (typeof WINDOW_KEYS)[number];
/**
 * Resolved window. `end` = now; `start` = now − N days, `null` under `"now"` (no lower bound).
 * ISO-8601 UTC timestamps. Spec §10, instructions §8 item 2.
 */
export interface Window {
  readonly key: WindowKey;
  readonly start: string | null;
  readonly end: string;
}
/** Display unit; applied by derive, never refetches. Spec §10, Appendix A O3. */
export type Unit = (typeof UNITS)[number];
/** `FunnelSeries.view`. Spec §10, Appendix A O4. */
export type View = "user" | "item" | "alert";
/** `Selection.view` (itemFunnel only). Appendix A O4. */
export type ItemFunnelView = (typeof ITEM_FUNNEL_VIEWS)[number];
/** 4.1 verdict mode. Spec §9 4.1. */
export type OtifMode = (typeof OTIF_MODES)[number];
/** Global item filters; empty array = no filter on that dimension. Spec §5 R1. */
export interface ItemFilters {
  readonly businessLine: readonly string[];
  readonly productLine: readonly string[];
  readonly region: readonly string[];
  readonly plant: readonly string[];
}
/** Item dimension (SalesOrders property). Spec §5 R1. */
export type ItemDim = (typeof ITEM_DIMS)[number];
/** Breakdown dimension. Spec §10; the registry in `breakdowns.ts` (Appendix A) says where each applies. */
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

/**
 * The user's selections. Breakdowns are NOT part of it (instructions §7).
 * `ageingThresholdDays` is an integer 1..365.
 */
export interface Selection {
  readonly window: WindowKey;
  readonly unit: Unit;
  readonly view: ItemFunnelView;
  readonly filters: ItemFilters;
  readonly otifMode: OtifMode;
  readonly ageingThresholdDays: number;
}

/** Card id. Instructions §2. */
export type CardId = (typeof CARD_IDS)[number];
/** Caveat code: exactly spec §6 (with Appendix A V4/V6). */
export type Caveat = (typeof CAVEATS)[number];
/** Why a card is blocked. Spec §10. */
export type BlockedReason = (typeof BLOCKED_REASONS)[number];
/** Funnel stage id. Spec §10. */
export type StageId = (typeof STAGE_IDS)[number];
/** Stage availability; `not-applicable` for stages a breakdown dim does not apply to. Appendix A O4. */
export type Availability = "ok" | "no-source" | "not-captured" | "not-applicable";
/** Risk bucket id. Spec §10. */
export type RiskBucketId = (typeof RISK_BUCKETS)[number];

/** Card payload: the total plus an optional breakdown. Appendix A O1. */
export interface CardData<T> {
  readonly total: T;
  readonly breakdown: BreakdownResult<T> | null;
}
/** One breakdown group: raw property value (booleans `"true"`/`"false"`) and its data. Spec §5 B3. */
export interface BreakdownGroup<T> {
  readonly group: string;
  readonly data: T;
}
/**
 * Breakdown result. Appendix A O1, spec §5 B2–B5.
 * `groups`: at most BREAKDOWN_MAX_GROUPS, largest first. `other`: additive dims only, else null.
 * `truncated`: group counts when top-N cut groups, else null. `overlapRatio`: non-additive only,
 * Σ over ALL groups (before truncation) / total on the first applicable stage or whole population; null otherwise.
 */
export interface BreakdownResult<T> {
  readonly dimension: BreakdownDimension;
  readonly additive: boolean;
  readonly groups: readonly BreakdownGroup<T>[];
  readonly other: T | null;
  readonly truncated: { readonly shown: number; readonly total: number } | null;
  readonly overlapRatio: number | null;
}

/** Output type `T` per card (Appendix A O2). `loadCard`/`useMetric` infer their return type from it. */
export interface CardOutput {
  readonly userFunnel: FunnelSeries;
  readonly itemFunnel: FunnelSeries;
  readonly riskDistribution: readonly BucketRow[];
  readonly otifOutcome: OutcomeHeadline;
  readonly raisedToClosed: DurationResult;
  readonly raisedToFirstView: DurationResult;
  readonly firstViewToClosure: DurationResult;
  readonly ageingBacklog: AgeingBacklog;
  readonly closureComposition: CompositionResult;
  readonly riskMovement: readonly MovementRow[];
  readonly riskCalibration: readonly CalibrationRow[];
  readonly rolledValue: readonly RolledMonthRow[];
}

/** Card status. Spec §10. `partial` = row-cap or not-worked-window-cap. */
export type MetricStatus = "ok" | "partial" | "blocked" | "loading" | "error";
/** Paging progress: rows loaded so far, total when known. Spec §10. */
export interface Progress {
  readonly loaded: number;
  readonly total?: number;
}
/** Why a card is blocked and what unblocks it. Spec §10, instructions §8 item 10. */
export interface BlockedInfo {
  readonly reason: BlockedReason;
  readonly unblockedBy: string;
}
/**
 * Result envelope of every card (spec §10). `data` is kept while `loading` (previous data);
 * `computedAt` comes from the cache entry (ISO); `caveats` de-duplicated, in config order.
 */
export interface MetricResult<T> {
  readonly status: MetricStatus;
  readonly data?: T;
  readonly caveats: readonly Caveat[];
  readonly computedAt: string;
  readonly window: Window;
  readonly error?: string;
  readonly blocked?: BlockedInfo;
  readonly progress?: Progress;
}

/**
 * What a loader returns: raw, unit- and threshold-independent data plus fetch-level caveats
 * (`row-cap`, `truncated` from a MAX_GROUPS hit, `not-worked-window-cap`). Instructions §5 rule 5.
 */
export interface LoaderOutput<R> {
  readonly raw: R;
  readonly status: "ok" | "partial";
  readonly caveats: readonly Caveat[];
  readonly progress?: Progress;
}
/** What a pure derive returns: the card data plus selection/data-dependent caveats. Instructions §5 rule 5. */
export interface DeriveOutput<T> {
  readonly data: CardData<T>;
  readonly caveats: readonly Caveat[];
}
/** A card's pure derive: raw → card data, applying unit and threshold. Appendix A O3. */
export type Derive<R, T> = (raw: R, selection: Selection, config?: MetricsConfig) => DeriveOutput<T>;
