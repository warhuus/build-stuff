/**
 * riskDistribution spec builders (spec §9 3.1). Pure; built on the primitives of `build.ts`.
 */
import type { ItemFilters, RiskBucketId, Window } from "../types";
import { allItems, hasItemFilters, itemsWithEvent, withItemFilters } from "./build";
import type { ItemSet, RiskCondition, RiskSet } from "./specs";

/**
 * Spec §9 3.1 `soeAll`: risk evaluations of every open item; with item filters, those of the filtered
 * items (pivot `otifEvaluation`).
 */
export const riskAll = (f: ItemFilters): RiskSet =>
  hasItemFilters(f) ? { kind: "ofItems", items: withItemFilters(allItems, f) } : { kind: "all" };

/**
 * Spec §9 3.1 `soeWorked`: `riskAll(f)` ∩ evaluations of items with a human event in `w`
 * (all-time under "now"; Appendix A W3).
 */
export const riskWorked = (w: Window, f: ItemFilters): RiskSet => ({
  kind: "intersect",
  a: riskAll(f),
  b: { kind: "ofItems", items: itemsWithEvent(["human"], w) },
});

/** `set` narrowed by a risk condition (bucket where-clause or the not-Delayed pre-filter). Spec §9 3.1. */
export const riskWhere = (set: RiskSet, condition: RiskCondition): RiskSet => ({ kind: "where", base: set, condition });

/** Spec §9 3.1 `bucketWhere(b)` applied to `set`. */
export const riskBucket = (set: RiskSet, bucket: RiskBucketId): RiskSet => riskWhere(set, { kind: "bucket", bucket });

/** Spec §9 3.1 `byRange` pre-filter: evaluations that are not Delayed. */
export const riskNotDelayed = (set: RiskSet): RiskSet => riskWhere(set, { kind: "notDelayed" });

/** Items of a risk set (pivot `salesOrder`), for value sums and item-dim splits. Spec §9 3.1. */
export const itemsOfRisk = (set: RiskSet): ItemSet => ({ kind: "ofRisk", risk: set });
