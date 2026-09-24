/**
 * Raw loader data per card: what `load` returns inside `LoaderOutput<R>` and what the card's pure
 * `derive(raw, selection)` consumes (Appendix A O3). Unit- and threshold-independent. Types only.
 * `window` is the resolved window; `dimension` the requested breakdown (already validated) or null.
 * Arithmetic (set algebra on ids, subtraction, top-N, bins) happens in derive, never in the loader,
 * except that the itemFunnel item-view loader ranks alert-dim groups with a compute function (spec §9 2.1).
 */
import type {
  AlertEventRow,
  AlertLifecycleRow,
  CountValue,
  GroupCount,
  GroupCountValue,
  ItemRow,
  OpenAlertRow,
  RangeCount,
  VerdictRow,
} from "./rowTypes";
import type { BreakdownDimension, ItemDim, OtifMode, RiskBucketId, Window } from "./types";

/** Section 1 stages that are queried (1.0 has no source). */
export type UserStageId = "1.1" | "1.2" | "1.3" | "1.4";
/** Section 2 stages. */
export type ItemStageId = "2.0" | "2.1" | "2.2" | "2.3" | "2.4";

/** Common fields of every raw payload. */
interface RawBase {
  readonly window: Window;
  readonly dimension: BreakdownDimension | null;
}

/**
 * userFunnel raw (spec §9 1.1–1.4): distinct users per stage; with a breakdown, grouped distinct users
 * for the stages the dim applies to (escalated: groups "true"/"false" from two calls). `generatedAt` ISO.
 */
export interface UserFunnelRaw extends RawBase {
  readonly generatedAt: string;
  readonly users: Readonly<Record<UserStageId, number>>;
  readonly groups: Partial<Readonly<Record<UserStageId, readonly GroupCount[]>>> | null;
}

/**
 * itemFunnel item view (spec §9 2.0–2.4): count + value per stage, outside paths, and per-stage groups.
 * Item dims: every group of every stage. Alert dims: every candidate group on 2.1, the top-N (chosen on 2.1)
 * on 2.2–2.4; 2.0 absent.
 */
export interface ItemViewRaw extends RawBase {
  readonly view: "item";
  readonly generatedAt: string;
  readonly stages: Readonly<Record<ItemStageId, CountValue>>;
  readonly outsidePath: { readonly "2.3": CountValue; readonly "2.4": CountValue };
  readonly groups: Partial<Readonly<Record<ItemStageId, readonly GroupCountValue[]>>> | null;
}
/**
 * 2.1 alert-view terms (spec §9 2.1): stage = lifecycleAlerts + openAlerts − openWithLifecycleEvent.
 * Under "now" lifecycleAlerts and openWithLifecycleEvent are 0 (one call).
 */
export interface CarriedAlertsRaw {
  /** Term a: distinct alerts with an opened/closed event in the window. */
  readonly lifecycleAlerts: number;
  /** All open alerts (item filters by pivot). */
  readonly openAlerts: number;
  /** Open alerts that have an opened/closed event since the window start (subtracted: term b). */
  readonly openWithLifecycleEvent: number;
}
/** The same three terms grouped by the alert dim (escalated: open alerts only, other two empty). */
export interface CarriedAlertGroupsRaw {
  readonly lifecycleAlerts: readonly GroupCount[];
  readonly openAlerts: readonly GroupCount[];
  readonly openWithLifecycleEvent: readonly GroupCount[];
}
/**
 * itemFunnel alert view (spec §9 2.1–2.4 alert view). 2.2–2.4 are derived from L1 rows; `facts` (L2) only
 * with alertType/routingPersona/priority; `openAlerts` (L3 alerts) only under "now" or with escalated.
 */
