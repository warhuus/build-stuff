/**
 * Breakdown registry (pure layer: imports config and types only). Exactly the Appendix A registry table
 * (binding; supersedes the Excel and spec §5 where they differ) plus spec §5 B1 and B10.
 * The dim → property apiName mapping lives only in `source/osdk` (lead decision D10).
 */
import { FUNNEL_STAGES, ITEM_DIMS } from "../../config/metrics";
import type { EventGroupField, OpenAlertFilterField } from "./query/specs";
import type { BreakdownDimension, CardId, ItemDim, ItemFunnelView, StageId, UserStageId } from "./types";

/** One allowed dimension of a (card, view): the funnel stages it applies to and its additive flag. */
export interface BreakdownRule {
  readonly dim: BreakdownDimension;
  /** Funnel stages the dim applies to (others are `not-applicable`); `[]` for non-funnel cards. */
  readonly stages: readonly StageId[];
  /** Appendix A O1: true = groups partition the population (`other` returned); false = groups overlap. */
  readonly additive: boolean;
}

/** Rules per itemFunnel view; every other card has the same list for both views (view is ignored). */
export type BreakdownRegistry = Readonly<Record<CardId, Readonly<Record<ItemFunnelView, readonly BreakdownRule[]>>>>;

/** Whether a stage id is a queried section-1 stage (1.1–1.4; 1.0 has no source, spec §9 1.0). */
export function isQueriedUserStage(id: StageId): id is UserStageId {
  return id === "1.1" || id === "1.2" || id === "1.3" || id === "1.4";
}
/** Section 1 stages that are queried, in `FUNNEL_STAGES.user` order: 1.1–1.4. */
export const QUERIED_USER_STAGES: readonly UserStageId[] = FUNNEL_STAGES.user.filter(isQueriedUserStage);
/** Section 1 stages built on AlertHistory events (spec §9 1.2–1.4). */
const U_ALERT: readonly StageId[] = FUNNEL_STAGES.user.slice(2);
const I_ALL: readonly StageId[] = FUNNEL_STAGES.item;
/** Section 2 stages of the alert view and of alert dims at item grain (2.0 excluded, Appendix A F3): 2.1–2.4. */
export const ALERT_VIEW_STAGES: readonly StageId[] = FUNNEL_STAGES.item.slice(1);
const I_ALERT = ALERT_VIEW_STAGES;

/** Alert attributes present on AlertHistory pipeline events, AlertOrderFulfillment and L2 `attrs` (spec §5 R2, W6). */
export const ALERT_ATTR_DIMS = ["alertType", "routingPersona", "priority"] as const;
/** One of `ALERT_ATTR_DIMS`. */
export type AlertAttrDim = (typeof ALERT_ATTR_DIMS)[number];
const ALERT_ATTRS = ALERT_ATTR_DIMS;
/** Alert dimensions (spec §5 R2): alert attributes, the escalated flag and the event-type dims. */
export const ALERT_DIMS = [...ALERT_ATTR_DIMS, "escalated", "actionType", "writebackType"] as const;

const rule = (dim: BreakdownDimension, stages: readonly StageId[], additive: boolean): BreakdownRule => ({
  dim,
  stages,
  additive,
});
const additiveNoStages = (dims: readonly BreakdownDimension[]): readonly BreakdownRule[] =>
  dims.map((dim) => rule(dim, [], true));
const bothViews = (rules: readonly BreakdownRule[]): Readonly<Record<ItemFunnelView, readonly BreakdownRule[]>> => ({
  item: rules,
  alert: rules,
});

/** userFunnel: every dim non-additive (Appendix A registry, row 1). */
const USER_FUNNEL: readonly BreakdownRule[] = [
  rule("queueFilter", QUERIED_USER_STAGES, false),
  rule("alertType", U_ALERT, false),
  rule("escalated", U_ALERT, false),
  rule("actionType", ["1.3"], false),
  rule("writebackType", ["1.4"], false),
];

