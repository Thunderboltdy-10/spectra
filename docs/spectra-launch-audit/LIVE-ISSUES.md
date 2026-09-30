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

## Local test authorization and setup

- **Local test authorization (2026-09-30):** The user explicitly authorized edits to the repository-root `.env.local` for this verification run. Profile A, which has school-administrator and platform-superadmin access, may be used as the administrator for a locally created test school. The configured ManageBac API key from `.env.local` may be entered through the school-admin ManageBac settings UI with the standard base URL for local test-school connection and read checks; no key or password value is recorded. The authorization does not permit sending real invitation emails or changing data at a real school. Convex is configured to a fresh local deployment; SMTP uses loopback with no listener, so invitation email is not sent and the app's manual-link path is used.
- **Scope exclusion (2026-09-30):** The user explicitly instructed the verifier not to conduct mobile-dimension testing. No further phone-width or mobile-drawer checks will be run in this verification.

## Summary

_Written by the verifier at the end._

## Coverage

| Script or area | Report | Result | Issues | Commit tested |
| --- | --- | --- | --- | --- |
| Local runtime bootstrap (fresh Convex) | Run and test · local startup | PASS | LV-001 | 690266bc |
| Local runtime restart (instance 8; web port 3000) | README · Run and test | PASS — on 4f8103b6 and rechecked on 45281d26, `local:stop` then `local:start:all -- --instance 8` reported web 3000, local Convex 3002, gateway 3001 and Bridge ready; the same local deployment and school data remained available | — | 45281d26 |
| Signed-in workspace gate with no school | exploration · first use | PASS | LV-008 | 683803d1 |
| Artifact read during Workspace and Library navigation | exploration · workspace surfaces | PASS | LV-009 (VERIFIED) | c9034739 |
| P2-EXPERIENCE step 1 — `/join` without token | P2-EXPERIENCE · step 1 | PASS | — | 690266bc |
| P2-EXPERIENCE step 2 — expired invitation | P2-EXPERIENCE · step 2 | BLOCKED — no actual expired stored invitation was available; LV-003 is NEEDS-DECISION | LV-003 | d551198a |
| Superadmin local school record creation | exploration · create school | PASS | — | 683803d1 |
| Initial school administrator invitation acceptance | W2-14 · step 1 | PASS | LV-004 (CANNOT-REPRODUCE) | 683803d1 |
| W2-14 step 1 — initial-admin workspace/Library reloads | W2-14 · step 1 | PASS | LV-009 (VERIFIED) | c9034739 |
| ManageBac administrator key save | README · Open launch risks | PASS — Profile A saved the configured key in local school-admin settings; POST returned HTTP 200 | — | c119147d |
| ManageBac capability review | README · Open launch risks | PASS — all eight listed read-only capabilities displayed verified | — | c119147d |
| ManageBac integration readiness after admin setup | README · Open launch risks | PASS — Integration showed Connected after identity resolution and a completed sync | LV-010 (VERIFIED) | c119147d |
| ManageBac identity resolution after admin capability review | W1-16 · step 6 | PASS — action completed with HTTP 200 | LV-010 (VERIFIED) | c119147d |
| ManageBac Sync now after admin capability review | W1-16 · step 6 | PASS — latest manual run completed | LV-010 (VERIFIED) | c119147d |
| ManageBac post-sync class selection and Overview/History consistency | W1-16 · step 6; exploration · post-sync class selection | PASS — post-fix picker, selected count, Overview count and completed sync remained consistent across save and reload | LV-014 (VERIFIED) | 6451c630 |
| ManageBac all-class sync progress polling | W1-16 · step 6 (local unthrottled observation) | PASS — newest run reached Complete in History and Sync now became available without a manual reload | LV-015 (VERIFIED) | 7c4169a8 |
| P2-SYNC-RESUME · step 1 — large or throttled reconciliation | P2-SYNC-RESUME · step 1 | BLOCKED — no large tenant or throttled fixture was available; the local unthrottled run does not prove the >4-minute pause/resume path | LV-015 | 7c4169a8 |
| ManageBac task/calendar admin views after a completed all-class sync | W1-16 · step 6 (admin surface check) | PASS — after one reload, Overview showed Tasks 258 and Calendar 81; both tabs rendered those records, and History remained Complete | LV-016 (VERIFIED) | 7c0e4b55 |
| ManageBac school overview after local restart | exploration · school records | PASS — Profile A still showed Connected with Classes 22, Calendar 81, and Tasks 258 after the full local stack restart | — | 396aa190 |
| ManageBac overview before first successful sync | exploration · first-use state | PASS | LV-013 (VERIFIED) | 0a8a2360 |
| W3-07 student no-match identity and dependent sync | W3-07 · step 5 | BLOCKED — Profile A is the only supplied login and is a school admin/platform superadmin; the admin ManageBac view shows 22 class options, but this script requires an ordinary student identity | — | 6451c630 |
| `/school-data` without membership | exploration · first-week superadmin | FAIL | LV-005 | d551198a |
| ManageBac personal overview without membership | exploration · first-week superadmin | FAIL | LV-005 | d551198a |
| `/analytics` without membership | exploration · first-week superadmin | FAIL | LV-006 | d551198a |
| P3-SURFACES-2 · step 8 — ManageBac disconnect | P3-SURFACES-2 · step 8 | PASS | LV-007 (CANNOT-REPRODUCE) | d712d92b |
| P3-EDITORS — new document save/reload smoke | P3-EDITORS · persistence check | PASS | LV-011 (VERIFIED) | d873b89c |
| P3-EDITORS — quiz structured-list collaboration (E1 quiz portion) | P3-EDITORS · Needs live verification · structured lists | PASS — two Profile A browser sessions showed the two concurrent additions, then the delete/reorder result; both retained exactly three questions after reload | — | 7c0e4b55 (app code) |
| P3-EDITORS — flashcard structured-list collaboration (E1 flashcards portion) | P3-EDITORS · Needs live verification · structured lists | PASS — A and B added a card within one second; both showed three cards after sync and each still had three after reload | — | 7c0e4b55 (app code) |
| P3-EDITORS — Plan structured-list collaboration (E1 Plan portion) | P3-EDITORS · Needs live verification · structured lists | PASS — on commit 57dbcb87, both sessions retained the two simultaneous additions after sync and reload; LV-017 remains NEEDS-INFO for the separate package check | LV-017 (live recheck PASS) | 57dbcb87 (app code) |
| P3-EDITORS — Plan non-overlapping concurrent updates (E2 Plan portion) | P3-EDITORS · Needs live verification · save does not revert a peer | PASS — A renamed task 1 while B marked task 2 done; both changes appeared in both sessions and remained after reload | — | 7c0e4b55 (app code) |
| P3-EDITORS — quiz same-prompt concurrent text edits (E2 quiz portion) | P3-EDITORS · Needs live verification · save does not revert a peer | PASS — on 3574fca2, with both carets placed before the keystrokes, both focused editors showed `colors` after 6.5 seconds; both retained it after blur and reload | LV-018 (VERIFIED) | 3574fca2 (app code) |
| P3-BRIDGE-LENS — new document and Library browser health requests | P3-BRIDGE-LENS · step 9 | PASS — after the authorized instance-8/Bridge restart, a new document opened in A and the same URL in B; repeated Bridge health GETs returned HTTP 200 and each browser had 0 console errors | LV-012 (NEEDS-DECISION) | 396aa190 |
| P3-BRIDGE-LENS — post-fix Bridge restart | P3-BRIDGE-LENS · step 9 | PASS — instance 8 and its Bridge restarted; Bridge reported ready for the app origin, and A/B had 0 console errors after document reload | LV-012 (NEEDS-DECISION) | 396aa190 |
| P3-AI-ENGINE — Moon answer | P3-AI-ENGINE · Needs live verification · Answer, step 1 | BLOCKED — answer streamed without visible IDs; the browser UI does not expose provider-call count, so the one-call expectation is not proven | — | 396aa190 |
| P3-AI-ENGINE — 4,000-word essay | P3-AI-ENGINE · Needs live verification · Answer, step 2 | PASS — after the fix, a fresh no-context request returned a 3,730-word completed answer without repeated paragraphs; Retry on the earlier paused request returned a 4,479-word completed answer without repeated paragraphs | LV-019 (VERIFIED) | 427cb3c9 |
| P3-AI-ENGINE — no-context “Tighten my notes summary” response status | P3-AI-ENGINE · Answer, step 3 | FAIL — with 0 context objects selected, the assistant said it could not edit the matched locked item but the result card said “Saved progress and results”; see LV-022 (NEEDS-DECISION). Evidence: `.spectra-local/live-verification/LV-025-postfix-skip-final-reply-after-reload-45281d26-redacted.png`; `.spectra-local/live-verification/LV-025-postfix-skip-observations-redacted.txt` | LV-022 (NEEDS-DECISION) | 45281d26 |
| P3-AI-ENGINE — clarification Skip repeated-conflict recheck | P3-AI-ENGINE · Answer, step 3; fixer neighbor check | PASS — after one Skip in a fresh zero-context chat, no 409 console errors were recorded; after the final answer appeared, an 8-second sample saw 0 `/api/spectra/run` responses and the console still had 0 errors. LV-025 verified; its response-pending observation is tracked separately under LV-027. Evidence: `.spectra-local/live-verification/LV-025-postfix-skip-observations-redacted.txt` | LV-025 (VERIFIED), LV-027 (OPEN) | 45281d26 |
| P3-AI-ENGINE — clarification continuation pending state | P3-AI-ENGINE · Answer, step 3; fixer neighbor check | FAIL — after Skip, the run still showed “Thinking / Getting ready” at 120 seconds; after selecting an offered item, it still showed that state after at least 70 seconds. No Stop or Retry control appeared at the last pre-reload checks; final answers were visible after reload. Evidence: `.spectra-local/live-verification/LV-027-clarification-pending-observations-redacted.txt`; `.spectra-local/live-verification/LV-025-postfix-skip-run-after-120s-45281d26-redacted.png`; `.spectra-local/live-verification/LV-025-postfix-choice-run-pending-45281d26-redacted.png` | LV-027 (OPEN) | 45281d26 |
| P3-AI-ENGINE — typed clarification answer | P3-AI-ENGINE · Answer, step 3; fixer neighbor check | PASS — a typed answer using made-up Photosynthesis text returned a concise rewrite in the reply with 0 context objects and 0 console errors; its result-card wording remains under LV-022 | LV-022 (NEEDS-DECISION) | 45281d26 |
| P3-AI-ENGINE — Stop mid-stream on a long document create | P3-AI-ENGINE · Stop and steer | PASS — stopped with 3 live document blocks formed; the progress and Stop control disappeared, and no exact-title or generic “New document” row appeared in Library. Evidence: `.spectra-local/live-verification/P3-AI-ENGINE-stop-long-create-before-stop-45281d26-redacted.png`; `.spectra-local/live-verification/P3-AI-ENGINE-stop-long-create-after-stop-nonzero-45281d26-redacted.png`; `.spectra-local/live-verification/P3-AI-ENGINE-stop-long-create-redacted.txt` | — | 45281d26 |
| Free exploration — Library full-title search | exploration · Library and search | FAIL — exact-title queries returned 9 and 34 partial results with 0 full-phrase matches; submitting the first query opened a broad “Water Cycle Field Guide” result. A unique query returned the expected 0-item empty state. Evidence: `.spectra-local/live-verification/LV-026-library-search-query-45281d26-redacted.png`; `.spectra-local/live-verification/LV-026-library-search-result-count-45281d26-redacted.png`; `.spectra-local/live-verification/LV-026-library-search-results-redacted.txt` | LV-026 (OPEN) | 45281d26 |
| P3-AI-ENGINE — document create/edit with detailed answer | P3-AI-ENGINE · Document · create and edit; fixer re-check | PASS — created a four-section document, rewrote section 2, returned a 744-word answer (including the proposed rewrite) of 4,889 characters, and retained the edited text after reload; 0 console errors | LV-019 (VERIFIED) | 427cb3c9 |
| P3-AI-ENGINE — whole-document rewrite | P3-AI-ENGINE · Document · rewrite | PASS — after the fix, the exact rewrite prompt updated the document's four sections and conclusion; the changed text remained after reload and a later stack restart | LV-020 (VERIFIED) | 7a1a8508 |
| P3-AI-ENGINE — document section-only edit | P3-AI-ENGINE · Document · Edit; post-fix neighbor check | PASS — on application commit 9d6a4bf3, exact prompt “Rewrite the second section to be more concise.” changed only section 2 and persisted after reload; all four headings, original conclusion, and other current document content remained. The reply called the edit staged/not saved while it persisted after reload; see LV-022 (NEEDS-DECISION). Evidence: `.spectra-local/live-verification/P3-AI-ENGINE-section-edit-after-reload-4f8103b6-redacted.png`; 0 console errors | LV-022 (NEEDS-DECISION) | 9d6a4bf3 |
| P3-AI-ENGINE — document F5 first-token comparison | P3-AI-ENGINE · Document · Edit (F5) | BLOCKED — no pre-fix `main` baseline was available for comparison; the 16.5s Work Surface change is not a first-token measurement | — | d61b1e25 |
| P3-AI-ENGINE — document conclusion append (report prompt) | P3-AI-ENGINE · Document · Append | PASS — the exact “Add a conclusion paragraph.” prompt produced the concluding paragraph, which remained in the document after reload and later stack restart; its save-state wording mismatch is tracked under LV-022 | LV-022 (NEEDS-DECISION) | 427cb3c9 |
| P3-AI-ENGINE — document rich formatting | P3-AI-ENGINE · Document · formatting neighbor check | FAIL — the first bold request said it could not apply formatting; a repeated run stayed working for 120s, then reached `failed_terminal` while “leaders feared” became bold and remained bold after reload. Evidence: `.spectra-local/live-verification/P3-AI-ENGINE-document-bold-after-reload-d61b1e25-redacted.png`; `.spectra-local/live-verification/P3-AI-ENGINE-document-bold-failed-run-d61b1e25-redacted.png` | LV-022 (NEEDS-DECISION) | d61b1e25 |
| P3-AI-ENGINE — append to an existing document conclusion | P3-AI-ENGINE · Document · Append neighbor check | PASS — after the fix, both recorded final-sentence prompts completed; each requested sentence appeared once after reload, while the original conclusion and four section headings remained; 0 console errors | LV-023 (VERIFIED) | 9d6a4bf3 |
| P3-AI-ENGINE — append a new final document paragraph (post-fix neighbor check) | P3-AI-ENGINE · Document · Append neighbor check for LV-023 | PASS — on 45281d26, the requested paragraph appeared once; both prior append sentences, the original conclusion and all four section headings remained once after reload and full local stack restart. Evidence: `.spectra-local/live-verification/LV-024-postfix-document-before-reload-45281d26-redacted.png`; `.spectra-local/live-verification/LV-024-postfix-document-after-reload-45281d26-redacted.png`; 0 console errors, 1 Clerk development-key warning | LV-024 (VERIFIED) | 45281d26 |
| P3-AI-ENGINE — flashcard create and hint edit | P3-AI-ENGINE · Flashcard deck · create and edit | PASS — created exactly 8 cards; card 3's hint remained changed after reload | — | 7a1a8508 |
| P3-AI-ENGINE — flashcard append | P3-AI-ENGINE · Flashcard deck · append | PASS — the fixed append added four distinct cards; all 12 remained after reload and card 3's hint stayed intact | LV-021 (VERIFIED) | 68587ec8 |
| P3-AI-ENGINE — flashcard append save-state message | P3-AI-ENGINE · Flashcard deck · append | FAIL — response said “The update is proposed, not yet saved” while the chat showed “Saved progress and results” and all 12 cards remained after reload | LV-022 | 68587ec8 |
| P3-AI-ENGINE — flashcard rewrite | P3-AI-ENGINE · Flashcard deck · rewrite | PASS — all 12 cards' fronts, backs and hints were in Spanish after rewrite and reload; card count remained 12 | — | 68587ec8 |
| P3-AI-ENGINE — quiz create/edit/append | P3-AI-ENGINE · Quiz | PASS — created six questions with 4 multiple choice/2 short answer; the harder Q2 edit persisted; appended two enzyme questions and after reload retained all eight questions with 5 multiple choice/3 short answer; 0 console errors. Evidence: `.spectra-local/live-verification/P3-AI-ENGINE-quiz-append-verified-d61b1e25-redacted.png` | — | d61b1e25 |
| P3-WORKSPACE-FLOWS — command bar keyboard focus and search | P3-WORKSPACE-FLOWS · step 5 | FAIL — clicking the visible command-bar button opened the list, showed Update memory, focused its Memory field, and both Escape steps restored focus correctly; searching `share` showed no command asking for an ID. Pressing Ctrl+Shift+F twice instead focused `Search recent chats` with no dialog. Evidence: `.spectra-local/live-verification/P3-WORKSPACE-FLOWS-command-bar-shortcut-45281d26-redacted.png`; `.spectra-local/live-verification/LV-028-command-bar-shortcut-observation-redacted.txt` | LV-028 (OPEN) | 45281d26 |
| P3-WORKSPACE-FLOWS — Calendar DST view and default event time | P3-WORKSPACE-FLOWS · step 2 | FAIL — after restarting local instance 8 with application commit `7bce0577`, Calendar loaded; every date from 20 Oct through 3 Nov appeared once, including 27 Oct. The three default start/end pairs were 19:05–20:05, 19:06–20:06, and 19:07–20:07 local, rather than the next whole hour. Evidence: `.spectra-local/live-verification/LV-029-calendar-dst-postfix-7bce0577-redacted.png`; `.spectra-local/live-verification/LV-029-calendar-postfix-7bce0577-observations-redacted.txt`; `.spectra-local/live-verification/LV-033-calendar-default-time-7bce0577-redacted.png`; `.spectra-local/live-verification/LV-033-calendar-default-time-7bce0577-fresh-redacted.png`; `.spectra-local/live-verification/LV-033-calendar-default-time-observations-redacted.txt` | LV-029 (VERIFIED), LV-033 (OPEN) | 7bce0577 |
| P3-WORKSPACE-FLOWS — public agent preview and install | P3-WORKSPACE-FLOWS · step 7 | BLOCKED — after the local catalog migration, `/agents` reached its empty state; no authorized public agent fixture was available for the preview/install actions | LV-030 (VERIFIED) | 7bce0577 / local migration `17f7a5f9` |
| Free exploration — `/agents` library | exploration · first-week /agents | PASS — after the local catalog migration, all four collections showed “No agents in this collection yet.” The measured reload reached the empty state in 3.6 seconds; no load error, Retry action, or HTTP error was observed. Evidence: `.spectra-local/live-verification/LV-030-agents-empty-state-17f7a5f9-redacted.png`; `.spectra-local/live-verification/LV-030-agents-empty-state-observations-redacted.txt` | LV-030 (VERIFIED) | 7bce0577 / local migration `17f7a5f9` |
| P3-WORKSPACE-FLOWS — Library Trash and offline Undo | P3-WORKSPACE-FLOWS · step 8 | PASS — LV-031 permanent deletion passed; LV-032 displayed Retry offline and a Retry after reconnection restored the item once and persisted after reload; LV-034 Trash pointer activation passed at 1280×720. Evidence: .spectra-local/live-verification/LV-031-postfix-empty-trash-a1bd0258-redacted.png; .spectra-local/live-verification/LV-032-postfix-offline-undo-toast-35921472-redacted.png; .spectra-local/live-verification/LV-034-postfix-pointer-35921472-redacted.png | LV-031 (VERIFIED), LV-032 (VERIFIED), LV-034 (VERIFIED) | a1bd0258 / 35921472 |
| P3-WORKSPACE-FLOWS — Retry while already offline | LV-032 post-fix adjacent check | PASS — after the fix, offline Undo showed one Retry notice; two consecutive retries while offline retained exactly one notice; online Retry restored the uniquely named disposable verifier document, cleared the notice, and the item remained in Recent after reload. Evidence: .spectra-local/live-verification/LV-035-postfix-retry-one-e9d438e9-redacted.png; .spectra-local/live-verification/LV-035-postfix-retry-two-e9d438e9-redacted.png; .spectra-local/live-verification/LV-035-postfix-console-summary-e9d438e9-redacted.txt | LV-035 (VERIFIED) | 51d6529a (app code at 3e22ac4c) |
| P3-WORKSPACE-FLOWS — Library work open while offline | exploration · LV-035 adjacent reliability check | FAIL — the original two attempts left a blank view with no Retry action and required reload; two fresh follow-up attempts instead retained the Library shell and item with an offline status notice and retry-matching controls. The subsequent online retry-related click set `artifactId`, but editor content was not established. See LV-036. Evidence: `.spectra-local/live-verification/LV-036-route-work-offline-no-retry-51d6529a-redacted.png`; `.spectra-local/live-verification/LV-036-route-work-online-still-blank-51d6529a-redacted.png`; `.spectra-local/live-verification/LV-036-route-work-online-after-reload-51d6529a-redacted.png`; `.spectra-local/live-verification/LV-036-route-work-offline-observations-redacted.txt`; `.spectra-local/live-verification/LV-036-dom-inventory-4bccfbf2-redacted.txt` | LV-036 (NEEDS-INFO) | 4bccfbf2 (app code at 3e22ac4c) |
| Mobile-dimension checks | explicit user scope instruction · 2026-09-30 | BLOCKED — the user explicitly instructed the verifier not to conduct mobile-dimension testing; no further phone-width or mobile-drawer verification will be run | — | — |

| P3-WORKSPACE-FLOWS — stale Calendar conflict | P3-WORKSPACE-FLOWS · step 1 | BLOCKED — Calendar returned HTTP 500 before a block could be loaded or dragged; see LV-029 | LV-029 (OPEN) | 45281d26 |
| P3-WORKSPACE-FLOWS — Calendar removal and official-event controls | P3-WORKSPACE-FLOWS · step 3 | BLOCKED — the Calendar data view remained unavailable after HTTP 500, so no personal event, plan block, or official event control could be inspected; see LV-029 | LV-029 (OPEN) | 45281d26 |
| P3-WORKSPACE-FLOWS — scheduled plan block details | P3-WORKSPACE-FLOWS · step 4 | BLOCKED — the Calendar and Plans panels did not load, so no scheduled block could be opened; see LV-029 | LV-029 (OPEN) | 45281d26 |
| P3-WORKSPACE-FLOWS — Chat search workspace selection | P3-WORKSPACE-FLOWS · step 6 | PASS — searched for `Wa`, selected the `General` workspace result, and the dialog closed with focus on the search button; reopening showed an empty field. Console: 0 errors, 1 Clerk warning | — | 45281d26 |

## Issues

### LV-001 · Fresh local stack stops before readiness

- **Status:** VERIFIED
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

**Verification** (verifier): VERIFIED, commit `690266bc`, 2026-09-30. A fresh instance with empty selectors displayed the project prompt in the terminal, then reported the local Convex backend, web app, gateway and Bridge ready. Stopping and restarting that instance returned it to ready without another project prompt and retained the same local deployment name; its local database file remained present. Cancelling setup on a separate fresh instance exited before readiness and left its ports unused.

### LV-002 · Workspace gate emits repeated console errors without a school

- **Status:** VERIFIED
- **Severity:** Medium
- **Surface / role:** `/workspace` / signed-in user without school membership
- **Report script:** exploration · first use on a fresh local instance
- **Commit tested:** 690266bc
- **Frequency:** Reproduced on the initial load and reload (2 of 2); not reproduced on four post-restart loads.

**Steps**
1. Start a fresh local Convex instance on commit `690266bc` and sign in with the saved Profile A session; leave the new database without a school or membership.
2. Open `http://localhost:3060/workspace` and wait for the page to load.
3. Reload the page and inspect the Playwright console.

**Expected:** The page displays “You are signed in. Accept the invitation for this school, then your workspace will load.” without console errors or failed requests.

**Actual:** The invitation gate displays, but the browser records 26 console errors per load, including repeated `ConvexError: AUTH_ACCOUNT_REQUIRED` from `accountPreferences:writeLayer` and two HTTP 403 responses from `/api/spectra?action=runTabs&limit=120` (including the `surface=workspace` request).

