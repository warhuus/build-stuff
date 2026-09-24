import { describe, expect, it } from "vitest";
import { clampNonNegative, fraction, remainder, safeDivide, sum, sumBy, sumNullable } from "../../compute/stats";

describe("safeDivide / fraction", () => {
  it("divides", () => {
    expect(safeDivide(1, 4)).toBe(0.25);
    expect(fraction(3, 4)).toBe(0.75);
  });
  it("gives null on a zero denominator", () => {
    expect(safeDivide(5, 0)).toBeNull();
    expect(fraction(0, 0)).toBeNull();
  });
  it("gives null on a null operand", () => {
    expect(safeDivide(null, 2)).toBeNull();
    expect(safeDivide(2, null)).toBeNull();
    expect(fraction(null, null)).toBeNull();
  });
  it("allows a zero numerator", () => {
    expect(safeDivide(0, 3)).toBe(0);
  });
});

describe("sums", () => {
  it("sum / sumBy of empty and non-empty lists", () => {
    expect(sum([])).toBe(0);
    expect(sum([1, 2, 3.5])).toBe(6.5);
    expect(sumBy([], (row: { n: number }) => row.n)).toBe(0);
    expect(sumBy([{ n: 2 }, { n: 5 }], (row) => row.n)).toBe(7);
  });
  it("sumNullable skips nulls and is null when nothing is present", () => {
    expect(sumNullable([])).toBeNull();
    expect(sumNullable([null, null])).toBeNull();
    expect(sumNullable([1, null, 2])).toBe(3);
  });
  it("clampNonNegative and remainder never go below 0", () => {
    expect(clampNonNegative(-3)).toBe(0);
    expect(clampNonNegative(4)).toBe(4);
    expect(remainder(10, [3, 4])).toBe(3);
    expect(remainder(5, [3, 4])).toBe(0);
    expect(remainder(5, [])).toBe(5);
  });
});
