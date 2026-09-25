/** Shared fixtures of the source/osdk tests: config, windows, contexts and a source over a recording client. */
import * as sdk from "@app/sdk";
import { METRICS_CONFIG, type MetricsConfig } from "../../../../config/metrics";
import type { ItemFilters, Progress, Window } from "../../types";
import type { MetricsSource, SourceCtx } from "../../source/MetricsSource";
import { createOsdkSource } from "../../source/osdk/osdkSource";
import { createRecordingClient, type RecordingClient } from "./recordingClient";

/** Config with the integration placeholders filled (tests override config, Appendix A X4). */
export const TEST_CONFIG: MetricsConfig = {
  ...METRICS_CONFIG,
  ALERT_APP_ID: "alert-app",
  VERDICT_DATE_PROPERTY: "otifOtShipmentEndDate",
};
/** A 7-day window ending mid-day (date-only bounds differ from the timestamps). */
export const W7: Window = { key: 7, start: "2026-09-17T10:30:00.000Z", end: "2026-09-24T10:30:00.000Z" };
/** The "now" window: no lower bound. */
export const WNOW: Window = { key: "now", start: null, end: "2026-09-24T10:30:00.000Z" };
/** No item filter. */
export const NO_FILTERS: ItemFilters = { businessLine: [], productLine: [], region: [], plant: [] };
/** Two non-empty dimensions. */
export const SOME_FILTERS: ItemFilters = { businessLine: ["BL1"], productLine: [], region: ["EU", "NA"], plant: [] };

/** A context with a fresh signal, a progress log and the given config overrides. */
export function makeCtx(overrides: Partial<MetricsConfig> = {}): SourceCtx & {
  controller: AbortController;
  progress: Progress[];
} {
  const controller = new AbortController();
  const progress: Progress[] = [];
  return {
    controller,
    progress,
    signal: controller.signal,
    onProgress: (p) => progress.push(p),
    config: { ...TEST_CONFIG, ...overrides },
  };
}

/** A recording client and the OSDK source over it. */
export function setup(): RecordingClient & { source: MetricsSource } {
  const rc = createRecordingClient();
  return { ...rc, source: createOsdkSource({ client: rc.client, sdk }) };
}
