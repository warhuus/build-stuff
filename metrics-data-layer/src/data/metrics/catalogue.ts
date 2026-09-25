/**
 * Card catalogue (instructions §4 `catalogue.ts`, §2 card list). `CARDS` is the public, readonly metadata per
 * card (id, spec rows, draft, title, output type name, stub block, required integration values) for the UI.
 * `CARD_IMPL` pairs each card's loader with its pure derive; it is imported by `loadCard.ts` only and is not
 * re-exported by the barrel.
 */
import { CARD_META, type CardMeta } from "../../config/metrics";
import { stageCaveatsOf } from "./compute/funnelGroups";
import { deriveAgeingBacklog } from "./compute/deriveAgeingBacklog";
import { deriveClosureComposition } from "./compute/deriveClosureComposition";
import { deriveFirstViewToClosure, deriveRaisedToClosed, deriveRaisedToFirstView } from "./compute/deriveDurations";
import { deriveItemFunnel } from "./compute/deriveItemFunnel";
import { deriveOtifOutcome } from "./compute/deriveOtifOutcome";
import { deriveRiskDistribution } from "./compute/deriveRiskDistribution";
import { deriveUserFunnel } from "./compute/deriveUserFunnel";
import { mergeCaveats } from "./compute/caveats";
import { loadAgeingBacklog } from "./loaders/ageingBacklog";
import { loadClosureComposition } from "./loaders/closureComposition";
import { loadFirstViewToClosure } from "./loaders/firstViewToClosure";
import { loadItemFunnel } from "./loaders/itemFunnel";
import { loadOtifOutcome } from "./loaders/otifOutcome";
import { loadRaisedToClosed } from "./loaders/raisedToClosed";
import { loadRaisedToFirstView } from "./loaders/raisedToFirstView";
import { loadRiskDistribution } from "./loaders/riskDistribution";
import { loadUserFunnel } from "./loaders/userFunnel";
import type { Loader } from "./source/MetricsSource";
import type { CardData, CardId, CardOutput, CardRaw, Caveat, Derive, FunnelSeries } from "./types";

/**
 * Readonly public metadata of every card, keyed by card id (instructions §7 `CARDS`): `rows` (spec row ids),
 * `draft` (1 or 2), `title`, `output` (name of the output type T), `stub` (non-null for the second-draft
 * stubs 3.2, 3.3, 4.7: blocked reason, what unblocks it, its caveats) and `requires` (integration values;
 * a placeholder value blocks the card with `needs-integration-value`). Never null.
 */
export const CARDS: Readonly<Record<CardId, CardMeta>> = CARD_META;

/**
 * Loader + derive of one card. `stageCaveats` returns the caveats carried by the data itself (every stage of
 * the total, of each group and of `other` for funnels; none for other cards) so loadCard can union them
 * (instructions §5 rule 5).
 */
export interface CardImpl<C extends CardId> {
  readonly load: Loader<CardRaw[C]>;
  readonly derive: Derive<CardRaw[C], CardOutput[C]>;
  readonly stageCaveats: (data: CardData<CardOutput[C]>) => readonly Caveat[];
}

/** One `CardImpl` per card id (typed per card so `CARD_IMPL[cardId]` stays cast-free for a generic id). */
export type CardImplMap = { readonly [C in CardId]: CardImpl<C> };

/**
 * Every stage caveat of a funnel card: total, each breakdown group and `other`. Instructions §5 rule 5.
 * @param data funnel card data.
 * @returns de-duplicated caveats in config order; `[]` when no stage carries any.
 */
export function funnelStageCaveats(data: CardData<FunnelSeries>): readonly Caveat[] {
  const series = [data.total, ...(data.breakdown?.groups.map((g) => g.data) ?? [])];
  if (data.breakdown?.other) series.push(data.breakdown.other);
  return mergeCaveats(...series.map(stageCaveatsOf));
}

/**
 * Stage caveats of a non-funnel card: none (their outputs carry no per-part caveats).
 * @returns `[]`.
 */
export function noStageCaveats(): readonly Caveat[] {
  return [];
}

/**
 * Loader of a second-draft stub (spec §9 3.2, 3.3, 4.7). Never reached: loadCard returns the stub's blocked
 * result before any load (D13). Kept so `CARD_IMPL` is total over `CardId`; makes no call.
 * @returns `{ raw: null, status: "ok", caveats: [] }`.
 */
export const loadStub: Loader<null> = () => Promise.resolve({ raw: null, status: "ok", caveats: [] });

/**
 * Derive of a second-draft stub (never reached, see `loadStub`).
 * @returns an empty row list as the total, no breakdown, no caveats.
 */
export function deriveStubRows<T>(): Derive<null, readonly T[]> {
  return () => ({ data: { total: [], breakdown: null }, caveats: [] });
}

/**
 * Loader + derive per card (instructions §4: "catalogue.ts pairs load + derive per card"). Imported by
 * `loadCard.ts` only; not part of the public API.
 */
export const CARD_IMPL: CardImplMap = {
  userFunnel: { load: loadUserFunnel, derive: deriveUserFunnel, stageCaveats: funnelStageCaveats },
  itemFunnel: { load: loadItemFunnel, derive: deriveItemFunnel, stageCaveats: funnelStageCaveats },
  riskDistribution: { load: loadRiskDistribution, derive: deriveRiskDistribution, stageCaveats: noStageCaveats },
  otifOutcome: { load: loadOtifOutcome, derive: deriveOtifOutcome, stageCaveats: noStageCaveats },
  raisedToClosed: { load: loadRaisedToClosed, derive: deriveRaisedToClosed, stageCaveats: noStageCaveats },
  raisedToFirstView: { load: loadRaisedToFirstView, derive: deriveRaisedToFirstView, stageCaveats: noStageCaveats },
  firstViewToClosure: {
    load: loadFirstViewToClosure,
    derive: deriveFirstViewToClosure,
    stageCaveats: noStageCaveats,
  },
  ageingBacklog: { load: loadAgeingBacklog, derive: deriveAgeingBacklog, stageCaveats: noStageCaveats },
  closureComposition: {
    load: loadClosureComposition,
    derive: deriveClosureComposition,
    stageCaveats: noStageCaveats,
  },
  riskMovement: { load: loadStub, derive: deriveStubRows(), stageCaveats: noStageCaveats },
  riskCalibration: { load: loadStub, derive: deriveStubRows(), stageCaveats: noStageCaveats },
  rolledValue: { load: loadStub, derive: deriveStubRows(), stageCaveats: noStageCaveats },
};