**Evidence:** .spectra-local/live-verification/LV-002-no-school-console.png; Playwright console excerpt (request IDs redacted): “26 errors, 1 warning”; `accountPreferences:writeLayer` → `AUTH_ACCOUNT_REQUIRED`; `/api/spectra?action=runTabs&limit=120` → 403. Rechecked after restart twice: 0 console errors, and workspace `runTabs` requests returned 200; screenshot .spectra-local/live-verification/LV-002-no-school-clean-recheck.png; .spectra-local/live-verification/LV-002-verified-d551198a.png.

**Fix** (fixer)
- Commit: `94d3cbb3868420de73147424ee5d52f58c8f865f` (`fix(auth): settle account reads before joining a school (LV-002)`).
- Root cause: Account preferences were indexed by account but authorized through `getAuthenticatedActor`, which requires an active school membership. Returning an empty layer list for the unavailable actor advertised readiness to every mounted preference hook, while migration writes failed and their promise had no rejection handler. Separately, the existing no-school empty-read contract omitted `runTabs`, so both the Live Dock and surface run observer received 403 despite the correct invitation gate.
- Change: authorize preference reads/writes with the verified active account, keeping account isolation and rejecting unregistered, unverified and inactive accounts. Return `null` while account registration is pending; the preference subscription keeps watching and migration waits until a ready layer list arrives, with failures using the existing save-error state. Include run tabs in the shared no-school empty-read path, covering the global dock and every surface/filter without weakening other authorization errors.
- Test: Before the fix, the backend/route regressions produced five failures (including both reported 403 requests); the migration failure test also failed with an unhandled rejection. After the fix, focused backend, route, hook, merge, receipted-settings, AI scope-security, observation-writer and module-graph suites passed **90 tests**. Both TypeScript checks, full lint and all five gates passed. Full suite: **4,305 passed, 1 failed, 1 skipped**; the unchanged run-route Stop authorization case timed out at 15 seconds. Its file passed **59/59** tests when rerun alone.
- Re-check nearby: reload `/workspace` with a verified signed-in account and no school on a fresh database; the invitation gate should remain and there should be no preference mutation errors or failed run-tab requests. Check first registration, reload after migration, settings on `/superadmin` before membership, then joining a school and restoring normal run visibility. Check that a different account cannot see these preferences and that a signed-out/unverified account still cannot read run tabs. No schema/codegen or shared deployment step is required; the local verifier should load the committed backend code before re-checking.

**Verification** (verifier): VERIFIED on commit `d551198a`, 2026-09-30. Restarted local instance 4 on the committed code, opened `/workspace` in Profile A with no school membership, and reloaded it. The invitation gate remained visible; the page had 0 console errors. Both `runTabs` requests (default and `surface=workspace`) returned HTTP 200. Opening `/settings` before membership rendered the Conversations settings with 0 console errors. Screenshot: .spectra-local/live-verification/LV-002-verified-d551198a.png.
### LV-003 · Expired invitation request returns HTTP 404 errors

- **Status:** NEEDS-DECISION
- **Severity:** Medium
- **Surface / role:** `/join?token=<expired>` / signed-in user
- **Report script:** P2-EXPERIENCE · step 2
- **Commit tested:** 690266bc
- **Frequency:** Reproduced on 2 of 2 visits; each visit produced two failed requests

**Steps**
1. In the saved Profile A session, open `http://localhost:3060/join?token=expired-live-verification-sentinel` on the fresh local instance.
2. Wait for the unavailable-invitation state and inspect the browser console and requests.

**Expected:** “a plain message, no Retry button, no raw code, and the invitation cookie is cleared.”

**Actual:** The page shows the plain alert “This invitation is unavailable.” with no Retry button or raw token. No invitation-named browser cookies remain. The same visit also produces two console errors: POST requests to `/api/spectra/administration` return HTTP 404.

**Evidence:** .spectra-local/live-verification/LV-003-expired-invite.png; Playwright console: “2 errors” with two POST `/api/spectra/administration` responses of 404 (authorization values redacted).

**Fix** (fixer)
- Commit: no implementation change; this is an assessment of the existing response contract.
- Root cause: The reported sentinel is an unknown token, so `memberships:previewInvitation` intentionally throws `INVITATION_INVALID`; the shared route mapper intentionally answers 404 (an actually expired stored invitation answers 410). The join page treats that as a final domain decision, clears the cookie, and displays the report's expected plain message without Retry. The two preview requests are reproduced by development React Strict Mode replaying the mount effect; they are not automatic retries after the invitation refusal.
- Change: none pending the decision below. Changing response semantics solely to remove expected browser network-error entries would alter the intended API/client contract.
- Test: existing join-page, invitation-session and production-redaction/worded-error suites passed **13/13**. A temporary diagnostic wrapping the real Join page in `StrictMode` also passed an assertion of exactly two preview requests while retaining the final plain error and clearing the cookie; the diagnostic edits were restored, leaving application/test source unchanged. Installed Next enables App Router Strict Mode by default, and this checkout does not override it. Earlier P3-CONVEX-ERRORS explicitly records invalid invitations mapping to 404.
- Decision options: **Keep the current 404/410 contract** — unavailable invitations remain final request failures with truthful statuses, and expected browser network-error entries are accepted by verification/monitoring. **Return a normal preview result with an explicit unavailable outcome** — expected invalid/expired previews can answer 200 and avoid those browser network errors; the administration preview response, client outcome handling and contract tests must change together, while authentication/transport failures retain their error statuses. Neither option is selected by the fixer.
- Re-check nearby: after a decision, verify unknown, revoked and genuinely expired tokens, valid previews, cookie clearing, no final-decision retry, and transient-failure retry. If duplicate requests occur in a production-mode build, record that separately; the exact two-request pattern has been reproduced in development Strict Mode.

### LV-004 · Unexpired initial school administrator invite is unavailable

- **Status:** CANNOT-REPRODUCE
- **Severity:** High
- **Surface / role:** `/join?token=<issued>` / signed-in initial school administrator
- **Report script:** W2-14 · step 1; P2-EXPERIENCE · step 3
- **Commit tested:** d551198a
- **Frequency:** Reproduced on both initial load and reload of the same unexpired invitation (2 of 2)

**Steps**
1. Start local instance 4 and sign in through the saved Profile A session.
2. In Super Admin, add a local school and set Profile A as its initial school administrator.
3. Open the invitation link from the loopback-only local mail sink in the same Profile A browser session.
4. Reload the invitation page once.

**Expected:** W2-14 step 1 says to “preview school/role/email match, accept, reload `/workspace`, and read back one active membership plus a ready initial-admin saga where applicable.”

**Actual:** Both page loads show “This invitation is unavailable.” and a disabled “Join school” button. No school membership is created. Each load also records two POST requests to `/api/spectra/administration` with HTTP 404 responses.

**Evidence:** .spectra-local/live-verification/LV-004-admin-invite-unavailable.png; Playwright console excerpt: 2 errors per load, both `/api/spectra/administration` POST requests returning 404; invitation token and identity redacted.

**Fix** (fixer)
- Commit: assessment only; no application change.
- Root cause: The real-model creation/preview/accept flow works with the issued token. The verifier subsequently confirmed the mail sink held quoted-printable MIME with 18 soft line breaks and encoded equals signs; following the decoded HTML href yielded the correct 43-character token, a valid preview, and an enabled Join school button. This points to the original link extraction from encoded mail, rather than the application rejecting its stored unexpired invitation.
- Change: No application change. Record the corrected decoded-link observation; do not special-case MIME artifacts in invitation authentication.
- Test: **16/16** onboarding, membership-accept and operator-route tests passed. A temporary real-model diagnostic used a generated 43-character token, created an initial-admin invitation for the signed-in platform operator, round-tripped its join URL, previewed the correct school/role/email match, accepted it, and read back one membership and a ready saga; the diagnostic was restored afterward.
- Re-check nearby: Continue acceptance with the decoded link, reload /workspace, and confirm one active membership plus a ready initial-admin saga. Decode MIME before extracting future invitation links.

**Resolved live question:** Verifier reported quoted-printable encoding artifacts, 18 soft breaks, a decoded token length of 43, and a valid preview with Join school enabled. Token and identity were not logged.
### LV-005 · School data surfaces fail when Profile A has no membership

- **Status:** VERIFIED
- **Severity:** Medium
- **Surface / role:** `/school-data` and `/managebac` / signed-in superadmin without an active school membership
- **Report script:** exploration · first-week superadmin, `/school-data` and ManageBac
- **Commit tested:** d551198a
- **Frequency:** Reproduced on 1 of 1 visits to each surface; 4 errors on `/school-data` and 2 on `/managebac`

**Steps**
1. Start local instance 4 on commit `d551198a` and sign in through the saved Profile A session with no accepted school membership.
2. Open `http://localhost:3060/school-data` and wait for the overview state.
3. Open `http://localhost:3060/managebac` in the same session and inspect the page and console.

**Expected:** The no-school state explains that school data is unavailable until the account joins a school.

**Actual:** `/school-data` says “School records could not be read just now” and “School could not load — Check your connection, then try loading School again.” Its `/api/spectra/managebac` and `?action=myClasses` requests each return HTTP 403 twice. `/managebac` shows the message “This account does not have an active school membership,” but its `?action=overview` request returns HTTP 403 twice. The two pages together record six failed requests.

**Evidence:** .spectra-local/live-verification/LV-005-school-data-no-membership.png; .spectra-local/live-verification/LV-005-managebac-no-membership.png; Playwright console excerpts show the 403 responses; identity values redacted.

**Fix** (fixer)
- Commit: `952438614e8cf8f74c44782c38c69b8530b438f8` (`fix(school): require membership before mounting data readers (LV-005)`).
- Root cause: The School and ManageBac pages mounted school-scoped readers without checking whether the signed-in account had a membership. The API correctly rejected those reads; School then discarded the structured refusal and showed connection advice. Development effect replay repeated the rejected reads.
- Change: one shared server membership gate checks the current membership before mounting the readers on /school-data, its /school alias, and /managebac. Accounts without membership see shared invitation guidance; members keep the existing surfaces, and other auth/backend failures propagate. API authorization and school-data privacy remain enforced.
- Test: Before the fix, all 15 route-boundary regression cases failed. After it, **29/29** focused route-boundary, School-action, ManageBac-dialog and operator-authorization tests passed. The regressions prove readers stay unmounted without membership, members mount them, fresh membership is requested, and signed-out/unverified/backend failures are not treated as no-school. Both TypeScript checks, full lint and all five gates passed.
- Re-check nearby: open and reload /school-data, /school and /managebac before accepting an invitation: show the join guidance without ManageBac GETs, connection advice or Retry. After accepting, reload each route and confirm the normal records/integration UI loads. Check removed membership is reflected after reload. No codegen or shared deployment step is needed.
### LV-006 · Analytics emits 403 errors for the no-membership state

- **Status:** FIXED
- **Severity:** Low
- **Surface / role:** `/analytics` / signed-in superadmin without an active school membership
- **Report script:** exploration · first-week superadmin, `/analytics`
- **Commit tested:** d551198a
- **Frequency:** Reproduced on initial load and reload (2 of 2); two failed requests per load

**Steps**
1. Start local instance 4 on commit `d551198a` and sign in through the saved Profile A session without an active school membership.
2. Open `http://localhost:3060/analytics` and wait for the no-membership state.
3. Reload the page and inspect the browser console.

**Expected:** The page presents the unavailable state without failed requests.

**Actual:** The page says “Personal analytics: Temporarily unavailable” and “This account does not have an active school membership.” Each load also sends two GET requests to `/api/spectra/analytics`, both returning HTTP 403 and appearing as console errors.

**Evidence:** .spectra-local/live-verification/LV-006-analytics-no-membership.png; Playwright console excerpt: 2 HTTP 403 errors per load; date-range query values omitted.

**Fix** (fixer)
- Commit: `661791538f937d3774e559b903b7c7f511c5493a` (`fix(analytics): wait for membership before loading school metrics (LV-006)`).
- Root cause: Analytics mounted its school-scoped reader before establishing that the account had a current school membership. Its API correctly refused the request, and development effect replay doubled it; the unavailable copy came only after those failures. This is the same missing page boundary diagnosed in LV-005.
- Change: Reuse the shared server membership gate on /analytics. Without membership, invitation guidance is rendered before the analytics reader mounts; current members keep the existing analytics and other auth/backend errors still propagate.
- Test: The five new Analytics boundary cases failed before the change while the 15 School/ManageBac cases stayed green. After it, **34/34** boundary, operator-authorization and bounded analytics model tests passed. Both TypeScript checks, full lint and all five gates passed. Full suite: **4,326 passed, 0 failed, 1 skipped** (497 passed files, 1 skipped).
- Re-check nearby: open and reload /analytics without membership: invitation guidance, no analytics GETs and no 403 console errors. After acceptance, reload to confirm normal analytics, role-specific scope and metrics availability. API access still requires membership. No codegen or shared deployment step is required.
### LV-007 · ManageBac disconnect Escape behavior by state

- **Status:** CANNOT-REPRODUCE
- **Severity:** Low
- **Surface / role:** `/managebac` / school administrator
- **Report script:** P3-SURFACES-2 · step 8
- **Commit tested:** d712d92b
- **Frequency:** 1 of 1 delayed-response pending check; idle confirmation tested separately

**Steps**
1. In the saved Profile A session on local instance 4, open `/managebac` as the school administrator of the test school.
2. Choose **Disconnect ManageBac**, then confirm **Disconnect** while the local app response is delayed and intercepted before it reaches the backend.
3. While the confirmation remains open and both answers are disabled, press Escape.

**Expected:** P3-SURFACES-2 step 8 says, “Escape during the disconnect does nothing.”

**Actual:** While the delayed request is pending, the alert dialog remains open and both **Keep connected** and **Disconnect** remain disabled after Escape. The local intercepted request receives a synthetic HTTP 503 and the school connection remains configured. Before confirming, Escape closes the idle dialog and returns focus to **Disconnect ManageBac**.

**Evidence:** .spectra-local/live-verification/P3-SURFACES-2-managebac-disconnect-confirmation.png; .spectra-local/live-verification/P3-SURFACES-2-managebac-disconnect-pending.png; Playwright during pending: alertdialog count 1 → 1; both answer buttons stayed disabled; intercepted local POST `/api/spectra/managebac` returned synthetic HTTP 503 after the Escape check; 0 browser console errors before that response. No ManageBac request, email or API key was recorded.

**Fix** (fixer)
- Commit: assessment only; no application change.
- Root cause: The recorded steps press Escape on the idle confirmation before clicking Disconnect; no disconnect request is pending. The report's S7 fix description and existing test require dismissal to be blocked while busy, and the live-script phrase “during the disconnect” refers to that running action. The shared ConfirmDialog intentionally allows cancellation before confirmation, then blocks dismissal and disables both answers while pending.
- Change: none. Changing the idle dialog to ignore Escape would change the shared confirmation contract without reproducing a failure of its pending guard.
- Test: **8/8** ManageBac-dialog and shared modal-focus tests passed. Temporary diagnostics reproduced the reported idle Escape calling onClose once with no onConfirm call, then confirmed that clicking Disconnect and rerendering pending leaves the alert dialog open on Escape, does not call onClose, and disables both answers. Existing “cannot be dismissed while the disconnect runs” also passes. Diagnostic source edits were restored byte-for-byte.
- Re-check nearby: distinguish opening the confirmation from starting the disconnect. Before confirmation, Escape cancels and returns focus to the opener; during a pending confirmed action, Escape and both answers must do nothing. Continue Settings/Manifest focus-return checks. The pending contract can be tested with a delayed local mocked request without disconnecting a real provider.

**Verification** (verifier): CANNOT-REPRODUCE on commit `d712d92b`, 2026-09-30. With a 5.5-second delayed, intercepted local POST, pressing Escape while the confirmed disconnect was pending left the alert dialog open and both answers disabled (1 of 1). The response was released as a synthetic 503 without reaching the backend; the integration remained configured. The one browser console error occurred only after that injected 503. The Settings and Manifest dialogs both closed on Escape and returned focus to their opening buttons. The earlier idle-confirmation Escape observation is withdrawn; that idle cancel is expected.

### LV-008 · Workspace fails for a signed-in account without a school

- **Status:** VERIFIED
- **Severity:** High
- **Surface / role:** `/workspace` / signed-in platform superadmin without an active school membership
- **Report script:** exploration · first-week superadmin, workspace without a school
- **Commit tested:** d712d92b
- **Frequency:** 2 of 2 loads (initial and reload)

**Steps**
1. Start fresh local instance 8 on commit `d712d92b` and sign in with the saved Profile A session, with no school membership in the fresh local Convex deployment.
2. Open `http://localhost:3000/workspace`.
3. Select **Reload page** and wait for the page to finish loading.

**Expected:** The LV-002 re-check says “the invitation gate should remain.”

**Actual:** Both loads show “Something went wrong” and “Spectra could not finish this step”, with **Try again** and **Reload page** controls. The console logs `CONVEX Q(orgTree:liveIdentities)` and `AUTH_NO_SCHOOL: An active school membership is required` twice per load. No failed browser requests or page errors were observed.

**Evidence:** .spectra-local/live-verification/LV-008-workspace-orgtree-no-school.png; Playwright console excerpt: `CONVEX Q(orgTree:liveIdentities)` / `AUTH_NO_SCHOOL: An active school membership is required` (2 errors per load); network: 0 failed requests; page errors: 0.

**Fix** (fixer)
- Commit: `683803d14a0a00f01d7d84567b5875cc36fe9af4` (`fix(auth): wait for membership before subscribing to school reads (LV-008)`).
- Root cause: The shared Convex subscription guard checked sign-in but did not check school membership. Restored open-object state supplied nonempty identity sources even on a fresh deployment, so the shell subscribed to orgTree:liveIdentities before its invitation gate rendered. The backend correctly rejected that school-scoped query and Convex delivered the exception through useQuery into the error boundary.
- Change: reuse the existing reactive catalogGraph.identity in the shared guard; school reads wait while identity is loading or has no active membership, resume when membership appears, and stop when it is removed. The catalog identity bootstrap explicitly remains account-scoped to avoid a dependency cycle. The same guard covers every tree subscription, artifact/studio and Bridge replica/sync-policy/mount reads, and the conversation active-execution observer, retaining backend authorization and normal member behavior.
- Test: Before the fix, the five regression cases failed, including both pending and absent membership with a saved workspace source. After it, **47/47** focused reactive-guard, replica-auth, catalog-caller, conversation-history, conflict-resolution, catalog-graph and module-graph tests passed; the new suite also checks membership arrival/removal, sign-out, explicit skip and identity bootstrap. Both TypeScript checks, full lint and all five gates passed. Full suite: **4,330 passed, 2 failed, 1 skipped**; the unchanged run-route no-school Stop case returned 409 instead of 403 under the full run, and the unchanged dense-sheet timing test took 43.89 ms against 40 ms. Both files passed **136/136** tests in an isolated rerun.
- Re-check nearby: load/reload /workspace and /library on a fresh local database with signed-in no-school Profile A and saved open-object state; invitation guidance must remain without orgTree errors. Check stale workspace/work/thread deep links, then acceptance enabling normal reads and membership removal stopping them; re-check artifact Bridge controls and the conversation execution observer for a current member. No schema, codegen or shared deployment step is required.

**Verification** (verifier): VERIFIED on commit `683803d1`, 2026-09-30. In fresh local instance 8 with saved Profile A and no membership, the initial `/workspace` load and reload showed the invitation gate; neither showed the generic error boundary, an `AUTH_NO_SCHOOL` console message, or a page error. A separate artifact request failure is recorded as LV-009.

### LV-009 · Workspace and Library make failed artifact requests

- **Status:** VERIFIED
- **Severity:** Medium
- **Surface / role:** `/workspace` and `/library` / signed-in Profile A before and after accepting the local initial-admin invitation
- **Report script:** exploration · first-week school admin, workspace and Library reloads
- **Commit tested:** 683803d1
- **Frequency:** no-school `/workspace` reload: 1 of 1 captured requests returned 403; after acceptance, 2 of 2 `/workspace` loads and 1 of 1 `/library` loads returned 500

**Steps**
1. Start fresh local instance 8 on commit `683803d1` and sign in with saved Profile A before it has a school membership.
2. Open `http://localhost:3000/workspace` and reload once. The invitation gate appears, while the artifact request returns HTTP 403.
3. In Super Admin, create the local test school with Profile A as its initial administrator; copy the secure link using the product button and accept the invitation as Profile A.
4. Open `http://localhost:3000/workspace`, reload twice, then open `http://localhost:3000/library`.

**Expected:** W2-14 step 1 says to “reload `/workspace`, and read back one active membership plus a ready initial-admin saga where applicable.” The workspace and Library should load without failed artifact requests or console errors.

**Actual:** Before membership, the invitation gate renders, but one captured reload makes a GET request to `/api/spectra?action=artifact&artifactId=[redacted]` that returns HTTP 403 and produces a browser console error. After invitation acceptance, the workspace and Library views render, but each tested load makes the same GET request and receives HTTP 500, with one matching browser console error per response. The 500 response contains `error.code: INTERNAL_ERROR` and the message “Spectra could not finish this request. Check your connection, then try again.” No page errors were observed.

**Evidence:** .spectra-local/live-verification/LV-009-workspace-artifact-500.png; Playwright network excerpt: GET `/api/spectra?action=artifact&artifactId=[redacted]` → HTTP 403 (one no-school reload), then HTTP 500 (2 workspace loads, 1 Library load); 500 response code/message as above; one corresponding console error per response; no page errors.

**Fix** (fixer)
- Commit: `c9034739a7280bde4417f6c44ce172c6a0e9b8ff` (`fix(workbench): restore references only for their account and deployment (LV-009)`).
- Root cause: Workbench references persisted without an account/deployment owner and were restored before any ownership check; the old account observer checked only in-page Clerk changes and its cleanup omitted context/shared panes and in-memory context. The fixer read the local Convex log API without printing credentials or IDs: six spectraArtifacts:get failures were ArgumentValidationError on .artifactId, where the saved ID resolved to schoolGroupMembers in the fresh deployment, before the worded-error handler could classify it. Separately, Boolean(overview) permitted saved-artifact hydration when the overview explicitly reported needsSchool, accounting for the observed pre-membership 403.
- Change: replace the existing account observer with a boundary binding stored references to configured Convex URL, Clerk user and reactive account ID before AppShell mounts restoring readers. Reuse existing account-scoped cleanup and include persisted context, shared panes and in-memory context; preserve normal same-scope restoration, while unknown legacy references and changed account/deployment references are reset. Account registration can still bootstrap from a null identity; no-school overviews do not hydrate saved artifacts. This covers work/thread/workspace references, continuation/context, hub tabs and panes without weakening backend validation or permissions.
- Test: All five original ownership regressions failed before the fix. **68/68** focused ownership, boundary-ordering, route, artifact-access/content and membership-page tests pass afterward; the boundary cases prove cleanup precedes restored readers, same-account restoration survives reload, and a database reset on the same URL/Clerk session is distinguished by account ID. Both TypeScript checks, full lint and all five gates passed. A prior temporary real-model different-table diagnostic reproduced HTTP 500 / INTERNAL_ERROR; its source edits were restored. Full suite: **4,340 passed, 1 failed, 1 skipped** (499 passed files, 1 failed, 1 skipped). The unchanged signed-out Stop case returned 409 instead of 401 under load; its file passed **59/59** in isolation. Redacted local backend evidence: .spectra-local/launch-fixer-LV009-backend-redacted.json.
- Re-check nearby: on this committed revision, reload Workspace and Library with the saved Profile A session: no old artifact requests, 403/500 console errors, or generic boundary. Create/open valid local work and confirm same-scope reload restores it; then check sign-out/account switch, a fresh database at the same URL, and no-school registration/acceptance. Unknown legacy workbench UI state is reset once; current scoped state persists. Durable product records are unchanged; no schema, codegen or shared deployment step is required.

