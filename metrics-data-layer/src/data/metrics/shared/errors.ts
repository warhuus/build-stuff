/**
 * Error normalisation (shared layer). Instructions §4 `shared/errors.ts`, §7 ("never throws: errors become
 * `status: "error"` with a message"). Abort errors use the platform `DOMException` name `AbortError` and the
 * one message of `compute/abort.ts`.
 */
import type { MetricResult, Window } from "../types";

/**
 * The abort helpers (`abortError`, `isAbortError`, `throwIfAborted`), defined once in `compute/abort.ts` so
 * the source adapters (which may not import `shared/`) raise the same error. Re-exported for shared callers.
 */
export { abortError, isAbortError, throwIfAborted } from "../compute/abort";

/**
 * A human-readable message for any thrown value.
 * @param e any thrown value.
 * @returns `Error.message` (its `name` when the message is empty), a string as is, an object's string
 * `message` property, else `String(e)`.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error || e instanceof DOMException) return e.message !== "" ? e.message : e.name;
  if (typeof e === "string") return e;
  if (typeof e === "object" && e !== null && "message" in e && typeof e.message === "string") return e.message;
  return String(e);
}

/**
 * The `MetricResult` error shape (spec §10): `status: "error"`, message, no caveats, the resolved window.
 * @param e any thrown value, or the error message itself (e.g. `BREAKDOWN_NOT_ALLOWED`).
 * @param window resolved window of the request.
 * @param computedAt ISO timestamp of the failure (the caller's `now`).
 * @returns the error result; carries no `data`.
 */
export function toErrorResult<T>(e: unknown, window: Window, computedAt: string): MetricResult<T> {
  return { status: "error", error: errorMessage(e), caveats: [], window, computedAt };
}
