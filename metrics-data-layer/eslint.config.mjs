import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Structural rules of the delivered files (instructions §5, §10, §14; formerly __tests__/structure.test.ts and
// layering.test.ts). ESLint replaces a rule's options per matching config object, so every scoped
// `no-restricted-imports` / `no-restricted-syntax` below repeats the global bans it must keep.

const DELIVERED = ["src/config/**/*.{ts,tsx}", "src/data/metrics/**/*.{ts,tsx}"];
const TESTS = ["src/data/metrics/__tests__/**"];
const M = "src/data/metrics";

/** An import-pattern ban (regex on the specifier) with its message. */
const ban = (regex, message) => ({ regex, message });

/** The OSDK client, the SDK and the host client module: only source/osdk may import them (§5 rule 2). */
const CLIENT_BANS = [
  ban("^@osdk/", "Only source/osdk may import @osdk/* (instructions §5 rule 2)."),
  ban("^@app/sdk(/|$)", "Only source/osdk may import @app/sdk (instructions §5 rule 2)."),
  ban("^(?!@)(.*/)?client(\\.js|\\.ts)?$", "Only source/osdk may import the host client module (instructions §5 rule 2)."),
];
/** The source adapters: only hooks/MetricsSourceContext.ts and index.ts wire them (§5.1, D10). */
const ADAPTER_BAN = ban("(^|/)source/(osdk|fake)(/|$)", "Only hooks/MetricsSourceContext.ts and index.ts may import a source adapter.");
/** Upper layers, as seen from compute/ and query/ (rank 2 is pure: no I/O layers above it). */
const ABOVE_PURE = ban(
  "^\\.\\./(shared|loaders|hooks|source|catalogue|loadCard)(/|\\.js$|$)",
  "compute/ and query/ are pure (rank 2): no shared, loaders, hooks, source, catalogue or loadCard.",
);
const ABOVE_SHARED = ban("^\\.\\./(loaders|hooks|catalogue|loadCard)(/|\\.js$|$)", "shared/ must not import loaders, hooks, catalogue or loadCard.");
const ABOVE_LOADERS = ban("^\\.\\./(hooks|catalogue|loadCard)(/|\\.js$|$)", "loaders/ must not import hooks, catalogue or loadCard.");

const importBans = (...patterns) => ["error", { patterns: [...CLIENT_BANS, ...patterns] }];

const WITH_PROPERTIES = {
  selector: "MemberExpression[property.name='withProperties']",
  message: "withProperties is not used by the data layer (instructions §5).",
};
const IMPURE = [
  { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: "compute/ is pure: take `now` as an argument." },
  { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: "compute/ is pure: no randomness." },
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "compute/ is pure: take `now` as an argument." },
];

export default tseslint.config(
  { ignores: ["node_modules", "coverage", "dist"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-console": "error",
    },
  },
  // Size (§10): every delivered file, tests included.
  { files: DELIVERED, rules: { "max-lines": ["error", { max: 250 }] } },
  // Delivered production files.
  {
    files: DELIVERED,
    ignores: TESTS,
    rules: {
      "max-lines-per-function": ["error", { max: 40 }],
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-exports": ["error", { restrictDefaultExports: { direct: true, named: true, defaultFrom: true, namedFrom: true, namespaceFrom: true } }],
      "no-restricted-imports": importBans(ADAPTER_BAN),
      "no-restricted-syntax": ["error", WITH_PROPERTIES],
    },
  },
  { files: [`${M}/loaders/**`], rules: { "max-lines": ["error", { max: 150 }] } },
  // Layering (§5.1): scoped bans; each repeats the client and adapter bans.
  {
    files: [`${M}/compute/**`, `${M}/query/**`],
    ignores: TESTS,
    rules: { "no-restricted-imports": importBans(ADAPTER_BAN, ABOVE_PURE) },
  },
  { files: [`${M}/compute/**`], ignores: TESTS, rules: { "no-restricted-syntax": ["error", WITH_PROPERTIES, ...IMPURE] } },
  { files: [`${M}/shared/**`], rules: { "no-restricted-imports": importBans(ADAPTER_BAN, ABOVE_SHARED) } },
  { files: [`${M}/loaders/**`], rules: { "no-restricted-imports": importBans(ADAPTER_BAN, ABOVE_LOADERS) } },
  // The adapters import their own files freely, never each other; only source/osdk sees the client.
  {
    files: [`${M}/source/fake/**`],
    rules: { "no-restricted-imports": importBans(ban("(^|/)osdk(/|$)", "source/fake must not import source/osdk.")) },
  },
  {
    files: [`${M}/source/osdk/**`],
    rules: { "no-restricted-imports": ["error", { patterns: [ban("(^|/)fake(/|$)", "source/osdk must not import source/fake.")] }] },
  },
  { files: [`${M}/hooks/MetricsSourceContext.ts`, `${M}/index.ts`], rules: { "no-restricted-imports": importBans() } },
);
