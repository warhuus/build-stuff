/**
 * Breakdown registry (pure layer: imports config and types only). Exactly the Appendix A registry table
 * (binding; supersedes the Excel and spec §5 where they differ) plus spec §5 B1 and B10.
 * The dim → property apiName mapping lives only in `source/osdk` (lead decision D10).
 */
import { ITEM_DIMS } from "../../config/metrics";
import type { BreakdownDimension, CardId, ItemDim, ItemFunnelView, StageId } from "./types";

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

const U_ALL: readonly StageId[] = ["1.1", "1.2", "1.3", "1.4"];
const U_ALERT: readonly StageId[] = ["1.2", "1.3", "1.4"];
const I_ALL: readonly StageId[] = ["2.0", "2.1", "2.2", "2.3", "2.4"];
const I_ALERT: readonly StageId[] = ["2.1", "2.2", "2.3", "2.4"];
const ALERT_ATTRS = ["alertType", "routingPersona", "priority"] as const;

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
  rule("queueFilter", U_ALL, false),
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
 * Whether a dim is an alert dimension (alert attribute or alert-event type; spec §5 R2): every dim that is
 * neither an item dim nor `queueFilter` (the app-usage / event persona dim of section 1).
 * @param dim dimension.
 * @returns true for routingPersona, priority, escalated, alertType, actionType, writebackType.
 */
export function isAlertDim(dim: BreakdownDimension): boolean {
  return !isItemDim(dim) && dim !== "queueFilter";
}
