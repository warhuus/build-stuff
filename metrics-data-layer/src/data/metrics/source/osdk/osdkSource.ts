/**
 * The OSDK implementation of the `MetricsSource` port (instructions §6, Appendix A X5). The only code that
 * talks to Foundry: `source/osdk/` alone imports `@osdk/client` and `@app/sdk`. The app wires in its client
 * and the generated SDK; tests pass a `createClient` with a recording `fetch`.
 */
import type { Client } from "@osdk/client";
import type { MetricsSource } from "../MetricsSource";
import type { OsdkObjectTypes } from "./compileSpec";
import {
  countAppUsers,
  countAppUsersBy,
  countEvents,
  countEventsBy,
  countItems,
  countItemsBy,
  countOpenAlerts,
  countOpenAlertsBy,
  countRisk,
  countRiskByScoreRange,
  countVerdictsBy,
} from "./osdkAggregates";
import { fetchEvents, fetchItems, fetchItemsByIds, fetchOpenAlerts, fetchVerdictsByIds } from "./osdkFetches";

export type { OsdkObjectTypes } from "./compileSpec";

/** Factory input: the host's OSDK client and the SDK object-type bundle (e.g. `import * as sdk from "@app/sdk"`). */
export interface OsdkSourceDeps {
  readonly client: Client;
  readonly sdk: OsdkObjectTypes;
}

/**
 * Creates the OSDK-backed `MetricsSource`. Input: `{ client, sdk }`. Output: the 16 port methods; each call
 * compiles its spec with `ctx.config`, performs one aggregate or a paged/chunked fetch, and rejects on abort
 * (AbortError) or server error. Spec §9; semantics in `source/MetricsSource.ts`.
 */
export function createOsdkSource(deps: OsdkSourceDeps): MetricsSource {
  const d = { client: deps.client, sdk: deps.sdk };
  return {
    countItems: (set, ctx) => countItems(d, set, ctx),
    countItemsBy: (set, g, ctx) => countItemsBy(d, set, g, ctx),
    countEvents: (set, distinct, ctx) => countEvents(d, set, distinct, ctx),
    countEventsBy: (set, distinct, g, ctx) => countEventsBy(d, set, distinct, g, ctx),
    countOpenAlerts: (set, ctx) => countOpenAlerts(d, set, ctx),
    countOpenAlertsBy: (set, g, ctx) => countOpenAlertsBy(d, set, g, ctx),
    countRisk: (set, ctx) => countRisk(d, set, ctx),
    countRiskByScoreRange: (set, ranges, ctx) => countRiskByScoreRange(d, set, ranges, ctx),
    countAppUsers: (w, ctx) => countAppUsers(d, w, ctx),
    countAppUsersBy: (w, g, ctx) => countAppUsersBy(d, w, g, ctx),
    countVerdictsBy: (filter, ctx) => countVerdictsBy(d, filter, ctx),
    fetchEvents: (set, ctx) => fetchEvents(d, set, ctx),
    fetchOpenAlerts: (set, ctx) => fetchOpenAlerts(d, set, ctx),
    fetchItems: (set, ctx) => fetchItems(d, set, ctx),
    fetchItemsByIds: (ids, ctx) => fetchItemsByIds(d, ids, ctx),
    fetchVerdictsByIds: (ids, ctx) => fetchVerdictsByIds(d, ids, ctx),
  };
}