export interface AlertViewRaw extends RawBase {
  readonly view: "alert";
  readonly generatedAt: string;
  readonly carried: CarriedAlertsRaw;
  readonly carriedGroups: CarriedAlertGroupsRaw | null;
  readonly humanEvents: readonly AlertEventRow[];
  readonly facts: readonly AlertLifecycleRow[] | null;
  readonly openAlerts: readonly OpenAlertRow[] | null;
}
/** itemFunnel raw, discriminated by view. */
export type ItemFunnelRaw = ItemViewRaw | AlertViewRaw;

/** Buckets whose value is fetched by a bucket where-clause (unscored comes by subtraction). */
export type FetchedRiskBucket = Exclude<RiskBucketId, "unscored">;
/**
 * One 3.1 side (all items, or worked items) — spec §9 3.1. Unscored count = totalCount − Σ rangeCounts
 * − delayedCount; unscored value = totalValue − Σ bucketTotals values. `groups` per bucket (incl. unscored
 * via its where-clause) only with a breakdown.
 */
export interface RiskSideRaw {
  readonly totalCount: number;
  readonly rangeCounts: readonly RangeCount[];
  readonly delayedCount: number;
  readonly totalValue: number;
  readonly bucketTotals: Readonly<Record<FetchedRiskBucket, CountValue>>;
  readonly groups: Readonly<Record<RiskBucketId, readonly GroupCountValue[]>> | null;
}
/** riskDistribution raw. not worked = all − worked, never negative (derive). */
export interface RiskDistributionRaw extends RawBase {
  readonly dimension: ItemDim | null;
  readonly all: RiskSideRaw;
  readonly worked: RiskSideRaw;
}

/**
 * otifOutcome raw (spec §9 4.1): gated verdict totals grouped by classification for `mode`, the worked
 * item ids, and their verdict rows (both modes' fields). Gate and window are applied client-side by derive.
 */
export interface OtifOutcomeRaw extends RawBase {
  readonly mode: OtifMode;
  readonly totals: readonly GroupCount[];
  readonly workedIds: readonly string[];
  readonly verdicts: readonly VerdictRow[];
}

/**
 * 4.2 / 4.3 / 4.4 raw (spec §9 4.2–4.4): L2 facts (4.3: selected window; 4.2/4.4: "now"), the not-worked
 * fetch (4.2 at 7/14 only, else null) and the population's items by id (item dims only, else null).
 */
export interface DurationRaw extends RawBase {
  readonly facts: readonly AlertLifecycleRow[];
  readonly notWorked: readonly AlertLifecycleRow[] | null;
  readonly items: readonly ItemRow[] | null;
}

/** ageingBacklog raw (spec §9 4.5, L3): open alerts, their opened events and items; `asOf` = now (ISO). */
export interface AgeingBacklogRaw extends RawBase {
  readonly asOf: string;
  readonly alerts: readonly OpenAlertRow[];
  readonly openedEvents: readonly AlertEventRow[];
  readonly items: readonly ItemRow[];
}

/**
 * closureComposition raw (spec §9 4.6): distinct closed-and-not-open-now alerts in the window (total and
 * grouped by the dim) and the L2("now") facts; derive filters facts by closedAt in the window.
 */
export interface ClosureCompositionRaw extends RawBase {
  readonly closedTotal: number;
  readonly closedTotalByGroup: readonly GroupCount[] | null;
  readonly facts: readonly AlertLifecycleRow[];
}

/** Raw type per card; blocked stubs have no raw data. */
export interface CardRaw {
  readonly userFunnel: UserFunnelRaw;
  readonly itemFunnel: ItemFunnelRaw;
  readonly riskDistribution: RiskDistributionRaw;
  readonly otifOutcome: OtifOutcomeRaw;
  readonly raisedToClosed: DurationRaw;
  readonly raisedToFirstView: DurationRaw;
  readonly firstViewToClosure: DurationRaw;
  readonly ageingBacklog: AgeingBacklogRaw;
  readonly closureComposition: ClosureCompositionRaw;
  readonly riskMovement: null;
  readonly riskCalibration: null;
  readonly rolledValue: null;
}
