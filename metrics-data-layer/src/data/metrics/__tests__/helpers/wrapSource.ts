/** Test helper for loadCard / useMetric: a source wrapper that can observe, delay or fail every port call. */
import { createFakeSource, type FakeSource } from "../../source/fake/fakeSource";
import type { MetricsSource, SourceCtx } from "../../source/MetricsSource";
import type { Deferred } from "./deferred";

/** Called before every port call; may return a promise the call waits for, or throw/reject to fail it. */
export type BeforeCall = (method: keyof MetricsSource, args: readonly unknown[], ctx: SourceCtx) => Promise<void> | void;

/**
 * Wraps a source: each call first runs `before` (awaited), then delegates to `inner`.
 * @returns a `MetricsSource` with the same results as `inner`.
 */
export function wrapSource(inner: MetricsSource, before: BeforeCall): MetricsSource {
  const run = async <T>(method: keyof MetricsSource, args: readonly unknown[], ctx: SourceCtx, call: () => Promise<T>): Promise<T> => {
    await before(method, args, ctx);
    return call();
  };
  return {
    countItems: (s, c) => run("countItems", [s], c, () => inner.countItems(s, c)),
    countItemsBy: (s, g, c) => run("countItemsBy", [s, g], c, () => inner.countItemsBy(s, g, c)),
    countEvents: (s, d, c) => run("countEvents", [s, d], c, () => inner.countEvents(s, d, c)),
    countEventsBy: (s, d, g, c) => run("countEventsBy", [s, d, g], c, () => inner.countEventsBy(s, d, g, c)),
    countOpenAlerts: (s, c) => run("countOpenAlerts", [s], c, () => inner.countOpenAlerts(s, c)),
    countOpenAlertsBy: (s, g, c) => run("countOpenAlertsBy", [s, g], c, () => inner.countOpenAlertsBy(s, g, c)),
    countRisk: (s, c) => run("countRisk", [s], c, () => inner.countRisk(s, c)),
    countRiskByScoreRange: (s, r, c) => run("countRiskByScoreRange", [s, r], c, () => inner.countRiskByScoreRange(s, r, c)),
    countAppUsers: (w, c) => run("countAppUsers", [w], c, () => inner.countAppUsers(w, c)),
    countAppUsersBy: (w, g, c) => run("countAppUsersBy", [w, g], c, () => inner.countAppUsersBy(w, g, c)),
    countVerdictsBy: (f, c) => run("countVerdictsBy", [f], c, () => inner.countVerdictsBy(f, c)),
    fetchEvents: (s, c) => run("fetchEvents", [s], c, () => inner.fetchEvents(s, c)),
    fetchOpenAlerts: (s, c) => run("fetchOpenAlerts", [s], c, () => inner.fetchOpenAlerts(s, c)),
    fetchItems: (s, c) => run("fetchItems", [s], c, () => inner.fetchItems(s, c)),
    fetchItemsByIds: (ids, c) => run("fetchItemsByIds", [ids], c, () => inner.fetchItemsByIds(ids, c)),
    fetchVerdictsByIds: (ids, c) => run("fetchVerdictsByIds", [ids], c, () => inner.fetchVerdictsByIds(ids, c)),
  };
}

/** The window key of a `countAppUsers` call (userFunnel stage 1.1), else undefined. */
export function appUsersWindowKey(method: keyof MetricsSource, args: readonly unknown[]): string | undefined {
  if (method !== "countAppUsers") return undefined;
  const w = args[0];
  return typeof w === "object" && w !== null && "key" in w ? String(w.key) : undefined;
}

/** A fake whose userFunnel 1.1 call (countAppUsers) waits on the gate of its window key; records signals. */
export function gatedUserSource(gates: Partial<Record<string, Deferred<void>>>): {
  readonly fake: FakeSource;
  readonly source: MetricsSource;
  readonly signals: AbortSignal[];
} {
  const signals: AbortSignal[] = [];
  const fake = createFakeSource();
  const source = wrapSource(fake, (method, args, ctx) => {
    const key = appUsersWindowKey(method, args);
    if (key === undefined) return undefined;
    signals.push(ctx.signal);
    return gates[key]?.promise;
  });
  return { fake, source, signals };
}
