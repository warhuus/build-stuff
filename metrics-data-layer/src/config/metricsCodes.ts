/**
 * Code lists of the Metrics data layer (config layer, bottom of the import order; imports nothing).
 * Every union type in `src/data/metrics/types.ts` is derived from one of these tuples with
 * `(typeof TUPLE)[number]`, so the runtime list and the type can never drift apart.
 * Tuple order is the config order used for sorting and for unioning caveats (instructions §5 rule 11).
 */

/** Time-window keys. `"now"` = no lower bound / open now; numbers are days back from now. Spec §10. */
export const WINDOW_KEYS = ["now", 7, 14, 30, 90] as const;

/** Display units. Spec §10. */
export const UNITS = ["count", "valueUsd"] as const;

/** itemFunnel views held in `Selection.view`. Spec §10, Appendix A O4. */
export const ITEM_FUNNEL_VIEWS = ["item", "alert"] as const;

/** 4.1 verdict modes. Spec §9 4.1. */
export const OTIF_MODES = ["otif", "crit"] as const;

/** Item dimensions: the only global filters and the item breakdowns. Spec §5 R1. */
export const ITEM_DIMS = ["businessLine", "productLine", "region", "plant"] as const;

/** Every breakdown dimension, item dims first. Spec §10 `BreakdownDimension`. */
export const BREAKDOWN_DIMENSIONS = [
  ...ITEM_DIMS,
  "routingPersona",
  "priority",
  "escalated",
  "alertType",
  "actionType",
  "writebackType",
  "queueFilter",
] as const;

/**
 * Caveat codes: exactly the spec §6 table, in its order, with the Appendix A V4 rename
 * (`opened-events-since-pipeline-start`). This order is the config order used when caveats are unioned.
 */
export const CAVEATS = [
  "no-source",
  "not-captured",
  "needs-integration-value",
  "proxy",
  "not-a-conversion",
  "low-volume",
  "build-stamp",
  "queue-filter-persona",
  "overlap",
  "escalated-open-only",
  "breakdown-open-only",
  "now-all-time",
  "now-open-only",
  "delayed-forced-100",
  "unscored-largest",
  "censored-unviewed",
  "excludes-close-before-view",
  "closure-actor-unknown",
  "precedence",
  "opened-events-since-pipeline-start",
  "gate-differs",
  "unstratified",
  "not-worked-includes-unalerted",
  "not-worked-window-cap",
  "filters-not-applied",
  "id-space-differs",
  "value-item-view-only",
  "no-target-property",
  "truncated",
  "row-cap",
  "simpson-strata",
  "crit-unstratified",
  "value-unavailable",
] as const;

/** Blocked reasons: a subset of the caveat codes. Spec §10 `BlockedReason`. */
export const BLOCKED_REASONS = ["no-source", "not-captured", "needs-integration-value"] as const;

/** Funnel stage ids, section 1 then section 2. Spec §10 `StageId`. */
export const STAGE_IDS = ["1.0", "1.1", "1.2", "1.3", "1.4", "2.0", "2.1", "2.2", "2.3", "2.4"] as const;

/** Stage order per funnel. Spec §9.0 (stage labels), instructions §9 (five bars in order). */
export const FUNNEL_STAGES = {
  user: ["1.0", "1.1", "1.2", "1.3", "1.4"],
  item: ["2.0", "2.1", "2.2", "2.3", "2.4"],
} as const;

/** Card ids: the 9 first-draft cards then the 3 second-draft stubs. Instructions §2. */
export const CARD_IDS = [
  "userFunnel",
  "itemFunnel",
  "riskDistribution",
  "otifOutcome",
  "raisedToClosed",
  "raisedToFirstView",
  "firstViewToClosure",
  "ageingBacklog",
  "closureComposition",
  "riskMovement",
  "riskCalibration",
  "rolledValue",
] as const;

/** Risk buckets in display order: unscored, the five score bands, delayed. Spec §2, instructions §9. */
export const RISK_BUCKETS = ["unscored", "b15_30", "b31_50", "b51_70", "b71_90", "b91_100", "delayed"] as const;

/** Scored buckets, index-aligned with `RISK_RANGES` in `metrics.ts`. Spec §9.0. */
export const SCORED_BUCKETS = ["b15_30", "b31_50", "b51_70", "b71_90", "b91_100"] as const;

/** 4.6 closure groups in display order (Excel 4.6 order). Spec §10 `ClosureGroup`. */
export const CLOSURE_GROUPS = ["noHuman", "viewOnly", "action", "writeBack"] as const;

/** 4.6 precedence, first match wins; anything else is `noHuman`. Spec §9 4.6, §12.2 S3. */
export const CLOSURE_PRECEDENCE = ["writeBack", "action", "viewOnly"] as const;

/** Duration series keys in display order. Spec §10 `DurationSeries.key`. */
export const DURATION_SERIES_KEYS = ["worked", "notWorked", "all"] as const;

/** Duration exclusion reasons. Spec §10 `DurationResult.excluded`. */
export const DURATION_EXCLUSIONS = ["noRaise", "closeBeforeView"] as const;

/** Config keys that hold integration placeholders (instructions §8 item 8, §13 rule 3). */
export const INTEGRATION_KEYS = ["ALERT_APP_ID", "VERDICT_DATE_PROPERTY"] as const;