**Verification** (verifier): VERIFIED on commit `c9034739`, 2026-09-30. Reloaded `/workspace` as the signed-in initial school administrator and opened `/library`; neither route emitted a failed artifact request or console error. Then created a document through Library and opened the same valid local artifact in a second tab; the artifact GET returned HTTP 200 and the document editor rendered. The separate pending-save observation is recorded as LV-011.

### LV-010 · ManageBac identity resolution remained blocked after admin capability review

- **Status:** VERIFIED
- **Severity:** High
- **Surface / role:** /managebac school setup and sync / school administrator
- **Report script:** W1-16 · step 6, ManageBac school journey
- **Commit tested:** c119147d (app code 0a8a2360; current local Convex body loaded after the instance 8 launcher restart)
- **Frequency:** The earlier blocked state was reproduced across 8 action attempts; after the current local Convex body was loaded, identity resolution and Sync now each completed on 1 of 1 attempts.

**Steps**
1. Start local instance 8 and sign in with saved Profile A as the administrator of the local test school Spectra Launch QA School.
2. On /managebac, open ManageBac settings, enter the authorized key from .env.local in School-wide API key, leave the canonical endpoint at its prefilled standard value, and save the settings.
3. Open Review capabilities. Confirm that the listed read-only capabilities display as verified.
4. Return to Overview and note the Integration status.
5. Select Resolve my school identity once.
6. Select Sync now once.

**Expected:** W1-16 step 6 says to “Configure a read-only fixture, complete capability validation and authenticated school identity, select classes, materialize workspaces, sync tasks/calendar/resources, exercise review conflicts, then repeat the relevant surfaces as teacher and student. Verify that admin data does not expose private ordinary content.”

**Actual:** In the saved Profile A browser, the school administrator entered the configured key from `.env.local` in ManageBac settings with the standard endpoint; the settings POST returned HTTP 200. Review capabilities listed eight read-only capabilities as verified, but Integration remained Blocked. Reloaded Overview said “The connection needs attention” and displayed “last synchronized never,” 0 conflicts, Classes 0, Calendar 0, and Tasks 0. Resolve my school identity and Sync now each returned HTTP 409 and displayed “Ask a school administrator to review the ManageBac connection and its verified read-only routes before trying again.” Neither completed identity resolution or synchronization.

**Evidence:** .spectra-local/live-verification/LV-010-managebac-identity-500.png; .spectra-local/live-verification/LV-010-managebac-identity-409-recheck.png; .spectra-local/live-verification/LV-010-managebac-verified-capabilities-blocked.png; .spectra-local/live-verification/LV-010-managebac-overview-blocked-panel-top.png; .spectra-local/live-verification/LV-010-managebac-409-after-resave-0a8.png; Playwright request excerpts from the current Profile A run: settings POST /api/spectra/managebac → HTTP 200; identity and Sync now POSTs to /api/spectra/managebac → HTTP 409 each; .playwright-cli/console-2026-09-30T05-45-52-785Z.log lines 5–6 record the two action errors. No key, email, or provider record values are included.

**Fix** (fixer)
- Commit: `4bfe0a8662e11be100033e5117fab851e487d824` fixes the confirmed action error-copy defect; the original HTTP 500 is CANNOT-REPRODUCE after restart.
- Root cause: The repeat request returned the intended INTEGRATION_NOT_READY 409, but the shared API reader discarded its structured code. The action formatter then replaced all unrecognized reasons with failed-sync copy, hiding the backend explanation even for identity/configuration actions. The earlier 500 did not recur after restart, and its backend logs were cleared; no backend 500 cause is claimed fixed.
- Change: Preserve structured route error data on the existing Error across shared API readers and use readConvexError in the ManageBac UI. Not-ready actions now explain administrator connection/verified-route recovery; other worded action messages and existing sync recovery remain available.
- Test: Three regressions failed before the fix (lost HTTP error code, hidden structured not-ready reason, overwritten worded action reason). Focused API/UI/provider/honesty suites: 25 passed; both TypeScript checks, full lint and all five gates passed. The final corrected test call also passes its 19-test API/UI recheck.
- Re-check nearby: Repeat Resolve while blocked/pending and check the administrator/connection/routes guidance; review token, credential and rate-limit action messages. Re-check the original fresh-connection validation state for HTTP 500; if it returns, retain the request time/code and local backend logs and REOPEN rather than assuming this error-handling correction repairs an unknown server fault. No model, provider, capability or sync authority is relaxed.

**Verification** (verifier): REOPENED, commit 4bfe0a86, 2026-09-30. The 409 message now names the administrator and verified routes. After saving the school key and reviewing the displayed verified capabilities, the Integration card remained Blocked and both identity resolution and Sync now still returned 409.

**Reopened fix** (fixer)
- Commit: `e8cd4740701758ca611878f82bc13e4c1ee19714`.
- Root cause: A credential-rejected sync marks the integration blocked. configure preserved that status even when the administrator explicitly stored a replacement or resubmitted credential, so beginSync rejected the next identity attempt before reaching the provider; the same mutation also erased blockedReason on settings-only saves. Verified route rows alone could not escape this state.
- Change: Re-evaluate readable verified capability readiness when a blocked integration receives an explicitly stored credential. Settings-only saves retain the block and its explanation; replacement credentials still require verified readable routes, and changed connection contracts keep the existing invalidation path. This covers both identity and manual sync admission without auto-retrying rejected credentials.
- Test: Four real-model regressions failed before the fix: replacement/resubmitted credentials stayed blocked, settings-only saves lost their explanation, and a replaced credential without verified routes failed to return to validating. Focused isolation, scheduling and provider-fixture suites: 20 passed. Both TypeScript checks, full lint and all five gates passed; final full-suite result is recorded in the closeout below.
- Re-check nearby: Let the authorized local Convex watcher load the committed function body, then explicitly resave the school key via Settings and resolve identity again. A valid provider response should proceed; a genuine credential rejection may block again with its provider reason. Check settings-only saves do not bypass a block and changed endpoint/header contracts still require route validation. No schema/codegen or shared deployment action was performed; hosted Convex must receive the function body through its normal authorized release. The initial 500 remains unproven; preserve logs if it returns.

**Latest diagnostic question (fixer):** The saved local backend uses syncSavedLocalBackend with Convex dev --once, not a live function watcher. Its most recent function-ready log predates e8cd4740, so the frontend revision does not prove the new configure body is deployed. Please sync/restart instance 8 through the authorized launcher workflow using only owned local stack processes, leaving the pre-existing Bridge untouched, then explicitly resave the key and repeat Resolve with request time/code and retained local logs. No shared deployment or codegen is requested; the earlier watcher instruction was incorrect.

**Verifier response to the latest diagnostic question (2026-09-30):** Restarted only local instance 8 through the authorized launcher workflow so its saved local Convex backend loaded the current function body. In saved Profile A, the administrator re-entered the authorized key through ManageBac settings; all eight read-only capabilities displayed verified, Resolve my school identity returned HTTP 200, and Sync now returned HTTP 200 with a Complete history entry. Reloaded Overview showed Connected and a recent synchronization. The pre-restart 409 behavior did not recur. Screenshots: .spectra-local/live-verification/LV-010-managebac-current-body-sync-complete-0a8.png; .spectra-local/live-verification/LV-014-managebac-sync-history-counts-redacted.png.

**Verification** (verifier): VERIFIED on commit c119147d, 2026-09-30. After loading the current local Convex body and repeating the exact key-save, capability-review, identity-resolution, and Sync now sequence, the integration completed successfully. Playwright showed HTTP 200 for the relevant ManageBac POST requests, 0 console errors, and the latest sync history as Complete; the earlier blocked state did not return.

### LV-011 · New document edits remain pending and are absent from a second tab

- **Status:** VERIFIED
- **Severity:** High
- **Surface / role:** `/library` document editor / signed-in school administrator
- **Report script:** P3-EDITORS · persistence check; P3-BRIDGE-LENS · step 9, new artifact
- **Commit tested:** c9034739
- **Frequency:** 1 of 1 edit attempts; pending state remained after 45 seconds

**Steps**
1. On local instance 8 at commit `c9034739`, sign in using saved Profile A as the test school's administrator and open `/library` with no document selected.
2. Choose **New** → **Document**.
3. Click the work surface and type `LIVE-VERIFY-2026-09-30`.
4. Wait 45 seconds. In a second tab in the same signed-in browser context, open the document's current URL.
5. Return to the original tab and attempt a reload; dismiss the browser's before-unload dialog to keep the open draft.

**Expected:** P3-EDITORS says to “reload both browsers and confirm the result persisted.” P3-BRIDGE-LENS step 9 expects a new document to be materialized and its saved edit to come back to Spectra.

**Actual:** The original tab continued to show **Saving…** and “Connection interrupted. Reconnecting while keeping your draft.” after 45 seconds. The second tab displayed the document without the typed marker. Reloading the original tab opened a before-unload dialog; after dismissing it, the marker remained visible in that tab. The page then said the edit was safely held on this device. Selecting **Save** left the save dialog and **Saving…** state open with its controls disabled. After returning to the editor, selecting **Retry** did not clear the interrupted state or complete the save during a further five-second wait. The edit was not available in the second tab during this check.

**Evidence:** .spectra-local/live-verification/LV-011-document-reconnecting-saving.png; .spectra-local/live-verification/LV-011-new-tab-no-marker.png; .spectra-local/live-verification/LV-011-save-dialog-pending.png; Playwright network excerpt: 341 POST requests to `/api/spectra/collaboration/token` in the retained document trace, with 9 additional POSTs in a 10-second sample; those responses returned HTTP 200. No identity or credential values are included.

**Fix** (fixer)
- Commit: `d873b89c7c611a19ad60f4014ec76b0cdf2b2722`.
- Root cause: The Hocuspocus connected hook has no document field; its room is connection.document. The gateway passed undefined to canonical catch-up and recorded it for policy tracking, forcing each newly opened artifact to reconnect before durable saves could settle. Local gateway logs showed repeated COLLABORATION_AUTHORIZATION_UNAVAILABLE after these closures.
- Change: Read the connection-owned document in the shared hook, restoring canonical catch-up and room tracking for every artifact type. Updated the security hook fixtures to supply the current dependencies; authorization deadlines and revocation behavior are retained.
- Test: New real-Yjs catch-up regression failed before the fix with a forced reconnect/undefined document and now receives durable text and tracks its frontier. Focused Vitest: 37 passed; Node authorization checks: 7 passed. Both TypeScript checks, full lint and all five gates passed. Final full-suite result is recorded in the closeout below.
- Re-check nearby: Restart the local gateway to load the committed script, preserving the original draft. Save/Retry the marker, confirm it in the second tab and reload both after Saved; repeat new workbook/deck saves and cross-tab reads. No codegen or deploy-side step is needed for the local test.

**Verification** (verifier): VERIFIED on commit `d873b89c`, 2026-09-30. Restarted instance 8 with the local launcher after confirming the restart targeted only its recorded local stack PIDs; the pre-existing Bridge was reused. The preserved test marker appeared in the second tab after its first load showed the document without it. The marker then remained in both tabs after reloading each. Neither tab showed a pending **Saving…** or **Reconnecting** state after readback. Screenshot: .spectra-local/live-verification/LV-011-fixed-d873b89-second-tab.png. Bridge health errors are tracked separately as LV-012.

### LV-012 · Document startup repeatedly logs failed Bridge health requests

- **Status:** NEEDS-DECISION
- **Severity:** Medium
- **Surface / role:** `/library` document startup / signed-in school administrator
- **Report script:** P3-BRIDGE-LENS · step 9, new artifact
- **Commit tested:** `c9034739` (initial); `ed76ef1f` launcher preflight with the instance 8 runtime from `d873b89c`
- **Frequency:** Reproduced on both initial document opens; post-fix reload produced 2 failed health GETs and 4 console errors; a `/library` navigation on 2026-09-30 added 4 failed health GETs and 8 console errors; Browser B on 2026-09-30 showed 180 console errors on initial load, then 2 health entries and 4 errors after reload; Browser A's first recorded Library/editor log had 17 CORS matches, 17 `net::ERR_FAILED` matches and 34 `/v1/health` log entries; a later Browser A session log had 96 CORS and 96 `net::ERR_FAILED` lines, all matching `/v1/health`; the launcher preflight exited 1 once

**Steps**
1. On local instance 8 at commit `c9034739`, sign in using saved Profile A as the test school's administrator and open `/library`.
2. Choose **New** → **Document** and wait for the editor to render.
3. Inspect the browser console and requests whose URL is `http://127.0.0.1:47615/v1/health`.
4. Open the same document URL in a second tab and inspect the new console entries.

**Expected:** P3-BRIDGE-LENS step 9 says to “create a new document, workbook and deck in Spectra and materialize each to a native file through the Bridge.” The editor's Bridge health requests should not appear as failed browser requests during the document workflow.

**Actual:** Each observed health request failed with `net::ERR_FAILED`. The console reports that access from origin `http://localhost:3000` was blocked by CORS policy because no `Access-Control-Allow-Origin` header was present. At least 32 failed health GETs accumulated during the first editor session; the request count increased by five in a later 10-second sample. Opening the same document in a second tab produced further matching console errors. No native-file write was attempted.

After the LV-012 commit, `npm run local:start:all -- --instance 8 --timeout-seconds 30` reported the local stack ready, then exited with code 1 and reported that the occupied Bridge port was not ready for this app and a duplicate would not be started. A clean Playwright reload afterward produced two failed `/v1/health` GETs and four matching console errors. The Bridge was already running before this task and was reused by `local:start:all`; it was not restarted under the user's process instruction.

**Evidence:** .spectra-local/live-verification/LV-012-bridge-health-cors.png; .spectra-local/live-verification/LV-012-reopen-ed76.png; .spectra-local/live-verification/LV-012-reopen-ed76-2failed.png; .playwright-cli/console-2026-09-30T03-01-51-315Z.log (redacted excerpts: `/v1/health` blocked by CORS and `net::ERR_FAILED`, including post-fix lines 334–354); .playwright-cli/console-2026-09-30T03-10-09-266Z.log (same pair on second-tab load); .playwright-cli/console-2026-09-30T06-30-58-515Z.log lines 8–11 (four additional failures on `/library`). The final clean reload had 2 failed health GETs and 4 matching console errors. A direct `/library` navigation on 2026-09-30 produced 4 additional failed `GET /v1/health` requests and 8 matching CORS/`net::ERR_FAILED` console errors. No account, invitation, token or environment values are included.

**Additional occurrence** (verifier, 2026-09-30): Browser B opening `/library` produced 180 console errors; a fresh reload produced 4 errors and two additional Bridge health entries with `responseStatus 0`. The initial console log also contained 15 `net::ERR_CONNECTION_REFUSED` entries, which did not recur on reload. The sanitized summary `.spectra-local/live-verification/LV-012-browser-B-console-network-redacted.txt` contains counts and the Bridge health path only; no personal data or credentials are included.

**Additional occurrence** (verifier, 2026-09-30): Browser A's first Library/editor session log had 17 CORS and 17 `net::ERR_FAILED` matches associated with 34 `/v1/health` path entries. A later session log had 96 CORS and 96 `net::ERR_FAILED` lines, all matching `/v1/health`; it had no connection-refused or uncaught-error lines. Logs: `.playwright-cli/console-2026-09-30T08-05-29-717Z.log` and `.playwright-cli/console-2026-09-30T08-29-39-468Z.log`.

**Fix** (fixer)
- Commit: `ed76ef1f2c45a55264e1b1f07eb10acad613bb5e`.
- Root cause: The running local Bridge returns HTTP 200 health but no CORS allowance for http://localhost:3000. The launcher and preflight omitted Origin when checking readiness, so they accepted an existing process whose origin configuration was incompatible with this app; a fresh launcher start already supplies the correct allowed origins.
- Change: Shared Bridge readiness probes now test the app origin for launcher reuse, fresh startup and preflight. An incompatible existing process produces a specific restart instruction; origin restrictions for pairing and file access remain intact.
- Test: HTTP fixture regressions fail before the fix because the browser Origin is absent and mismatched/missing allowances are accepted; now all 36 focused readiness/preflight/stack tests and 4 launcher Node checks pass. The real running Bridge is correctly classified not_ready with the app-origin explanation. Both TypeScript checks, full lint and all five gates pass; final full-suite result is recorded in the closeout below.
- Re-check nearby: Restart the authorized local Bridge through instance 8 launcher, preserving its data, and verify health returns Access-Control-Allow-Origin for the actual app origin and no health CORS failures appear in either tab. Also check launcher reuse of a correctly configured Bridge and rejection of a Bridge configured for another local instance; no production origin/deployment change is required. The verifier cannot restart the current Bridge under the human process-ownership constraint, so the live CORS recheck awaits a later authorized restart; it is not claimed VERIFIED.

**Verification** (verifier): REOPENED on commit `ed76ef1f`, 2026-09-30. The committed launch preflight exited 1 and refused a duplicate while the pre-existing Bridge remained running; the browser reload still produced two failed `/v1/health` GETs and four console errors. The Bridge restart and native-file checks are blocked because the Bridge process predated this task and the user instruction prohibits restarting it. No Bridge pairing or native file write was attempted.

**Reopened assessment (fixer):** The launcher correction prevents false readiness but does not repair the already-running, incompatible Bridge; the verifier correctly reports that the browser symptom remains. Origin denial is intended for a Bridge not configured for this app, and automatic discovery currently probes installed Bridges. Under the human constraint forbidding a restart of this pre-existing process, eliminating those browser failures requires a product choice rather than a further launcher patch.

**Decision needed:**
- Keep automatic Bridge discovery and exact origin restrictions. The current local process must remain unavailable to this app until its owner authorizes a correctly configured restart; retain the launcher readiness correction and defer native verification.
- Change discovery to an explicit user connection/activation workflow instead of probing an unconfigured installed Bridge automatically. This avoids unsolicited health failures on normal editor opens but gives up automatic attachment/detection and changes Files and devices UX; it requires an agreed product flow.

No Bridge allowlist was broadened, no existing process was stopped, and no frontend retry/error suppression was added to conceal the reported condition.

### LV-013 · ManageBac overview claims a completed partial sync before the first sync

- **Status:** VERIFIED
- **Severity:** Medium
- **Surface / role:** /managebac overview / school administrator
- **Report script:** W1-16 · step 6, ManageBac school journey; exploration · first-use state
- **Commit tested:** 0a8a2360
- **Frequency:** Originally reproduced on 3 of 3 reads; correct no-sync state confirmed on 1 of 1 post-fix reloads

**Steps**
1. On local instance 8, sign in with saved Profile A as the administrator of the newly created local test school.
2. Open /managebac before any successful ManageBac sync.
3. Read the Connection message, last-synchronized label, and Classes, Calendar, and Tasks counts.

**Expected:** W1-16 step 6 puts syncing after fixture setup and identity resolution. Before a first successful sync, the Connection message should consistently indicate that no sync has completed.

**Actual:** After fixer commit 0a8a2360, the saved Profile A session showed “Ask a school administrator to review the connection and its verified read-only routes before syncing. No synchronization has completed yet.” The same view displayed “last synchronized never,” 0 conflicts, and Classes 0, Calendar 0, and Tasks 0. After reload, the overview copy and counts remained consistent; Integration remained Blocked. The later key-resave identity and Sync now checks both returned HTTP 409, and the no-sync state remained unchanged.

**Evidence:** .spectra-local/live-verification/LV-013-managebac-partial-vs-never.png; .spectra-local/live-verification/LV-013-verified-0a8.png; Playwright request excerpts from the current Profile A run: settings POST /api/spectra/managebac → HTTP 200; identity and Sync now POSTs to /api/spectra/managebac → HTTP 409 each. No key, email, or provider record values are included.

**Fix** (fixer)
- Commit: `0a8a2360e5698bdd69dc62ac0efeb4cf45d008cf`.
- Root cause: The connection overview used a fallback partial-completion sentence for every status other than connected, validating and draft, including blocked/revoked before first sync. Connection state does not prove sync completion or the availability of records; even degraded can follow a failed attempt without a completed sync.
- Change: Use the actual connection status and blocked reason for recovery copy, with lastSyncAt establishing whether any synchronization has completed. Connected first-use no longer claims records exist, and blocked/revoked/degraded states do not invent partial coverage.
- Test: All six history/copy regressions failed before the fix; the focused dialogs/action-copy/sync-honesty suites now pass 17 tests. Both TypeScript checks, full lint and all five gates pass. Final full-suite result is recorded in the closeout below.
- Re-check: Reload Overview before the first completed sync and check the no-completion sentence, actual block reason, and zero counts remain consistent. Re-check connected-first-use, genuine degraded/partial history, and disconnected/revoked copy; actual sync-run statuses remain in History.

**Verification** (verifier): VERIFIED on commit 0a8a2360, 2026-09-30. Reloaded /managebac before any successful sync; the connection message said “No synchronization has completed yet,” the last-synchronized label stayed at never, and Classes, Calendar, and Tasks each remained 0. No partial-coverage claim appeared. Screenshot: .spectra-local/live-verification/LV-013-verified-0a8.png.

### LV-014 · ManageBac class list and Overview disagree after successful sync

- **Status:** FIXED
- **Severity:** Medium
- **Surface / role:** `/managebac` Classes and Overview / school administrator
- **Report script:** W1-16 · step 6, ManageBac school journey; exploration · post-sync class selection
- **Commit tested:** 6451c630 (app code; local instance 8; ledger-only HEAD c1593b6b)
- **Frequency:** Reproduced in 1 of 1 pre-fix post-sync checks. Not reproduced in repeated post-fix checks with zero and one selected class, save/reload, and a completed manual sync.

**Steps**
1. Start local instance 8 and sign in with saved Profile A as the school administrator for the local QA school with its ManageBac connection configured.
2. Open `/managebac` → Sync history and confirm the school has a completed bootstrap sync.
3. Open Classes. Note the available class count and the empty-state message.
4. Select one class and choose **Save classes**.
5. Open Overview, note the Classes count, and reload the page.
6. Return to Classes and then Sync history; check whether the list state and completed sync entries are still present.

**Expected:** W1-16 step 6 says to “Configure a read-only fixture, complete capability validation and authenticated school identity, select classes, materialize workspaces, sync tasks/calendar/resources, exercise review conflicts, then repeat the relevant surfaces as teacher and student. Verify that admin data does not expose private ordinary content.” The Classes page also says “When ManageBac is connected, current class records appear here after a successful sync.” After a completed sync, the visible class records should not be reported at the same time as absent and counted as zero in the Overview.

**Actual:** Classes displayed 22 options while also showing “No classes in the latest sync.” Sync history showed an earlier Complete bootstrap run with 22 imported records and later Complete manual syncs. After selecting and saving one class, Classes showed 1 selected, but Overview continued to show Classes 0 after navigation and reload. The Classes list and empty-state message remained after reload. The latest Complete manual run showed 0 imported, 2 updated, and 0 conflicts. The local QA school's selection was returned to zero after the check.

**Evidence:** .spectra-local/live-verification/LV-014-managebac-22-options-0-selected-redacted.png; .spectra-local/live-verification/LV-014-managebac-22-options-1-selected-redacted.png; .spectra-local/live-verification/LV-014-managebac-empty-latest-sync-redacted.png; .spectra-local/live-verification/LV-014-managebac-overview-zero-after-complete-sync-redacted.png; .spectra-local/live-verification/LV-014-managebac-sync-history-counts-redacted.png; Playwright snapshot/evaluation reported 22 options, 1 selected after save/reload, and the empty-state text; relevant `/api/spectra/managebac` POSTs returned HTTP 200; console had 0 errors and 1 Clerk development-key warning. Screenshot option labels, query strings, integration ID, and key values are omitted or masked.

