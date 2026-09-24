/**
 * Static text and card metadata of the Metrics data layer (config layer). Short machine labels only;
 * no formatting. Imports only the sibling code lists.
 */
import type {
  BLOCKED_REASONS,
  CARD_IDS,
  CAVEATS,
  DURATION_SERIES_KEYS,
  INTEGRATION_KEYS,
  STAGE_IDS,
} from "./metricsCodes";

/** One sentence per caveat code. Spec §6 table; Appendix A V6 for the codes it adds. */
export const CAVEAT_TEXT: Readonly<Record<(typeof CAVEATS)[number], string>> = {
  "no-source": "No data source exists yet for this metric.",
  "not-captured":
    "The OTIF risk score is a snapshot with no history, so movement and calibration cannot be computed.",
  "needs-integration-value": "A value that must be set at integration is still a placeholder.",
  proxy:
    "\"Open at any point in the window\" is approximated from the goods-issue date; a small share of items cannot be placed.",
  "not-a-conversion":
    "Actions do not require a prior view (many acted items have no view), so \"% of 2.2\" is overlap, not conversion.",
  "low-volume": "Write-backs are very rare; percentages are unstable.",
  "build-stamp":
    "Pipeline raised/closed times are build stamps with about 36-minute resolution; order within one build is unknown.",
  "queue-filter-persona": "Persona here is the queue filter the user had selected, not who the user is.",
  overlap: "Items are counted in every group they match; groups overlap and do not add up to the total.",
  "escalated-open-only": "The escalated flag exists only on currently open alerts.",
  "breakdown-open-only":
    "The alert-attribute split uses currently open alerts only; closed alerts cannot be filtered by these attributes.",
  "now-all-time": "Under \"Now\" events are counted over all time.",
  "now-open-only": "Under \"Now\" the population is items or alerts open right now.",
  "delayed-forced-100":
    "Delayed items have their score forced to 100; that bucket restates lateness, it does not predict it.",
  "unscored-largest": "Many open items have no score; the unscored bucket is the largest and is shown, not dropped.",
  "censored-unviewed":
    "Defined only on alerts someone viewed; alerts still waiting for a first view are excluded.",
  "excludes-close-before-view":
    "Alerts whose closure precedes the first view are excluded; the excluded count is reported.",
  "closure-actor-unknown":
    "Who closed an alert is never recorded; \"no human\" means no human event before closure.",
  precedence:
    "Groups use precedence write-back, then action, then view only, then no human, so they sum to 100%.",
  "opened-events-since-pipeline-start":
    "Raise times exist only for alerts raised since the pipeline start; older alerts are excluded and counted.",
  "gate-differs": "OTIF and CRIT use different exclusion gates, so their populations differ.",
  unstratified: "The comparison is not adjusted for alert type and priority.",
  "not-worked-includes-unalerted": "Not worked includes delivered items that never had an alert.",
  "not-worked-window-cap": "The not-worked series is computed only for 7- and 14-day windows.",
  "filters-not-applied": "Item filters do not apply to this measure.",
  "id-space-differs": "The app-usage user ids and alert-event actor ids are different id spaces.",
  "value-item-view-only": "Order value is an item property and is not shown in alert view.",
  "no-target-property": "No property holds an ageing target; the threshold N is user-set.",
  truncated: "Only the largest groups are shown.",
  "row-cap": "A fetch hit its row limit, so the result is partial.",
  "simpson-strata": "Worked alerts skew to urgent types; compare within alert type × priority, not pooled.",
  "crit-unstratified": "CRIT cannot be split by alert type × priority until its verdict is filterable.",
  "value-unavailable": "Value cannot be split by this group-by-only attribute; counts only.",
};

/** Funnel stage labels. Spec §9.0, Appendix A F1. */
export const STAGE_LABELS: Readonly<Record<(typeof STAGE_IDS)[number], string>> = {
  "1.0": "Users who should use the app",
  "1.1": "Opened the app",
  "1.2": "Viewed an alert",
  "1.3": "Took an action",
  "1.4": "Executed a write-back",
  "2.0": "Open items",
  "2.1": "Carried an alert",
  "2.2": "Alert viewed",
  "2.3": "Acted on",
  "2.4": "Written back",
};

/** Outside-path segment labels (2.3, 2.4 only). Spec §9.0, Appendix A F1. */
export const OUTSIDE_PATH_LABELS = {
  "2.3": "Acted without a view",
  "2.4": "Written back outside the path",
} as const;

/** Duration series labels. Spec §9.0. */
export const DURATION_SERIES_LABELS: Readonly<Record<(typeof DURATION_SERIES_KEYS)[number], string>> = {
  worked: "Worked",
  notWorked: "Not worked",
  all: "All",
};

