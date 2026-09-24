import { describe, expect, it } from "vitest";
import { CAVEAT_ORDER } from "../../../../config/metrics";
import { mergeCaveats } from "../../compute/caveats";

describe("mergeCaveats", () => {
  it("returns [] for no lists and for empty lists", () => {
    expect(mergeCaveats()).toEqual([]);
    expect(mergeCaveats([], [])).toEqual([]);
  });
  it("de-duplicates and orders by CAVEAT_ORDER regardless of input order", () => {
    expect(mergeCaveats(["row-cap", "no-source"], ["truncated", "no-source"], ["proxy"])).toEqual([
      "no-source",
      "proxy",
      "truncated",
      "row-cap",
    ]);
  });
  it("keeps every code of the full list in config order", () => {
    expect(mergeCaveats([...CAVEAT_ORDER].reverse())).toEqual([...CAVEAT_ORDER]);
  });
});