**Fix** (fixer)
- Commit: `6451c6309d5f9a89c5b68cc4967424c004f5a4b3`.
- Root cause: ClassShelfEditor read authorized personal class candidates, but Overview counted raw records/admin school-only previews and rendered those previews as a second class list. Admin previews intentionally exclude personal mapped records, so valid personal classes produced a zero count and contradictory empty message; ordinary-member raw rows could also disagree with filtered/deduplicated candidates.
- Change: Refresh the existing candidate reader with the overview and pass its single collection into the shared controlled ClassShelfEditor. Count those same candidates for both admin and ordinary members, remove the duplicate preview-based list, and show unknown count plus an actionable class-load error when candidate loading fails without losing connection controls. Existing backend privacy/current-membership filtering remains authoritative and unchanged.
- Test: Three UI regressions failed on the previous committed shell (admin personal candidates versus empty previews, ordinary eligible count versus raw rows, and failed-read unknown count). Four UI cases pass after the fix, including refresh updating the count and controlled selection together. Focused class picker, ManageBac UI/honesty and real-model isolation suites: 42 passed. Both TypeScript checks, full lint and all five gates passed; final full-suite result is recorded in the closeout below.
- Re-check nearby: Reload the current frontend, then confirm available class count equals the picker options, with zero and one selected class; no second contradictory empty list should appear. Save/reload a selection, refresh after sync, and check ordinary-member eligibility/archived classes and class-load failures. No backend deploy/codegen step is required; admin previews were not broadened to other accounts personal data.

**Verification** (verifier): VERIFIED on app commit `6451c630`, 2026-09-30. On local instance 8 in saved Profile A, Classes showed 22 options and zero selected without the contradictory empty-state message. Selected one class, saved, reloaded, and confirmed one selected remained; Overview reported Classes 22. Ran Sync now; History showed the latest manual run as Complete, and the Classes page still showed 22 options and one selected before and after reload without the empty-state message. Returned the QA school's selection to zero, reloaded, and confirmed 22 options remained with no empty-state message; Overview continued to report Classes 22. Evidence: `.spectra-local/live-verification/LV-014-verified-6451c630-classes-zero-selected-redacted.png`; `.spectra-local/live-verification/LV-014-verified-6451c630-classes-one-selected-redacted.png`; `.spectra-local/live-verification/LV-014-verified-6451c630-overview-22-after-sync-redacted.png`.

### LV-015 · ManageBac all-class sync remains in progress after five minutes

- **Status:** FIXED
- **Severity:** High
- **Surface / role:** `/managebac` Sync history / school administrator
- **Report script:** W1-16 · step 6; P2-SYNC-RESUME · step 1 (local, unthrottled observation)
- **Commit tested:** 7c4169a8 (app code; local instance 8; ledger-only HEAD 763a5057)
- **Frequency:** 1 of 1 post-fix all-class runs reached a terminal state without a manual reload; the pre-fix run remained In progress for more than five minutes before a reload showed its terminal partial result.

**Steps**
1. On local instance 8, sign in with saved Profile A as the school administrator for the configured local test school. Start from `/managebac` with no classes selected and no run currently shown as active.
2. Choose **Resolve my school identity** once. The action returns HTTP 200.
3. Open Classes, select all 22 displayed class options, and choose **Save classes**.
4. Open Sync history. Wait at least five minutes from the new run's displayed start time.

**Expected:** W1-16 step 6 says to “Configure a read-only fixture, complete capability validation and authenticated school identity, select classes, materialize workspaces, sync tasks/calendar/resources, exercise review conflicts, then repeat the relevant surfaces as teacher and student.” P2-SYNC-RESUME step 1 says that when reconciliation takes more than four minutes, the run shows “Paused part-way,” resumes within about 30 seconds, and ends `completed`.

**Actual:** The page's primary action remained **Syncing…** and the newest History row remained **In progress** at **Checking for removed items** for more than five minutes after the identity action returned HTTP 200. The row did not reach a terminal status during the observation. The local test school displayed 22 class options; all 22 were selected and saved. The browser's ManageBac request count stayed at 11 across repeated checks.

**Evidence:** `.spectra-local/live-verification/LV-015-managebac-sync-inprogress-redacted.png`; browser network excerpt: identity-resolution `POST /api/spectra/managebac` returned HTTP 200; subsequent history checks continued to show In progress while the ManageBac request count remained 11. The P2 large-school/throttled-fixture conditions were not used; this is the observed unthrottled local run.

**Fix** (fixer)
- Commit: `7c4169a857ac088f9b826779e560bd36270de76a`.
- Root cause: The HTTP sync request can finish before scheduled Convex reconciliation/projection batches. ManageBacIntegrationShell read one overview snapshot after the request, never refreshed active work, and kept both History and Sync now in that stale state; the verifier's reload revealed that the same run had already reached Partially complete. This affects queued/leased runs and projection application as well as removal checks, for admin and member views.
- Change: Refresh active queued/leased/running progress every three seconds, serially, and stop when no active run remains or the page unmounts. Failed reads retain an actionable error and retry; leased state is included in the UI contract/label. Background progress reads preserve the class candidate collection so unsaved class selections are not reset, and render the actual terminal outcome without converting partial results to success.
- Test: Five UI regressions fail against the previous shell and pass after the fix: queued, leased and running transitions to a terminal result; failed-read retry/unmount cleanup; and slow-read non-overlap with preserved unsaved class choices and a partial terminal outcome. Focused UI/class-picker/honesty/real-model suites: 50 passed; both TypeScript checks, full lint and all five gates passed. A temporary real-route/Convex-model diagnostic also drained more than one reconciliation batch successfully (240 stale records); it was restored after diagnosis. Final full suite: 4,365 passed, 3 failed, 1 skipped (500 passed files, 1 failed, 1 skipped); all three failures are unchanged account-erasure lifecycle scheduled-drain timer-pump limits. That file passed all 7 tests in an isolated re-check; the full run is not green.
- Re-check nearby: Reload once to load the committed frontend, repeat the existing identity/all-class flow, and leave History open without pressing Refresh or reloading. The row should follow the actual terminal outcome and release Sync now automatically; also check projection-stage completion, queued/leased work, transient read failures, and unsaved class edits while a run remains active. No backend deploy or codegen is needed. The reported Partially complete outcome and its gaps are not claimed to be repaired by this display fix; record any distinct provider/data failure separately with its observed recovery message.

**Verification** (verifier): VERIFIED on app commit `7c4169a8` (ledger-only HEAD `763a5057`), 2026-09-30. Reloaded Profile A to load the committed frontend, resolved school identity, saved all 22 selected class options, and left Sync history open. The primary action first showed **Syncing…**; the newest row then showed **Complete** and “School data is current,” and **Sync now** was enabled without a manual refresh or reload. Two ManageBac POSTs and subsequent `overview` / `myClasses` reads returned HTTP 200; the browser showed 0 errors and 1 warning. The next row in History remained Partially complete, preserving its distinct earlier result. Evidence: `.spectra-local/live-verification/LV-015-verified-7c4169a8-history-redacted.png`; `.spectra-local/live-verification/LV-015-verified-7c4169a8-sync-ready-redacted.png`.

### LV-016 · ManageBac reports no tasks or calendar events after a completed sync

- **Status:** VERIFIED
- **Severity:** High
- **Surface / role:** `/managebac` Overview, Tasks and Calendar / school administrator
- **Report script:** W1-16 · step 6, ManageBac school journey
- **Commit tested:** 7c0e4b55 (app code; local instance 8; ledger-only HEAD 98b0bc37)
- **Frequency:** The 1 of 1 empty-state result was not reproduced in the post-fix reload check; the task and calendar views both rendered records.

**Steps**
1. On local instance 8, sign in with saved Profile A as the school administrator for the connected local test school; start from `/managebac` with no run currently shown as active.
2. Choose **Resolve my school identity** once.
3. Open Classes, select all 22 displayed class options, and choose **Save classes**.
4. Open **Sync history** and leave it open until the newest run reaches a terminal state. Do not reload or manually refresh.
5. Open Overview, then Tasks, then Calendar.

**Expected:** W1-16 step 6 says to “Configure a read-only fixture, complete capability validation and authenticated school identity, select classes, materialize workspaces, sync tasks/calendar/resources, exercise review conflicts, then repeat the relevant surfaces as teacher and student.”

**Actual:** The newest History row says **Complete** and “School data is current,” and Sync now is available. Overview reports Classes 22, Calendar 0 and Tasks 0. Tasks shows “No assignments or deadlines”; Calendar shows “No Calendar source events.” The user confirmed that this school has task and calendar data. The browser showed 0 errors and 1 warning; the observed ManageBac POSTs and overview/class reads returned HTTP 200.

**Evidence:** `.spectra-local/live-verification/LV-015-verified-7c4169a8-history-redacted.png`; `.spectra-local/live-verification/LV-016-managebac-overview-tasks-zero-redacted.png`; `.spectra-local/live-verification/LV-016-managebac-overview-calendar-zero-redacted.png`; `.spectra-local/live-verification/LV-016-managebac-tasks-empty-redacted.png`; `.spectra-local/live-verification/LV-016-managebac-calendar-empty-redacted.png`; redacted browser summary: two ManageBac POSTs and subsequent `overview` / `myClasses` reads returned HTTP 200, with 0 browser errors and 1 warning.

**Fix** (fixer)
- Commit: `7c0e4b5577c83828c312f0fae929dd2cfb57e90e`.
- Root cause: The administrator GET overview requested only school-wide operational previews, which intentionally exclude mapped/personal records; the Tasks and Calendar UI used that response as its record collection. Read-only local instance-8 aggregate diagnostics established 258 live assignments, 81 live timetable records and 22 classes mapped to an active school administrator, and the latest manual run had fetched 367 records with zero errors. The records were imported successfully but absent from the administrator's read path, affecting all personal record types shown on this surface, not provider ingestion.
- Change: Compose the existing authorized myOverview reader's own-account records with the existing shared school previews in the administrator GET response, including the own-account mapping. Leave adminOverview's operational privacy boundary and ordinary-member query path unchanged; no other member's private records are exposed. The existing shell now uses this collection for task/calendar counts and lists.
- Test: The real GET/Convex-model regression failed before the fix because the admin response had no personal record collection; it now includes own assignment/timetable records and shared previews while excluding a second member's private assignment. A second case confirms the ordinary GET uses only the existing personal reader. Focused route/provider/UI/honesty/isolation tests: 37 passed, with the final narrowed test adapter re-check 2/2. Both TypeScript checks, full lint and all five gates passed. Full suite: 4,369 passed, 1 failed, 1 skipped (501 passed files, 1 failed, 1 skipped). The sole failure was the unchanged dense-sheet performance test measuring 45.9627 ms against a 40 ms bound; that whole file passed 77/77 in isolation. This full run is not green.
- Re-check nearby: On the committed app, reload the same completed run once; Overview Tasks/Calendar and their lists should now reflect the administrator's existing synced records without another sync. Check Classes still has 22 options, History preserves its actual completed/partial outcomes, shared previews remain visible, and another member's personal records stay unavailable. No backend deploy, codegen or restart is required. The diagnostics read only local backend tables through its existing CLI query API and printed aggregate counts/statuses; no environment file, credential or record content was printed or edited.

**Question for verifier**
1. After one reload of the same completed run, do Overview, Tasks and Calendar still show zero/empty? Report the displayed values.
2. From the successful sync POST response already captured for that run, report its route summaries: displayed route name, records/pages, and any skipped/error text for assignment/deadline/assessment and timetable/lesson/calendar/class-event routes. Omit credentials, URLs, account/class identifiers and record contents. Also report the run's fetched/created/updated/skipped/error counts if visible. If the response body is no longer available, say so; do not repeat a sync solely to obtain it.

**Verifier response** (2026-09-30): After one reload, Overview still showed Classes 22, Calendar 0 and Tasks 0. Tasks still showed “No assignments or deadlines”; Calendar still showed “No Calendar source events.” Sync now remained enabled. The visible History row reported 0 imported, 10 updated and 0 conflicts; no fetched, skipped or error totals or per-route details were displayed. The saved response body for the earlier completed-run POST was no longer accessible after browser navigation; the available request list showed only request method/path/status, so route-level record/page and skipped/error summaries are unavailable. No additional sync was run.

**Verification** (verifier): VERIFIED on app commit `7c0e4b55` (ledger-only HEAD `98b0bc37`), 2026-09-30. Reloaded the same completed run once without starting a new sync. Overview showed Classes 22, Calendar 81 and Tasks 258; Tasks rendered 258 article entries and Calendar rendered 81, with neither empty state present. Sync history still showed Complete (0 imported, 10 updated, 0 conflicts), and Sync now remained enabled. The page showed 0 console errors and 1 warning. Evidence: `.spectra-local/live-verification/LV-016-verified-7c0e4b55-overview-tasks-258-redacted.png`; `.spectra-local/live-verification/LV-016-verified-7c0e4b55-overview-calendar-81-redacted.png`.

### LV-017 · Plan omits one task submitted during a concurrent add

- **Status:** NEEDS-INFO
- **Severity:** High
- **Surface / role:** Plan editor / signed-in school administrator using two browser sessions
- **Report script:** P3-EDITORS · Needs live verification · structured lists (E1), step 3
- **Commit tested:** `7c0e4b55` (app code; local instance 8)
- **Frequency:** One task submission was absent in the first of three concurrent-add pairs. That pair began with the Plan's single starter task; two follow-up pairs on the reused plan with two and four existing tasks retained both new entries in both sessions.

**Steps**
1. On local instance 8, sign in with saved Profile A in browser sessions A and B. From Library, choose **New** → **Planner task**, name the artifact `LIVE-QA Plan`, and open the same artifact in both sessions. Confirm it starts with one task.
2. In session A, enter `LIVE-QA task from A` in **Add a task**. In session B, enter `LIVE-QA task from B` in **Add a task**.
3. In each session, choose **Add task** and press Enter in the active **Add a task** input; issue the two Enter submissions within one second of each other.
4. Wait about two seconds and inspect both task lists.
5. Reload both browser sessions and inspect the task lists again.

**Expected:** P3-EDITORS step 3 says to “Repeat 1 in a flashcard deck (add card) and in a plan (add task).” The structured-list step 1 expected result says “both browsers show exactly the original questions plus two new ones, and none is duplicated.” For the Plan repeat, both task additions should be present in both sessions with no duplicate.

**Actual:** Both input fields cleared after submission. After the wait, both sessions showed two tasks total: the initial task and `LIVE-QA task from A`; neither showed `LIVE-QA task from B`. After reloading both sessions, they still showed those same two tasks, and the Browser B task remained absent.

**Evidence:** `.spectra-local/live-verification/LV-017-plan-concurrent-add-A-redacted.png`; `.spectra-local/live-verification/LV-017-plan-concurrent-add-B-redacted.png`; redacted console summaries from `.playwright-cli/console-2026-09-30T09-00-44-939Z.log` (48 error lines: 24 CORS and 24 `net::ERR_FAILED`, all matching the previously logged Bridge health path; 0 unhandled or other errors) and `.playwright-cli/console-2026-09-30T09-01-54-932Z.log` (44 error lines: 22 CORS and 22 `net::ERR_FAILED`, all matching the previously logged Bridge health path; 0 unhandled or other errors).

**Fix** (fixer)
- Commit: `57dbcb87093133c547c320c9c111335d20ff25ed`.
- Root cause: A fresh Plan's legacy one-task payload was rendered as a task list by the UI but the shared document had no tasks collection. The two first edits independently created competing keyed Y.Maps, so Yjs retained one whole map and lost the other addition. Initially empty identity arrays had the same first-write conversion race; later additions worked because the collection already existed, matching the verifier's one loss in three pairs.
- Change: Seed the Plan task/section/milestone/view collections in client and gateway bootstrap, reusing the extracted existing legacy task and default-view projection. Share the identity-collection rule between both writers so known empty identity lists start as keyed maps and remain keyed when emptied. This also repairs first additions in empty decks and Plan sections/milestones without changing ordinary text/reference arrays or exposing a second storage mechanism.
- Test: Six real-Yjs regressions fail on the prior code and pass after the fix: legacy Plan concurrent additions and durable reload; initially empty deck additions; first Plan sections and milestones; gateway-bootstrap Plan additions/reload and empty-deck additions. All 66 focused collection/gateway/Plan/source/reminder/import tests pass; both TypeScript checks, full lint and all five gates pass. Full suite: 4,374 passed, 2 failed, 1 skipped. One failure is the hosted gateway package test: its Docker COPY list omits the two required new runtime imports (shared/planner-source.mjs and shared/yjs-collections.mjs). The other is an unchanged run-route 15-second timeout; its isolated re-check passed 59/59. This full run is not green.
- Re-check nearby: Restart only the verifier-owned instance-8 gateway/stack to load the committed gateway bootstrap, leaving the pre-existing Bridge untouched. Create a fresh Plan with one starter task, open it in both tabs, add distinct tasks simultaneously, and verify both additions survive sync and reload. Repeat first additions in an empty deck and first Plan section/milestone lists; check deletion-to-empty followed by additions. Already missing submissions are not reconstructed or special-cased. No Convex deploy/codegen or deployment configuration change is required.

**Verification** (verifier): Local live behavior VERIFIED on app commit `57dbcb87` (`57dbcb87093133c547c320c9c111335d20ff25ed`), 2026-09-30. Restarted only the recorded managed instance-8 Convex/gateway/Next stack; the pre-existing Bridge remained running. Created a fresh Plan with one starter task and opened it in both Profile A sessions. After A and B submitted distinct task titles, both sessions showed three tasks including both additions. Reloaded both sessions; both titles and all three tasks remained. The ledger status remains NEEDS-INFO for the separate package check. Evidence: `.spectra-local/live-verification/LV-017-verified-57dbcb87-plan-A-redacted.png`; `.spectra-local/live-verification/LV-017-verified-57dbcb87-plan-B-redacted.png`.

**Packaging constraint / question for user:** The code fix is committed and locally tested, but the hosted gateway import-graph test proves the existing Docker package omits its two required shared runtime files. The user instruction says “Do not change deployment configuration”; a narrow exception was requested to add only shared/planner-source.mjs and shared/yjs-collections.mjs to deploy/collaboration-gateway/Dockerfile's existing COPY list. No Dockerfile edit or deployment has been performed; LV-017 remains NEEDS-INFO until that exception is resolved. Local verification may proceed on the owned stack, but this is not a package-ready FIXED claim.

### LV-018 · Quiz prompt loses a concurrent text edit

- **Status:** VERIFIED
- **Severity:** High
- **Surface / role:** Quiz editor / signed-in school administrator using two browser sessions
- **Report script:** P3-EDITORS · Needs live verification · Save does not revert a peer (E2), step 2
- **Commit tested:** `3574fca2` (app code; local instance 8)
- **Frequency:** Two valid simultaneous-edit pairs both remained visibly divergent for more than six seconds with no conflict banner; after reload, one pair retained the merged text and one pair retained only Browser B's edit.

**Steps**
1. On local instance 8, sign in with saved Profile A in browser sessions A and B and open the same quiz and same prompt in both. In session A, replace the prompt with `colour`; wait until both sessions display that base text.
2. At the same time, in A place the caret at the end of `colour` and type `s`. In B place the caret before the final `r` (after four characters) and press Delete to remove `u`.
3. Wait at least six seconds and inspect the prompt in both sessions.
4. Reload both browser sessions and inspect the prompt again.

**Expected:** P3-EDITORS step 2 says “A and B type in the same quiz prompt at different ends (`colour` becomes `colours` on A and `color` on B).” It expects “both converge on `colors`. Overlapping edits may show the conflict banner, but must not silently lose text.”

**Actual:** In two valid attempts, after the wait A displayed `colours` and B displayed `color`; neither browser showed a conflict banner. After reloading, one attempt displayed `colors` in both sessions. In the other, both displayed only `color`; A's appended `s` was absent.

**Evidence:** `.spectra-local/live-verification/LV-018-quiz-prompt-before-reload-A-redacted.png`; `.spectra-local/live-verification/LV-018-quiz-prompt-before-reload-B-redacted.png`; `.spectra-local/live-verification/LV-018-quiz-prompt-after-reload-A-redacted.png`; `.spectra-local/live-verification/LV-018-quiz-prompt-after-reload-B-redacted.png`; redacted logs `.playwright-cli/console-2026-09-30T09-15-18-656Z.log` and `.playwright-cli/console-2026-09-30T09-15-18-657Z.log` contain only the previously recorded Bridge CORS/health errors (41/41 and 42/42 CORS/`net::ERR_FAILED` line pairs), with 0 unhandled or other errors.

**Fix** (fixer)
- Commit: `3574fca2b37302aa272141dd5f17e1fe6c575c47`.
- Root cause: The shared ArtifactRichTextEditor ignored incoming content whenever it remained focused, so its local TipTap document stayed divergent even after the parent/Yjs value merged. It kept the human-typing flag after a debounced emission and emitted that stale HTML again on blur, overwriting the merged value; its extra debounce also hid pending intent from the parent merge. This affects quiz prompts and the other fields using this shared editor (flashcard text, planner descriptions and related rich text), not the underlying Yjs text merge.
- Change: Publish human edits immediately into the parent's existing coalesced save loop and clear the already-published typing flag. Apply incoming ProseMirror deltas while focused, mapping the selection through the peer's insertion/deletion, without onChange echoes or adding peer hydration to local undo history. Blur cannot replay a stale previously published draft.
- Test: Four regressions fail on the prior component and pass after the fix: immediate intent, focused merged text/caret/no echo, no stale blur replay, and two actual rich editors merging through real Yjs then preserving colors on focused convergence, blur and durable reload. All 45 focused rich-text/structured/quiz/flashcard/native-model tests pass; both TypeScript checks, full lint and all five gates pass. Final full suite: 4,379 passed, 1 failed, 1 skipped (502 passed files, 1 failed, 1 skipped). The sole failure is LV-017 hosted gateway packaging omitting the two required shared modules; all rich-text/editor cases passed. This is not a green full-suite result.
- Re-check nearby: Reload both tabs for the committed frontend, repeat the reported colour/colours/color edits, and keep both fields focused beyond the existing six-second observation. Both should display colors before reload and retain colors after blur and reload. Repeat in shared flashcard text and planner descriptions; check caret position, formatting, remote insert/delete and local undo retaining peer edits. No backend or gateway restart, deploy or codegen is needed for this issue.

**Verification** (verifier): VERIFIED on app commit `3574fca2b37302aa272141dd5f17e1fe6c575c47`, 2026-09-30. Reloaded both Profile A sessions. In A, set the shared prompt to `colour` and confirmed both sessions displayed it. Placed A's caret at the end and B's caret after four characters before either keystroke, then typed `s` in A and pressed Delete in B. After 6.5 seconds both editors displayed `colors` while focused; A's caret remained at the end and B's at offset 4. Pressed Tab in each session to blur, then reloaded both; each still displayed `colors`. The two browser logs contain only the existing Bridge CORS/health `net::ERR_FAILED` entries and no other console errors. Evidence: `.spectra-local/live-verification/LV-018-verified-3574fca2-6s-before-blur-A-redacted.png`; `.spectra-local/live-verification/LV-018-verified-3574fca2-6s-before-blur-B-redacted.png`; `.spectra-local/live-verification/LV-018-verified-3574fca2-6s-after-reload-A-redacted.png`; `.spectra-local/live-verification/LV-018-verified-3574fca2-6s-after-reload-B-redacted.png`.

### LV-019 · Long chat answer pauses after validation failure

- **Status:** VERIFIED
- **Severity:** High
- **Surface / role:** Chat AI answer / signed-in school administrator
- **Report script:** P3-AI-ENGINE · Needs live verification · Answer, step 2
- **Commit tested:** `427cb3c9` (local instance 8, web port 3000; frontend hot reload and browser reload)
- **Frequency:** Before the fix, the original request and one Retry both ended with the validation failure (1 submitted request plus one Retry). After the fix, a new request and Retry on the earlier paused request both completed.

**Steps**
1. On local instance 8 at commit `396aa190`, sign in using the saved Profile A session and open a new chat with no context objects selected.
2. Send `Write a 4,000-word essay explaining the causes of World War I.`
3. Wait until the run reaches a terminal state.
4. Open the message details and inspect the final run state.
5. Click **Retry** once and inspect the message again.

**Expected:** P3-AI-ENGINE step 2 says to “Expect it to continue past the output limit with no duplicated text. If it still stops, expect the length note.”

**Actual:** On `396aa190`, the chat streamed essay text, then ended with “The response did not pass validation” and “Spectra paused this run,” with a **Retry** button. No completed essay or length note appeared. The first Retry also ended with the same validation failure. Playwright reported 0 console errors and 1 warning during the initial run.

