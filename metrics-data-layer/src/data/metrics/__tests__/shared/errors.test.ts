import { describe, expect, it } from "vitest";
import { resolveWindow } from "../../window";
import { abortError, errorMessage, isAbortError, throwIfAborted, toErrorResult } from "../../shared/errors";

describe("errors", () => {
  it("isAbortError recognises abort errors only", () => {
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(true);
    expect(isAbortError(new Error("x"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });

  it("throwIfAborted", () => {
    const c = new AbortController();
    expect(() => throwIfAborted(c.signal)).not.toThrow();
    expect(() => throwIfAborted(undefined)).not.toThrow();
    c.abort();
    expect(() => throwIfAborted(c.signal)).toThrow(expect.objectContaining({ name: "AbortError" }));
  });

  it("errorMessage normalises any thrown value", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(new TypeError(""))).toBe("TypeError");
    expect(errorMessage(abortError())).toBe("aborted");
    expect(errorMessage("breakdown-not-allowed")).toBe("breakdown-not-allowed");
    expect(errorMessage({ message: "from object" })).toBe("from object");
    expect(errorMessage({ message: 3 })).toBe("[object Object]");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("toErrorResult builds the MetricResult error shape", () => {
    const window = resolveWindow(7, new Date("2026-09-24T00:00:00Z"));
    expect(toErrorResult<number>(new Error("x"), window, "2026-09-24T00:00:00.000Z")).toEqual({
      status: "error",
      error: "x",
      caveats: [],
      window,
      computedAt: "2026-09-24T00:00:00.000Z",
    });
  });
});