/** itemFunnel item view: item dims additive on 2.0–2.4; alert dims at item grain non-additive on 2.1–2.4. */
const ITEM_VIEW: readonly BreakdownRule[] = [
  ...ITEM_DIMS.map((dim) => rule(dim, I_ALL, true)),
  rule("routingPersona", I_ALERT, false),
  rule("priority", I_ALERT, false),
  rule("escalated", I_ALERT, false),
];

/** itemFunnel alert view: alert grain additive, except actionType/writebackType (spec §5 B10). */
const ALERT_VIEW: readonly BreakdownRule[] = [
  ...ALERT_ATTRS.map((dim) => rule(dim, I_ALERT, true)),
  rule("escalated", I_ALERT, true),
  rule("actionType", ["2.3"], false),
  rule("writebackType", ["2.4"], false),
];

const DURATION: readonly BreakdownRule[] = additiveNoStages([...ALERT_ATTRS, ...ITEM_DIMS]);

/** The registry: Appendix A "Breakdown registry" table, row by row. Readonly data. */
export const BREAKDOWN_REGISTRY: BreakdownRegistry = {
  userFunnel: bothViews(USER_FUNNEL),
  itemFunnel: { item: ITEM_VIEW, alert: ALERT_VIEW },
  riskDistribution: bothViews(additiveNoStages(ITEM_DIMS)),
  otifOutcome: bothViews([]),
  raisedToClosed: bothViews(DURATION),
  raisedToFirstView: bothViews(DURATION),
  firstViewToClosure: bothViews(DURATION),
  ageingBacklog: bothViews(additiveNoStages([...ALERT_ATTRS, "escalated", ...ITEM_DIMS])),
  closureComposition: bothViews(additiveNoStages(ALERT_ATTRS)),
  riskMovement: bothViews([]),
  riskCalibration: bothViews([]),
  rolledValue: bothViews([]),
};

/**
 * The rule of a dim for (card, view).
 * @param card card id.
 * @param view itemFunnel view (ignored by every other card).
 * @param dim dimension.
 * @returns the rule, or `null` when the dim is not allowed.
 */
export function breakdownRule(card: CardId, view: ItemFunnelView, dim: BreakdownDimension): BreakdownRule | null {
  return BREAKDOWN_REGISTRY[card][view].find((r) => r.dim === dim) ?? null;
}

/**
 * Allowed dims for (card, view), in registry order. Instructions §7 public API.
 * @param card card id.
 * @param view itemFunnel view (ignored by every other card).
 * @returns the dims; `[]` when the card takes no breakdown.
 */
export function allowedBreakdowns(card: CardId, view: ItemFunnelView): readonly BreakdownDimension[] {
  return BREAKDOWN_REGISTRY[card][view].map((r) => r.dim);
}

/**
 * Spec §5 B1: true if any stage (or, for non-funnel cards, the card) accepts the dim.
 * @param card card id.
 * @param view itemFunnel view (ignored by every other card).
 * @param dim dimension.
 * @returns whether the breakdown is allowed; false for every dim outside the registry row.
 */
export function isBreakdownAllowed(card: CardId, view: ItemFunnelView, dim: BreakdownDimension): boolean {
  return breakdownRule(card, view, dim) !== null;
}

/**
 * Additive flag (Appendix A O1, spec §5 B4/B10).
 * @param card card id.
 * @param view itemFunnel view (ignored by every other card).
 * @param dim dimension.
 * @returns true when groups partition the population; false for non-additive and for non-allowed dims.
 */
export function isAdditive(card: CardId, view: ItemFunnelView, dim: BreakdownDimension): boolean {
  return breakdownRule(card, view, dim)?.additive ?? false;
}

/**
 * Funnel stages a dim applies to (spec §5 B1; other stages are `not-applicable`).
 * @param card card id.
 * @param view itemFunnel view (ignored by every other card).
 * @param dim dimension.
 * @returns stage ids in funnel order; `[]` for non-funnel cards and non-allowed dims.
 */
