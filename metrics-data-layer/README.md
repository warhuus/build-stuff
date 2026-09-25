# Metrics data layer

The data layer for the Metrics page. It covers 12 cards: 9 first-draft cards and 3 second-draft stubs. It has no UI. The UI imports only `src/data/metrics/index.ts`.

- To wire it into the host app, see `INTEGRATION.md`.
- Assumptions, blocked items and known deviations are in `QUESTIONS.md`.
- The process, the findings and the check results are in `REVIEW.md`.

## Architecture

**Layers.** Imports flow downward only:

`config` → `types` → `compute` / `query` (pure) → `source` port → `shared` → `loaders` → `catalogue` → `loadCard` → `hooks` → `index`

- `src/config/metrics.ts` holds every constant. It also holds the placeholders and the caveat texts.
- `compute/` is pure. `now` is always passed in as a parameter.
- `query/` builds plain-data set specs, such as `ItemSet`, `EventSet`, `OpenAlertSet` and `RiskSet`. It uses business names only.

**Port and adapters.** `source/MetricsSource.ts` is the port. It has 16 methods, and each makes one server call; id lookups are split into chunks. There are two adapters:

- `source/osdk/` (`createOsdkSource({ client, sdk })`) compiles the specs to OSDK object sets. It is the only code that imports `@osdk/client`, `@app/sdk` or `src/client.ts`, and the only code that names properties.
- `source/fake/` (`createFakeSource(FIXTURES)`) evaluates the same specs in memory. It is used by the tests.

**Loaders and derive.** Each card has two parts:

- A loader (`loaders/<card>.ts`) builds specs, calls the port and returns raw data. The raw data does not depend on the unit or the threshold. Loaders do no arithmetic.
- A pure `derive(raw, selection, config)` (`compute/derive*.ts`) computes percentages, bins, quantiles, breakdowns and caveats. It also applies `unit` and `ageingThresholdDays`.

`catalogue.ts` pairs each loader with its derive.

**Cache and semaphore.**

- `loadCard` and `useMetric` share one implementation and one raw cache (`shared/cache.ts`).
- The cache key is `card | window | view (itemFunnel) | otifMode (otifOutcome) | filters (not userFunnel) | breakdown`. Unit and threshold are not part of the key, so changing them re-derives from the cache without a refetch.
- Only `loadCard` acquires the app-wide semaphore, which has 4 slots.
- Shared loaders keep one in-flight promise per key and never take a semaphore slot:
  - L1: human events
  - L2: touched alerts and their facts
  - L3: open alerts, their opened events and their items
  - not-worked alerts
  - items by id
- Inner id batches use their own limiter (`INNER_CONCURRENCY`).
- `clearMetricsCache()` empties everything and bumps a version. Mounted hooks subscribe to that version and refetch.

**Second-draft seam.** 4.2–4.4, 4.6 and the itemFunnel alert view get per-alert facts (`AlertLifecycleRow`) in one place: `shared/touchedAlerts.ts` together with `compute/alertLifecycle.ts`. `shared/notWorkedAlerts.ts` does the same for the 4.2 not-worked side. When the `AlertLifecycle` object exists, one port method (`fetchAlertLifecycles`) replaces those bodies. Their signatures stay the same.

## Public API (`src/data/metrics/index.ts`)

Values:

| Export | What it is |
|---|---|
| `useMetric(cardId, selection, breakdown = null)` | React hook that returns `MetricResult<CardData<CardOutput[cardId]>>`. The type is inferred from `cardId`. It never throws. |
| `loadCard(cardId, selection, breakdown, opts?)` | Non-React entry. It uses the same cache and returns the same result. `opts`: `{ source?, now?, signal?, config?, onProgress? }`. `source` defaults to the app's OSDK source. It never throws. |
| `useMetricsSelection()` | Returns `[selection, setSelection]`, synced to the URL (`w u v bl pl rg pt om n`). Arrays are repeated params, defaults are left out, and invalid values fall back to the defaults. |
| `MetricsSourceProvider` | Context provider. Optional `source`, `config` and `now` props (`now` is a `Date` or `() => Date`). The default is the OSDK source. |
| `clearMetricsCache()` | Clears every cache and memo. Mounted hooks refetch. |
| `DEFAULT_SELECTION`, `parseSelection`, `serializeSelection` | Selection defaults and URL helpers. |
| `allowedBreakdowns(card, view)`, `isBreakdownAllowed(card, view, dim)`, `isAdditive(card, view, dim)` | Lookups in the breakdown registry. |
| `CARDS` | Read-only metadata per card, keyed by id: `rows`, `draft`, `title`, `output`, `stub`, `requires`. |
| `CAVEAT_TEXT` | One sentence per caveat code. |

`index.ts` also exports types: every spec §10 output type, `Selection`, `MetricResult`, `CardData`, `BreakdownResult`, the row types, `Paged`, `SourceCtx`, `MetricsSource` and the query-spec types.

`MetricResult` is a union discriminated on `status`:

| `status` | Fields |
|---|---|
| `ok`, `partial` | `data` |
| `loading` | `data?` (the previous data, kept so the UI can dim it) |
| `blocked` | `blocked: { reason, unblockedBy }` |
| `error` | `error` (a string) |

Every variant also carries `caveats`, `computedAt` (ISO UTC), `window` and, optionally, `progress`.

