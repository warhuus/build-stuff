/**
 * Group labels of fetched rows per breakdown dimension (spec §5 B3: raw property values; booleans as
 * `"true"` / `"false"` from `config.ESCALATED_GROUP_LABELS`). Used by the client-side breakdowns of
 * 4.2–4.6 and the itemFunnel alert view. Pure. Null = the row falls outside every group.
 */
import type { MetricsConfig } from "../../../config/metrics";
import type { AlertAttrs, AlertLifecycleRow, BreakdownDimension, ItemDim, ItemRow, OpenAlertRow } from "../types";
import { isItemDim } from "../breakdowns";

/** Item-dimension value of an item row (spec §5 R1); null when the property is null. */
export function itemDimValue(item: ItemRow, dim: ItemDim): string | null {
  return item[dim];
}

/**
 * Alert-attribute value of `AlertAttrs` (Appendix A W6): alertType, routingPersona, priority. Every
 * other dim has no value on the facts → null.
 */
export function attrsDimValue(attrs: AlertAttrs, dim: BreakdownDimension): string | null {
  switch (dim) {
    case "alertType":
      return attrs.alertType;
    case "routingPersona":
      return attrs.routingPersona;
    case "priority":
      return attrs.priority;
    default:
      return null;
  }
}

/** `"true"` / `"false"` label of the escalated flag (spec §5 B3); null flag → null. */
export function escalatedLabel(escalated: boolean | null, config: MetricsConfig): string | null {
  if (escalated === null) return null;
  return escalated ? config.ESCALATED_GROUP_LABELS.true : config.ESCALATED_GROUP_LABELS.false;
}

/**
 * Alert-dimension value of an open alert (AlertOrderFulfillment, spec §9.0.1 L3): routingPersona =
 * persona, priority, alertType = riskType, escalated = its label. Every other dim → null.
 */
export function openAlertDimValue(alert: OpenAlertRow, dim: BreakdownDimension, config: MetricsConfig): string | null {
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
      return null;
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

/**
 * Group key of an alert fact (spec §9 4.2–4.4): item dims via its item (`items`, fetched by id),
 * alert dims from `attrs`. `items` null (not fetched) → item dims give null.
 */
export function factKeyOf(
  dim: BreakdownDimension,
  items: readonly ItemRow[] | null,
): (fact: AlertLifecycleRow) => string | null {
  if (!isItemDim(dim)) return (fact) => attrsDimValue(fact.attrs, dim);
  const byId = itemsById(items ?? []);
  return (fact) => itemValueOf(fact.salesOrderId, byId, dim);
}
