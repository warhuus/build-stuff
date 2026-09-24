import { describe, expect, it } from "vitest";
import {
  cacheKey,
  DEFAULT_SELECTION,
  EMPTY_FILTERS,
  filtersKey,
  hasFilters,
  mergeSelectionParams,
  normalizeFilterValues,
  normalizeSelection,
  parseSelection,
  serializeSelection,
  toThresholdDays,
} from "../selection";
import type { Selection } from "../types";

const FULL: Selection = {
  window: "now",
  unit: "valueUsd",
  view: "alert",
  filters: { businessLine: ["b", "a"], productLine: ["p"], region: ["EU", "EU"], plant: ["x,y", "1"] },
  otifMode: "crit",
  ageingThresholdDays: 45,
};

describe("DEFAULT_SELECTION", () => {
  it("matches instructions §7", () => {
    expect(DEFAULT_SELECTION).toEqual({
      window: 30,
      unit: "count",
      view: "item",
      filters: { businessLine: [], productLine: [], region: [], plant: [] },
      otifMode: "otif",
      ageingThresholdDays: 30,
    });
  });
});

describe("normalizeSelection", () => {
  it("fills every missing field with its default", () => {
    expect(normalizeSelection({})).toEqual(DEFAULT_SELECTION);
  });

  it("falls back per field on invalid values", () => {
    const s = normalizeSelection({
      window: 60,
      unit: "eur",
      view: "user",
      filters: { businessLine: "a", region: [1, "", "r"] },
      otifMode: "OTIF",
      ageingThresholdDays: 12.5,
    });
    expect(s).toEqual({ ...DEFAULT_SELECTION, filters: { ...EMPTY_FILTERS, region: ["r"] } });
  });

  it("sorts and de-duplicates filters", () => {
    expect(normalizeSelection(FULL).filters).toEqual({
      businessLine: ["a", "b"],
      productLine: ["p"],
      region: ["EU"],
      plant: ["1", "x,y"],
    });
    expect(normalizeFilterValues(["b", "a", "b", "B"])).toEqual(["B", "a", "b"]);
  });

  it("accepts thresholds 1..365 integers only", () => {
    expect(toThresholdDays(1)).toBe(1);
    expect(toThresholdDays(365)).toBe(365);
    expect(toThresholdDays(0)).toBeNull();
    expect(toThresholdDays(366)).toBeNull();
    expect(toThresholdDays("30")).toBeNull();
    expect(toThresholdDays(Number.NaN)).toBeNull();
  });
});

describe("URL parse / serialise (instructions §7, X7)", () => {
  it("omits every default", () => {
    expect(serializeSelection(DEFAULT_SELECTION).toString()).toBe("");
  });

  it("uses short keys and repeated params", () => {
    expect(serializeSelection(FULL).toString()).toBe(
      "w=now&u=valueUsd&v=alert&bl=a&bl=b&pl=p&rg=EU&pt=1&pt=x%2Cy&om=crit&n=45",
    );
  });

  it("round-trips", () => {
    expect(parseSelection(serializeSelection(FULL))).toEqual(normalizeSelection(FULL));
    expect(parseSelection(serializeSelection(DEFAULT_SELECTION))).toEqual(DEFAULT_SELECTION);
    const seven = { ...DEFAULT_SELECTION, window: 7 as const };
    expect(parseSelection(serializeSelection(seven))).toEqual(seven);
  });

  it("parses repeated params into sorted arrays", () => {
    const s = parseSelection(new URLSearchParams("bl=z&bl=a&bl=z&w=90"));
    expect(s.filters.businessLine).toEqual(["a", "z"]);
    expect(s.window).toBe(90);
  });

  it("falls back to defaults on invalid values", () => {
    const s = parseSelection(new URLSearchParams("w=8&u=x&v=user&om=foo&n=0&bl="));
    expect(s).toEqual(DEFAULT_SELECTION);
    for (const n of ["abc", "-5", "1e2", "30.5", "400"]) {
      expect(parseSelection(new URLSearchParams(`n=${n}`)).ageingThresholdDays).toBe(30);
    }
    expect(parseSelection(new URLSearchParams("w=")).window).toBe(30);
  });

  it("ignores unknown params and takes the first scalar value", () => {
    expect(parseSelection(new URLSearchParams("foo=1&w=7&w=14")).window).toBe(7);
  });

  it("mergeSelectionParams keeps unrelated params and replaces ours", () => {
    const base = new URLSearchParams("tab=x&w=7&bl=old");
    const merged = mergeSelectionParams(base, { ...DEFAULT_SELECTION, unit: "valueUsd" });
    expect(merged.toString()).toBe("tab=x&u=valueUsd");
    expect(base.toString()).toBe("tab=x&w=7&bl=old");
  });
});