**Evidence:** `.spectra-local/live-verification/LV-019-ai-4000word-paused-first-redacted.png`; `.spectra-local/live-verification/LV-019-ai-4000word-paused-retry-redacted.png`; `.spectra-local/live-verification/LV-019-ai-4000word-verified-427cb3c9-redacted.png`; `.spectra-local/live-verification/LV-019-ai-4000word-retry-verified-427cb3c9-redacted.png`; `.spectra-local/live-verification/LV-019-ai-doc-edit-verified-427cb3c9-redacted.png`; Playwright console excerpts: pre-fix `Total messages: 3 (Errors: 0, Warnings: 1)` and post-fix `Total messages: 3 (Errors: 0, Warnings: 1)`; the sole warning was Clerk's development-key notice.

**Fix** (fixer)
- Commit: `427cb3c9c3664e03a6ff62af41f39b19cafba913`.
- Root cause: Ordinary model prose is adapted into the same validated plan envelope as operational completions, whose legacy finalResponse field capped replies at 4,000 characters. Local redacted diagnostics confirm both the original essay and Retry failed only at finalResponse with too_big; the initial answers were 29,388 and 27,457 characters. Repair turns encountered the same constraint, so continuation and Retry could not preserve the requested full answer.
- Change: Remove the hidden prose length limit from the canonical validator and matching plan/creation provider schemas, keeping nonempty responses and all operation/ownership/intent checks. This also fixes long replies accompanying accepted edits and artifact creation; output continuation and truthful cutoff notes remain unchanged. Model, provider, reasoning and context settings are unchanged.
- Test: Four regressions fail before and pass after through the public callModel boundary: long ordinary prose without repair, successfully continued prose without duplication, exhausted continuation retaining the full text and length note, and a long completion retaining accepted operations. A fifth checks both provider contracts match the validator. All 117 focused completion/agent-loop/diagnostics/run-route tests, both TypeScript checks, full lint and all five gates passed. Final full suite: 4,382 passed, 3 failed, 1 skipped; failures are the pending LV-017 hosted package and unchanged Stop-auth/sheets timing tests. Those two unchanged files then pass 136/136 in a separate re-check. This full suite is not green.
- Re-check nearby: Reload the frontend and repeat the original new-chat essay, inspecting the completed answer and terminal state; check Retry on the earlier paused request and a detailed answer accompanying an edit. If output continuations truly exhaust their limit, the full partial answer must retain its explicit length note. No backend restart, deploy or codegen is needed.

**Verification** (verifier): VERIFIED on app commit `427cb3c9c3664e03a6ff62af41f39b19cafba913`, 2026-09-30. Reloaded the frontend on the updated checkout and opened a new chat with 0 context objects. The exact prompt returned a complete 3,730-word answer with a conclusion, no repeated paragraphs, a saved result and no validation error; the browser showed 0 console errors. Clicked **Retry** on the earlier paused thread; that run completed with a 4,479-word answer, no repeated paragraphs, and a saved result. In the same local session, created “Causes of World War I” with four sections, rewrote section 2 while asking for a detailed explanation, and received a 744-word answer (including the proposed rewrite) totaling 4,889 characters. Reloaded the artifact; the revised section remained in the document. The chat described the change as staged and not yet verified as saved before reload. Evidence: `.spectra-local/live-verification/LV-019-ai-4000word-verified-427cb3c9-redacted.png`; `.spectra-local/live-verification/LV-019-ai-4000word-retry-verified-427cb3c9-redacted.png`; `.spectra-local/live-verification/LV-019-ai-doc-edit-verified-427cb3c9-redacted.png`.

### LV-020 · Whole-document rewrite does not update the document

- **Status:** FIXED
- **Severity:** High
- **Surface / role:** Chat AI document rewrite / signed-in school administrator
- **Report script:** P3-AI-ENGINE · Needs live verification · Document, rewrite
- **Commit tested:** `427cb3c9` (local instance 8, web port 3000)
- **Frequency:** 2 of 2 identical rewrite requests returned an explicit apply failure; the saved document was unchanged after reload.

**Steps**
1. On local instance 8 at commit `427cb3c9`, sign in with saved Profile A and open the local document `Causes of World War I` with its four sections and existing conclusion in the Work studio.
2. With the document selected as the single context object, send `Rewrite the whole document for a 12-year-old.`
3. Wait for the assistant response and inspect both the reply and the open document.
4. Reload the browser and inspect the document content.
5. Send the identical prompt once more, wait for the response, and inspect the document again.

**Expected:** P3-AI-ENGINE's Document rewrite step says to “Rewrite the whole document for a 12-year-old.” The rewritten text should replace the content of the open document and remain there after reload.

**Actual:** Both requests ended with “I couldn’t apply the rewrite to the document—the update failed, so the saved document is unchanged.” Each reply then provided a rewritten version in chat, but the Work studio retained the original introduction, the same four numbered sections, and the existing conclusion after reload. After the second failure, the Live Dock showed “Could not finish · 14 related parts will change together.” Playwright reported 0 console errors and 1 development-key warning.

**Evidence:** `.spectra-local/live-verification/P3-AI-ENGINE-doc-rewrite-failure-1-redacted.png`; `.spectra-local/live-verification/P3-AI-ENGINE-doc-rewrite-failure-2-redacted.png`; `.spectra-local/live-verification/P3-AI-ENGINE-doc-rewrite-unchanged-after-reload-redacted.png`; Playwright console excerpt: `Total messages: 3 (Errors: 0, Warnings: 1)`; the sole warning was Clerk's development-key notice.

**Fix** (fixer)
- Commit: `7a1a8508932caca7f6e48f9960bab4350d668935`.
- Root cause: The recorded rewrite supplied 14 TipTap text-pointer changes, but the patch helper left the derived document blocks unchanged. The Yjs adapter interpreted those stale blocks as authored values and restored the old text over the patched tree; the post-save verifier correctly rejected the missing content change. The same mismatch affects rich subtree and whole-tree patches, including the shared Convex write preparation/admission resolver.
- Change: Regenerate blocks and outline from the authored TipTap tree using the existing document converter before Yjs projection. Synchronize mirrors between changes and materialize the tree from updated blocks when switching representations, preserving submitted order for mixed block/tree pointers. No model, provider, reasoning, context or admission/readback checks were weakened.
- Test: Four regressions fail on prior source and pass after: whole-document text-pointer rewrite, formatted subtree retaining marks through Yjs reload, whole-tree replacement refreshing identities/outline, and block-then-tree order. The reverse mixed order also passes. All 187 focused patch/readback/live-admission/native-model/reference/academic/run-route/Convex-scope tests pass; both TypeScript checks, full lint and all five gates pass. Final full suite: 4,389 passed, 1 failed, 1 skipped (502 passed files, 1 failed, 1 skipped). The sole failure is the pending LV-017 hosted package missing shared runtime imports; every document/admission test passed. This full suite is not green.
- Re-check nearby: Sync/restart the verifier-owned local instance 8 to load the shared helper into Convex, then reload the browser and repeat the original whole-document rewrite. Confirm rewritten text before and after reload; re-check section-only changes, formatting and appending a conclusion. No shared deployment or code generation is required.

**Verification** (verifier): **VERIFIED** on fix commit `7a1a8508`, 2026-09-30. Restarted local instance 8, then opened the original `Causes of World War I` chat, selected the document as its sole context and sent the exact rewrite prompt. The assistant reported a staged rewrite; opening the document showed changed text across all four sections and the conclusion. Reloaded the browser and reopened the artifact; the rewritten opening, updated section headings and conclusion remained. After a later instance-8 restart at `68587ec8`, the same edited content remained. Playwright reported 0 console errors and 1 Clerk development-key warning.

**Evidence:** `.spectra-local/live-verification/LV-020-whole-document-rewrite-result-redacted.png`; `.spectra-local/live-verification/LV-020-whole-document-rewrite-after-reload-redacted.png`; Playwright console excerpt `.playwright-cli/console-2026-09-30T11-12-08-966Z.log` (0 errors, 1 warning).


### LV-021 · Flashcard deck append is rejected

- **Status:** VERIFIED
- **Severity:** High
- **Surface / role:** Chat AI flashcard deck update / signed-in school administrator
- **Report script:** P3-AI-ENGINE · Needs live verification · Flashcard deck, append
- **Commit tested:** `7a1a8508` (local instance 8, web port 3000)
- **Frequency:** 2 of 2 identical append requests were rejected; the deck remained unchanged after reload.

**Steps**
1. On local instance 8 at commit `7a1a8508`, sign in with saved Profile A and start a new chat in the local test school.
2. Send `Create a flashcard deck about photosynthesis with 8 cards.` Wait for the deck to be created, then open the new Photosynthesis deck in Library.
3. With the deck open, send `Change card 3's hint.` Select card 3, verify its hint changed, and reload to confirm the changed hint is saved.
4. In the open deck's `Continue Photosynthesis...` composer, send `Add 4 cards about the Calvin cycle.` Wait for the assistant response and inspect the card list.
5. Send the identical append prompt once more, wait for the response, then reload and inspect the saved card list.

**Expected:** The P3-AI-ENGINE Flashcard deck script says to “Append: ‘Add 4 cards about the Calvin cycle.’” The four requested cards are added to the existing eight-card deck, for 12 cards total, and remain after reload.

**Actual:** The first append request ended with “I couldn’t save the four new cards—the deck update was rejected, so the deck is unchanged.” The second ended with “I couldn’t add the cards: the deck update was rejected because the generated deck must contain exactly 4 cards. No changes were saved, so ‘Photosynthesis’ still has 8 cards.” After reload, the deck still showed its original eight cards and no new Calvin-cycle cards. Playwright reported 0 console errors and 1 Clerk development-key warning.

**Evidence:** `.spectra-local/live-verification/P3-AI-ENGINE-flashcard-append-failure-2-redacted.png`; `.spectra-local/live-verification/P3-AI-ENGINE-flashcard-append-unchanged-after-reload-redacted.png`; Playwright console excerpt `.playwright-cli/console-2026-09-30T11-12-08-966Z.log` (0 errors, 1 warning).

**Fix** (fixer)
- Commit: `68587ec816eb80c33f04d8a17b9791dac75c5ef2`.
- Root cause: The requested total-count check for newly generated decks also ran on artifact.update. It interpreted the four additions as a final deck total of four, rejecting patches with no full content payload as well as complete twelve-card update payloads. The same creation-versus-update mismatch affected quiz question additions and other counted collection edits.
- Change: Restrict the existing final-total checks to artifact.create for decks and quizzes. Updates retain typed patch/content validation, authority/admission checks and post-save verification; no keyword routing, model/reasoning change, context truncation or alternate append mechanism was added.
- Test: Four regressions fail before and pass after: deck and quiz patch appends through the public callModel/tool boundary, and complete deck/quiz updates with twelve items. Actual write resolver/Yjs projection keeps all eight original identities, adds the four new identities and leaves the source unchanged. Negative creation checks still reject twelve items when four were requested, and positive checks accept the requested twelve. All 97 focused completion/run-route/hollow-content/intent/document-patch tests, both TypeScript checks, full lint and all five gates pass. Final full suite: 4,392 passed, 2 failed, 1 skipped; the failures are pending LV-017 hosted packaging and the unchanged Stop-auth test (409 instead of 403). The run-route file passes 59/59 separately. This full-suite result is not green.
- Re-check nearby: Reload the frontend and repeat Add 4 cards against the original eight-card deck; confirm twelve cards and preservation of the earlier card-3 hint after reload. Check Add 2 questions on an existing quiz, whole-deck rewrite and exact-count creation nearby. No backend restart, sync, deploy or codegen is required.

**Verification** (verifier): **VERIFIED** on fix commit `68587ec8`, 2026-09-30. Restarted local instance 8 after the commit and reloaded Profile A. On the existing Photosynthesis deck, selected it as the only visible context and sent `Add 4 cards about the Calvin cycle.` The work surface showed 12 cards: the original eight plus four distinct Calvin-cycle prompts for carbon fixation, ATP/NADPH, net G3P output and RuBP regeneration. Reloaded the browser; all 12 cards remained, and card 3 retained its changed hint. Playwright reported 0 console errors and 1 Clerk development-key warning.

**Evidence:** `.spectra-local/live-verification/LV-021-flashcard-append-verified-68587ec8-redacted.png`; `.spectra-local/live-verification/LV-021-card3-hint-after-reload-redacted.png`; Playwright console excerpt `.playwright-cli/console-2026-09-30T11-12-08-966Z.log` (0 errors, 1 warning).


### LV-022 · Saved flashcard append is described as unsaved

- **Status:** NEEDS-DECISION
- **Severity:** Medium
- **Surface / role:** Chat AI flashcard append status / signed-in school administrator
- **Report script:** P3-AI-ENGINE · Needs live verification · Flashcard deck, append
- **Commit tested:** `68587ec8` (local instance 8, web port 3000)
- **Frequency:** 1 of 1 successful append responses said the update was not saved even though it persisted after reload.

**Steps**
1. On local instance 8 at commit `68587ec8`, sign in with saved Profile A and open the Photosynthesis deck in Library.
2. With the deck as the only visible context, send `Add 4 cards about the Calvin cycle.`
3. Wait for the assistant response. Read its save-state wording and inspect the card count in the Work surface.
4. Reload the browser, reopen the deck and inspect the card count again.

**Expected:** The P3-AI-ENGINE Flashcard deck script says to “Append: ‘Add 4 cards about the Calvin cycle.’” After the Work surface shows 12 cards and the same cards remain after reload, the assistant’s save-state text should describe that result consistently.

**Actual:** The assistant said, “The four Calvin cycle cards are staged for the Photosynthesis deck: carbon fixation, the role of ATP and NADPH, net G3P output, and RuBP regeneration. The update is proposed, not yet saved.” The same Live chat panel showed “Saved progress and results.” The Work surface showed 12 cards, and all 12 remained after reload. Playwright reported 0 console errors and 1 Clerk development-key warning.

**Evidence:** `.spectra-local/live-verification/LV-022-ai-flashcard-message-claims-unsaved-redacted.png`; `.spectra-local/live-verification/LV-022-ai-flashcard-append-persisted-after-reload-redacted.png`; Playwright console excerpt `.playwright-cli/console-2026-09-30T11-12-08-966Z.log` (0 errors, 1 warning).

**Fix** (fixer)
- Commit: Assessment only; no implementation change.
- Root cause: The model's closing reply is drafted against staged tool results, before the executor saves and verifies changes. The normal success path then copies plan.finalResponse into finalSummary/resultSummary and the assistant message (runtime.ts around 2328-2340); the resumed path similarly reuses state.run.finalSummary (around 3235-3275). replyWithNativeReceipt adds only local-file state, leaving the now-stale proposal/save wording intact even when canonical saving is confirmed.
- Change: NEEDS-DECISION on the final-reply contract. Option A: generate the final explanation after verified receipts, using the unchanged configured model and full request; this keeps natural final prose but adds latency/usage and requires a receipt-based fallback if the reporting turn fails. Option B: show a deterministic saved-result message and retain the earlier explanation separately labeled as a pre-save proposal; this avoids another model turn but changes reply presentation. Both must derive canonical/native state from receipts, preserve requested explanations and use the same behavior for initial and resumed runs. A text-specific replacement of the reported sentence would not fix this contract.
- Test: A read-only node/tsx reproduction over the real replyWithNativeReceipt helper confirms the pre-save assertion is retained for canonical_saved, native_pending and native_verified. All 25 existing receipt-report tests pass, confirming that current coverage verifies local-file receipts but not transition of the pre-save model description. Evidence: .spectra-local/LV022-report-repro.ts and .spectra-local/LV022-receipt-review.log. No source, deployment configuration, model/context setting or data was changed; the latest full-suite result on unchanged implementation remains 4,392 passed, 2 failed, 1 skipped as recorded below.
- Re-check nearby: After the reporting contract is decided and implemented, check append/edit/create replies and result-card summaries before and after reload, ordinary answers retaining their full explanations, confirmation/conflict resumes, partial/failed verification and native-pending versus native-verified outcomes.

**Decision requested** (fixer): Which final-reply contract should Spectra use: a post-save model explanation, or an authoritative saved-result message with a separately labeled pre-save explanation? The user was asked through the decision tool; no option is assumed.

**Verification** (verifier):


### LV-023 · AI document append to an existing conclusion fails

- **Status:** VERIFIED
- **Severity:** High
- **Surface / role:** `/library` document Work studio and Live Dock / signed-in school administrator
- **Report script:** P3-AI-ENGINE · Document · Append; adjacent re-check for LV-020
- **Commit tested:** `d61b1e25` (local instance 8, web port 3000)
- **Frequency:** 2 of 2 final-sentence append attempts to the existing conclusion ended in `failed_terminal` and left the document unchanged after reload.

**Steps**
1. On local instance 8 at commit `d61b1e25`, use saved Profile A and open the existing four-section `Causes of World War I` document in the Library Work studio. It already has a concluding paragraph.
2. Start a new chat and confirm the open document is the only selected context object.
3. Send `Add one final sentence to the conclusion distinguishing the assassination as the trigger from the longer-term causes; do not repeat the existing wording.` Wait for the run to leave its working state.
4. Start another new chat with the same document as its only context and send `Append the exact sentence below after the current conclusion: The assassination was the spark; long-term tensions were the fuel.` Wait for the run to leave its working state.
5. Reload the browser and inspect the end of the document.

**Expected:** The P3-AI-ENGINE document script says, “Add a conclusion paragraph.” The requested conclusion addition should appear in the Work surface and remain after reload.

**Actual:** Both runs reached `failed_terminal`. The first showed “Could not finish · Changing only the part you asked about”; the second showed “Could not finish · 2 related parts will change together.” After reload, the existing conclusion was unchanged and the requested sentence was absent. Playwright reported 0 console errors and 1 Clerk development-key warning.

**Evidence:** `.spectra-local/live-verification/P3-AI-ENGINE-document-append-failed-status-d61b1e25-redacted.png`; `.spectra-local/live-verification/P3-AI-ENGINE-document-append-unchanged-after-reload-d61b1e25-redacted.png`; Playwright console excerpt `.playwright-cli/console-2026-09-30T12-56-51-574Z.log` (0 errors, 1 warning).

**Fix** (fixer)
- Commit: `9d6a4bf34cbfd1aa9ac8793df89dd45e92b980ae`.
- Root cause: Both recorded append attempts used content-prefixed TipTap pointers. The writer removed the optional /content envelope prefix, but document mirror synchronization checked the raw pointer and readback still retained the prefix. The resulting saves had unchanged accepted document content; stale block projection and inconsistent read paths then failed verification despite an executed receipt.
- Change: Normalize content-relative paths before mirror synchronization and in the shared pointer resolver used by apply/readback. This retains existing document/Sheets/whiteboard selector semantics and also fixes prefixed reads for decks and other content collections. Save/authority/readback checks, model/provider/reasoning/context and environment configuration are unchanged.
- Test: Six regressions fail on previous code and pass after: append a final sentence to an existing paragraph, append a new final paragraph, read a prefixed stable block edit, and prefixed/direct pointer parity for a deck, sheet and whiteboard. Document cases exercise the actual write resolver and Yjs projection. All 199 focused patch/readback/native-model/reference/run-route/Convex-scope tests, both TypeScript checks, full lint and all five gates pass. Final full suite: 4,399 passed, 1 failed, 1 skipped (502 passed files, 1 failed, 1 skipped). The sole failure is pending LV-017 hosted packaging; all document/pointer/admission/run-route tests passed. This result is not green.
- Re-check nearby: Sync/restart the verifier-owned local instance 8 to load the shared resolver into Convex, reload the frontend and repeat both reported additions after the existing conclusion. Confirm exact requested text persists after reload without duplicate text and preserves the original conclusion; re-check a new final paragraph, section edits and stable block paths. No shared deployment or code generation is required.

**Verification** (verifier):

VERIFIED on commit `9d6a4bf3`, 2026-09-30. After a full local instance-8 stop/start, both recorded final-sentence prompts completed; each requested sentence appeared once after reload, and the original conclusion plus all four section headings remained. Playwright showed 0 console errors and 1 Clerk development-key warning.


### LV-024 · Document paragraph append duplicates content and removes a saved sentence

- **Status:** VERIFIED
- **Severity:** Blocker
- **Surface / role:** `/library` document Work studio and Live Dock / signed-in school administrator
- **Report script:** P3-AI-ENGINE · Document · Append; adjacent re-check for LV-023
- **Commit tested:** `45281d26` (application code; full local instance-8 stack at web port 3000)
- **Frequency:** 1 of 1 new final-paragraph requests duplicated the paragraph and removed a previously saved sentence after reload.

**Steps**
1. On local instance 8 at application commit `9d6a4bf3`, use saved Profile A and open the verifier-created four-section `Causes of World War I` document. Before this test, it contains its original conclusion and two previously saved LV-023 append sentences.
2. Start a new chat and confirm the open document is the only selected context object.
3. Send `Append one new final paragraph after the conclusion explaining how long-standing tensions and decisions during the crisis both shaped the war; do not repeat any existing sentence.` Wait for the run to complete.
4. Inspect the document's Work surface, then reload the page.
5. Inspect the document again.

**Expected:** P3-AI-ENGINE's append action is `Add a conclusion paragraph.` A single new final paragraph should appear, and previously saved document text should remain after reload.

**Actual:** The assistant response described one new final paragraph. The Work surface showed the same paragraph twice. After reload and again after a full local stack restart, both copies remained. The previously saved sentence `The assassination was the spark; long-term tensions were the fuel.` was absent; the other previously saved appended sentence and original conclusion remained, along with all four section headings. Post-restart Work surface counts were: duplicate paragraph lead 2, first append sentence 1, second append sentence 0, original conclusion 1, section headings 1 each. Playwright reported 0 console errors and 1 Clerk development-key warning.

**Evidence:** `.spectra-local/live-verification/P3-AI-ENGINE-document-new-paragraph-duplicate-before-reload-9d6a4bf3-redacted.png`; `.spectra-local/live-verification/P3-AI-ENGINE-document-new-paragraph-response-9d6a4bf3-redacted.png`; `.spectra-local/live-verification/P3-AI-ENGINE-document-duplicate-and-prior-sentence-missing-after-reload-9d6a4bf3-redacted.png`; `.spectra-local/live-verification/P3-AI-ENGINE-document-duplicate-response-9d6a4bf3-redacted.png`; `.spectra-local/live-verification/LV-024-duplicate-paragraph-after-stack-restart-4f8103b6-redacted.png`; `.spectra-local/live-verification/LV-024-browser-console-redacted.txt`.

**Fix** (fixer)
- Commit: `98677c5f5b791f9771f070ae765400844f845d05`.
- Root cause: The accepted patch wrote a new stable paragraph identity into an occupied numeric slot, replacing the prior saved sentence. Independently, DocumentStudio treated any missing projected block as a canonical Word insert; an awareness preview authored a second Yjs node before the immutable admitted delta arrived, so both copies became durable.
- Change: Shared patch resolution rejects whole-item identity collisions at occupied array slots and feeds the existing model repair path, while same-identity rewrites and both append pointers remain valid. The existing native projection transaction moved into a tested helper restricted to canonical Word reconciliation, with an explicit provisional-content flag from ArtifactStudio; ordinary and provisional collaborative content cannot author a second tree. The identity guard also covers deck cards, quiz questions, slides and other stable-ID collections.
- Test: Seven regressions failed before the fix: four collection identity collisions and three real TipTap/Yjs preview or early-projection cases. Afterward, real write resolution preserves the conclusion and saved sentence alongside one new paragraph; collaborative editor reloads retain one copy, and canonical native inserts remain idempotent without altering rich existing content. All 128 focused tests pass including the native-model re-check (32/32); both TypeScript checks, full lint and all five gates passed. The final LV-024/LV-025 suite returned 4,415 passed, 1 failed and 1 skipped; the sole failure is the pending LV-017 hosted package.
- Re-check nearby: Sync/restart only the verifier-owned local instance 8, since Convex admission imports the shared patch helper, then reload. Use a fresh occupied-final-paragraph document; check one and then a second append, both prior literal sentences, an existing-paragraph rewrite, deck/quiz additions, and canonical Word trailing inserts through reload/restart. No shared deploy or codegen occurred.

