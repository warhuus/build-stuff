/** Test helper for the scan tests (structure, layering, config): the delivered source tree, read once. */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Absolute path of `src/` (ends with a separator). */
export const SRC = fileURLToPath(new URL("../../../../", import.meta.url));
/** `data/metrics/` relative to SRC. */
export const METRICS = join("data", "metrics") + sep;
/** `data/metrics/source/osdk/` relative to SRC. */
export const OSDK_DIR = join("data", "metrics", "source", "osdk") + sep;

/** Every file below `dir`. */
export function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** One scanned file: path relative to SRC, absolute path, text and parsed AST. */
export interface ScannedFile {
  readonly rel: string;
  readonly abs: string;
  readonly text: string;
  readonly ast: ts.SourceFile;
}

const scan = (abs: string): ScannedFile => {
  const text = readFileSync(abs, "utf8");
  return { rel: relative(SRC, abs), abs, text, ast: ts.createSourceFile(abs, text, ts.ScriptTarget.ES2020, true) };
};

/** Every .ts/.tsx file of the delivered roots (config, data/metrics), tests included. */
export const DELIVERED: readonly ScannedFile[] = ["config", join("data", "metrics")]
  .flatMap((r) => walk(join(SRC, r)))
  .filter((f) => /\.tsx?$/.test(f))
  .map(scan);

/** The delivered production files (no `__tests__`). */
export const PRODUCTION: readonly ScannedFile[] = DELIVERED.filter((f) => !f.rel.includes("__tests__"));

/** Every module specifier of a file: static imports/exports, `import()`, `typeof import()` and `require`. */
export function specifiersOf(f: ScannedFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
        out.push(node.arguments[0].text);
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      out.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(f.ast);
  return out;
}

/** Strips a `.js`/`.ts`/`.tsx` extension and a trailing `/index` from a specifier. */
export const normalizeSpecifier = (s: string): string => s.replace(/\.(js|mjs|ts|tsx)$/, "").replace(/\/index$/, "");

/**
 * A relative specifier resolved to a path relative to SRC (`.ts`, `.tsx` or `/index.ts`), or the unresolved
 * normalised path when no file exists (the caller flags it as unranked).
 */
export function resolveLocal(f: ScannedFile, spec: string): string {
  const base = resolve(dirname(f.abs), normalizeSpecifier(spec));
  const hit = [".ts", ".tsx", `${sep}index.ts`].map((e) => base + e).find((p) => existsSync(p));
  return relative(SRC, hit ?? base);
}
