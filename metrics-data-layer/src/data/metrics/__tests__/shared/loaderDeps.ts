/** Test helper: loader deps over the fake source and fixtures, plus the fixture windows and filters. */
import type { MetricsConfig } from "../../../../config/metrics";
import { EMPTY_FILTERS } from "../../selection";
import type { LoaderDeps } from "../../source/MetricsSource";
import { createFakeSource } from "../../source/fake/fakeSource";
import type { FakeSource } from "../../source/fake/fakeSource";
import { FIXTURE_CONFIG, FIXTURE_NOW } from "../../source/fake/fixtures";
import type { ItemFilters, Window, WindowKey } from "../../types";
import { resolveWindow } from "../../window";

/** Deps over a fresh fake source; `signal` never aborts unless given. */
export function fakeDeps(
  overrides: { readonly signal?: AbortSignal; readonly config?: Partial<MetricsConfig> } = {},
): LoaderDeps & { readonly source: FakeSource } {
  return {
    source: createFakeSource(),
    now: FIXTURE_NOW,
    signal: overrides.signal ?? new AbortController().signal,
    config: { ...FIXTURE_CONFIG, ...overrides.config },
  };
}

/** The fixture window of a key (FIXTURE_NOW = 2026-09-01T12:00Z). */
export const win = (key: WindowKey): Window => resolveWindow(key, FIXTURE_NOW);

/** Region = AMER: items I21–I40 except I29 (null region). */
export const AMER: ItemFilters = { ...EMPTY_FILTERS, region: ["AMER"] };

/** Distinct sorted alert ids of rows. */
export const idsOf = (rows: readonly { readonly riskAlertId: string }[]): string[] =>
  [...new Set(rows.map((r) => r.riskAlertId))].sort();

/** Number of recorded calls of one port method. */
export const callCount = (source: FakeSource, method: string): number =>
  source.calls.filter((c) => c.method === method).length;