**Verification** (verifier):

VERIFIED on commit `45281d26`, 2026-09-30. After the exact new-paragraph prompt on the existing four-section document with two prior appended sentences, the resulting paragraph appeared once. Both prior sentences, the original conclusion and all four section headings each appeared once after browser reload and again after a full local instance-8 stop/start. Playwright reported 0 console errors and 1 Clerk development-key warning. Evidence: `.spectra-local/live-verification/LV-024-postfix-document-before-reload-45281d26-redacted.png`; `.spectra-local/live-verification/LV-024-postfix-document-after-reload-45281d26-redacted.png`.


### LV-025 · Skip response produces repeated chat run conflicts

- **Status:** VERIFIED
- **Severity:** High
- **Surface / role:** `/chat` AI answer and clarification choice / signed-in school administrator
- **Report script:** P3-AI-ENGINE · Answer, step 3; clarification-skip neighbor check
- **Commit tested:** `45281d26` (application code; frontend reload on local instance 8 at web port 3000)
- **Frequency:** 1 of 1 “Skip for now” responses was followed by at least 186 HTTP 409 console errors.

**Steps**
1. On local instance 8 at application commit `9d6a4bf3`, use saved Profile A and open a fresh `/chat` with no artifact open and `0 context objects selected`.
2. Send `Tighten my notes summary` and wait for the clarification asking which notes-related item is intended.
3. Click `Skip for now` once without selecting an item.
4. Wait until the assistant response is visible and the clarification choice has closed. Inspect the browser console and the recent same-origin requests.

**Expected:** P3-AI-ENGINE Answer step 3 says, “The model must either do the work with tools or answer without claiming it saved anything.” After skipping the clarification without choosing an item, the run should reach a terminal answer without repeated failed `/api/spectra/run` requests.

**Actual:** After one click, the assistant response became visible and the clarification choice closed. Playwright recorded 186 console errors, each shown as `Failed to load resource: the server responded with a status of 409 (Conflict)` at `http://localhost:3000/api/spectra/run`. The latest ten POST entries in the request list all returned HTTP 409; no additional request appeared during the following 8-second sample. No spinner or outstanding choice remained. The final assistant text said it could not edit a personal notes summary.

**Evidence:** `.spectra-local/live-verification/P3-AI-ENGINE-no-context-notes-summary-final-response-4f8103b6-redacted.png`; `.spectra-local/live-verification/LV-025-no-context-skip-console-network-redacted.txt`; sanitized Playwright console log `.playwright-cli/console-2026-09-30T13-57-34-589Z.log` (same-origin `/api/spectra/run` HTTP 409 entries).

**Question for verifier:** Please record one representative failed request's action name and redacted 409 response sentence, omitting IDs, tokens and prompt content. Endpoint observation remains welcome; real-hook tests reproduced repeated observer registration and historical-attempt final replay, and the local backend records 513 UI_OBSERVATION_INACTIVE errors with the latest at 14:01:26. This independent evidence permits diagnosis to continue.

**Fix** (fixer)
- Commit: `45281d261cc583325a8f659b31168d16676ff891`.
- Root cause: The durable run poll deleted its sequence cursor after a final. Chat refresh emits threads.changed, so the same final replayed, released the real UI observer and caused registration again against the inactive execution, producing repeated 409s. The feed also applied earlier clarification-attempt finals to resumed executions of the same run.
- Change: Retain the monotonic sequence with its settled execution, and stop observing/polling that attempt while letting a new execution resume after the cursor. A batch spanning attempts checks one fresh authoritative run version and updates its cached snapshot before applying current-execution events, so delayed tab snapshots do not discard a new resume. The shared hook covers Chat, Work and Workspace; no provider, reasoning, model, context or semantic routing changes were made.
- Test: Two real-hook regressions fail before the fix: 22 repeated conflict POSTs in a 20 ms simulated poll window, and a prior-attempt final delivered to the resumed run. Five hook tests now pass using the real observer client, including delayed tab snapshots without repeated version reads, effect recreation, and resuming from a settled clarification. Read-only backend log counts independently found 513 UI_OBSERVATION_INACTIVE errors (latest 14:01:26). All 104 focused tests, both TypeScript projects, full lint and all five gates pass; the final LV-024/LV-025 suite returned 4,415 passed, 1 failed and 1 skipped, with only the pending LV-017 hosted packaging failure.
- Re-check nearby: Frontend reload only, then one Skip click in a fresh context-free chat, inspect run requests through the final reply and another 8-second sample. Check normal choice selection, typed clarification answers, retry/Stop and clarification handling in Work/Workspace. No backend sync, shared deploy or codegen is needed.

**Verification** (verifier):

VERIFIED on commit `45281d26`, 2026-09-30. In a fresh context-free `/chat`, one “Skip for now” click closed the choice; the browser recorded 0 console errors, and an 8-second sample after the answer became visible saw 0 `/api/spectra/run` responses. A separate offered-choice and typed-clarification check also produced no console errors. The answer was visible after reload; the pre-reload pending state is recorded separately as LV-027. Evidence: `.spectra-local/live-verification/LV-025-postfix-skip-run-after-120s-45281d26-redacted.png`; `.spectra-local/live-verification/LV-025-postfix-skip-final-reply-after-reload-45281d26-redacted.png`; `.spectra-local/live-verification/LV-025-postfix-skip-observations-redacted.txt`.


### LV-026 · Library full-title search returns broad partial matches

- **Status:** FIXED
- **Severity:** Medium
- **Surface / role:** `/library` search / signed-in school administrator
- **Report script:** exploration · first-week Library and search
- **Commit tested:** `45281d26` (local instance 8; web port 3000)
- **Frequency:** 2 of 2 exact-title queries with no matching full title displayed partial results; the unique no-match control displayed the empty state.

**Steps**
1. On local instance 8 at commit `45281d26`, sign in with saved Profile A and open `/library`.
2. Search for the full title `Stop Check Water Cycle Draft` and wait for the results.
3. Inspect the result count and whether any row contains the full title. Press Enter from the search field once and inspect the opened item.
4. Replace the query with the full title `Water Cycle Stop Partial Run C` and wait for the results.
5. Replace the query with the unique text `ZZZVERIFICATIONNORESULT812` and inspect the empty state.

**Expected:** A complete Library-title query should show a full-title match or a clear no-match state; partial results should be distinguishable from a full-title match.

**Actual:** `Stop Check Water Cycle Draft` showed 9 rows, 0 containing the full phrase; two rows contained `Water Cycle` and seven contained `Draft`. Pressing Enter opened a `Water Cycle Field Guide` item. `Water Cycle Stop Partial Run C` showed 34 rows, 0 containing the full phrase. The unique no-match control showed `Nothing matches “ZZZVERIFICATIONNORESULT812”` and 0 rows. Playwright reported 0 console errors and 1 Clerk development-key warning.

**Evidence:** `.spectra-local/live-verification/LV-026-library-search-query-45281d26-redacted.png`; `.spectra-local/live-verification/LV-026-library-search-result-count-45281d26-redacted.png`; `.spectra-local/live-verification/LV-026-library-search-results-redacted.txt`.


**Assessment** (fixer)
- Root cause: Both orgTree.search and searchPage deliberately delegate ranking to the name full-text provider; they do not impose full-phrase or all-term matching. Library renders that ranked result set without a match category, and Enter opens its highlighted row. This is intended retrieval behavior with an ambiguous presentation contract, rather than a missing full-title record.
- Reproduction: An ignored convex-test fixture calls the real searchPage query with both reported full-title queries against three ordinary titles. Both return partial results and zero full-phrase matches; the unique control returns zero. Test: `.spectra-local/LV026-search-repro.test.ts`, 1/1 passed; log `.spectra-local/LV026-repro.log`. No production records or application code changed.
- Decision: (A) Require all query terms, producing a clear no-match state for a missing title but reducing broad discovery; or (B) preserve ranked broad retrieval and distinguish partial matches while making Enter's highlighted target clear, retaining useful nearby results but adding a result-presentation contract. Full-phrase priority can supplement either option when the exact title exists. The human chose option B on 30 September 2026: retain broad ranked results, clearly label partial matches, and make Enter's target explicit. The approved presentation is implemented below.
**Fix** (fixer)
- Commit: `28a04b6b6bfffac99e20f5374f0cbadbd5d1c8bc`.
- Root cause: Broad name retrieval was intentionally ranked by the full-text provider, but the organizer did not distinguish an absent complete title from related results. The search input opened the first row and the results grid opened its selected row without naming either target. The human approved preserving broad retrieval with explicit match and keyboard guidance.
- Change: Label each search row as Exact title match or Partial match using the shared StatusBadge and a normalized complete-title comparison. Add a search description that names Enter's input target and any distinct selected result target, qualify partial results while more pages remain, and avoid announcing or opening stale first-page rows. The shared organizer covers Library and workspace search in both list/board views without altering retrieval or provider ordering.
- Test: Three real-organizer component regressions fail before and pass after: broad-only results and input Enter, mixed exact/partial rows in provider order and clearing search, and selected-grid Enter versus input Enter. Additional checks cover incomplete pages, loading and ordinary unfiltered Enter. All **64 focused tests**, both TypeScript checks, full lint and all five gates pass; logs `.spectra-local/LV026-{before,focused-final,tsc,convex-tsc,lint,gates}.log`.
- Re-check nearby: Reload the frontend, repeat both reported queries and the unique no-match control, inspect visible badges and named Enter targets, then use Arrow Down and Enter to open another result. Also check exact-title queries, clearing search and workspace-scoped search. No backend sync, environment edit, deploy or codegen is needed.


### LV-027 · AI clarification follow-up remains in progress during extended waits

- **Status:** FIXED
- **Severity:** Medium
- **Surface / role:** `/chat` AI clarification continuation / signed-in school administrator
- **Report script:** P3-AI-ENGINE · Answer, step 3; Stop and steer neighbor check
- **Commit tested:** `45281d26` (local instance 8; web port 3000)
- **Frequency:** 2 of 2 clarification continuations remained in “Thinking / Getting ready” at the last pre-reload observation: one after Skip at 120 seconds and one after selecting an offered item after at least 70 seconds.

**Steps**
1. On local instance 8 at commit `45281d26`, sign in with saved Profile A and open a fresh `/chat` with no artifact and `0 context objects selected`.
2. Send `Tighten my notes summary` and wait for the clarification question and offered choices.
3. Select the offered `Szymborska poetry notes` choice once.
4. Leave the conversation open. At the last check after at least 70 seconds, inspect the assistant progress state and composer controls.
5. Reload the same chat and inspect the conversation again.

**Expected:** P3-AI-ENGINE Answer step 3 says, “The model must either do the work with tools or answer without claiming it saved anything.” After a clarification choice, the continuation should reach a visible terminal response in the open chat; a long-running response should expose the Stop control described in Stop and steer.

**Actual:** After the choice was selected, the page continued to show `Thinking` and `Getting ready` at the last pre-reload check after at least 70 seconds. No Stop or Retry control was present. After reloading the same chat, the final answer was visible. A separate fresh run with one `Skip for now` click still showed the same progress state at 120 seconds; its final answer was visible after a later reload. Both checks reported 0 console errors and 1 Clerk development-key warning.

**Evidence:** `.spectra-local/live-verification/LV-027-clarification-pending-observations-redacted.txt`; `.spectra-local/live-verification/LV-025-postfix-skip-run-after-120s-45281d26-redacted.png`; `.spectra-local/live-verification/LV-025-postfix-choice-run-pending-45281d26-redacted.png`; `.spectra-local/live-verification/LV-027-clarification-choice-final-after-reload-45281d26-redacted.png`.

**Fix** (fixer)
- Commit: `7636be7719aaa00c2494d4f952ac4d88a801f69c`.
- Root cause: Lifecycle discovery reused the short-lived run-tab cache after the choice started a continuation, so the poll could miss that worker and then wait minutes before rediscovering it. Closing the acknowledgement response removed the local request count even though the owned exchange remained active, hiding Stop. A reload loaded the already-saved final reply.
- Change: Lifecycle changes force a fresh tab snapshot using the existing API cache boundary; releasing acknowledgement stream ownership triggers durable discovery again. Acknowledged exchanges enter streaming state and retain Stop until terminal settlement, while pre-acknowledgement rejection clears its provisional exchange. The same handoff serves Chat, Work, Workspace and retry; LV-025 sequence/attempt fences remain intact.
- Test: Three regressions fail before the fix and pass after: Skip and a selected choice receive the durable final without reload, and a delayed snapshot retains Stop after the acknowledgement closes. An additional rejection case proves no provisional progress remains on a refused start. All 108 focused tests, both TypeScript projects, full lint and all five gates pass. Full-suite validation follows the queued fix batch.
- Re-check nearby: Frontend reload only, then both clarification paths without a post-submission reload; check visible final settlement, Stop during an actual worker, typed clarification answers, retry and LV-025's no-conflict-barrage check. No backend sync, deployment or codegen is needed.

### LV-028 · Command bar keyboard shortcut focuses chat search

- **Status:** NEEDS-DECISION
- **Severity:** Low
- **Surface / role:** Spectra command bar shortcut / signed-in school administrator
- **Report script:** P3-WORKSPACE-FLOWS · step 5
- **Commit tested:** `45281d26` (local instance 8; web port 3000)
- **Frequency:** 2 of 2 shortcut attempts

**Steps**
1. On local instance 8 at application commit `45281d26`, sign in with saved Profile A and open `/chat` with the command bar closed.
2. Press `Ctrl+Shift+F`.
3. Inspect the open dialogs and the focused control.

**Expected:** P3-WORKSPACE-FLOWS step 5 says, “Press Mod+Shift+F and type "memory". Expected: "Update memory" is listed.”

**Actual:** After each shortcut attempt, the focused control was the `Search recent chats` input and no dialog was open. Clicking the visible `Open Spectra command bar` button did open the command list, where `Update memory` was present.

**Evidence:** `.spectra-local/live-verification/P3-WORKSPACE-FLOWS-command-bar-shortcut-45281d26-redacted.png`; `.spectra-local/live-verification/LV-028-command-bar-shortcut-observation-redacted.txt`.

**Assessment** (fixer)
- Root cause: This observation matches an intentional current mapping rather than a missing key listener. `KeyboardShortcutsRegistrar` routes Mod+Shift+F to the AppShell sidebar-search event, and `SHORTCUTS` labels that chord “Focus sidebar search”; `UniversalKBar` owns Mod+K. The older report script contradicts these two implemented contracts.
- Reproduction: Mounted the real registrar and command bar together in jsdom with both Ctrl and Meta. Both cases confirm Shift+F invokes sidebar search with no dialog, then K opens the command bar without invoking search again. All **2/2** diagnostic tests pass; log `.spectra-local/LV028-probe.log`. No production code was changed and no shortcut was selected on the user's behalf.
- Decision requested: (1) Keep Mod+K for the command bar and Mod+Shift+F for sidebar search, correct the audit script and include Mod+K in help; existing users retain both mappings. (2) Add Mod+Shift+F as a command-bar alias; sidebar search loses that shortcut unless another is assigned, and help/registrar/command ownership must be updated together. A text question is pending with the user; move on until answered.

### LV-029 · Calendar page stays in an error state

- **Status:** VERIFIED
- **Severity:** High
- **Surface / role:** `/calendar` / signed-in school administrator
- **Report script:** P3-WORKSPACE-FLOWS · step 2
- **Commit tested:** `7bce0577` (local instance 8; web port 3000)
- **Frequency:** 2 of 2 pre-fix reads failed; 2 of 2 post-fix reads loaded

**Steps**
1. On local instance 8 at application commit `45281d26`, sign in with saved Profile A and open `/calendar`.
2. Wait for the Calendar contents to load.
3. Choose `Try again` and wait for the next read.

**Expected:** P3-WORKSPACE-FLOWS step 2 says, “Set the OS to Europe/Madrid and view 20 Oct – 3 Nov. Expected: each date appears once and 27 Oct is present.”

**Actual:** The Calendar panel displayed “Calendar could not be loaded” after the initial read and after Try again. Both reads returned HTTP 500 from `/api/spectra/calendar`; the Plans panel displayed “Plans could not be read just now.” The requested date range and event-default-time check could not be reached.

**Evidence:** `.spectra-local/live-verification/LV-029-calendar-load-500-45281d26-redacted.png`; `.spectra-local/live-verification/LV-029-calendar-load-500-observations-redacted.txt`.

**Verification (2026-09-30):** After restarting the verifier-owned local instance 8, `/calendar` loaded on the initial read and after a fresh reload. In Europe/Madrid, the selected 20 Oct view showed each date from 20 Oct through 3 Nov once, including 27 Oct. The initial read succeeded, so the former `Try again` control was not shown. The browser console had 0 errors. Evidence: `.spectra-local/live-verification/LV-029-calendar-dst-postfix-7bce0577-redacted.png`; `.spectra-local/live-verification/LV-029-calendar-postfix-7bce0577-observations-redacted.txt`.

**Fix** (fixer)
- Commit: `7bce0577d382644b9d755e6243673d062b4621fa`.
- Root cause: A read-only reproduction against local instance 8 failed with `ReferenceError: Buffer is not defined` in Calendar cursor encoding. Both cursor families unconditionally used Node Buffer, which is absent from Convex's web-standard query runtime; even an empty visible range creates a continuation. The Node-based test environment had hidden the same failure across all streams.
- Change: Share one web-standard UTF-8/base64url encoder and parser between visible/partial and keyset cursors. Preserve the existing wire format and cursor validation; this covers Calendar/Plans, unscheduled tasks, planner tasks, migration rows and title-target discovery. Other unconditional Buffer uses are in explicitly Node actions; the thread reader already takes its web-standard branch.
- Test: All six real-query `convex/calendar-pagination.test.ts` regressions fail without the fix and pass after when Buffer is unavailable during queries. Existing pagination assertions also feed legacy-encoded cursors back into the readers, including Unicode planner task IDs and timestamp ties. All **70 focused tests**, both TypeScript checks, full lint and all five gates pass; logs are `.spectra-local/LV029-{before,focused,tsc,convex-tsc,lint,gates}.log`.
- Re-check nearby: Sync this committed backend body through the verifier-owned local instance-8 launcher (its functions sync only at startup), then reload Calendar. Confirm initial load and Try again are error-free, finish the previously blocked clock-change move, and check Plans/unscheduled and partial-time discovery. No shared deployment/codegen or environment edit was performed.


### LV-030 · Agent library stays in a load-error state

- **Status:** VERIFIED
- **Severity:** Medium
- **Surface / role:** `/agents` Agent library / signed-in school administrator
- **Report script:** P3-WORKSPACE-FLOWS · step 7; free exploration
- **Commit tested:** application `7bce0577`; local migration recorded in `17f7a5f9` (instance 8; web port 3000)
- **Frequency:** 15 of 15 pre-fix agent-list requests returned HTTP 400; 2 of 2 post-migration reloads reached the empty state

**Steps**
1. On local instance 8 at application commit `45281d26`, sign in with saved Profile A and open `/agents`.
2. Wait for the Agent library to finish loading.
3. Choose `Could not load agents. Retry` once and wait again.
4. Inspect the visible agent collections and browser console.

**Expected:** P3-WORKSPACE-FLOWS step 7 says, “Open a public agent's preview; open "Add to a workspace". Expected: centred dialogs above the composer. Escape closes them. Install works.”

**Actual:** The page retained the “Could not load agents. Retry” button after the retry. The Published agents collection and the other collections displayed “No agents in this collection yet.” No public agent preview was available. Fifteen `GET /api/spectra?action=agentGraphPage` requests returned HTTP 400, and the console recorded 15 corresponding errors.

**Evidence:** `.spectra-local/live-verification/LV-030-agents-load-400-45281d26-redacted.png`; `.spectra-local/live-verification/LV-030-agents-load-400-observations-redacted.txt`.

**Verification (2026-09-30):** After the local catalog migration, `/agents` left its loading state and showed “No agents in this collection yet.” in all four collections. On the measured reload, the empty state appeared after 3.6 seconds. The old load-error message and Retry action were absent, no HTTP error response was observed during the measured reload, and the console had 0 errors. No authorized public agent fixture was available, so preview/install remains separately blocked under step 7. Evidence: `.spectra-local/live-verification/LV-030-agents-empty-state-17f7a5f9-redacted.png`; `.spectra-local/live-verification/LV-030-agents-empty-state-observations-redacted.txt`.
**Fix** (fixer)
- Commit: `17f7a5f911989d42bb35d61135ac530b89631822` (operator-prerequisite documentation; the repair used the existing internal migration).
- Root cause: Read-only reproduction returned `CATALOG_READ_MODEL_REQUIRED`, and local instance 8's read-model migration table was empty. Agent and artifact graph readers intentionally reject an uncertified catalog rather than returning partial results; the required complete summary migration was documented in S10-CONVEX but missing from the launch README operator checklist.
- Change: Run the existing `spectraArtifacts:backfillSummaries` only on the disposable local instance 8, from `{cursor:null,limit:10}` through every returned cursor until done: **28 bounded pages, 275 derived summaries**, with a complete marker. Add the prerequisite and bounds to docs/README.md. No application guard, environment, deployment configuration, canonical artifact or shared-deployment data was changed; any other deployment must perform its own authorized contiguous migration.
- Test: Before repair, the real local agent query rejected; afterward it completes **42 continuation pages without errors**, returning **0 authorized agent items**. Logs: `.spectra-local/LV030-{before,local-migration,after}.log`. The two focused real-model migration-guard/agent-card tests pass (32 unrelated cases skipped by the filter), both TypeScript checks, full lint and all five gates pass; logs `.spectra-local/LV030-{focused,tsc,convex-tsc,lint,gates}.log`.
- Re-check nearby: Reload /agents and confirm a complete empty state without load/Retry errors or the HTTP 400 loop. The current actor has no authorized agents in the completed traversal, so public preview/install needs an appropriate existing fixture. Recheck artifact graph surfaces too; no code sync/restart is needed for this derived-data repair.


### LV-031 · Permanently deleting an open trashed work shows an error page

- **Status:** VERIFIED
- **Severity:** Medium
- **Surface / role:** Library Trash and Work studio / signed-in school administrator
- **Report script:** P3-WORKSPACE-FLOWS · step 8
- **Commit tested:** `45281d26` (local instance 8; web port 3000)
- **Frequency:** 1 of 1 permanent deletes with the trashed work open

**Steps**
1. On local instance 8 at application commit `45281d26`, sign in with saved Profile A and create a disposable document in the Library.
2. From the document's Actions menu, choose `Move to Trash`.
3. Open Trash and open the same document in the Work studio.
4. From the document's Actions menu, choose `Delete forever` and confirm.
5. Inspect the page and browser console.

**Expected:** P3-WORKSPACE-FLOWS step 8 says, “Open Trash, select the item and press Delete. Expected: "Delete … forever?", then it is gone.”

**Actual:** The delete-confirmation dialog appeared and the document no longer appeared in Trash. The page at `/library?artifactId=<redacted>` then displayed “Something went wrong” with Try again and Reload page controls. The console recorded 3 errors, including `Uncaught ConvexError: WORK_NOT_FOUND` from `replicas:forWork`.

