/**
 * Derive of the second-draft stub cards (spec §9 3.2 riskMovement, 3.3 riskCalibration, 4.7 rolledValue).
 * Pure. Never reached: loadCard returns the stub's blocked result before any load (lead decision D13); kept so
 * the catalogue pairs a derive with every card id (instructions §4).
 */
import type { Derive } from "../types";

/**
 * The derive of a stub card whose output is a row list.
 * @returns a derive giving an empty row list as the total, no breakdown and no caveats, whatever the input.
 */
export function deriveStubRows<T>(): Derive<null, readonly T[]> {
  return () => ({ data: { total: [], breakdown: null }, caveats: [] });
}