describe("filtersKey / hasFilters", () => {
  it("is dimension-qualified and canonical (D6)", () => {
    expect(filtersKey(EMPTY_FILTERS)).toBe("bl=;pl=;rg=;pt=");
    expect(filtersKey({ ...EMPTY_FILTERS, businessLine: ["b", "a", "a"], region: ["x"] })).toBe("bl=a,b;pl=;rg=x;pt=");
  });

  it("does not confuse dimensions or separators", () => {
    const a = filtersKey({ ...EMPTY_FILTERS, businessLine: ["a"] });
    const b = filtersKey({ ...EMPTY_FILTERS, productLine: ["a"] });
    expect(a).not.toBe(b);
    const c = filtersKey({ ...EMPTY_FILTERS, plant: ["a,b"] });
    const d = filtersKey({ ...EMPTY_FILTERS, plant: ["a", "b"] });
    expect(c).not.toBe(d);
  });

  it("hasFilters", () => {
    expect(hasFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasFilters({ ...EMPTY_FILTERS, plant: ["1"] })).toBe(true);
  });
});

describe("cacheKey (spec §11, D6)", () => {
  const base = normalizeSelection(FULL);
  it("excludes unit and threshold", () => {
    const other = { ...base, unit: "count" as const, ageingThresholdDays: 7 };
    for (const card of ["itemFunnel", "ageingBacklog", "riskDistribution"] as const) {
      expect(cacheKey(card, other, null)).toBe(cacheKey(card, base, null));
    }
  });

  it("section 1 excludes filters", () => {
    expect(cacheKey("userFunnel", { ...base, filters: EMPTY_FILTERS }, "queueFilter")).toBe(
      cacheKey("userFunnel", base, "queueFilter"),
    );
    expect(cacheKey("userFunnel", base, null)).toBe("userFunnel|w=now|b=");
  });

  it("includes filters on every other card, including 4.1 and 4.5", () => {
    for (const card of ["itemFunnel", "otifOutcome", "ageingBacklog", "closureComposition"] as const) {
      expect(cacheKey(card, { ...base, filters: EMPTY_FILTERS }, null)).not.toBe(cacheKey(card, base, null));
    }
  });

  it("includes view only for itemFunnel and otifMode only for otifOutcome", () => {
    const flip = { ...base, view: "item" as const, otifMode: "otif" as const };
    expect(cacheKey("itemFunnel", flip, null)).not.toBe(cacheKey("itemFunnel", base, null));
    expect(cacheKey("otifOutcome", flip, null)).not.toBe(cacheKey("otifOutcome", base, null));
    expect(cacheKey("riskDistribution", flip, null)).toBe(cacheKey("riskDistribution", base, null));
    expect(cacheKey("itemFunnel", base, "region")).toBe("itemFunnel|w=now|v=alert|f=bl=a,b;pl=p;rg=EU;pt=1,x%2Cy|b=region");
    expect(cacheKey("otifOutcome", DEFAULT_SELECTION, null)).toBe("otifOutcome|w=30|om=otif|f=bl=;pl=;rg=;pt=|b=");
  });

  it("includes window and breakdown", () => {
    expect(cacheKey("ageingBacklog", { ...base, window: 7 }, null)).not.toBe(cacheKey("ageingBacklog", base, null));
    expect(cacheKey("ageingBacklog", base, "plant")).not.toBe(cacheKey("ageingBacklog", base, null));
  });
});
