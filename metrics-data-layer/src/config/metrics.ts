/**
 * All constants of the Metrics data layer (instructions §4, §10). Bottom layer: imports nothing outside
 * `src/config`. Loaders and sources read values through `LoaderDeps.config` / `SourceCtx.config`
 * (a `MetricsConfig`), which defaults to `METRICS_CONFIG`; tests override it (Appendix A X4).
 */
import {
  CARD_IDS,
  CAVEATS,
  ITEM_FUNNEL_VIEWS,
  OTIF_MODES,
  UNITS,
  WINDOW_KEYS,
} from "./metricsCodes";

export * from "./metricsCodes";
export * from "./metricsText";

/** Error message of a breakdown not allowed for (card, view). Instructions §7. */
export const BREAKDOWN_NOT_ALLOWED = "breakdown-not-allowed";

/** Placeholder for values set at integration (instructions §13 rule 3). */
export const PLACEHOLDER = "<to be set at integration>";

/** Window options offered to the user, in display order. Spec §10 `WindowKey`. */
export const WINDOW_OPTIONS: readonly (typeof WINDOW_KEYS)[number][] = WINDOW_KEYS;
/** Default window: 30 days. Instructions §7. */
export const DEFAULT_WINDOW: (typeof WINDOW_KEYS)[number] = 30;
/** Default unit. Instructions §7. */
export const DEFAULT_UNIT: (typeof UNITS)[number] = "count";
/** Default itemFunnel view. Instructions §7. */
export const DEFAULT_VIEW: (typeof ITEM_FUNNEL_VIEWS)[number] = "item";
/** Default 4.1 mode. Instructions §7. */
export const DEFAULT_OTIF_MODE: (typeof OTIF_MODES)[number] = "otif";
/** Default 4.5 threshold N, in days. Instructions §7. */
export const DEFAULT_AGEING_THRESHOLD_DAYS = 30;
/** Threshold N bounds, days, integers inclusive. Instructions §7. */
export const AGEING_THRESHOLD_MIN_DAYS = 1;
/** Threshold N upper bound, days. Instructions §7. */
export const AGEING_THRESHOLD_MAX_DAYS = 365;

/** URL search-param short keys (instructions §7); arrays are repeated params (Appendix A X7). */
export const URL_KEYS = {
  window: "w",
  unit: "u",
  view: "v",
  businessLine: "bl",
  productLine: "pl",
  region: "rg",
  plant: "pt",
  otifMode: "om",
  ageingThresholdDays: "n",
} as const;

/** First UTC day with pipeline `opened`/`closed` events. Spec §9.0, Appendix A V4. */
export const PIPELINE_EVENTS_START = "2026-05-15";

/** AppUsageEvent.appId of the alert app. Placeholder until integration (spec §9 1.1). */
export const ALERT_APP_ID: string = PLACEHOLDER;

/** Property choice for the verdict window date (Appendix A V7: the one property-name exception). */
export type VerdictDateProperty =
  | "otifOtShipmentEndDate"
  | "otifFirstInitialDeliveryDateTarget"
  | typeof PLACEHOLDER;
/** Verdict window date property. Placeholder until integration (spec §14 item 1). */
export const VERDICT_DATE_PROPERTY: VerdictDateProperty = PLACEHOLDER;

/** How verdicts are looked up by id: `$in` chunks or one `$eq` per id. Appendix A V8. */
export type VerdictIdLookup = "in" | "eq";
/** Verdict id lookup mode; verify at integration. Appendix A V8. */
export const VERDICT_ID_LOOKUP: VerdictIdLookup = "in";

/** AlertHistory.eventType values used by the named predicates. Spec §3, §4. */
export const EVENT_TYPES = {
  viewed: "opened_by_user",
  deeplink: "deeplink_clicked",
  updated: "updated",
  opened: "opened",
  closed: "closed",
  writeback: ["delivery_block_removed", "delivery_tolerance_corrected", "allocation_rejection_lifted"],
} as const;

/** AlertHistory.eventSource values that make an event an action. Spec §4 `action_event`. */
export const ACTION_EVENT_SOURCES = ["user", "user action", "action"] as const;
/** eventSource of a view (not an action). Spec §3, §4. Used by fixtures only. */
export const VIEW_EVENT_SOURCE = "user view";
/** eventSource / eventActor of pipeline events. Spec §3. Used by fixtures only. */
export const PIPELINE_EVENT_SOURCE = "pipeline";

/** SalesOrderOtifEvaluation.otifStatus of delayed items. Spec §9 3.1. */
export const OTIF_STATUS_DELAYED = "Delayed";
/** Value of an official-exclusion gate that lets a verdict row in. Spec §9 4.1. */
export const EXCLUSION_GATE_PASS = "No";
/** Made / not-made verdict values per mode; the rate denominator is made + not-made (Appendix A P3). */
export const VERDICT_VALUES = {
  otif: { made: "OTIF", notMade: "Not OTIF" },
  crit: { made: "CRIT", notMade: "Not CRIT" },
} as const;

/** `[start, end)` score ranges, index-aligned with `SCORED_BUCKETS` (b15_30 … b91_100). Spec §9.0. */
export const RISK_RANGES: readonly (readonly [number, number])[] = [
  [0, 31],
  [31, 51],
  [51, 71],
  [71, 91],
  [91, 101],
];

