/**
 * The one abort helper of the data layer (instructions §5 rule 6, §7; spec §9.0 `fetchAllPages` "check
 * signal.aborted"). Used by the source adapters (osdk, fake) and re-exported by `shared/errors.ts`, so every
 * abort, wherever it is raised, is the same `DOMException` named `AbortError` with the same message. Pure: it
 * only builds and inspects values (no I/O, no clock).
 */

/** The single abort message; `errorMessage` reports it, so `MetricResult.error` reads the same everywhere. */
const ABORT_MESSAGE = "aborted";

/**
 * A fresh abort error, as rejected by the port, the shared helpers and the caches when a signal aborts.
 * @returns a `DOMException` named `AbortError` with the message `"aborted"`.
 */
export function abortError(): DOMException {
  return new DOMException(ABORT_MESSAGE, "AbortError");
}

/**
 * Whether a thrown value is an abort (a `DOMException`/`Error` or any object whose `name` is `AbortError`).
 * @param e any thrown value.
 * @returns true for aborts; false otherwise (including null/undefined and plain strings).
 */
export function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && "name" in e && e.name === "AbortError";
}

/**
 * Throws `abortError()` when the signal has aborted (call before every page, chunk, batch or wait).
 * @param signal optional signal; absent (undefined) = never aborted, so nothing is thrown.
 * @returns nothing; throws the abort error when aborted.
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortError();
}
