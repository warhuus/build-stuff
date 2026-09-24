/**
 * Error normalisation (shared layer). Instructions §4 `shared/errors.ts`, §7 ("never throws: errors become
 * `status: "error"` with a message"). Abort errors use the platform `DOMException` name `AbortError`.
 */
import type { MetricResult, Window } from "../types";

/**
 * Whether a thrown value is an abort (a `DOMException`/`Error` or any object whose `name` is `AbortError`).
 * @param e any thrown value.
 * @returns true for aborts; false otherwise (including null/undefined).
 */
export function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && "name" in e && e.name === "AbortError";
}

/**
 * A fresh abort error, as rejected by the port and the shared helpers when a signal aborts.
 * @returns a `DOMException` named `AbortError` (empty message; `errorMessage` then reports the name).
 */
export function abortError(): DOMException {
  return new DOMException(undefined, "AbortError");
}

/**
 * Rejects with `abortError()` when the signal has aborted (call between pages, batches or waits).
 * @param signal optional signal; absent = never aborted.
 * @returns nothing; throws the abort error when aborted.
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

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