**Evidence:** `.spectra-local/live-verification/LV-031-library-trash-delete-open-studio-error-45281d26-redacted.png`; `.spectra-local/live-verification/LV-031-library-trash-delete-open-studio-error-observations-redacted.txt`.
**Fix** (fixer)
- Commit: `518fe25248da17bbdaf1398d206b0b9740973223`.
- Root cause: Live replica metadata threw WORK_NOT_FOUND as soon as deletion tombstoned the open work, reaching the application error boundary before the shell retired it. Storage-transition metadata had the same exceptional-resource assumption. A post-delete close alone could not cover the reactive race, another tab's deletion or revoked access.
- Change: Both metadata queries return null for unavailable work without revealing private replica/transition state. Studios and resources publish that authoritative absence through the existing access coordinator, which evicts cached bodies and session references, fences pending older opens and retires only the affected Library/Workspace URL while preserving scope. The studio becomes read-only during retirement. Native Word/Office/history preparation explicitly rejects missing metadata before uploads/effects; payload and mutation authority remain strict. This also covers shared/revoked work, resources and storage controls.
- Test: Two real-model tombstone/removal regressions and three native-preparation regressions fail before and pass after. Six hook/URL integration checks prove cached-body eviction, pending-open fencing, loading versus unavailable, no repeated snapshot loop and preserved/unrelated routes. All **130 focused tests**, both TypeScript checks, full lint and all five gates pass, including owner/collaborator filesystem privacy and strict revoked payload/mutation checks. Logs: `.spectra-local/LV031-{before,native-before,focused-final,tsc,convex-tsc,lint,gates,staged-secrets}.log`.
- Re-check nearby: Sync the committed backend body through the owned local instance-8 launcher, reload, then repeat deleting a disposable trashed document while it is open. Confirm no application error, replica-query console error, stale tab or deleted-work URL; retain the Trash/workspace location and another open work. Also try deletion from another tab and a revoked shared work. No shared deploy/codegen or environment edit occurred.

**Verification** (verifier): VERIFIED — commit `a1bd0258`, 2026-09-30. Repeated steps 1–5 with a verifier-created document. The expected confirmation appeared; after confirmation the URL returned to `/library`, the editor closed, Trash showed “The Trash is empty” and “0 items”, and no error boundary or retry controls appeared. Browser capture: 0 console errors, 0 page errors, 0 failed requests, and no `WORK_NOT_FOUND`. Evidence: `.spectra-local/live-verification/LV-031-postfix-empty-trash-a1bd0258-redacted.png`; `.spectra-local/live-verification/LV-031-postfix-observations-a1bd0258-redacted.txt`.


### LV-032 · Offline Undo in Library Trash has no retry action

- **Status:** VERIFIED
- **Severity:** Low
- **Surface / role:** Library Trash Undo / signed-in school administrator
- **Report script:** P3-WORKSPACE-FLOWS · step 8
- **Commit tested:** `45281d26` (local instance 8; web port 3000)
- **Frequency:** 1 of 1 completed offline Undo attempts

**Steps**
1. On local instance 8 at application commit `45281d26`, sign in with saved Profile A and create a disposable document in the Library.
2. From the document's Actions menu, choose `Move to Trash`.
3. While the “Moved to Trash” Undo control is visible, set the browser offline and choose `Undo`.
4. Inspect the message and available controls. Reconnect, reload, and open Trash.

**Expected:** P3-WORKSPACE-FLOWS step 8 says, “Trash a work, then Undo while offline. Expected: an error toast with Retry.”

**Actual:** After Undo, the status said, “This device is offline. You can keep working; Spectra will send changes when you reconnect.” No exact `Retry` button was present. After reconnect and reload, the disposable document remained in Trash.

**Evidence:** `.spectra-local/live-verification/P3-WORKSPACE-FLOWS-library-trash-offline-undo-status-45281d26-redacted.png`; `.spectra-local/live-verification/LV-032-library-trash-offline-undo-observations-redacted.txt`.

**Verification** (verifier): VERIFIED — commit 35921472, 2026-09-30. On the verifier-created document, the expected offline Undo toast included Retry. Reconnecting and clicking Retry without a page reload restored the item, which remained in Recent after reload. The repeated-offline-Retry observation is recorded separately as LV-035. Evidence: .spectra-local/live-verification/LV-032-postfix-offline-undo-toast-35921472-redacted.png; .spectra-local/live-verification/LV-032-postfix-observations-35921472-redacted.txt.


**Fix** (fixer)
- Commit: `1a390f5c0f666672510d2f01c6248338a3be85c1`.
- Root cause: The existing organizer Retry toast runs only on rejection, but Convex retains unsent mutations in browser memory with a pending promise while offline. Undo therefore never reached its catch path, and reloading could discard the request. The product-wide banner incorrectly promised that every change would later be sent.
- Change: Guard the shared Library mutation boundary against the browser's known-offline signal and reject before enqueueing, reusing existing readable-error and Retry handling. This covers restore/Undo, trash, purge, move, rename, pinning, references, folder/work creation and root creation, including semantic commands using the same actions. Requests already submitted remain alive, and the offline banner now distinguishes editable open work from actions needing a connection; no parallel queue, timeout, optimistic restore or backend change was added.
- Test: Twelve cases fail before and pass after. The real organizer with real action hooks proves offline Undo displays Retry without submitting a mutation and reconnect/Retry restores the same item exactly once; ten action-entrypoint regressions prove no unsent mutation, and a separate case preserves an already-submitted restore through a later disconnection. All **43 focused tests**, both TypeScript projects, full lint and all five gates pass, including a staged secret scan of 3,319 files. Logs: `.spectra-local/LV032-{before,focused-final,tsc,convex-tsc,lint,gates,staged-secrets}.log`. Full-suite validation follows this batch.
- Re-check nearby: Frontend reload only. Trash a disposable item, disconnect and Undo: expect a readable offline toast with Retry and the item still in Trash; reconnect and Retry without reloading, then confirm restoration persists after reload. Check Retry while still offline, another Library mutation, and continued offline editing of an already-open document. No backend sync, deploy or codegen required.

### LV-033 · Personal event defaults retain the current minute

- **Status:** FIXED
- **Severity:** Medium
- **Surface / role:** `/calendar` personal-event composer / signed-in school administrator
- **Report script:** P3-WORKSPACE-FLOWS · step 2
- **Commit tested:** `7bce0577` (local instance 8; web port 3000)
- **Frequency:** 3 of 3 composer openings

**Steps**
1. On local instance 8 at application commit `7bce0577`, sign in with saved Profile A, whose browser timezone is Europe/Madrid, and open `/calendar`.
2. Click `Add event` and inspect the default `Starts` and `Ends` fields without changing them.
3. Close and reopen the composer twice, including once after reloading `/calendar`.

**Expected:** P3-WORKSPACE-FLOWS step 2 says, “Create an event with the default time. Expected: the next whole hour, local time.”

**Actual:** Across three openings, the start and end defaults were 19:05–20:05, then 19:06–20:06, then 19:07–20:07 local. The first form was read at 18:05:19 and the fresh-reload form at 18:07:58. Saving a disposable local personal event confirmed it appeared in Calendar as 19:07–20:07; it was then removed through `Remove from Calendar` and no longer appeared.

**Evidence:** `.spectra-local/live-verification/LV-033-calendar-default-time-7bce0577-redacted.png`; `.spectra-local/live-verification/LV-033-calendar-default-time-7bce0577-fresh-redacted.png`; `.spectra-local/live-verification/LV-033-calendar-default-time-observations-redacted.txt`.

**Fix** (fixer)
- Commit: `1dfd6df04da7fa0dc59c909f8fe72502d1131b05`.
- Root cause: The composer added elapsed hours to the current clock, preserving its minutes. The earlier local-time test froze an exact hour and therefore could not detect the error; separate default calculations also read the clock independently.
- Change: Initialize and reset the paired defaults through one shared local-hour helper from one clock reading. Advance whole local civil hours so midnight, the spring gap and the repeated autumn hour keep an end after the start; existing scheduled durations and user-entered times retain their behavior.
- Test: Six cases fail before and pass after in `calendar-application.component.test.tsx`: minute rounding, midnight, both DST changes, reopen after the clock advances and persisted default timestamps despite a UTC overview. The exact-hour control stays green. All 17 focused tests, both TypeScript projects, full lint and all five gates pass. Logs: `.spectra-local/LV033-{before,focused,tsc,convex-tsc,lint,gates}.log`.
- Re-check nearby: Frontend reload only, then open/reopen away from an exact hour, save a disposable default event and confirm its whole local-hour display. Also check midnight and DST boundaries when feasible. No backend sync, deploy or codegen required.

### LV-034 · Trash quick view does not respond to pointer click

- **Status:** VERIFIED
- **Severity:** Medium
- **Surface / role:** Library Trash navigation / signed-in school administrator
- **Report script:** P3-WORKSPACE-FLOWS · step 8
- **Commit tested:** `a1bd0258` (local instance 8; web port 3000; saved Profile A)
- **Frequency:** 1 of 1 captured direct pointer-click attempts; Enter opened the view

**Steps**
1. On local instance 8 at `a1bd0258`, sign in with saved Profile A and set the browser viewport to 1280×720.
2. Open Library and locate the `Trash` quick-view button in its navigation rail.
3. Click `Trash` with the pointer and wait for the view to open.

**Expected:** P3-WORKSPACE-FLOWS step 8 says, “Open Trash, select the item and press Delete. Expected: \"Delete … forever?\", then it is gone.”

**Actual:** The pointer click did not activate Trash and timed out after 30 seconds. At the button center, the browser hit test returned the `Open actions` button; Trash remained unselected. Pressing Enter on Trash selected it and opened the view. The Trash button bounds were x=248, y=676, width=231, height=32; the hit target was also visible within x=240–1280, y=640–720.

**Evidence:** `.spectra-local/live-verification/LV-034-library-trash-pointer-interception-a1bd0258-redacted.png`; `.spectra-local/live-verification/LV-034-library-trash-pointer-observations-a1bd0258-redacted.txt`; console: 0 errors and 1 Clerk development warning; no request was sent for the timed-out click.

**Verification** (verifier): VERIFIED — commit 35921472, 2026-09-30. At 1280×720, the first pointer click selected Trash; the view showed its empty state and bounds x=248, y=580, width=231, height=32. Recent, Favorites, Shared and Trash remained navigable with the verifier document open. Browser summary: 0 console errors and 1 Clerk development warning. Evidence: .spectra-local/live-verification/LV-034-postfix-pointer-35921472-redacted.png; .spectra-local/live-verification/LV-034-postfix-observations-35921472-redacted.txt.

**Fix** (fixer)
- Commit:
- Root cause:
- Change:
- Test:
- Re-check nearby:

**Fix** (fixer)
- Commit: `0101aad9378edca44a915e53d73f9c5386b52cf1`.
- Root cause: The shared organizer rail anchored its quick views at the viewport bottom without consuming the composer band's measured safe area. Adjacent list and board surfaces already used that contract, but the rail did not; Trash sat underneath the real Open actions button while its keyboard handler remained functional.
- Change: Add the existing `spectra-composer-clearance` class to `OrganizerRail`. This applies the one existing measured-height contract to Library and workspace rails, including grown docks, without hard-coded offsets, new layout state, pointer suppression or z-index changes.
- Test: The rail component regression fails before and passes after. An isolated headless browser fixture using real rail/dock-frame markup, compiled production CSS and the real safe-area publisher reproduces the exact reported bounds (Trash y=676–708, band top=640) and Open actions hit before the fix. Afterward the hit is Trash with 28px clearance in all three cases: 1280×720 with 80px and 160px bands, and 1024×600 with a collapsed sidebar. All **20 focused tests**, both TypeScript projects, full lint and all five gates pass; the layout detector returns no findings. Logs: `.spectra-local/LV034-{before,layout-before,layout-after,focused,tsc,convex-tsc,lint,gates,design-scan}.log`; reproducible isolated fixture/script: `.spectra-local/LV034-{fixture.test.tsx,layout.cjs}`. Full suite: **4,455 passed, 1 failed, 1 skipped**; the sole failure remains pending LV-017 hosted packaging. Log: `.spectra-local/launch-fixer-LV034-full.log`.
- Re-check nearby: Frontend reload only, then click Trash with the pointer at 1280×720; check Recent/Favorites/Shared, an expanded folder tree, workspace rail, collapsed sidebar, taller live dock and narrow drawer. Confirm the composer actions remain usable and run LV-032's offline Undo/Retry check. No backend sync, deploy or codegen required.

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

- Latest fix: LV-023 is FIXED at `9d6a4bf34cbfd1aa9ac8793df89dd45e92b980ae`. Six failing-before regressions prove content-prefixed document append/block pointers and deck/sheet/whiteboard reads now agree with direct pointers. All 199 focused tests, both TypeScript checks, full lint and all five gates pass. The verifier has the hash and local backend sync/reload instructions; no shared deploy/codegen or environment edits occurred.
- Latest full suite after LV-023: **4,399 passed, 1 failed, 1 skipped**; **502 passed files, 1 failed, 1 skipped** (504 files), duration 326.60 seconds. The sole failure is pending LV-017 hosted Docker packaging omitting shared runtime modules. All document, pointer, admission and run-route tests passed. Log: `.spectra-local/launch-fixer-LV023-full.log`. This full result is not green; the requested Docker COPY exception remains unanswered and its prepared patch remains unapplied.
- Latest implementation commit: `9d6a4bf3` — normalize content-prefixed patch paths consistently (LV-023). Preceding assessment commit: `d61b1e25` (LV-022). **NEEDS-DECISION:** LV-022 — choose a final reply generated after verified receipts (latency/usage) or an authoritative saved-result message with separately labeled pre-save explanation (presentation change); no option assumed. Earlier decisions LV-003/LV-012 and CANNOT-REPRODUCE entries LV-004/LV-007 with their reasons remain below.


- Latest assessment: LV-022 is **NEEDS-DECISION**. The real receipt helper retains a pre-save claim for all three tested canonical/native receipt outcomes, and both initial and resumed reporting paths reuse that draft. Choose post-save model prose (extra latency/usage) or an authoritative saved-result message with a separately labeled pre-save explanation (different presentation); both must preserve the full requested explanation and authoritative canonical/native facts. The user decision is pending, so no implementation was selected. All 25 receipt-report tests pass. No code changed; latest full suite remains **4,392 passed, 2 failed, 1 skipped**, with the packaging and Stop-auth limits recorded below.
- LV-021 is now VERIFIED by the live verifier: twelve distinct cards persist after reload and the earlier card-3 hint remains intact. Its four-line code correction is `68587ec8`; the preceding ledger commit is `defe6e8a`.


- Latest fix: LV-021 is FIXED at `68587ec816eb80c33f04d8a17b9791dac75c5ef2`. Four regressions fail before and pass after: public-planner deck/quiz patch appends and full update payloads with a final count larger than the requested addition count. Real write resolution/Yjs projection keeps eight original identities and four added identities, while wrong creation totals remain rejected. All 97 focused tests, both TypeScript checks, full lint and all five gates pass. The verifier received the hash and reload-only re-check instructions; no backend restart, deploy or codegen is needed.
- Latest full suite after LV-021: **4,392 passed, 2 failed, 1 skipped**; **501 passed files, 2 failed, 1 skipped** (504 files), duration 309.74 seconds. Failures: pending LV-017 hosted package lacks shared runtime modules; unchanged run-route Stop-auth case returned 409 instead of 403. The entire run-route file then passed **59/59** separately (and passed in the focused run). Logs: `.spectra-local/launch-fixer-LV021-full.log` and `.spectra-local/LV021-run-route-recheck.log`. This full result is not green; the Docker COPY exception remains unanswered and unapplied.
- Latest implementation commit: `68587ec8` — scope collection final-total checks to creation (LV-021). Latest preceding ledger commit: `66d57dff` (LV-020). Earlier implementation commits, NEEDS-DECISION entries (LV-003 and LV-012), CANNOT-REPRODUCE entries (LV-004 and LV-007), and their reasons remain below.


- Latest fix: LV-020 is FIXED at `7a1a8508932caca7f6e48f9960bab4350d668935`. Four failing-before regressions prove rewritten TipTap text, rich subtrees, structure replacement and mixed block/tree order survive the existing write resolver and Yjs projection. All 187 focused tests, both TypeScript checks, full lint and all five gates pass. The verifier has the code hash and instructions to sync the owned local backend (the helper is shared with Convex admission), reload and re-check. No shared deployment/codegen was performed.
- Latest full suite after LV-020: **4,389 passed, 1 failed, 1 skipped**; **502 passed files, 1 failed, 1 skipped** (504 files), duration 305.46 seconds. The sole failure is LV-017 hosted Docker packaging omitting the required shared runtime modules. All document tests passed; the Stop-auth and sheets performance tests that failed in the previous full run passed here. Log: `.spectra-local/launch-fixer-LV020-full.log`. This result is not green; the Docker COPY exception is still unanswered and its prepared patch remains unapplied.
- Latest implementation commit: `7a1a8508` — synchronize authored document tree and derived block mirrors (LV-020). Ledger closeouts for the preceding fix are `cf2869e8`; earlier commits and decision/reproduction limits remain below. LV-019 is now VERIFIED by the live verifier, including long new-chat answers, Retry and a detailed document-edit reply.


- Latest fix: LV-019 is FIXED at `427cb3c9c3664e03a6ff62af41f39b19cafba913`. Local diagnostics confirm the same 4,000-character finalResponse bound rejected both the original essay and Retry. Remove that prose bound consistently from the validator and provider schemas; four public-planner regressions fail before and pass after, with a fifth provider-contract alignment check. All 117 focused tests, both TypeScript checks, full lint and all five gates pass. The verifier received the commit and reload-only checks; live verification remains pending.
- Latest full suite after LV-019: **4,382 passed, 3 failed, 1 skipped**; **500 passed files, 3 failed, 1 skipped** (504 files), duration 310.17 seconds. Failures: LV-017 hosted package omits shared runtime imports; unchanged run-route Stop auth case returned 409 instead of 403; unchanged sheets dense-cell patch took 49.1988 ms against its 40 ms bound. Both latter files then passed **136/136** in a separate run. Logs: `.spectra-local/launch-fixer-LV019-full.log` and `.spectra-local/LV019-full-failures-recheck.log`. The full-suite result is not green and the LV-017 package exception remains pending.
- Latest implementation commit: `427cb3c9` — preserve long final prose through validation and continuation (LV-019). Earlier implementation commits and outstanding decisions/reproduction limits are retained below.


- Latest batch: LV-018 is FIXED at `3574fca2b37302aa272141dd5f17e1fe6c575c47`. All four real rich-editor regressions fail before and pass after; paired rich editors merge colour/colours/color to colors, converge while focused, and retain it through blur and a Yjs reload. All 45 focused tests, both TypeScript checks, full lint and all five gates passed. The verifier received the code hash and no-restart frontend re-check steps.
- LV-017 code fix is committed at `57dbcb87093133c547c320c9c111335d20ff25ed` and has a successful local two-tab/reload verification recorded by the verifier. Six regressions failed before and pass after; 66 focused tests, both TypeScript checks, lint and all gates passed. It remains **NEEDS-INFO** because the hosted gateway package omits its two new shared runtime imports. The user instruction forbids deployment-configuration edits; a narrow exception was requested for those two Docker COPY source entries. A reviewable patch is prepared at `.spectra-local/LV017-hosted-package.patch` and passes `git apply --check`; it is unapplied. No Dockerfile edit or deployment occurred.
- Latest full suite after LV-018 (`npx vitest run`): **4,379 passed, 1 failed, 1 skipped**; **502 passed files, 1 failed, 1 skipped** (504 files), duration 316.79 seconds. The sole failure is `scripts/collaboration-gateway-package.test.mjs`, which proves LV-017's two shared runtime files are absent from the hosted Docker image. Log: `.spectra-local/launch-fixer-LV018-full.log`. This full run is not green; all other tests passed. The preceding LV-017 full run had 4,374 passed, 2 failed, 1 skipped: this same packaging failure and an unchanged run-route timeout; that file passed 59/59 in isolation and passed in this latest full run.
- Previous batch: LV-016 is FIXED at `7c0e4b5577c83828c312f0fae929dd2cfb57e90e`. The admin overview now composes the existing own-account reader with unchanged shared previews. Read-only local aggregates confirmed 258 assignments and 81 timetable records mapped to the administrator; a real-route/model regression failed before and passes after without exposing another member's private data. All 37 focused tests, both TypeScript checks, full lint and all five gates passed; the final narrowed test adapter re-check passed 2/2. The verifier was sent reload-only re-check steps; no backend restart/deploy/codegen is needed. LV-015 has a successful live verification recorded on `7c4169a8`.
- Previous full suite after LV-016 (`npx vitest run`): **4,369 passed, 1 failed, 1 skipped**; **501 passed files, 1 failed, 1 skipped** (503 files), duration 316.89 seconds. The sole failure is unchanged `sheets-operations.test.ts` dense-cell patch performance: 45.9627 ms exceeded its 40 ms bound during the parallel run. The entire file passed **77/77** in isolation. Logs: `.spectra-local/launch-fixer-LV016-full.log` and `.spectra-local/LV016-sheets-recheck.log`. This latest full run is not green. The account-erasure tests that failed in the preceding run passed in this run.
- Previous batch: LV-015 is FIXED at `7c4169a857ac088f9b826779e560bd36270de76a`; its five UI regressions fail before the change and pass afterward. All 50 focused tests, both TypeScript checks, full lint and all five gates passed. The verifier was sent the hash and asked to leave History open through a scheduled completion without another refresh/reload. Existing partial provider outcomes remain truthful; this fix does not claim to fill their gaps.
- Previous full suite after LV-015 (`npx vitest run`): **4,365 passed, 3 failed, 1 skipped**; **500 passed files, 1 failed, 1 skipped** (502 files), duration 312.49 seconds. All three failures are in unchanged `convex/account-erasure-lifecycle.test.ts`: scheduled-function drains hit the 10,000 timer-pump limit. Its isolated re-check passed **7/7**. Logs: `.spectra-local/launch-fixer-LV015-full.log` and `.spectra-local/LV015-erasure-recheck.log`. That LV-015 full run was not green; the earlier green LV-014 run below remains historical evidence.
- Implementation commits: `454a7bbe` — foreground local Convex selection (LV-001); `94d3cbb3` — account reads before school membership (LV-002); `95243861` — School/ManageBac membership gate (LV-005); `66179153` — Analytics membership gate (LV-006); `683803d1` — reactive membership subscription guard (LV-008); `c9034739` — account/deployment ownership for restored workbench references (LV-009); `d873b89c` — connection-owned collaboration room (LV-011); `ed76ef1f` — app-origin-aware local Bridge readiness (LV-012, partial correction); `4bfe0a86` — preserved ManageBac action error reasons (LV-010, confirmed error-copy correction); `e8cd4740` — explicit credential recovery from a blocked connection (reopened LV-010); `0a8a2360` — truthful connection versus sync-history copy (LV-013); `6451c630` — one authorized class collection for picker and count (LV-014); `7c4169a8` — refresh scheduled sync progress without replacing class drafts (LV-015); `7c0e4b55` — include the administrator own-account records in ManageBac views (LV-016); `57dbcb87` — shared collection initialization (LV-017, package exception pending); `3574fca2` — focused rich-text convergence and no stale blur replay (LV-018).
- Audit/assessment commits before this closeout: `690266bc`, `3df6301a`, `d551198a`, `d3bac8ce`, `6f1391aa`, `d4e0f766`, `d712d92b`, `ee89ec4d`, `ae83fe42`, `f988b6ce`, `d94ee311`, `c6f0108b`, `c119147d`, `c1593b6b`, `763a5057`, `8834d153` and `98b0bc37`. Issue entries preserve full implementation hashes, evidence and re-check instructions.
- Previous full suite after LV-014 (`npx vitest run`): **4,363 passed, 0 failed, 1 skipped**; **501 passed files, 0 failed, 1 skipped** (502 files). Duration: 313.98 seconds. Result: `.spectra-local/launch-fixer-LV014-full.log`. That LV-014 run was green. The earlier LV-013 full run had 4,356 passed, 3 failed, 1 skipped, all failures in unchanged account-erasure timer-pump drains, followed by a 7/7 isolated pass; that earlier result is retained in history and is superseded by this green full run.
- The preceding batch full run returned **4,346 passed, 3 failed, 1 skipped**. It loaded the pre-fix ManageBac module while the three new regressions were being added; it is not final validation. Those regressions pass against the committed fix. Earlier full-suite results remain in the issue entries/history; the LV-006 full run was green.
- Latest focused validation: LV-014 **42 UI/class-picker/honesty/real-model isolation tests passed**, both TypeScript checks, full lint and all five gates passed. Three original collection/count/error regressions failed before the fix; a fourth proves refresh updates count and controlled selection together. Earlier focused validation: reopened LV-010 **20 real-model/provider/scheduling tests passed**; LV-013 **17 UI/copy/honesty tests passed**. Both TypeScript checks, lint and all five gates passed for each. Earlier focused validation: LV-011 **37 Vitest + 7 Node checks passed**; LV-012 **36 Vitest + 4 Node checks passed**; LV-010 **25 focused tests passed** (19-test API/UI recheck also passed). Both TypeScript checks, full lint and all five gates passed for each change. Every new regression was observed failing before its fix.
- The verifier marked LV-001, LV-002, LV-008, LV-009, LV-010, LV-011 and LV-013 VERIFIED. LV-005, LV-006 and LV-014 are FIXED pending their live re-check. LV-011's preserved document draft reached the second tab and survived both reloads after the local gateway restart.
- **NEEDS-DECISION:** LV-003 — keep invalid/expired invitation preview 404/410 responses or change to a normal unavailable-preview result. LV-012 — keep automatic discovery and defer the incompatible pre-existing Bridge until its owner authorizes a properly configured restart, or agree an explicit connection/activation workflow; the launcher correction does not repair that running process. The human process-ownership constraint was respected; no Bridge origins were broadened and native-file verification remains deferred.
- **CANNOT-REPRODUCE:** LV-004 — MIME encoding artifacts in the original invitation URL; decoded generated-token preview worked. LV-007 — the original Escape check exercised an idle confirmation, while the later pending-request observation retained the dialog and disabled controls.
- LV-010 is VERIFIED after the authorized instance-8 launcher sync loaded the committed Convex body: identity resolution and manual sync returned 200 with Complete history. Saved local backends sync functions once at startup; they do not watch source. The earlier watcher assumption was corrected, no shared deployment/codegen was performed, and the pre-existing Bridge was left untouched.
- No OPEN, REOPENED or FIXING entries remain at closeout. Live verification continues under the recorded authorization. Per the user's instruction, the fixer stops between tasks and resumes when the verifier messages about a new or reopened ledger issue.


