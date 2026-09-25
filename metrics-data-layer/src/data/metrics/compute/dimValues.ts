/**
 * Group labels of fetched rows per breakdown dimension (spec §5 B3: raw property values; booleans as
 * `"true"` / `"false"` from `config.ESCALATED_GROUP_LABELS`). Used by the client-side breakdowns of
 * 4.2–4.6 and the itemFunnel alert view. Pure. Null = the row falls outside every group.
 * Every dispatch over `BreakdownDimension` is an exhaustive switch (spec §12.2 S1).
 */
import type { MetricsConfig } from "../../../config/metrics";
import type { AlertAttrDim } from "../breakdowns";
import { unhandledDimension } from "../breakdowns";
import type { OpenAlertGroupField } from "../query/specs";
import type { AlertAttrs, AlertLifecycleRow, BreakdownDimension, ItemDim, ItemRow, OpenAlertRow } from "../types";

/** Item-dimension value of an item row (spec §5 R1); null when the property is null. */
export function itemDimValue(item: ItemRow, dim: ItemDim): string | null {
  return item[dim];
}

/** Alert-attribute value of `AlertAttrs` (Appendix A W6): alertType, routingPersona, priority; null when unset. */
export function attrsDimValue(attrs: AlertAttrs, dim: AlertAttrDim): string | null {
  switch (dim) {
    case "alertType":
      return attrs.alertType;
    case "routingPersona":
      return attrs.routingPersona;
    case "priority":
      return attrs.priority;
    default:
      return unhandledDimension(dim);
  }
}

/** Group label of a known escalated flag: `config.ESCALATED_GROUP_LABELS` (spec §5 B3). The one label rule. */
export function escalatedFlagLabel(escalated: boolean, config: MetricsConfig): string {
  return escalated ? config.ESCALATED_GROUP_LABELS.true : config.ESCALATED_GROUP_LABELS.false;
}

/** `"true"` / `"false"` label of the escalated flag (spec §5 B3, `escalatedFlagLabel`); null flag → null. */
export function escalatedLabel(escalated: boolean | null, config: MetricsConfig): string | null {
  return escalated === null ? null : escalatedFlagLabel(escalated, config);
}

/**
 * The escalated flag a group label stands for (inverse of `escalatedLabel`, spec §9.0 `aofWhere(escalated, g)`).
 * @returns true only for `config.ESCALATED_GROUP_LABELS.true`; any other label → false.
 */
export function escalatedValueOf(label: string, config: MetricsConfig): boolean {
  return label === config.ESCALATED_GROUP_LABELS.true;
}

/**
 * Alert-dimension value of an open alert (AlertOrderFulfillment, spec §9.0.1 L3): routingPersona =
 * persona, priority, alertType = riskType, escalated = its label; null when the property is null.
 */
export function openAlertDimValue(alert: OpenAlertRow, dim: OpenAlertGroupField, config: MetricsConfig): string | null {
  switch (dim) {
    case "routingPersona":
      return alert.persona;
    case "priority":
      return alert.priority;
    case "alertType":
      return alert.riskType;
    case "escalated":
      return escalatedLabel(alert.escalated, config);
    default:
      return unhandledDimension(dim);
  }
}

/** Items keyed by `salesOrderId` (items fetched by id / L3 items). Later duplicates win. */
export function itemsById(items: readonly ItemRow[]): Map<string, ItemRow> {
  return new Map(items.map((item) => [item.salesOrderId, item]));
}

/**
 * Item-dim value of the item with `salesOrderId` (spec §9 4.2–4.5: item dims from the alert's item);
 * null when the id is null, the item was not fetched, or the property is null.
 */
export function itemValueOf(
  salesOrderId: string | null,
  items: ReadonlyMap<string, ItemRow>,
  dim: ItemDim,
): string | null {
  const item = salesOrderId === null ? undefined : items.get(salesOrderId);
  return item ? itemDimValue(item, dim) : null;
}

/** A group key that puts every row outside every group (a dim the card's registry row does not allow). */
const NO_GROUP = (): null => null;

/**
 * Group key of an alert fact (spec §9 4.2–4.4, 4.6): item dims via its item (`items`, fetched by id), alert
 * attributes from `attrs`. `items` null (not fetched) → item dims give null. Dims outside the 4.2–4.6
 * registry rows (escalated, actionType, writebackType, queueFilter) never reach here (loadCard rejects them);
 * they key nothing.
 */
export function factKeyOf(
  dim: BreakdownDimension,
  items: readonly ItemRow[] | null,
): (fact: AlertLifecycleRow) => string | null {
  switch (dim) {
    case "alertType":
    case "routingPersona":
    case "priority":
      return (fact) => attrsDimValue(fact.attrs, dim);
    case "businessLine":
    case "productLine":
    case "region":
    case "plant": {
      const byId = itemsById(items ?? []);
      return (fact) => itemValueOf(fact.salesOrderId, byId, dim);
    }
    case "escalated":
    case "actionType":
    case "writebackType":
    case "queueFilter":
      return NO_GROUP;
    default:
      return unhandledDimension(dim);
  }
}

/**
 * Group key of an open alert (spec §9 4.5): alert dims from the AlertOrderFulfillment row, item dims from
 * its item in `items`. Dims outside the 4.5 registry row (actionType, writebackType, queueFilter) key nothing.
 */
export function openAlertKeyOf(
  dim: BreakdownDimension,
  items: ReadonlyMap<string, ItemRow>,
  config: MetricsConfig,
): (alert: OpenAlertRow) => string | null {
  switch (dim) {
    case "alertType":
    case "routingPersona":
    case "priority":
    case "escalated":
      return (alert) => openAlertDimValue(alert, dim, config);
    case "businessLine":
    case "productLine":
    case "region":
    case "plant":
      return (alert) => itemValueOf(alert.salesOrderId, items, dim);
    case "actionType":
    case "writebackType":
    case "queueFilter":
      return NO_GROUP;
    default:
      return unhandledDimension(dim);
  }
}
