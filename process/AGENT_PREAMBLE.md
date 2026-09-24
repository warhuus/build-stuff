# Common brief for every sub-agent

You are a sub-agent of a lead agent building the data layer for a Metrics page. Work fully unattended: never ask a human. Where something is unclear, follow section 13 of the instructions (safer reading -> note it; invented data -> config placeholder + blocked). If you need a FROZEN interface changed, do NOT work around it: stop, write the request in your findings file under "Interface change requests", and finish everything else.

Binding inputs (read them; precedence: instructions > spec > Excel):
- Instructions (HOW, plus binding Appendix A): /root/.claude/uploads/6668890e-cf53-523c-8931-07c0cb904c0d/8a639e33-Instructions_-_metrics_data_layer.md
- Spec (WHAT: plans, types, values): /root/.claude/uploads/6668890e-cf53-523c-8931-07c0cb904c0d/a0aaaf18-Metrics_data_layer_spec.md
- Excel dumped to text (business MEANING): /tmp/claude-0/-home-user-build-stuff/6668890e-cf53-523c-8931-07c0cb904c0d/scratchpad/excel.txt

Project: /home/user/build-stuff/metrics-data-layer (deps installed; @osdk/client 2.7.8 and @osdk/api in node_modules — read their .d.ts to confirm any OSDK syntax; never rely on memory).
Process notes and findings files: /home/user/build-stuff/process/
Design doc (after phase 1): /home/user/build-stuff/process/DESIGN.md

Hard rules you must obey (instructions §5, §10): named exports only; no `any` (except `// OSDK boundary:` in source/osdk); no `as unknown as`, no @ts-ignore, no eslint-disable (except react-hooks/exhaustive-deps with a reason); files <= 250 lines, functions <= 40 lines, loaders <= 150 lines; JSDoc on every export (inputs, output, units, null behaviour; cite spec, e.g. `// Spec §9 2.3`); every constant in src/config/metrics.ts; no console, no TODO, no commented-out code; compute/ is pure (now is a parameter; no Date.now(), no new Date() without argument, no Math.random()); imports flow downward only (§5.1); only source/osdk may import @osdk/client, @app/sdk or src/client.ts or contain property apiNames as string literals. Timestamps are ISO-8601 UTC strings. Percentages are fractions 0..1, null on division by zero/null. Tests: vitest in src/data/metrics/__tests__/ mirroring the tree (file names `*.test.ts`/`*.test.tsx`).

Checks: `npx tsc --noEmit`, `npx eslint <your files> --max-warnings 0`, `npx vitest run <your tests>`. Leave your files passing all three. Do not edit files owned by another agent; if you find a problem in them, report it in your findings file.
