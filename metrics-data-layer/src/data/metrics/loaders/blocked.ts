/**
 * Blocked-card helpers (instructions §8 items 8, 10; lead decision D13; spec §9 3.2, 3.3, 4.7). Pure, no
 * network: loadCard checks `stubBlocked` then `integrationBlock` before any load and, on a hit, returns
 * `{ status: "blocked", blocked: { reason, unblockedBy }, caveats, window, computedAt }`.
 */
import type { MetricsConfig } from "../../../config/metrics";
import { CARD_META, INTEGRATION_UNBLOCKED_BY } from "../../../config/metricsText";
import type { Loader } from "../source/MetricsSource";
import type { BlockedInfo, CardId, Caveat } from "../types";

/** Why a card is blocked, what unblocks it, and the caveats the blocked result carries. */
export interface BlockedCard extends BlockedInfo {
  readonly caveats: readonly Caveat[];
}

/**
 * The block of a second-draft stub card (spec §9 3.2 riskMovement, 3.3 riskCalibration, 4.7 rolledValue).
 * @param cardId any card id.
 * @returns the stub's reason, `unblockedBy` text and stub caveats from `CARD_META`; null for a first-draft
 * card (not a stub).
 */
export function stubBlocked(cardId: CardId): BlockedCard | null {
  const stub = CARD_META[cardId].stub;
  return stub === null ? null : { reason: stub.reason, unblockedBy: stub.unblockedBy, caveats: [...stub.caveats] };
}

/**
 * The placeholder block of a card whose required integration value is unset (D13; spec §9 1.1 ALERT_APP_ID,
 * §9 4.1 VERDICT_DATE_PROPERTY).
 * @param cardId any card id.
 * @param config the loader config; a key is unset when `config[key] === config.PLACEHOLDER`.
 * @returns `{ reason: "needs-integration-value", unblockedBy, caveats: ["needs-integration-value"] }` for the
 * first unset key in `CARD_META[cardId].requires`; null when every required key is set (or none is required).
 */
export function integrationBlock(cardId: CardId, config: MetricsConfig): BlockedCard | null {
  const key = CARD_META[cardId].requires.find((k) => config[k] === config.PLACEHOLDER);
  return key === undefined
    ? null
    : { reason: "needs-integration-value", unblockedBy: INTEGRATION_UNBLOCKED_BY[key], caveats: ["needs-integration-value"] };
}

/**
 * Loader of a second-draft stub (spec §9 3.2, 3.3, 4.7). Never reached: loadCard returns the stub's blocked
 * result (`stubBlocked`) before any load (D13). Kept so `CARD_IMPL` is total over `CardId`; makes no call.
 * @returns `{ raw: null, status: "ok", caveats: [] }`.
 */
export const loadStub: Loader<null> = () => Promise.resolve({ raw: null, status: "ok", caveats: [] });
