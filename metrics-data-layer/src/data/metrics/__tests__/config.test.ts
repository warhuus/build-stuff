// @vitest-environment node
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { BLOCKED_REASONS, CAVEATS, INTEGRATION_KEYS } from "../../../config/metricsCodes";
import { CARD_META, CAVEAT_TEXT, INTEGRATION_UNBLOCKED_BY } from "../../../config/metricsText";
import { CARDS } from "../catalogue";
import { stubBlocked } from "../loaders/blocked";
import { PRODUCTION, SRC } from "./helpers/sourceTree";

// Spec §13 "Config" rows and instructions §14 acceptance "Every caveat code used anywhere has text in
// CAVEAT_TEXT. Checked by a test" (TST-01 / STR-02).
const FILES = PRODUCTION.map((f) => f.abs);
const KNOWN: ReadonlySet<string> = new Set(Object.keys(CAVEAT_TEXT));
const isText = (s: unknown): boolean => typeof s === "string" && s.trim().length > 0;

describe("config texts (spec §13 Config)", () => {
  it("CAVEAT_TEXT has exactly the CAVEATS keys, each a non-empty sentence", () => {
    expect([...KNOWN].sort()).toEqual([...CAVEATS].sort());
    for (const c of CAVEATS) {
      expect(isText(CAVEAT_TEXT[c]), c).toBe(true);
      expect(CAVEAT_TEXT[c].trim().endsWith("."), c).toBe(true);
    }
  });

  it("every BlockedReason is a caveat code with text", () => {
    for (const r of BLOCKED_REASONS) expect(isText(CAVEAT_TEXT[r]), r).toBe(true);
  });

  it("INTEGRATION_UNBLOCKED_BY has a non-empty text for every integration key", () => {
    expect(Object.keys(INTEGRATION_UNBLOCKED_BY).sort()).toEqual([...INTEGRATION_KEYS].sort());
    for (const k of INTEGRATION_KEYS) expect(isText(INTEGRATION_UNBLOCKED_BY[k]), k).toBe(true);
  });

  it("the three stub cards (3.2, 3.3, 4.7) carry a reason, unblockedBy and known caveats", () => {
    const stubs = Object.values(CARD_META).filter((m) => m.stub !== null);
    expect(stubs.map((m) => m.id)).toEqual(["riskMovement", "riskCalibration", "rolledValue"]);
    for (const m of stubs) {
      const block = stubBlocked(m.id);
      expect(block, m.id).not.toBeNull();
      expect(isText(block?.unblockedBy), m.id).toBe(true);
      expect(BLOCKED_REASONS).toContain(block?.reason);
      expect(block?.caveats.every((c) => KNOWN.has(c)), m.id).toBe(true);
      expect(CARDS[m.id].stub?.unblockedBy).toBe(block?.unblockedBy);
    }
  });
});

/** String literals whose contextual type is a caveat-code union: every literal used as a caveat. */
function caveatLiterals(): { readonly where: string; readonly text: string }[] {
  const program = ts.createProgram(FILES, {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
    types: [],
    paths: { "@app/sdk": [join(SRC, "..", "stubs", "app-sdk", "index.ts")] },
  });
  const checker = program.getTypeChecker();
  // A caveat position: every string-literal member of the contextual type is a caveat code (so `Caveat`,
  // `BlockedReason` or a subset; not `Availability`, which merely shares "no-source").
  const inCaveatType = (t: ts.Type | undefined): boolean => {
    const literals = t === undefined ? [] : (t.isUnion() ? t.types : [t]).filter((u) => u.isStringLiteral());
    return literals.length > 0 && literals.every((u) => u.isStringLiteral() && KNOWN.has(u.value));
  };
  const found: { where: string; text: string }[] = [];
  for (const file of FILES) {
    const sf = program.getSourceFile(file);
    if (sf === undefined) throw new Error(`not in program: ${file}`);
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (inCaveatType(checker.getContextualType(node))) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          found.push({ where: `${file.slice(SRC.length)}:${line}`, text: node.text });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

/** Kebab-case literals inside a `caveats` array/property or a call whose name mentions caveat (syntactic net). */
function caveatShapedLiterals(): { readonly where: string; readonly text: string }[] {
  const found: { where: string; text: string }[] = [];
  const inCaveatSlot = (node: ts.Node): boolean => {
    for (let p = node.parent; p !== undefined && !ts.isSourceFile(p); p = p.parent) {
      if ((ts.isPropertyAssignment(p) || ts.isVariableDeclaration(p)) && /caveat/i.test(p.name.getText())) return true;
      if (ts.isCallExpression(p) && /caveat/i.test(p.expression.getText())) return true;
      if (ts.isBlock(p) || ts.isArrowFunction(p)) return false;
    }
    return false;
  };
  for (const { abs: file, ast: sf } of PRODUCTION) {
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) && /^[a-z0-9]+(-[a-z0-9]+)+$/.test(node.text) && inCaveatSlot(node)) {
        found.push({ where: `${file.slice(SRC.length)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`, text: node.text });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

describe("caveat codes used in production code (instructions §14)", () => {
  it("every caveat literal (type-checked position) is a key of CAVEAT_TEXT", { timeout: 60_000 }, () => {
    const used = caveatLiterals();
    expect(used.filter((u) => !KNOWN.has(u.text))).toEqual([]);
    // Anti-vacuity: the scan sees the codes the cards emit (spec §9 caveat lists).
    const distinct = new Set(used.map((u) => u.text));
    for (const c of ["row-cap", "truncated", "overlap", "not-worked-window-cap", "value-item-view-only", "build-stamp"]) {
      expect(distinct.has(c), c).toBe(true);
    }
    expect(distinct.size).toBeGreaterThanOrEqual(25);
  });

  it("every kebab-case literal in a caveats slot is a key of CAVEAT_TEXT", () => {
    const shaped = caveatShapedLiterals();
    expect(shaped.length).toBeGreaterThan(10);
    expect(shaped.filter((u) => !KNOWN.has(u.text))).toEqual([]);
  });
});
