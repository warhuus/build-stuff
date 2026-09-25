// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Instructions §5 rules 1–2 and §10 size limits, checked on the delivered source.
const SRC = fileURLToPath(new URL("../../../", import.meta.url));
const M = join("data", "metrics") + sep;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = ["config", join("data", "metrics")]
  .flatMap((r) => walk(join(SRC, r)))
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))
  .map((f) => ({ rel: relative(SRC, f), abs: f, text: readFileSync(f, "utf8") }));

/** Layer rank per instructions §5.1; source adapters sit beside the port. */
function rankOf(rel: string): number {
  const p = rel.startsWith(M) ? rel.slice(M.length).split(sep).join("/") : rel.split(sep).join("/");
  if (rel.startsWith("config")) return 0;
  if (/^(types|outputTypes|rowTypes|rawTypes)\.ts$/.test(p)) return 1;
  if (/^(compute|query)\//.test(p) || /^(window|selection|breakdowns)\.ts$/.test(p)) return 2;
  if (p === "source/MetricsSource.ts" || p === "source/batching.ts") return 3;
  if (/^source\/(osdk|fake)\//.test(p)) return 3.5;
  if (p.startsWith("shared/")) return 4;
  if (p.startsWith("loaders/")) return 5;
  if (p === "catalogue.ts") return 6;
  if (p === "loadCard.ts") return 7;
  if (p.startsWith("hooks/")) return 8;
  if (p === "index.ts") return 9;
  return -1;
}

const localImports = (f: { abs: string; text: string }): string[] =>
  [...f.text.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)].map((m) =>
    relative(SRC, resolve(dirname(f.abs), m[1])).replace(/(\.tsx?)?$/, ".ts"),
  );

describe("layering (instructions §5.1)", () => {
  it("places every delivered file in a layer", () => {
    expect(files.filter((f) => rankOf(f.rel) < 0).map((f) => f.rel)).toEqual([]);
  });

  it("imports only flow downward", () => {
    const bad: string[] = [];
    for (const f of files) {
      const own = rankOf(f.rel);
      for (const target of localImports(f)) {
        const t = rankOf(target);
        const adapter = t === 3.5 && !/source[/\\](osdk|fake)/.test(f.rel);
        const allowedAdapter = /hooks[/\\]MetricsSourceContext\.ts$|metrics[/\\]index\.ts$/.test(f.rel);
        if (adapter && !allowedAdapter) bad.push(`${f.rel} -> ${target} (adapter)`);
        else if (!adapter && t > own && !(own === 3.5 && t <= 3.5)) bad.push(`${f.rel} -> ${target}`);
        if (t === 8 && own !== 8 && own !== 9) bad.push(`${f.rel} -> ${target} (hooks)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("keeps property apiNames and link names inside source/osdk (config: V7 only)", () => {
    const API_NAMES = [
      "businessLineName", "productLineName", "iscRegionName", "plantCode", "salesOrderItemCreationDate",
      "actualGiDate", "plannedGiDate", "currentGiDate", "otifScore", "otifStatus", "initOtifClassification",
      "critClassification", "officialExclusionOtif", "officialExclusionCrit", "otifOrderId", "appId", "userId",
      "eventActor", "historyEventId", "otifContributionScore", "alertTypeId", "allocationSuppressed",
      "salesOrder_1", "alertHistory", "orderFulfillmentAlerts", "sourceSalesOrder", "historyEvents",
      "otifEvaluation",
    ];
    const bad = files
      .filter((f) => !f.rel.includes(`${sep}source${sep}osdk${sep}`))
      .flatMap((f) => {
        const code = f.text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
        return API_NAMES.filter((n) => new RegExp(`["'\`]${n}["'\`]`).test(code)).map((n) => `${f.rel}: ${n}`);
      });
    expect(bad).toEqual([]);
  });
});

describe("size limits (instructions §10)", () => {
  it("no function is longer than 40 lines", () => {
    const long: string[] = [];
    for (const f of files) {
      const sf = ts.createSourceFile(f.abs, f.text, ts.ScriptTarget.ES2020, true);
      const visit = (node: ts.Node): void => {
        if (ts.isFunctionLike(node) && "body" in node && node.body) {
          const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
          const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
          if (end - start + 1 > 40) long.push(`${f.rel}:${start + 1} (${end - start + 1} lines)`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(long).toEqual([]);
  });

  it("no loader file is longer than 150 lines", () => {
    const long = files
      .filter((f) => f.rel.includes(`${sep}loaders${sep}`))
      .filter((f) => f.text.split("\n").length > 150)
      .map((f) => f.rel);
    expect(long).toEqual([]);
  });
});
