# Test cut (user request, after delivery)

The user judged the 798-test suite bloated. Binding target: keep only tests of the core metric functionality — for a set of inputs, does the function return the expected output — with a few cases each (typical, nulls, zeroes, boundaries), plus one end-to-end golden per card and a handful of guards. Total ≈ 80–120 test cases, ≈ 2,000–2,500 lines of test code. This overrides instructions §11/§14 test-count and coverage requirements (no coverage target any more; structural rules move to ESLint).

Rules:
- Do NOT change production code (src/config, src/data/metrics outside __tests__), except where the brief says so explicitly.
- Reuse expected values from the existing tests (they are hand-derived and verified); do not invent new expected numbers unless you derive them by hand with a one-line working comment.
- Prefer table-driven `it.each` with small hand-built inputs. No tests of helpers that the card-level tests already exercise. No asserting exact query/call lists except in the guard tests named below.
- Keep test helpers minimal; delete helpers that are no longer used.
- Project: /home/user/build-stuff/metrics-data-layer. At the end: `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run` all green. Report final test count (vitest "Tests" line) and `find src -path '*__tests__*' -name '*.ts*' | xargs wc -l | tail -1`.
