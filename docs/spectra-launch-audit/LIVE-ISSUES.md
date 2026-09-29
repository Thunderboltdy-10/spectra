# Live issues ledger

This ledger is shared by the live verifier and the fixer; the prompts are in
[`LIVE-VERIFICATION-PROMPTS.md`](LIVE-VERIFICATION-PROMPTS.md).

- The **verifier** writes the issues and the Coverage table.
- The **fixer** writes the root cause, the fix and the commit.

Statuses move in this order:

1. `OPEN` (verifier).
2. `FIXING` (fixer).
3. `FIXED` (fixer, with a commit).
4. `VERIFIED` or `REOPENED` (verifier).

Three side exits, each set by the fixer:
- `NEEDS-INFO` means the fixer has a question for the verifier.
- `NEEDS-DECISION` means the question is for the user.
- `CANNOT-REPRODUCE`.

Severity:

| Severity | Meaning |
| --- | --- |
| **Blocker** | Data loss, security or privacy exposure, a core job impossible, or a crash. |
| **High** | A core job is unreliable, or wrong without warning. |
| **Medium** | A job works, but is confusing, slow or inconsistent. |
| **Low** | Polish. |

## Summary

_Written by the verifier at the end._

## Coverage

| Script or area | Report | Result | Issues | Commit tested |
| --- | --- | --- | --- | --- |
| Local runtime bootstrap (fresh Convex) | Run and test · local startup | FAIL | LV-001 | 14f31c0c |

## Issues

### LV-001 · Fresh local stack stops before readiness

- **Status:** FIXED
- **Severity:** Medium
- **Surface / role:** Local stack startup / operator
- **Report script:** Run and test · local startup
- **Commit tested:** 14f31c0c
- **Frequency:** 1 of 1 fresh instance starts

**Steps**
1. On main at 14f31c0c, use a fresh local instance ID 3 with ports 3040–3043 free.
2. Run npm run local:start:all -- --instance 3.
3. Wait for the launcher's readiness check.

**Expected:** The launcher starts “the local Convex deployment, collaboration gateway, Next server and Bridge” and reports the stack ready.

**Actual:** The launcher exits before any service is ready. Its output says, “This instance needs its one-time local Convex selection. Follow the Convex prompt if team/project were not set in env.local.” The error log says, “Cannot prompt for input in non-interactive terminals. (Project:)” and “local Convex configuration stopped before it became ready (code 1).” Opening http://localhost:3040 in the saved Profile A session shows ERR_CONNECTION_REFUSED.

**Evidence:** .spectra-local/live-verification/LV-001-launch-refused.jpg; start-all-stack.stdout.log: “This instance needs its one-time local Convex selection. Follow the Convex prompt if team/project were not set in env.local.”; start-all-stack.stderr.log: “Cannot prompt for input in non-interactive terminals. (Project:)” and “local Convex configuration stopped before it became ready (code 1).”

**Fix** (fixer)
- Commit: `454a7bbe50ec0b022f6311998aebfaf5348dfb30` (`fix(local): finish Convex selection before detaching the stack (LV-001)`).
- Root cause: `start-all.mjs` launched the stack detached with stdin ignored and output redirected to logs. A fresh instance then reached the existing Convex project-selection prompt, which could neither read input nor show its choices in the caller's terminal; saved instances bypassed that prompt.
- Change: complete fresh configuration in the foreground with inherited input/output before detaching. The new `stack.mjs configure` command reuses the existing instance validation, local-only Convex selection and environment synchronization, then stops its owned backend; the detached stack restarts the saved identity and database. Failed or unsaved configuration aborts startup with an actionable next step.
- Test: `node --test scripts/local/start-all.node.mjs` (4 passed), including a real child-process selection test that fails when stdin is discarded and passes with inherited input. It also proves saved instances do not reselect, and failed/unsaved setup cannot continue. Focused stack configuration/scaffolding/readiness Vitest tests: 22 passed. Both TypeScript checks, full lint and all five repository gates passed; final full suite: 4,296 passed, 1 failed, 1 skipped. The failure was the unchanged dense-sheet timing assertion (42.37 ms against 40 ms); its file passed all 77 tests alone.
- Re-check nearby: run fresh startup in an interactive terminal, select the intended local project, confirm all services become ready, then restart the same saved instance and confirm no project prompt or database replacement. Check setup cancellation/failure and explicit team/project setup too. A headless fresh run still requires both `SPECTRA_LOCAL_CONVEX_TEAM` and `SPECTRA_LOCAL_CONVEX_PROJECT` in its instance `env.local`; no project can be selected without either explicit values or interactive input. No shared deployment/codegen step is required by this patch.

<!-- Template: copy for each issue. The verifier fills the top part; the fixer fills "Fix". -->
<!--
### LV-000 · <short title>

- **Status:** OPEN
- **Severity:**
- **Surface / role:**
- **Report script:** (e.g. P3-EDITORS-2 · step 4, or "exploration")
- **Commit tested:**
- **Frequency:** (always / N of M tries)

**Steps**
1.

**Expected:**

**Actual:**

**Evidence:** (screenshot paths under .spectra-local/live-verification/, console / network / Convex log excerpts, redacted)

**Fix** (fixer)
- Commit:
- Root cause:
- Change:
- Test:
- Re-check nearby:

**Verification** (verifier): VERIFIED / REOPENED, commit, date, notes
-->

## Fixer closeout · 30 September 2026

- Fix commit: `454a7bbe` — finish Convex selection before detaching the stack (LV-001). The accompanying ledger documentation commit records this result.
- Final full suite (`npx vitest run`): **4,296 passed, 1 failed, 1 skipped** (493 passed files, 1 failed, 1 skipped). `sheets-operations.test.ts` exceeded its unchanged 40 ms timing threshold at 42.37 ms under the full run; rerun alone: **77 passed**. Raw local result: `.spectra-local/launch-fixer-LV001-full.log`.
- Before changes, the full suite had **4,292 passed, 5 failed, 1 skipped**. The two failing files passed **66/66** tests in an isolated rerun. These results are reported as baseline observations, not separate live ledger issues.
- LV-001 regression: **4 Node tests passed**; focused stack suites: **22 Vitest tests passed**. Web and Convex TypeScript checks, full lint and all five gates passed.
- No issue remains OPEN, REOPENED or FIXING in this pass; LV-001 awaits the verifier's live re-check. No issue is left NEEDS-DECISION or CANNOT-REPRODUCE.
- Fresh local setup requires interactive project selection or both explicit local team/project values. Live product coverage is still in progress. Per the user's instruction, the fixer stops between tasks and resumes when the verifier messages it about a ledger issue.
