// @vitest-environment node
import { sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { METRICS, PRODUCTION, resolveLocal, specifiersOf } from "./helpers/sourceTree";
import type { ScannedFile } from "./helpers/sourceTree";

// Instructions §5 rules 1, 2, 4 and §10 size limits, checked on the delivered source (hardened in phase 4:
// STR-03, MOD-20).
const posix = (p: string): string => p.split(sep).join("/");
const inMetrics = (rel: string): string => posix(rel.startsWith(METRICS) ? rel.slice(METRICS.length) : rel);

/** Layer rank per instructions §5.1 and D10; source adapters (3.5) sit beside the port; -1 = unranked. */
function rankOf(rel: string): number {
  const p = inMetrics(rel);
  if (posix(rel).startsWith("config/")) return 0;
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

/** Host modules outside the layers, and who may import them (instructions §3, §5 rule 2; STR-01). */
const HOST_IMPORTS: readonly { readonly target: string; readonly from: RegExp }[] = [
  { target: "lib/osdk.ts", from: /^data\/metrics\/source\/(batching\.ts$|osdk\/|fake\/)/ },
  { target: "client.ts", from: /^data\/metrics\/source\/osdk\// },
];
const adapterOf = (rel: string): string | null => /^source\/(osdk|fake)\//.exec(inMetrics(rel))?.[1] ?? null;

/** Every problem with one import edge `from → target` (paths relative to SRC). */
function edgeProblems(from: string, target: string): string[] {
  const own = rankOf(from);
  const t = rankOf(target);
  if (t < 0) {
    const allowed = HOST_IMPORTS.some((h) => h.target === posix(target) && h.from.test(posix(from)));
    return allowed ? [] : [`${from} -> ${target} (unranked)`];
  }
  if (t === 3.5) {
    const sameAdapter = adapterOf(from) !== null && adapterOf(from) === adapterOf(target);
    const hostWiring = /^(hooks\/MetricsSourceContext\.ts|index\.ts)$/.test(inMetrics(from));
    return sameAdapter || hostWiring ? [] : [`${from} -> ${target} (adapter)`];
  }
  const out = t > own ? [`${from} -> ${target}`] : [];
  return t === 8 && own !== 8 && own !== 9 ? [...out, `${from} -> ${target} (hooks)`] : out;
}

const localEdges = (f: ScannedFile): string[] => specifiersOf(f).filter((s) => s.startsWith(".")).map((s) => resolveLocal(f, s));

describe("layering (instructions §5.1)", () => {
  it("places every delivered file in a layer; source/batching.ts is rank 3 (port level)", () => {
    expect(PRODUCTION.filter((f) => rankOf(f.rel) < 0).map((f) => f.rel)).toEqual([]);
    expect(rankOf(`${METRICS}source${sep}batching.ts`)).toBe(3);
  });

  it("imports only flow downward; unranked targets only from the allow-list; adapters never import each other", () => {
    const bad = PRODUCTION.flatMap((f) => localEdges(f).flatMap((t) => edgeProblems(f.rel, t)));
    expect(bad).toEqual([]);
  });

  it("the edge rules flag what they must (self-test)", () => {
    const m = (p: string): string => `${METRICS}${p.split("/").join(sep)}`;
    expect(edgeProblems(m("source/fake/fakeSource.ts"), m("source/osdk/paging.ts"))).toHaveLength(1);
    expect(edgeProblems(m("source/osdk/osdkSource.ts"), m("source/fake/fakeEval.ts"))).toHaveLength(1);
    expect(edgeProblems(m("source/osdk/osdkSource.ts"), m("source/osdk/paging.ts"))).toEqual([]);
    expect(edgeProblems(m("source/osdk/osdkSource.ts"), m("shared/memo.ts"))).toHaveLength(1);
    expect(edgeProblems(m("compute/bins.ts"), m("shared/memo.ts"))).toHaveLength(1);
    expect(edgeProblems(m("compute/bins.ts"), `lib${sep}osdk.ts`)).toHaveLength(1);
    expect(edgeProblems(m("source/batching.ts"), `lib${sep}osdk.ts`)).toEqual([]);
    expect(edgeProblems(m("source/fake/fakePaging.ts"), "client.ts")).toHaveLength(1);
    expect(edgeProblems(m("loaders/userFunnel.ts"), m("unknown.ts"))).toHaveLength(1);
    expect(edgeProblems(m("shared/memo.ts"), m("hooks/useMetric.ts"))).toHaveLength(2);
  });

  it("resolves .js and /index specifiers to their files", () => {
    const f = PRODUCTION.find((x) => inMetrics(x.rel) === "loadCard.ts");
    if (f === undefined) throw new Error("loadCard.ts not found");
    expect(posix(resolveLocal(f, "./catalogue.js"))).toBe("data/metrics/catalogue.ts");
    expect(posix(resolveLocal(f, "../../config/metrics.ts"))).toBe("config/metrics.ts");
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
    const bad = PRODUCTION.filter((f) => !f.rel.includes(`${sep}source${sep}osdk${sep}`)).flatMap((f) => {
      const code = f.text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      return API_NAMES.filter((n) => new RegExp(`["'\`]${n}["'\`]`).test(code)).map((n) => `${f.rel}: ${n}`);
    });
    expect(bad).toEqual([]);
  });
});

describe("purity of the rank-2 layer (instructions §5 rule 4; D10)", () => {
  const pure = PRODUCTION.filter((f) => rankOf(f.rel) === 2);

  it("covers compute/, query/, window.ts, selection.ts and breakdowns.ts", () => {
    const names = pure.map((f) => inMetrics(f.rel));
    for (const n of ["window.ts", "selection.ts", "breakdowns.ts", "compute/bins.ts", "query/build.ts"]) expect(names).toContain(n);
  });

  it("has no I/O, clocks, randomness or React", () => {
    const bad = pure
      .filter((f) => /Date\.now\(|new Date\(\)|Math\.random\(|performance\.now\(|from ["']react["']|\bfetch\(/.test(f.text))
      .map((f) => f.rel);
    expect(bad).toEqual([]);
  });

  it("has no module state (no top-level let or var)", () => {
    const bad = pure.flatMap((f) =>
      f.ast.statements
        .filter(ts.isVariableStatement)
        .filter((s) => (s.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== ts.NodeFlags.Const)
        .map((s) => `${f.rel}:${f.ast.getLineAndCharacterOfPosition(s.getStart(f.ast)).line + 1}`),
    );
    expect(bad).toEqual([]);
  });
});

describe("size limits (instructions §10)", () => {
  it("no function is longer than 40 lines", () => {
    const long: string[] = [];
    for (const f of PRODUCTION) {
      const visit = (node: ts.Node): void => {
        if (ts.isFunctionLike(node) && "body" in node && node.body) {
          const start = f.ast.getLineAndCharacterOfPosition(node.getStart(f.ast)).line;
          const end = f.ast.getLineAndCharacterOfPosition(node.getEnd()).line;
          if (end - start + 1 > 40) long.push(`${f.rel}:${start + 1} (${end - start + 1} lines)`);
        }
        ts.forEachChild(node, visit);
      };
      visit(f.ast);
    }
    expect(long).toEqual([]);
  });

  it("no loader file is longer than 150 lines", () => {
    const long = PRODUCTION.filter((f) => f.rel.includes(`${sep}loaders${sep}`))
      .filter((f) => f.text.split("\n").length > 150)
      .map((f) => f.rel);
    expect(long).toEqual([]);
  });
});
