/**
 * React context providing the `MetricsSource` (instructions §4 `hooks/MetricsSourceContext.ts`, §7
 * `MetricsSourceProvider`). Default: the app's OSDK source, created lazily. Written with `createElement`, no
 * JSX: a data provider, not UI (instructions §2 "No UI").
 */
import { createContext, createElement, type ReactElement, type ReactNode, useContext, useMemo } from "react";
import { METRICS_CONFIG, type MetricsConfig } from "../../../config/metrics";
import type { MetricsSource } from "../source/MetricsSource";
import { getDefaultOsdkSource } from "../source/osdk/defaultSource";

/** What the hooks read from context: the source, the config and the clock (window end, `computedAt`). */
export interface MetricsEnvironment {
  readonly source: MetricsSource;
  readonly config: MetricsConfig;
  readonly now: () => Date;
}

/** Props of `MetricsSourceProvider`; every field optional (defaults: OSDK source, METRICS_CONFIG, clock). */
export interface MetricsSourceProviderProps {
  /** Data source; default: the app's OSDK source. */
  readonly source?: MetricsSource;
  /** Config handed to loaders and derives; default `METRICS_CONFIG` (tests and integration override it). */
  readonly config?: MetricsConfig;
  /** Clock; default the current time. Tests pin it (e.g. to the fixture `now`). */
  readonly now?: () => Date;
  readonly children?: ReactNode;
}

const MetricsContext = createContext<MetricsEnvironment | null>(null);

const currentTime = (): Date => new Date();

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
  const value = useMemo<MetricsEnvironment | null>(
    () =>
      source === undefined && config === undefined && now === undefined
        ? null
        : { source: source ?? getDefaultOsdkSource(), config: config ?? METRICS_CONFIG, now: now ?? currentTime },
    [source, config, now],
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
