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

## Issues

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
