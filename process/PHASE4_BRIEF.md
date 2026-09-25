# Phase 4 fixer brief
Read /home/user/build-stuff/process/AGENT_PREAMBLE.md (incl. Phase 2 additions). Then read process/PHASE4_PLAN.md — it is the lead's binding decision on every phase-3 finding, with file ownership. Read the phase-3 findings files for the ids assigned to you (process/phase3-*.md) and PHASE1_DECISIONS.md notes L1–L6.
Implement ONLY the items assigned to your agent id. The frozen-file rule is relaxed exactly where PHASE4_PLAN says the lead authorises it.
Other fixers run in parallel on other folders. At the end: `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run` — all must pass for your files; if a failure is caused by another fixer's in-progress work, note it and do not touch their files.
Write process/phase4-<id>.md: per finding id → what you changed (file:line) or why not, plus new QUESTIONS.md entries (Assumed/Blocked with spec refs).
