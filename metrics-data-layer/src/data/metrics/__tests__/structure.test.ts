// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Acceptance checks from instructions §14 that scan the delivered source tree.
const SRC = fileURLToPath(new URL("../../../", import.meta.url));
const DELIVERED_ROOTS = ["config", join("data", "metrics")];
const OSDK_DIR = join("data", "metrics", "source", "osdk") + sep;
const MAX_LINES = 250;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = DELIVERED_ROOTS.flatMap((r) => walk(join(SRC, r)))
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/(structure|layering)\.test\.ts$/.test(f))
  .map((f) => ({ rel: relative(SRC, f), text: readFileSync(f, "utf8") }));
const productionFiles = files.filter((f) => !f.rel.includes("__tests__"));

const importsOf = (text: string): string[] =>
  [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

describe("delivered source structure", () => {
  it("finds the delivered files", () => {
    expect(productionFiles.length).toBeGreaterThan(20);
  });

  it("only source/osdk imports @osdk/client, @app/sdk or the client module", () => {
    const offenders = productionFiles
      .filter((f) => !f.rel.startsWith(OSDK_DIR))
      .filter((f) => importsOf(f.text).some((p) => p.startsWith("@osdk/") || p === "@app/sdk" || /(^|\/)client(\.ts)?$/.test(p)))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it(`no file in src exceeds ${MAX_LINES} lines`, () => {
    const all = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
    const long = all
      .map((f) => ({ rel: relative(SRC, f), lines: readFileSync(f, "utf8").split("\n").length }))
      .filter((f) => f.lines > MAX_LINES);
    expect(long).toEqual([]);
  });

  it("uses no withProperties, no console and no any outside the OSDK boundary", () => {
    const bad: string[] = [];
    for (const f of files) {
      const code = f.text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/withProperties/.test(code) && !f.rel.includes("__tests__")) bad.push(`${f.rel}: withProperties`);
      if (/\bconsole\./.test(code)) bad.push(`${f.rel}: console`);
      const anyUse = /(:\s*any\b|<any>|\bas any\b|any\[\])/.test(code);
      if (anyUse && !f.rel.startsWith(OSDK_DIR)) bad.push(`${f.rel}: any`);
      if (/as unknown as|@ts-ignore|@ts-expect-error/.test(f.text)) bad.push(`${f.rel}: unsafe cast or ts directive`);
    }
    expect(bad).toEqual([]);
  });

  it("marks every any in source/osdk with an OSDK boundary comment", () => {
    const bad = productionFiles
      .filter((f) => f.rel.startsWith(OSDK_DIR))
      .flatMap((f) =>
        f.text.split("\n").flatMap((line, i, lines) => {
          const code = line.replace(/\/\/.*$/, "");
          if (!/(:\s*any\b|<any>|\bas any\b|any\[\])/.test(code)) return [];
          const marked = line.includes("OSDK boundary:") || (lines[i - 1] ?? "").includes("OSDK boundary:");
          return marked ? [] : [`${f.rel}:${i + 1}`];
        }),
      );
    expect(bad).toEqual([]);
  });

  it("has no default exports and no TODO or eslint-disable outside the allowed rule", () => {
    const bad: string[] = [];
    for (const f of productionFiles) {
      if (/export\s+default\b/.test(f.text)) bad.push(`${f.rel}: default export`);
      if (/\bTODO\b/.test(f.text)) bad.push(`${f.rel}: TODO`);
      for (const m of f.text.matchAll(/eslint-disable[^\n]*/g)) {
        if (!/react-hooks\/exhaustive-deps\s+--\s+\S/.test(m[0])) bad.push(`${f.rel}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("keeps compute/ free of I/O, clocks and randomness", () => {
    const bad = productionFiles
      .filter((f) => f.rel.includes(`${sep}compute${sep}`))
      .filter((f) => /Date\.now\(|new Date\(\)|Math\.random\(|from ["']react["']|fetch\(/.test(f.text))
      .map((f) => f.rel);
    expect(bad).toEqual([]);
  });
});
