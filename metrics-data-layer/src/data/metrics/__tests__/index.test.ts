import { describe, expect, it } from "vitest";
import * as api from "../index";

describe("public barrel (instructions §7)", () => {
  it("exports exactly the listed values", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "CARDS",
        "CAVEAT_TEXT",
        "DEFAULT_SELECTION",
        "MetricsSourceProvider",
        "allowedBreakdowns",
        "clearMetricsCache",
        "isAdditive",
        "isBreakdownAllowed",
        "loadCard",
        "parseSelection",
        "serializeSelection",
        "useMetric",
        "useMetricsSelection",
      ].sort(),
    );
  });
});