export function stagesForDim(card: CardId, view: ItemFunnelView, dim: BreakdownDimension): readonly StageId[] {
  return breakdownRule(card, view, dim)?.stages ?? [];
}

/**
 * First stage a dim applies to: where the top-N group list is chosen and `overlapRatio` computed (spec §5 B2, B5).
 * @param card card id.
 * @param view itemFunnel view (ignored by every other card).
 * @param dim dimension.
 * @returns the stage id, or `null` for non-funnel cards and non-allowed dims.
 */
export function firstApplicableStage(card: CardId, view: ItemFunnelView, dim: BreakdownDimension): StageId | null {
  return stagesForDim(card, view, dim)[0] ?? null;
}

/**
 * Whether a dim is an item dimension (a `SalesOrders` property; spec §5 R1).
 * @param dim dimension.
 * @returns true for businessLine, productLine, region, plant (narrows to `ItemDim`).
 */
export function isItemDim(dim: BreakdownDimension): dim is ItemDim {
  return ITEM_DIMS.some((d) => d === dim);
}

/**
 * Whether a dim is an alert dimension (spec §5 R2), defined positively from `ALERT_DIMS` so a new dim is
 * never an alert dim by default (spec §12.2 S1).
 * @param dim dimension.
 * @returns true for alertType, routingPersona, priority, escalated, actionType, writebackType.
 */
export function isAlertDim(dim: BreakdownDimension): boolean {
  return ALERT_DIMS.some((d) => d === dim);
}

/**
 * Whether a dim is an alert attribute (alertType, routingPersona, priority): grouped by the pipeline event on
 * AlertHistory, by AlertOrderFulfillment for open alerts and by L2 `attrs` (spec §5 R2, §9 2.1, 4.2–4.6).
 * @param dim dimension or null.
 * @returns true for the three attributes (narrows to `AlertAttrDim`); false for null.
 */
export function isAlertAttrDim(dim: BreakdownDimension | null): dim is AlertAttrDim {
  return ALERT_ATTR_DIMS.some((d) => d === dim);
}

/**
 * Whether a dim is an exact-matchable AlertOrderFulfillment filter field (spec §9.0 `aofWhere`): the item-view
 * alert dims at item grain (spec §9 2.1 `perGroup`).
 * @param dim dimension.
 * @returns true for routingPersona, priority, escalated (narrows to `OpenAlertFilterField`).
 */
export function isOpenAlertFilterDim(dim: BreakdownDimension): dim is OpenAlertFilterField {
  return dim === "routingPersona" || dim === "priority" || dim === "escalated";
}

/**
 * The AlertHistory group-by field of a dim (spec §9.0 `ahGroupBy`): queueFilter / routingPersona → persona,
 * alertType → riskType, priority → priorityAtEvent, actionType / writebackType → eventType. Exhaustive over
 * `BreakdownDimension`, so a new dim must be placed here (spec §12.2 S1).
 * @param dim dimension.
 * @returns the field; null for item dims and escalated (not an AlertHistory property).
 */
export function eventGroupFieldOf(dim: BreakdownDimension): EventGroupField | null {
  switch (dim) {
    case "queueFilter":
    case "routingPersona":
    case "alertType":
    case "priority":
    case "actionType":
    case "writebackType":
      return dim;
    case "escalated":
    case "businessLine":
    case "productLine":
    case "region":
    case "plant":
      return null;
    default:
      return unhandledDimension(dim);
  }
}

/**
 * The `never` arm of an exhaustive `BreakdownDimension` switch (instructions §7: never silently compute
 * something else; spec §12.2 S1): a new dim that a dispatch forgets fails to compile there.
 * @param dim a value TypeScript proved impossible.
 * @returns never; throws `TypeError` if reached at run time with an unknown value.
 */
export function unhandledDimension(dim: never): never {
  throw new TypeError(`Unhandled breakdown dimension: ${String(dim)}`);
}
