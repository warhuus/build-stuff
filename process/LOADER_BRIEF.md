# Brief for loader agents E1–E3

Read /home/user/build-stuff/process/AGENT_PREAMBLE.md (incl. Phase 2 additions) and obey it.

Already built — read code + findings, reuse, don't duplicate:
- process/phase2-A1.md (core compute), process/phase2-D1.md (window, selection, breakdowns, cache, memo, concurrency, errors), process/phase2-B.md (query/build.ts, buildFunnel.ts, buildRisk.ts, fake source, fixtures with alert table), process/phase2-D2.md (shared loaders L1 loadHumanEvents, L2 loadTouchedAlerts, L3 loadOpenAlerts/loadOpenAlertOpenedEvents/loadOpenAlertItems, loadNotWorkedAlerts, loadItemsByIds, sourceCtx.ts helpers; hand-checked fixture values; test helper __tests__/shared/loaderDeps.ts `fakeDeps`, `win`, `AMER`).
- Agent A2 is concurrently writing compute/derive*.ts, durations/ageing/otifOutcome/composition (process/phase2-A2.md when done). Your loader tests may call the derive for end-to-end checks ONLY if it exists when you finish; loader tests primarily assert RAW output.

Rules for every loader (instructions §5 rules 3, 5, 6, 10; PHASE1_DECISIONS):
- `export const load<CardId>: Loader<CardRaw["<cardId>"]>` in `loaders/<cardId>.ts` (≤ 150 lines per loader file; you may split into extra files in loaders/, e.g. itemFunnelItemView.ts). Signature `(selection, breakdown, deps) => Promise<LoaderOutput<Raw>>`.
- Build specs with query builders, call the port (`deps.source`, ctx = sourceCtxOf(deps, deps.signal)) or shared loaders, return raw plain data. No arithmetic beyond wiring (set algebra, subtraction, top-N, bins live in derive/compute) — the only allowed exception: the itemFunnel item-view alert-dim path ranks candidate groups on 2.1 with compute's topGroups to decide which groups to query on 2.2–2.4 (spec §9 2.1).
- Raw data independent of unit and ageingThresholdDays (O3). `window = resolveWindow(selection.window, deps.now)`.
- The breakdown passed in is already validated by loadCard; loaders branch on it.
- Loader caveats only: `row-cap` + status "partial" if any Paged fetch returned capped (D11); `truncated` when a grouped port call returned exactly config.MAX_GROUPS rows (isTruncatedByCap); 4.2 `not-worked-window-cap` + status "partial" when window key ∉ config.NOT_WORKED_WINDOW_KEYS. All other caveats belong to derive.
- Issue independent port calls in parallel (Promise.all) — spec §11: "2.2–2.4 are issued in parallel with 2.1".
- Loaders never acquire the app semaphore.
- Read config only from deps.config.
- Tests in __tests__/loaders/<cardId>.test.ts against createFakeSource() + FIXTURES + FIXTURE_CONFIG with FIXTURE_NOW: for every card at least one test per window key the spec uses (7, 14, 30, 90, now as relevant), per view (itemFunnel), per breakdown dimension the registry allows (Appendix A registry; breakdowns.ts), with and without an item filter where the card uses filters. HAND-COMPUTE each expected value from the fixture tables (fixtures.ts / fixtureAlerts.ts headers, phase2-D2.md values) and write the working in a comment above the expectation. Also assert which port calls were made via fake.calls (no raw event history loads beyond X2: only L1–L3, items by id, 4.1 worked ids + verdicts, 4.2 not-worked, 4.5 fetches).
- Write findings to process/phase2-<you>.md: files, hand-checked values, assumptions for QUESTIONS.md with spec refs.
