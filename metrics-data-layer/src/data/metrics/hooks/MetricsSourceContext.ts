/**
 * React context providing the `MetricsSource` (instructions §4 `hooks/MetricsSourceContext.ts`, §7
 * `MetricsSourceProvider`). Default: the app's OSDK source, created lazily. Written with `createElement`, no
 * JSX: a data provider, not UI (instructions §2 "No UI").
 */
import { createContext, createElement, type ReactElement, type ReactNode, useContext, useMemo, useRef } from "react";
import { METRICS_CONFIG, type MetricsConfig } from "../../../config/metrics";
import type { MetricsSource } from "../source/MetricsSource";
import { getDefaultOsdkSource } from "../source/osdk/defaultSource";

/** What the hooks read from context: the source, the config and the clock (window end, `computedAt`). */
export interface MetricsEnvironment {
  readonly source: MetricsSource;
  readonly config: MetricsConfig;
  readonly now: () => Date;
}

/**
 * Props of `MetricsSourceProvider`; every field optional (defaults: OSDK source, METRICS_CONFIG, clock).
 * The environment is rebuilt (and in-progress loads restart) only when `source` or `config` identity, or a
 * pinned `now` instant, changes (TYP-06): pass a stable `source` / `config` (module constant or `useMemo`).
 */
export interface MetricsSourceProviderProps {
  /** Data source; default: the app's OSDK source. Keyed on identity. */
  readonly source?: MetricsSource;
  /** Config handed to loaders and derives; default `METRICS_CONFIG` (tests and integration override it). Keyed on identity. */
  readonly config?: MetricsConfig;
  /**
   * Clock; default the current time. A `Date` pins it (keyed on `getTime()`); a function is read through a
   * ref, so an inline `() => date` does not rebuild the environment. Tests pin it (e.g. to the fixture `now`).
   */
  readonly now?: Date | (() => Date);
  /** The subtree that reads the environment. */
  readonly children?: ReactNode;
}

const MetricsContext = createContext<MetricsEnvironment | null>(null);

const currentTime = (): Date => new Date();

/**
 * The time of a `now` prop: a pinned `Date` (copied), a clock function's result, or the current time.
 * @param now the prop value, possibly undefined.
 * @returns a Date.
 */
function readClock(now: Date | (() => Date) | undefined): Date {
  if (now === undefined) return currentTime();
  return now instanceof Date ? new Date(now.getTime()) : now();
}

let defaultEnv: MetricsEnvironment | null = null;

/** The default environment, created once so hook dependencies stay stable across renders. */
function defaultEnvironment(): MetricsEnvironment {
  defaultEnv ??= { source: getDefaultOsdkSource(), config: METRICS_CONFIG, now: currentTime };
  return defaultEnv;
}

/**
 * Provides the data source (and optionally config and clock) to `useMetric` below it.
 * @param props source / config / now overrides and children.
 * @returns the context provider element wrapping `children`.
 */
export function MetricsSourceProvider(props: MetricsSourceProviderProps): ReactElement {
  const { source, config, now, children } = props;
  const nowRef = useRef(now);
  nowRef.current = now;
  const nowKey = now === undefined ? "clock" : now instanceof Date ? now.getTime() : "function";
  const value = useMemo<MetricsEnvironment | null>(
    () =>
      source === undefined && config === undefined && nowKey === "clock"
        ? null
        : { source: source ?? getDefaultOsdkSource(), config: config ?? METRICS_CONFIG, now: () => readClock(nowRef.current) },
    [source, config, nowKey],
  );
  return createElement(MetricsContext.Provider, { value }, children);
}

/**
 * The metrics environment of the nearest provider; without one (or with no override) the OSDK source,
 * `METRICS_CONFIG` and the current time.
 * @returns the environment (never null).
 */
export function useMetricsEnvironment(): MetricsEnvironment {
  const env = useContext(MetricsContext);
  return env ?? defaultEnvironment();
}

/**
 * The `MetricsSource` in context (default: the app's OSDK source).
 * @returns the source (never null).
 */
export function useMetricsSource(): MetricsSource {
  return useMetricsEnvironment().source;
}
