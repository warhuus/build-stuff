import { describe, expect, it } from "vitest";
import { abortError, isAbortError, throwIfAborted } from "../../compute/abort";
import * as errors from "../../shared/errors";

describe("compute/abort (one abort helper for source and shared)", () => {
  it("abortError is a DOMException named AbortError with the one message", () => {
    const e = abortError();
    expect(e).toBeInstanceOf(DOMException);
    expect(e).toMatchObject({ name: "AbortError", message: "aborted" });
    expect(isAbortError(e)).toBe(true);
  });

  it("throwIfAborted throws only for an aborted signal", () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
    expect(() => throwIfAborted(AbortSignal.abort())).toThrow(expect.objectContaining({ name: "AbortError" }));
  });

  it("shared/errors re-exports the same functions", () => {
    expect(errors.abortError).toBe(abortError);
    expect(errors.isAbortError).toBe(isAbortError);
    expect(errors.throwIfAborted).toBe(throwIfAborted);
  });
});