/** What unblocks a card whose integration value is still the placeholder. Instructions §8 item 8. */
export const INTEGRATION_UNBLOCKED_BY: Readonly<Record<(typeof INTEGRATION_KEYS)[number], string>> = {
  ALERT_APP_ID: "Set ALERT_APP_ID in src/config/metrics.ts at integration",
  VERDICT_DATE_PROPERTY: "Set VERDICT_DATE_PROPERTY in src/config/metrics.ts at integration",
};

/** A second-draft stub: blocked reason, what unblocks it, and the caveats it carries. Spec §9 3.2, 3.3, 4.7. */
export interface StubMeta {
  readonly reason: (typeof BLOCKED_REASONS)[number];
  readonly unblockedBy: string;
  readonly caveats: readonly (typeof CAVEATS)[number][];
}

/** Static card metadata. The runtime catalogue (load + derive) lives in `data/metrics/catalogue.ts`. */
export interface CardMeta {
  readonly id: (typeof CARD_IDS)[number];
  /** Excel / spec row ids covered by the card. */
  readonly rows: readonly string[];
  readonly draft: 1 | 2;
  /** Short machine title. */
  readonly title: string;
  /** Name of the card's output type `T` (instructions §2). */
  readonly output: string;
  /** Non-null for second-draft stubs: the card is always blocked and makes no network call. */
  readonly stub: StubMeta | null;
  /** Integration values the card's queries need; placeholder → blocked `needs-integration-value`. */
  readonly requires: readonly (typeof INTEGRATION_KEYS)[number][];
}

/** Card catalogue metadata, keyed by card id. Instructions §2, spec §7 row split, §9 stubs. */
export const CARD_META: Readonly<Record<(typeof CARD_IDS)[number], CardMeta>> = {
  userFunnel: { id: "userFunnel", rows: ["1.0", "1.1", "1.2", "1.3", "1.4"], draft: 1, title: "User adoption funnel", output: "FunnelSeries", stub: null, requires: ["ALERT_APP_ID"] },
  itemFunnel: { id: "itemFunnel", rows: ["2.0", "2.1", "2.2", "2.3", "2.4"], draft: 1, title: "Sales order item funnel", output: "FunnelSeries", stub: null, requires: [] },
  riskDistribution: { id: "riskDistribution", rows: ["3.1"], draft: 1, title: "Current OTIF risk distribution", output: "BucketRow[]", stub: null, requires: [] },
  otifOutcome: { id: "otifOutcome", rows: ["4.1"], draft: 1, title: "Realised OTIF / CRIT", output: "OutcomeHeadline", stub: null, requires: ["VERDICT_DATE_PROPERTY"] },
  raisedToClosed: { id: "raisedToClosed", rows: ["4.2"], draft: 1, title: "Raised to closed", output: "DurationResult", stub: null, requires: [] },
  raisedToFirstView: { id: "raisedToFirstView", rows: ["4.3"], draft: 1, title: "Raised to first view", output: "DurationResult", stub: null, requires: [] },
  firstViewToClosure: { id: "firstViewToClosure", rows: ["4.4"], draft: 1, title: "First view to closure", output: "DurationResult", stub: null, requires: [] },
  ageingBacklog: { id: "ageingBacklog", rows: ["4.5"], draft: 1, title: "Ageing backlog", output: "AgeingBacklog", stub: null, requires: [] },
  closureComposition: { id: "closureComposition", rows: ["4.6"], draft: 1, title: "What happened before closure", output: "CompositionResult", stub: null, requires: [] },
  riskMovement: {
    id: "riskMovement", rows: ["3.2"], draft: 2, title: "OTIF risk movement", output: "MovementRow[]", requires: [],
    stub: { reason: "not-captured", unblockedBy: "S2 OTIF risk score history", caveats: ["not-captured"] },
  },
  riskCalibration: {
    id: "riskCalibration", rows: ["3.3"], draft: 2, title: "OTIF risk calibration", output: "CalibrationRow[]", requires: [],
    stub: {
      reason: "not-captured",
      unblockedBy: "S2 OTIF risk score history (and the item ↔ verdict link)",
      caveats: ["not-captured", "delayed-forced-100"],
    },
  },
  rolledValue: {
    id: "rolledValue", rows: ["4.7"], draft: 2, title: "Rolled order value", output: "RolledMonthRow[]", requires: [],
    stub: { reason: "no-source", unblockedBy: "S4 rolled-value source", caveats: ["no-source"] },
  },
};