```ts
import {
  useMetric, loadCard, useMetricsSelection, MetricsSourceProvider, clearMetricsCache,
  CAVEAT_TEXT, CARDS, allowedBreakdowns, DEFAULT_SELECTION, type Selection,
} from "./data/metrics";   // path relative to the importing file

// Selection: URL-synced state. setSelection also accepts an updater.
const [selection, setSelection] = useMetricsSelection();
setSelection((s) => ({ ...s, window: 7, filters: { ...s.filters, region: ["AMER"] } }));

// Provider: optional. Tests pass a fake source and a pinned clock.
// createElement(MetricsSourceProvider, { source: createFakeSource(), now: FIXTURE_NOW }, children)
```

### One example per card

```ts
// userFunnel (1.0–1.4) → FunnelSeries. While ALERT_APP_ID is the placeholder:
//   { status: "blocked", blocked: { reason: "needs-integration-value",
//     unblockedBy: "Set ALERT_APP_ID in src/config/metrics.ts at integration" }, caveats: ["needs-integration-value"] }
// Once it is set: status "ok"; stage 1.0 has availability "no-source"; 1.1–1.4 are user counts; valueUsd is null.
const users = useMetric("userFunnel", selection, "alertType");   // breakdown: 2nd argument

// itemFunnel (2.0–2.4) → FunnelSeries. selection.view picks "item" (count + valueUsd) or "alert".
const items = useMetric("itemFunnel", { ...selection, view: "item" }, "businessLine");
if (items.status === "ok" || items.status === "partial") {
  const s22 = items.data.total.stages.find((st) => st.id === "2.2"); // count, valueUsd, pctPrev, pctFirst
  const groups = items.data.breakdown?.groups;                      // top 8, largest first; `other` if additive
}

// riskDistribution (3.1) → BucketRow[]: 7 buckets × worked/not worked, with shareOfBucket.
const risk = useMetric("riskDistribution", { ...selection, unit: "valueUsd" }, "region");

// otifOutcome (4.1) → OutcomeHeadline. While VERDICT_DATE_PROPERTY is the placeholder: blocked, needs-integration-value.
const outcome = useMetric("otifOutcome", { ...selection, otifMode: "crit" });   // no breakdowns allowed

// raisedToClosed (4.2) → DurationResult. At 30 / 90 / "now": status "partial" + "not-worked-window-cap".
const r2c = useMetric("raisedToClosed", { ...selection, window: 14 }, "priority");

// raisedToFirstView (4.3) and firstViewToClosure (4.4) → DurationResult (bins, n, median, p90, excluded).
const r2v = useMetric("raisedToFirstView", selection, "routingPersona");
const v2c = useMetric("firstViewToClosure", selection);

// ageingBacklog (4.5) → AgeingBacklog. Changing the threshold re-derives from the cache (no refetch).
const ageing = useMetric("ageingBacklog", { ...selection, ageingThresholdDays: 14 }, "escalated");

// closureComposition (4.6) → CompositionResult: noHuman / viewOnly / action / writeBack, zero-filled.
const closure = useMetric("closureComposition", selection, "alertType");

// Second-draft stubs: always blocked, no network call.
const movement = useMetric("riskMovement", selection);
//   { status: "blocked", blocked: { reason: "not-captured", unblockedBy: "S2 OTIF risk score history" },
//     caveats: ["not-captured"] }
const calibration = useMetric("riskCalibration", selection);
//   blocked "not-captured", unblockedBy "S2 OTIF risk score history (and the item ↔ verdict link)",
//   caveats ["not-captured", "delayed-forced-100"]
const rolled = useMetric("rolledValue", selection);
//   blocked "no-source", unblockedBy "S4 rolled-value source", caveats ["no-source"]
```

### loadCard, breakdowns, refresh, caveat text

```ts
// Non-React: same cache and result as the hook. It never throws.
const ctrl = new AbortController();
const res = await loadCard("ageingBacklog", DEFAULT_SELECTION, null, {
  signal: ctrl.signal,
  onProgress: (p) => console.log(p.loaded),   // rows loaded so far by this load
});

// A breakdown that is not allowed for (card, view) gives an error, never another computation:
const bad = await loadCard("otifOutcome", DEFAULT_SELECTION, "region");
// bad.status === "error" && bad.error === "breakdown-not-allowed"
allowedBreakdowns("itemFunnel", "alert");   // alertType, routingPersona, priority, escalated, actionType, writebackType (registry order)

// Refresh button:
clearMetricsCache();                        // mounted useMetric hooks refetch

// Caveat text for display:
const texts = res.caveats.map((c) => CAVEAT_TEXT[c]);
const title = CARDS.ageingBacklog.title;    // "Ageing backlog"
```

An abort surfaces as `status: "error"`, `error: "aborted"`.

## Running the checks

```sh
cd metrics-data-layer
npm i
npx tsc --noEmit
npx eslint . --max-warnings 0
npx vitest run
```

The suite is deliberately small, about 100 tests. It covers:
- **Metric maths** in `__tests__/compute/`: table-driven, one file per card family, with typical inputs plus null, zero and boundary cases.
- **End-to-end** in `cards.test.ts`: one golden per card on the fake source and its fixtures.
- **Guards** in `guards.test.ts`:
  - toggling unit or threshold does not refetch
  - a disallowed breakdown returns an error
  - the row cap gives a `partial` result
  - section 1 ignores item filters
  - a cache hit makes no fetch
- **Query shape** in `source/osdk/queries.test.ts`: the main query plans are compiled through a recording OSDK client. It also checks that no group-by-only property is ever filtered and that an empty id list sends no request.

The structural rules are ESLint rules in `eslint.config.mjs`, not tests:
- the import direction and the OSDK boundary
- file, function and loader size limits
- no `any`, `console`, default exports or `withProperties`
- purity of `compute/`
