/** Shared test helpers (MOD-19): the one selection builder and the fake-source context builder. */
import type { MetricsConfig } from "../../../../config/metrics";
import { DEFAULT_SELECTION } from "../../selection";
import type { SourceCtx } from "../../source/MetricsSource";
import { FIXTURE_CONFIG } from "../../source/fake/fixtures";
import type { Progress, Selection } from "../../types";

/** `DEFAULT_SELECTION` with overrides (e.g. `sel({ window: 7, filters: AMER, view: "alert" })`). */
export const sel = (overrides: Partial<Selection> = {}): Selection => ({ ...DEFAULT_SELECTION, ...overrides });

/**
 * A port-call context over FIXTURE_CONFIG (fake-source tests): config overrides, optional progress sink and
 * signal (a fresh, never-aborted one by default).
 */
export const fakeCtx = (
  over: Partial<MetricsConfig> = {},
  onProgress?: (p: Progress) => void,
  signal: AbortSignal = new AbortController().signal,
): SourceCtx => ({ signal, onProgress, config: { ...FIXTURE_CONFIG, ...over } });

/**
 * A value parsed from wire JSON, typed as `T` without a cast: stands for data from outside the type system
 * (e.g. an unknown breakdown dimension from an untyped caller), to exercise the `never` arms of exhaustive
 * switches at run time.
 */
export function fromWire<T>(json: string): T {
  const value: T = JSON.parse(json);
  return value;
}
