// @vitest-environment node
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { DELIVERED, OSDK_DIR, PRODUCTION, SRC, normalizeSpecifier, resolveLocal, specifiersOf, walk } from "./helpers/sourceTree";
import type { ScannedFile } from "./helpers/sourceTree";

// Acceptance checks from instructions §14 that scan the delivered source tree (hardened in phase 4, STR-03).
const MAX_LINES = 250;
const SCANNERS = /(structure|layering|config)\.test\.ts$/;
const scanned = DELIVERED.filter((f) => !SCANNERS.test(f.rel));

/** Line numbers (1-based) of every node of a file matching `pick`. */
function linesWhere(f: ScannedFile, pick: (n: ts.Node) => boolean): number[] {
  const out: number[] = [];
  const visit = (node: ts.Node): void => {
    if (pick(node)) out.push(f.ast.getLineAndCharacterOfPosition(node.getStart(f.ast)).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(f.ast);
  return out;
}

const isAny = (n: ts.Node): boolean => n.kind === ts.SyntaxKind.AnyKeyword;

/** True when the specifier names the OSDK client, the SDK or the host client module (any spelling). */
function isClientImport(f: ScannedFile, spec: string): boolean {
  const s = normalizeSpecifier(spec);
  if (s.startsWith("@osdk/") || s === "@app/sdk" || s.startsWith("@app/sdk/")) return true;
  if (!s.startsWith(".")) return false;
  const target = resolveLocal(f, spec).replace(/\.tsx?$/, "").split(sep).join("/");
  return target === "client" || target === "client/index";
}

/** Default exports: `export default`, `export =`, `export { x as default }`, `export { default } from`. */
function defaultExportLines(f: ScannedFile): number[] {
  return linesWhere(f, (n) => {
    if (ts.isExportAssignment(n)) return true;
    if (ts.isExportSpecifier(n)) return n.name.text === "default";
    if (!ts.canHaveModifiers(n)) return false;
    const mods = ts.getModifiers(n) ?? [];
    return mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) && mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  });
}

describe("delivered source structure", () => {
  it("finds the delivered files", () => {
    expect(PRODUCTION.length).toBeGreaterThan(20);
  });

  it("only source/osdk imports @osdk/client, @app/sdk or the client module (any spelling)", () => {
    const offenders = PRODUCTION.filter((f) => !f.rel.startsWith(OSDK_DIR))
      .flatMap((f) => specifiersOf(f).filter((s) => isClientImport(f, s)).map((s) => `${f.rel}: ${s}`));
    expect(offenders).toEqual([]);
  });

  it("the client-import check recognises every spelling (self-test)", () => {
    const at = PRODUCTION.find((f) => f.rel.endsWith(`metrics${sep}index.ts`));
    if (at === undefined) throw new Error("index.ts not found");
    for (const s of ["../../client", "../../client.js", "../../client.ts", "@osdk/client", "@osdk/api", "@app/sdk"]) {
      expect(isClientImport(at, s), s).toBe(true);
    }
    expect(isClientImport(at, "./catalogue")).toBe(false);
  });

  it(`no file in src exceeds ${MAX_LINES} lines`, () => {
    const long = walk(SRC)
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => ({ rel: relative(SRC, f), lines: readFileSync(f, "utf8").split("\n").length }))
      .filter((f) => f.lines > MAX_LINES);
    expect(long).toEqual([]);
  });

  it("uses no withProperties, no console and no unsafe casts or ts directives", () => {
    const bad: string[] = [];
    for (const f of scanned) {
      const code = f.text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/withProperties/.test(code) && !f.rel.includes("__tests__")) bad.push(`${f.rel}: withProperties`);
      if (/\bconsole\./.test(code)) bad.push(`${f.rel}: console`);
      if (/as unknown as|@ts-ignore|@ts-expect-error|@ts-nocheck/.test(f.text)) bad.push(`${f.rel}: unsafe cast or ts directive`);
    }
    expect(bad).toEqual([]);
  });

  it("has no `any` (AST: annotations, generics, aliases, returns, casts) outside the OSDK boundary", () => {
    const bad = scanned
      .filter((f) => !f.rel.startsWith(OSDK_DIR))
      .flatMap((f) => linesWhere(f, isAny).map((l) => `${f.rel}:${l}`));
    expect(bad).toEqual([]);
  });

  it("the any scan sees generic, alias and return-position uses (self-test)", () => {
    const text = "type A = any;\nconst m: Map<string, any> = new Map();\nfunction f(): any { return 1; }\nconst g = (x: number) => x as any;\n";
    const probe = { rel: "probe.ts", abs: "probe.ts", text, ast: ts.createSourceFile("probe.ts", text, ts.ScriptTarget.ES2020, true) };
    expect(linesWhere(probe, isAny)).toEqual([1, 2, 3, 4]);
  });

  it("marks every any in source/osdk with an OSDK boundary comment", () => {
    const bad = PRODUCTION.filter((f) => f.rel.startsWith(OSDK_DIR)).flatMap((f) => {
      const lines = f.text.split("\n");
      return linesWhere(f, isAny)
        .filter((l) => !lines[l - 1].includes("OSDK boundary:") && !(lines[l - 2] ?? "").includes("OSDK boundary:"))
        .map((l) => `${f.rel}:${l}`);
    });
    expect(bad).toEqual([]);
  });

  it("has no default exports (any form) and no TODO or eslint-disable outside the allowed rule", () => {
    const bad: string[] = [];
    for (const f of PRODUCTION) {
      for (const l of defaultExportLines(f)) bad.push(`${f.rel}:${l}: default export`);
      if (/\bTODO\b/.test(f.text)) bad.push(`${f.rel}: TODO`);
      for (const m of f.text.matchAll(/eslint-disable[^\n]*/g)) {
        if (!/react-hooks\/exhaustive-deps\s+--\s+\S/.test(m[0])) bad.push(`${f.rel}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the default-export scan sees every form (self-test)", () => {
    const text = "export default 1;\nconst x = 1;\nexport { x as default };\nexport default function f() {}\nexport { default } from './m';\n";
    const probe = { rel: "p.ts", abs: "p.ts", text, ast: ts.createSourceFile("p.ts", text, ts.ScriptTarget.ES2020, true) };
    expect(defaultExportLines(probe)).toEqual([1, 3, 4, 5]);
  });
});
