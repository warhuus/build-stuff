# Phase 3 reviewer brief (instructions §12 phase 3)

Read /home/user/build-stuff/process/AGENT_PREAMBLE.md (incl. Phase 2 additions) and the binding docs it lists. Read process/PHASE1_DECISIONS.md (decisions D1–D24 and lead notes L1–L6 — L1, L2, L5, L6 are already known and scheduled; do not re-report them) and skim the process/phase2-*.md findings files.
You REPORT ONLY. Do NOT edit any file under metrics-data-layer (you may create scratch files in /tmp/claude-0/-home-user-build-stuff/6668890e-cf53-523c-8931-07c0cb904c0d/scratchpad/ and run tsc/eslint/vitest).
Project: /home/user/build-stuff/metrics-data-layer (src/config, src/data/metrics). Currently: tsc clean, eslint clean, 656 tests green, 100% line coverage.
Write findings to /home/user/build-stuff/process/phase3-<dimension>.md as a table: id (prefix given below), severity (blocker / major / minor), file:line, finding, evidence, reference (doc §), suggested fix. Only real, verified findings — no style nits unless they break a stated rule. End your reply with a short summary of blockers/majors.
