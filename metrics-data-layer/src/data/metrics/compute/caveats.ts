/**
 * Caveat union helper (instructions §5 rule 5). Pure.
 */
import { CAVEAT_ORDER } from "../../../config/metrics";
import type { Caveat } from "../types";

/**
 * De-duplicated union of any number of caveat lists, in `CAVEAT_ORDER` (the spec §6 table order),
 * independent of input order. Empty input gives `[]`. Instructions §5 rule 5.
 */
export function mergeCaveats(...lists: readonly (readonly Caveat[])[]): Caveat[] {
  const present = new Set<Caveat>(lists.flat());
  return CAVEAT_ORDER.filter((caveat) => present.has(caveat));
}
