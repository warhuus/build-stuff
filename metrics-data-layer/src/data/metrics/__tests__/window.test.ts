import { describe, expect, it } from "vitest";
import { daysBetween, hoursBetween, inWindow, resolveWindow, toDateOnly, windowDays } from "../window";

const NOW = new Date("2026-09-24T10:30:00.000Z");

describe("resolveWindow (spec §13 Window)", () => {
  it("gives start = end − 7 days for 7", () => {
    const w = resolveWindow(7, NOW);
    expect(w).toEqual({ key: 7, start: "2026-09-17T10:30:00.000Z", end: "2026-09-24T10:30:00.000Z" });
    expect(Date.parse(w.end) - Date.parse(w.start ?? "")).toBe(7 * 86_400_000);
  });

  it("resolves 14, 30 and 90 days back", () => {
    expect(resolveWindow(14, NOW).start).toBe("2026-09-10T10:30:00.000Z");
    expect(resolveWindow(30, NOW).start).toBe("2026-08-25T10:30:00.000Z");
    expect(resolveWindow(90, NOW).start).toBe("2026-06-26T10:30:00.000Z");
  });

  it('gives start null under "now"', () => {
    expect(resolveWindow("now", NOW)).toEqual({ key: "now", start: null, end: "2026-09-24T10:30:00.000Z" });
  });

  it("does not mutate now", () => {
    const now = new Date(NOW.getTime());
    resolveWindow(30, now);
    expect(now.getTime()).toBe(NOW.getTime());
  });

  it("windowDays maps keys to days", () => {
    expect(windowDays("now")).toBeNull();
    expect(windowDays(90)).toBe(90);
  });
});

describe("toDateOnly", () => {
  it("returns the UTC calendar date", () => {
    expect(toDateOnly("2026-09-24T23:59:59.999Z")).toBe("2026-09-24");
    expect(toDateOnly("2026-09-25T00:30:00+02:00")).toBe("2026-09-24");
    expect(toDateOnly("2026-01-01T00:00:00.000Z")).toBe("2026-01-01");
  });

  it("throws on an unparsable timestamp", () => {
    expect(() => toDateOnly("not a date")).toThrow(RangeError);
  });
});

describe("inWindow", () => {
  const w = resolveWindow(7, NOW);
  it("includes both bounds", () => {
    expect(inWindow(w.end, w)).toBe(true);
    expect(inWindow(w.start, w)).toBe(true);
    expect(inWindow("2026-09-20T00:00:00Z", w)).toBe(true);
  });

  it("excludes timestamps outside", () => {
    expect(inWindow("2026-09-17T10:29:59.999Z", w)).toBe(false);
    expect(inWindow("2026-09-24T10:30:00.001Z", w)).toBe(false);
  });

  it('has no lower bound under "now"', () => {
    const n = resolveWindow("now", NOW);
    expect(inWindow("2000-01-01T00:00:00Z", n)).toBe(true);
    expect(inWindow("2026-09-25T00:00:00Z", n)).toBe(false);
  });

  it("is false for null or unparsable timestamps", () => {
    expect(inWindow(null, w)).toBe(false);
    expect(inWindow("garbage", w)).toBe(false);
  });
});

describe("hoursBetween / daysBetween", () => {
  it("returns signed fractional hours and days", () => {
    expect(hoursBetween("2026-09-24T00:00:00Z", "2026-09-24T01:30:00Z")).toBe(1.5);
    expect(hoursBetween("2026-09-24T01:00:00Z", "2026-09-24T00:00:00Z")).toBe(-1);
    expect(daysBetween("2026-09-20T00:00:00Z", "2026-09-24T12:00:00Z")).toBe(4.5);
  });

  it("returns null for null or unparsable input", () => {
    expect(hoursBetween(null, "2026-09-24T00:00:00Z")).toBeNull();
    expect(daysBetween("2026-09-24T00:00:00Z", null)).toBeNull();
    expect(hoursBetween("x", "2026-09-24T00:00:00Z")).toBeNull();
  });
});
