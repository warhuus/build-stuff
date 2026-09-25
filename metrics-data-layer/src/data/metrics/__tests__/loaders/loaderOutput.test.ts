import { describe, expect, it } from "vitest";
import { loaderOutput } from "../../loaders/loaderOutput";

const ok = { rows: [], capped: false };
const capped = { rows: [], capped: true };

describe("loaderOutput (D11, L6, instructions §5 rule 5)", () => {
  it("ok without fetches or flags; null fetches skipped", () => {
    expect(loaderOutput(1)).toEqual({ raw: 1, status: "ok", caveats: [] });
    expect(loaderOutput(1, [ok, null])).toEqual({ raw: 1, status: "ok", caveats: [] });
  });
  it("any capped fetch → partial + row-cap (e.g. only itemsById)", () => {
    expect(loaderOutput(1, [ok, null, capped])).toEqual({ raw: 1, status: "partial", caveats: ["row-cap"] });
  });
  it("not-worked-window-cap → partial; caveats in config order; never truncated (derive's, MOD-02)", () => {
    expect(loaderOutput(1, [ok], { notWorkedWindowCap: true })).toEqual({
      raw: 1,
      status: "partial",
      caveats: ["not-worked-window-cap"],
    });
    expect(loaderOutput(1, [capped], { notWorkedWindowCap: true }).caveats).toEqual(["not-worked-window-cap", "row-cap"]);
  });
});