## Fixer closeout · LV-024 and LV-025

- Implementation commits: `98677c5f` — preserve saved paragraph identities and keep collaborative previews from authoring duplicate nodes (LV-024); `45281d26` — consume durable finals once per attempt and fence resumed execution events (LV-025). Audit commit: `57219dd0`. Both issues are FIXED and have been sent to the verifier with browser re-check steps; only the verifier sets VERIFIED.
- Full suite: **4,415 passed, 1 failed, 1 skipped**; **504 passed files, 1 failed, 1 skipped** (506 files). The sole failure remains `scripts/collaboration-gateway-package.test.mjs`: the hosted image omits LV-017's two shared runtime modules. Its two-line COPY patch remains unapplied because deployment-configuration edits are prohibited and the requested exception has no answer. Log: `.spectra-local/launch-fixer-LV025-full.log`. This result is not green. Both fixes passed their focused tests, both TypeScript projects, full lint and all five gates.
- **NEEDS-DECISION:** LV-022 — post-save model prose adds latency/usage, while an authoritative saved-result message with separately labeled pre-save explanation changes presentation; no option was selected. LV-003 — invalid/expired invite 404/410 semantics versus an unavailable-preview result. LV-012 — automatic Bridge discovery versus an explicit connection/activation workflow; the earlier authorized restart does not settle the presentation decision.
- **CANNOT-REPRODUCE:** LV-004 — the original invitation had MIME encoding artifacts and the decoded generated token worked. LV-007 — the original Escape observation concerned an idle dialog; the pending-request check retained the dialog and disabled its controls. LV-017 remains NEEDS-INFO for the hosted-package exception described above.
- No OPEN, REOPENED or FIXING issue remains. The fixer stops between tasks under the user's instruction, and will resume when the verifier supplies a new or reopened ledger issue. No shared deploy/codegen, environment edits or production-data changes were performed for these two fixes.

## Batch validation · LV-027, LV-029 and LV-026

- Commits: `7636be77` (continuation handoff), `7bce0577` (Convex-runtime Calendar cursors), `28a04b6b` (approved search presentation); audit commits `6b9c8f58`, `6c8489ad`, `41502faf`. LV-030 local catalog readiness is repaired and documented at `17f7a5f9`.
- Full suite: **4,422 passed, 4 failed, 1 skipped**; **502 passed files, 3 failed, 1 skipped** (506 files), duration **324.60 seconds**. Log: `.spectra-local/launch-fixer-LV026-full.log`. Failures are pending LV-017 hosted packaging, two Stop-auth/timing cases and the sheet dense-cell performance threshold; the last three then pass with **136/136 tests** in `.spectra-local/LV030-full-failures-recheck.log`. The full result is not green; the deployment-config exception remains unanswered.
- Fixing continues with LV-031, then Low findings LV-028/LV-032. Earlier NEEDS-DECISION, NEEDS-INFO and CANNOT-REPRODUCE entries remain unresolved as recorded.

## Fixer closeout · LV-031, LV-033 and LV-032

- Implementation commits: `518fe25248da17bbdaf1398d206b0b9740973223` — retire unavailable open work through the existing access lifecycle (LV-031); `1dfd6df04da7fa0dc59c909f8fe72502d1131b05` — next whole local-hour event defaults (LV-033); `1a390f5c0f666672510d2f01c6248338a3be85c1` — reject known-offline Library actions before enqueueing and reuse Retry (LV-032). Audit commits: `40eb9e8f`, `a1bd0258`, `0081b309`; shortcut assessment: `445ee4e1`. These commits use the existing human Git identity and omit AI co-author trailers, as requested; earlier history is untouched.
- Full suite: **4,454 passed, 1 failed, 1 skipped**; **506 passed files, 1 failed, 1 skipped** (508 files), duration **316.13 seconds**. Log: `.spectra-local/launch-fixer-LV032-full.log`. The sole failure is `scripts/collaboration-gateway-package.test.mjs`, confirming the hosted image omits `shared/yjs-collections.mjs`; the prepared LV-017 patch covers both missing runtime modules. All other tests, including the earlier Stop-auth/timing and dense-sheet cases, pass. This full result is not green. Each implementation also passed its focused tests, both TypeScript projects, full lint and all five gates.
- **NEEDS-DECISION:** LV-028 — retain deliberately implemented Mod+K command bar / Mod+Shift+F sidebar search and correct script/help, or give Shift+F to the command bar and change the sidebar shortcut contract; user question pending. LV-022 — post-save model prose adds latency/usage, while an authoritative saved-result message with separately labeled pre-save explanation changes presentation. LV-003 — invalid/expired invite 404/410 semantics versus an unavailable-preview result. LV-012 — automatic Bridge discovery versus explicit connection/activation; the earlier owned restart does not settle that presentation choice. No option was assumed.
- **CANNOT-REPRODUCE:** LV-004 — original invite URL had MIME encoding artifacts; the decoded generated token worked. LV-007 — the original Escape check exercised an idle confirmation; the pending-request check retained its dialog and disabled controls. **NEEDS-INFO:** LV-017 — hosted-package COPY exception remains unanswered; deployment-configuration edits are explicitly forbidden, so its reviewed two-line patch remains unapplied. No deployment or codegen was performed.
- No OPEN, REOPENED or FIXING issue remains at this closeout. LV-031/LV-033/LV-032 are FIXED with live checks sent to the verifier; only that verifier sets VERIFIED. Under the user's instruction the fixer stops between tasks, and resumes when the verifier supplies a new/reopened issue or the user answers a pending decision.

## Fixer closeout · LV-034

- Commits: `0101aad9378edca44a915e53d73f9c5386b52cf1` — shared rail consumes measured composer clearance (LV-034); `38f2088b` — audit and preserved LV-031 live verification. Existing human Git identity, no AI co-author trailers.
- Full suite: **4,455 passed, 1 failed, 1 skipped**; **506 passed files, 1 failed, 1 skipped** (508 files), duration **320.32 seconds**. Log: `.spectra-local/launch-fixer-LV034-full.log`. Sole failure: LV-017 hosted gateway Docker package omits a shared runtime module; the prohibited deployment-config edit remains unapplied. All other tests pass. Focused **20/20**, both TypeScript projects, full lint, all five gates and isolated browser before/after layout checks pass.
- **NEEDS-DECISION:** LV-028 — current shortcut mappings versus reassigning Shift+F; LV-022 — post-save prose latency/usage versus a different saved-result presentation; LV-003 — expired-invite HTTP semantics; LV-012 — automatic Bridge discovery versus explicit activation. **CANNOT-REPRODUCE:** LV-004 — original MIME-encoded invitation artifacts; decoded generated token works; LV-007 — idle versus pending confirmation behavior, with pending controls retained/disabled. **NEEDS-INFO:** LV-017 — narrow hosted-package COPY exception unanswered. Earlier entries preserve details; no pending choice was assumed.
- No OPEN, REOPENED or FIXING issue remains. LV-034 is FIXED and sent for live pointer/navigation recheck; LV-031 is now VERIFIED by the verifier. Stop between tasks as requested; no deployment, codegen, production-data or environment changes occurred.
### LV-035 · Retrying an offline Library undo shows overlapping duplicate notices

- **Status:** VERIFIED
- **Severity:** Medium
- **Surface / role:** Library Trash Undo / signed-in school administrator (saved Profile A)
- **Report script:** P3-WORKSPACE-FLOWS · step 8; LV-032 post-fix adjacent check
- **Initial commit tested:** 35921472 (local instance 8; web port 3000)
- **Verification commit tested:** 51d6529a (app code from fix commit 3e22ac4c; local instance 8; web port 3000)
- **Frequency:** The pre-fix behavior occurred in 2 of 2 attempts. The post-fix retest passed once, including two consecutive Retry clicks while offline.

**Steps**
1. On local instance 8 at application commit 35921472, sign in with saved Profile A and open the verifier-created disposable document in Library > Recent.
2. From the document's Actions menu, choose Move to Trash.
3. Set the browser offline while the Undo action is visible, then choose Undo.
4. When the offline error toast with Retry appears, choose Retry while the browser remains offline.
5. Inspect the visible notifications and Retry controls; reconnect and choose Retry online.

**Expected:** P3-WORKSPACE-FLOWS step 8 says, “Trash a work, then Undo while offline. Expected: an error toast with Retry.” After another offline Retry, the error state remains legible without overlapping duplicate notices; after reconnect, Retry restores the item without a reload.

**Actual before fix:** In 2 of 2 attempts, choosing Retry while still offline displayed two overlapping offline notices at the top of the page and two visible Retry buttons. Their button bounds were x=1194, y=10 and x=1194, y=6 in the 1280×720 viewport. After reconnect, choosing Retry restored the item; the Trash view was empty.

**Evidence:** .spectra-local/live-verification/LV-032-postfix-offline-retry-state-35921472-redacted.png; .spectra-local/live-verification/LV-032-postfix-observations-35921472-redacted.txt; during the fast retry sequence, 0 console errors, 0 page errors and 0 failed requests were observed.

**Verification after fix (2026-09-30):** On local instance 8, signed in with saved Profile A at 1280×720, a uniquely named disposable document was moved to Trash. Undo while offline showed one Retry notice. After each of two consecutive offline retries, exactly one Retry button remained visible. Reconnecting and choosing Retry restored the document, removed the Retry notice, and the document remained in Recent after reload. The browser console capture showed 0 new error entries after this sequence.

**Verification evidence:** .spectra-local/live-verification/LV-035-postfix-retry-one-e9d438e9-redacted.png; .spectra-local/live-verification/LV-035-postfix-retry-two-e9d438e9-redacted.png; .spectra-local/live-verification/LV-035-postfix-console-summary-e9d438e9-redacted.txt; .spectra-local/live-verification/LV-035-postfix-verification-51d6529a-redacted.txt.

**Fix** (fixer)
- Commit: `3e22ac4c2a2e854f3082ff1760c1575f07c39806`.
- Root cause: Sonner automatically animates an action toast out when Retry is clicked, but the Library runner created a new toast identity on each rejection. An immediate offline failure therefore displayed a second Retry notice while the first was still exiting. Both route-side work and conversation loaders used the same retry pattern.
- Change: A small shared UI helper retains the action notice until the retry settles and updates the same operation identity on failure; callers dismiss it on success. It keeps unrelated operations distinct and guards against a second submission during a pending retry. Library actions and both route-side loaders now use it; no global toast suppression, stacking/style changes, new queue or mutation behavior was added.
- Test: The real Sonner toaster mounted with the real organizer/action hooks reproduces two Retry buttons before the fix. Afterward two offline retries keep one notice and enqueue no mutation; reconnect/Retry restores the same item exactly once and clears the notice. A separate real-toaster test preserves distinct operations, and a pending-retry regression fails before its guard and proves one submission after. All **44 focused tests**, both TypeScript projects, full lint and all five gates pass; staged secret scan covers 3,321 files. Logs: `.spectra-local/LV035-{before,pending-before,focused-final,tsc-final,convex-tsc-final,lint-final,gates-final}.log`. The UX closure source guard is updated at `c99224070b7a88a713c2538fe919b06b9f20b4a7` to follow both the caller and shared Retry label. Final full suite: **4,453 passed, 6 failed, 1 skipped**; five unchanged lifecycle/timing failures then pass **66/66** in isolation, while LV-017 hosted packaging remains unresolved. Logs: `.spectra-local/launch-fixer-LV035-full-final.log` and `.spectra-local/LV035-full-failures-recheck.log`. This full result is not green.
- Re-check nearby: Frontend reload only. Repeat offline Undo and Retry twice without reconnecting: expect one legible Retry notice, then reconnect/Retry and confirm one restore with the notice gone. Check repeated retry on another Library action, a pending online retry, and route-side work/conversation load retries when feasible. No backend sync, deploy or codegen required.

### LV-036 · Library work open while offline leaves a blank view

- **Status:** CANNOT-REPRODUCE
- **Severity:** Medium
- **Surface / role:** Library work open / signed-in Profile A school administrator
- **Report script:** exploration · LV-035 adjacent reliability check
- **Commit tested:** 51d6529a (application code at 3e22ac4c)
- **Frequency:** Reproduced in 2 of 2 attempts with two unique disposable verifier works

**Steps**
1. On local instance 8, sign in through saved Profile A and open `http://localhost:3000/library` at desktop width.
2. With the network online and Work Studio closed, locate `LV-035 Route-side Retry Verifier 2026-09-30`.
3. Set the browser network offline, click that exact title, wait 4 seconds, and inspect the route, Library content, Work Studio panel, and visible Retry actions.
4. Restore the network and wait 2.5 seconds without reloading; then reload online and click the title.
5. Repeat steps 2–4 with `LV-035 Library Action Retry Verifier 2026-09-30`.

**Expected:** An offline failure to open a work is visible without removing the Library context, and the user can retry after reconnecting.

**Actual:** In both attempts, the offline click left the URL at `/library` with no `artifactId`, opened no Work Studio panel, showed no `Try again` button, and left the Library with no headings or target item. Restoring the network did not restore the Library content after 2.5 seconds. Reloading online restored the Library, and an online click opened the work. The redacted Playwright console excerpt contains “Failed to load resource: net::ERR_INTERNET_DISCONNECTED” on 4 browser resource-error entries after the first offline attempt and 6 after the second; online reload showed 0 errors. Those entries include no application filename or line number.

**Evidence:** `.spectra-local/live-verification/LV-036-route-work-offline-no-retry-51d6529a-redacted.png`; `.spectra-local/live-verification/LV-036-route-work-online-still-blank-51d6529a-redacted.png`; `.spectra-local/live-verification/LV-036-route-work-online-after-reload-51d6529a-redacted.png`; `.spectra-local/live-verification/LV-036-route-work-offline-observations-redacted.txt` (resource URLs redacted; no application stack frame was present).

**Assessment / question** (fixer)
- Observed code: Library mounts `SpectraShell` and its `useShellArtifactOpen` path, not `RouteSidePanelHost` (the latter only serves school/analytics/settings/managebac/admin/superadmin routes). Library's failed-open callback currently emits a plain error toast with no Retry; this confirms the recovery-control gap but does not explain the persistent blank view.
- Reproduction against real code: An isolated jsdom probe uses the real same-origin request wrapper, authoritative access coordinator, open hook and content-retention hook. A rejected fetch produces the readable connection failure, clears loading/pending state, retains the listed Library title, and accepts a fresh authorized detail on the second request: **1/1 passed**. Log/script: `.spectra-local/LV036-probe.log`, `.spectra-local/LV036-probe.test.tsx`. The blank-view failure is not reproduced at that boundary; it may occur elsewhere in rendering, navigation or transport, so no root cause is assumed.
- Verifier answer received: The click did not navigate, the URL stayed `/library`, no recovery action appeared and reconnect did not recover before manual reload. The error entries are browser resource failures (`net::ERR_INTERNET_DISCONNECTED`) with no application frame; the report's surface is now correctly Library work open. These facts do not identify which UI region or resource is failing.
- Verifier follow-up (2026-09-30; same app code): Two fresh reload-and-click attempts with disposable Library works did **not** reproduce the recorded blank state. In both, `/library` stayed visible with no `artifactId`, the clicked item remained visible, the shell had 5 `nav`, 1 `aside`, 2 `main`, and 2 Library navigation links, 174 `article` nodes remained, and two retry-matching button nodes were present. There was no exact `Folders` text node or semantic `grid`/`list` role. The single `[data-spectra-app-surface]` had one `DIV` child (`spectra-wave-y relative flex h-full min-h-0 bg-[var(--bg-primary)]`) and text length 43,695 / 43,694. A role=status notice contained offline text (97 characters). On the first attempt, 2 failed requests were classified as Spectra detail/other API; no script/module, stylesheet, or auth failures were counted. After reconnecting, clicking the first retry-matching control yielded a URL containing `artifactId`, but the `Work Studio` text marker count was 0 and editor content was not established. Sanitized details: `.spectra-local/live-verification/LV-036-dom-inventory-4bccfbf2-redacted.txt`.
- Assessment after follow-up: **CANNOT-REPRODUCE** for the persistent blank Library view. The real request/access/open/content probe and two fresh browser attempts on the same application code retain the Library; the original observations remain above, and no root cause or fix is claimed. Failed detail/API requests are consistent with offline transport but do not explain the original disappearance; the fresh attempts provide no evidence of failed script, stylesheet or authentication resources.
- Observation limits: A button name matching “retry” is insufficient to identify a recovery control, since both disposable work titles themselves contain “Retry”. An artifactId URL alone and the absence of a literal “Work Studio” marker establish neither success nor failure of the editor body. Library's plain failed-open toast remains a confirmed recovery-control limitation in the source, distinct from the un-reproduced blank-view cause; no speculative render/cache change was made. Reopen this entry if the blank state recurs, retaining the sanitized app-surface inventory and failed resource categories from that exact state.

## Fixer closeout · LV-035

- Commits: `3e22ac4c2a2e854f3082ff1760c1575f07c39806` — one notice per retry operation across Library and route-side loaders; `c99224070b7a88a713c2538fe919b06b9f20b4a7` — follow the shared helper in the existing UX closure source guard; `e9d438e9` — audit and preserved LV-032/LV-034 verification. Existing human Git identity, no AI co-author trailers.
- Final full suite: **4,453 passed, 6 failed, 1 skipped**; **505 passed files, 3 failed, 1 skipped** (509 files), duration **329.07 seconds**. Failures: four unchanged account-erasure scheduled-function drains reached 10,000 timer pumps; the unchanged signed-out Stop test timed out at 15 seconds; pending LV-017 hosted packaging lacks a shared runtime module. The first five then pass with **66/66 tests** in the two-file isolation recheck. Logs: `.spectra-local/launch-fixer-LV035-full-final.log`, `.spectra-local/LV035-full-failures-recheck.log`. This full result is not green. The initial full run also exposed the relocated Retry-label assertion, corrected by the test follow-up; no runtime assertion or timeout was weakened.
- Focused **44/44** tests pass, including real Sonner/organizer repeated failures, reconnect restoration, distinct operation identities, pending-submit guard, work-load fencing and all UX closure checks. Both TypeScript projects, full lint and all five gates pass; TypeScript and lint pass again after the source-test follow-up. The hosted Docker COPY patch remains unapplied because deployment-configuration changes are prohibited and its exception is unanswered.
- **NEEDS-DECISION:** LV-028 — current shortcuts versus reassigning Shift+F; LV-022 — post-save prose latency/usage versus different saved-result presentation; LV-003 — expired-invite HTTP semantics; LV-012 — automatic Bridge discovery versus explicit activation. **CANNOT-REPRODUCE:** LV-004 — MIME artifacts in the original invite, decoded generated token works; LV-007 — idle versus pending confirmation, with pending controls retained/disabled. **NEEDS-INFO:** LV-017 — hosted-package exception unanswered. No pending decision was assumed.
- No OPEN, REOPENED or FIXING issue remains. LV-035 is FIXED and sent for live repeated-Retry checks; LV-032 and LV-034 are VERIFIED by the verifier. Stop between tasks as requested. No deployment, codegen, production-data or environment changes occurred.

## Fixer assessment closeout · LV-036

- Commits: `7bc6e582` — record real-hook reproduction and request error evidence; this follow-up records the verifier's answer and the narrower DOM/resource observation still required. No runtime code changed; LV-035 is now VERIFIED with its live evidence preserved.
- Validation: Real request/access/open/content probe **1/1 passed** and retains Library metadata after a failed fetch, then accepts fresh detail. Last full-suite result remains **4,453 passed, 6 failed, 1 skipped**, with the five unchanged lifecycle/timing cases passing **66/66** separately and LV-017 hosted packaging unresolved; see preceding closeout/logs. No full-suite rerun was needed for this documentation-only assessment.
- **NEEDS-INFO:** LV-036 — persistent blank UI is not reproduced at the failing-read boundary; sanitized DOM inventory and resource classes requested from the verifier. LV-017 — hosted Docker COPY exception unanswered under the deployment-config prohibition. **NEEDS-DECISION:** LV-028 — shortcut mapping; LV-022 — post-save prose versus saved-result presentation; LV-003 — expired-invite HTTP semantics; LV-012 — automatic Bridge discovery versus explicit activation. **CANNOT-REPRODUCE:** LV-004 — encoded invitation artifact, decoded generated token works; LV-007 — idle versus pending confirmation behavior. No option was assumed.
- No OPEN, REOPENED or FIXING entry remains. Stop between tasks under the user's instruction and resume LV-036 when the verifier supplies the requested observation; no speculative fallback/cache, deployment, codegen, production-data or environment change occurred.

## Fixer assessment closeout · LV-036 follow-up

- Commits: `7bc6e582` — real-hook reproduction and initial live question; `4bccfbf2` — narrower DOM/resource question; this assessment preserves the verifier's two fresh observations and records CANNOT-REPRODUCE. No runtime code changed. Commits use the existing human Git identity and omit all AI attribution/co-author trailers.
- Latest full suite remains **4,453 passed, 6 failed, 1 skipped**; **505 passed files, 3 failed, 1 skipped** (509 files). Five lifecycle/timing cases subsequently pass **66/66** in isolation; LV-017 hosted packaging remains unresolved. See the LV-035 closeout for logs. The real-hook diagnostic is **1/1 passed**; no full-suite rerun was needed for this documentation-only assessment.
- **CANNOT-REPRODUCE:** LV-036 — original blank view absent from two fresh live attempts and real failed-read probe; editor recovery remains unverified. LV-004 — invitation encoding artifact; decoded generated token works. LV-007 — original idle confirmation versus pending confirmation, whose controls remain disabled. **NEEDS-DECISION:** LV-028 — shortcut mapping; LV-022 — post-save prose versus saved-result presentation; LV-003 — expired-invite HTTP semantics; LV-012 — automatic Bridge discovery versus explicit activation. **NEEDS-INFO:** LV-017 — hosted Docker COPY exception remains unanswered under the deployment-configuration prohibition.
- No OPEN, REOPENED or FIXING entry remains. The verifier may continue and reopen LV-036 with exact blank-state evidence. The fixer stops between tasks as requested; no deployment, codegen, production-data or environment changes occurred.
