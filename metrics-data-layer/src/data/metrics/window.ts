/**
 * Time windows (pure layer: imports config and types only; importable by compute). Spec §10 `Window`,
 * instructions §8 item 2. Every timestamp in and out is an ISO-8601 UTC string; `now` is always a parameter.
 */
import { MS_PER_DAY, MS_PER_HOUR } from "../../config/metrics";
import type { Window, WindowKey } from "./types";

/**
 * Number of days a window key spans.
 * @param key window key.
 * @returns days back from now (7, 14, 30, 90), or `null` for `"now"` (no lower bound).
 */
export function windowDays(key: WindowKey): number | null {
  return key === "now" ? null : key;
}

/**
 * Resolves a window key against `now`. Instructions §8 item 2, spec §13 Window.
 * @param key window key.
 * @param now the load time (never read from a clock here).
 * @returns `end` = now (ISO); `start` = now − N days (ISO, exact milliseconds), `null` under `"now"`.
 */
export function resolveWindow(key: WindowKey, now: Date): Window {
  const days = windowDays(key);
  const end = now.getTime();
  return {
    key,
    start: days === null ? null : new Date(end - days * MS_PER_DAY).toISOString(),
    end: new Date(end).toISOString(),
  };
}

/**
 * UTC calendar date of a timestamp, for comparisons with date-only properties (instructions §8 item 2).
 * @param iso ISO-8601 timestamp (any offset; converted to UTC).
 * @returns `YYYY-MM-DD` of the UTC calendar day. Throws `RangeError` for an unparsable timestamp.
 */
export function toDateOnly(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Whether a timestamp lies in a window, both bounds inclusive (`start ≤ ts ≤ end`).
 * @param ts ISO-8601 timestamp; `null` or unparsable → false.
 * @param window resolved window; `start: null` means no lower bound.
 * @returns true when inside the window.
 */
export function inWindow(ts: string | null, window: Window): boolean {
  if (ts === null) return false;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return false;
  if (window.start !== null && t < Date.parse(window.start)) return false;
  return t <= Date.parse(window.end);
}

/**
 * Signed elapsed time between two timestamps.
 * @param fromIso start timestamp (ISO).
 * @param toIso end timestamp (ISO).
 * @returns hours (fractional, negative when `toIso` precedes `fromIso`); `null` when either is null or unparsable.
 */
export function hoursBetween(fromIso: string | null, toIso: string | null): number | null {
  const ms = msBetween(fromIso, toIso);
  return ms === null ? null : ms / MS_PER_HOUR;
}

/**
 * Signed elapsed time between two timestamps.
 * @param fromIso start timestamp (ISO).
 * @param toIso end timestamp (ISO).
 * @returns days (fractional, negative when `toIso` precedes `fromIso`); `null` when either is null or unparsable.
 */
export function daysBetween(fromIso: string | null, toIso: string | null): number | null {
  const ms = msBetween(fromIso, toIso);
  return ms === null ? null : ms / MS_PER_DAY;
}

function msBetween(fromIso: string | null, toIso: string | null): number | null {
  if (fromIso === null || toIso === null) return null;
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Number.isNaN(ms) ? null : ms;
}