/** Duration bin edges, hours; last bin from 2160 upward is open-ended. Appendix A V1. */
export const DURATION_EDGES_HOURS: readonly number[] = [0, 1, 2, 4, 8, 24, 48, 96, 168, 336, 720, 2160];
/** Age bin edges, days: 1-day bins 0–30, then 30–60, 60–90, 90 upward (open-ended). Spec §9.0. */
export const AGE_EDGES_DAYS: readonly number[] = [...Array.from({ length: 31 }, (_, day) => day), 60, 90];
/** Quantiles reported per duration series. Appendix A O7. */
export const DURATION_QUANTILES = { median: 0.5, p90: 0.9 } as const;

/** Group limit passed as `$exactWithLimit` on every exact grouped aggregate. Appendix A V3. */
export const MAX_GROUPS = 10_000;
/** Groups shown per breakdown (top-N). Appendix A V3. */
export const BREAKDOWN_MAX_GROUPS = 8;
/** Row cap per paged fetch; hitting it → status partial + `row-cap`. Appendix A V2. */
export const ROW_CAP = 60_000;
/** Rows per page. Appendix A V2 (OSDK maximum 10,000). */
export const PAGE_SIZE = 1_000;
/** Ids per `$in` chunk. Appendix A V5. */
export const ID_BATCH = 500;
/** In-flight id batches inside one loader (own limiter, not the app semaphore). Appendix A V5, X3. */
export const INNER_CONCURRENCY = 4;
/** Slots of the one app-wide semaphore acquired by loadCard/useMetric. Instructions §8 item 12. */
export const APP_SEMAPHORE_SLOTS = 4;

/** Milliseconds per hour (duration conversion). */
export const MS_PER_HOUR = 3_600_000;
/** Milliseconds per day (age conversion). */
export const MS_PER_DAY = 86_400_000;

/** 2.1 emits `build-stamp` when the window is at most this many days. Spec §6. */
export const BUILD_STAMP_MAX_WINDOW_DAYS = 7;
/** Windows where 4.2 computes the not-worked series; others are partial. Instructions §8 item 9. */
export const NOT_WORKED_WINDOW_KEYS: readonly (typeof WINDOW_KEYS)[number][] = [7, 14];

/** Tie order at equal eventTimestamp: opened, then human, then closed. Spec §4. */
export const EVENT_TIE_ORDER = { opened: 0, human: 1, closed: 2 } as const;
/** Group labels of the boolean `escalated` dimension. Spec §5 B3. */
export const ESCALATED_GROUP_LABELS = { true: "true", false: "false" } as const;

/** Semaphore queue order = mount order; blocked cards enqueue nothing. Spec §11. */
export const MOUNT_ORDER: readonly (typeof CARD_IDS)[number][] = [
  "itemFunnel",
  "userFunnel",
  "riskDistribution",
  "ageingBacklog",
  "closureComposition",
  "raisedToClosed",
  "raisedToFirstView",
  "firstViewToClosure",
  "otifOutcome",
];

/** Order used when caveats are unioned: the spec §6 table order. Instructions §5 rule 5. */
export const CAVEAT_ORDER: readonly (typeof CAVEATS)[number][] = CAVEATS;

/**
 * The runtime configuration handed to loaders and sources (`LoaderDeps.config`, `SourceCtx.config`).
 * Declared explicitly so tests can override any value, including the integration placeholders.
 */
export interface MetricsConfig {
  readonly PLACEHOLDER: string;
  readonly PIPELINE_EVENTS_START: string;
  readonly ALERT_APP_ID: string;
  readonly VERDICT_DATE_PROPERTY: VerdictDateProperty;
  readonly VERDICT_ID_LOOKUP: VerdictIdLookup;
  readonly EVENT_TYPES: typeof EVENT_TYPES;
  readonly ACTION_EVENT_SOURCES: typeof ACTION_EVENT_SOURCES;
  readonly OTIF_STATUS_DELAYED: string;
  readonly EXCLUSION_GATE_PASS: string;
  readonly VERDICT_VALUES: typeof VERDICT_VALUES;
  readonly RISK_RANGES: readonly (readonly [number, number])[];
  readonly DURATION_EDGES_HOURS: readonly number[];
  readonly AGE_EDGES_DAYS: readonly number[];
  readonly MAX_GROUPS: number;
  readonly BREAKDOWN_MAX_GROUPS: number;
  readonly ROW_CAP: number;
  readonly PAGE_SIZE: number;
  readonly ID_BATCH: number;
  readonly INNER_CONCURRENCY: number;
  readonly NOT_WORKED_WINDOW_KEYS: readonly (typeof WINDOW_KEYS)[number][];
  readonly ESCALATED_GROUP_LABELS: typeof ESCALATED_GROUP_LABELS;
}

/** The real configuration; `config` defaults to it everywhere (Appendix A X4). */
export const METRICS_CONFIG: MetricsConfig = {
  PLACEHOLDER,
  PIPELINE_EVENTS_START,
  ALERT_APP_ID,
  VERDICT_DATE_PROPERTY,
  VERDICT_ID_LOOKUP,
  EVENT_TYPES,
  ACTION_EVENT_SOURCES,
  OTIF_STATUS_DELAYED,
  EXCLUSION_GATE_PASS,
  VERDICT_VALUES,
  RISK_RANGES,
  DURATION_EDGES_HOURS,
  AGE_EDGES_DAYS,
  MAX_GROUPS,
  BREAKDOWN_MAX_GROUPS,
  ROW_CAP,
  PAGE_SIZE,
  ID_BATCH,
  INNER_CONCURRENCY,
  NOT_WORKED_WINDOW_KEYS,
  ESCALATED_GROUP_LABELS,
};
