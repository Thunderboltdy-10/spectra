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
| P3-BRIDGE-LENS — step 10 B1 (DOCX write after Word close) | P3-BRIDGE-LENS · step 10, B1 | PASS — with a native Bridge built from fix 0d1f4e16, the selected disposable folder was Ready; after Word closed the DOCX, the Spectra marker appeared in Word on three unchanged-byte readback sessions, with 56 words, note entries visible and no repair prompt. Evidence: .spectra-local/live-verification/LV043-postfix-repeated-word-readback-redacted.txt; .spectra-local/live-verification/LV043-bridge-postfix-word-maximized-60e2ba0c.png; .spectra-local/live-verification/LV043-bridge-postfix-word-session2-max-settled-60e2ba0c.png; .spectra-local/live-verification/LV043-bridge-postfix-word-session3-max-60e2ba0c.png | LV-043 (VERIFIED) | 60e2ba0c |
| P3-BRIDGE-LENS — step 10 B1 adjacent XLSX write with a separate DOCX held in Word | P3-BRIDGE-LENS · step 10, B1 (cross-file check) | PASS — on app code 628f4987, Native write & sync remained selected and the folder Ready. With the separate DOCX open in Word, B3, B5, and chart-source A3 each completed without HTTP 400 or the generic failure alert. After reload, the markers and A3=11 remained. Excel showed formula result 23, the updated chart, existing Sheet1 formatting/link/comment, Sheet2 content and shapes, with no repair prompt. Evidence: .spectra-local/live-verification/LV044-native-mode-recheck-628f4987-redacted.txt; .spectra-local/live-verification/LV044-settings-628f4987.png; .spectra-local/live-verification/LV044-B3-semantic-after-reload-628f4987.png; .spectra-local/live-verification/LV044-B5-plain-retest-628f4987.png; .spectra-local/live-verification/LV044-A3-chart-source-retest-628f4987.png; .spectra-local/live-verification/LV044-persisted-reload-settled-628f4987.png; .spectra-local/live-verification/LV044-native-excel-reopened-628f4987.png; .spectra-local/live-verification/LV044-native-excel-sheet2-628f4987.png | LV-044 (VERIFIED) | 628f4987 (app code; checkout HEAD 18d33f99) |
| P3-BRIDGE-LENS — step 10 B1 adjacent PPTX write with a separate DOCX held in Word | P3-BRIDGE-LENS · step 10, B1 (cross-file check) | PASS — while Word remained open on a separate DOCX, the PPTX body edit appeared in PowerPoint after reopening, with no repair prompt. The same-file PPTX lock check is covered separately below. Evidence: .spectra-local/live-verification/LV043-bridge-pptx-edit-settled-60e2ba0c.png; .spectra-local/live-verification/LV043-bridge-pptx-native-reopened-60e2ba0c.png | — | 60e2ba0c |
| P3-BRIDGE-LENS — step 10 B1 same-file PPTX lock and write | P3-BRIDGE-LENS · step 10, B1 | PASS — after the PPTX fix, three edit/close/readback cycles completed without generic failure or HTTP 400; the native body markers, including the multiline blank paragraph, appeared in PowerPoint with no repair prompt. One cycle’s post-write Waiting for Office persistence is recorded separately under LV-046. Evidence: .spectra-local/live-verification/LV045-pptx-postfix-console-network-ea08bdda-redacted.txt; .spectra-local/live-verification/LV045-pptx-postfix-native-reopened-ea08bdda.png; .spectra-local/live-verification/LV045-pptx-postfix-multiline-native-628f4987.png | LV-045 (VERIFIED) | 628f4987 (app code; first post-fix cycle ea08bdda) |
| P3-BRIDGE-LENS — PPTX waiting status after native write lands | P3-BRIDGE-LENS · step 10, B1 · status after same-file lock release | FAIL — on the first post-fix cycle, the native file changed and PowerPoint showed the marker, while Spectra still showed “Waiting for Office” for at least 50 seconds after close; reload cleared it. Two later cycles on 628f4987 cleared sooner or did not show the status. See LV-046. Evidence: .spectra-local/live-verification/LV045-pptx-postfix-waiting-after-close-ea08bdda.png; .spectra-local/live-verification/LV045-pptx-postfix-native-reopened-ea08bdda.png; .spectra-local/live-verification/LV045-pptx-postfix-console-network-ea08bdda-redacted.txt | LV-046 (NEEDS-INFO) | ea08bdda; 628f4987 follow-up |
| LV-044 fixer follow-up — retry of the retained B3 request | fixer post-fix recheck instruction | BLOCKED — after reload on 628f4987, the B3 value was visible but no Try again control was presented; a new B3 edit was submitted and saved instead. The exact historical request was not resent. Evidence: .spectra-local/live-verification/LV044-B3-semantic-after-reload-628f4987.png; .spectra-local/live-verification/LV044-native-mode-recheck-628f4987-redacted.txt | LV-044 (VERIFIED for the new edit path) | 628f4987 |
| LV-045 fixer follow-up — Try again after the native PPTX write lands | fixer post-fix recheck instruction | BLOCKED — after each successful write, no Try again control was presented once the native bytes had landed, so the repeat-after-landed action was unavailable. The three edit/close/readback cycles are recorded above. Evidence: .spectra-local/live-verification/LV045-pptx-postfix-native-reopened-ea08bdda.png; .spectra-local/live-verification/LV045-pptx-postfix-multiline-native-628f4987.png | LV-045 (VERIFIED for the reported failure path) | 628f4987 |
| P3-AI-ENGINE — Moon answer | P3-AI-ENGINE · Needs live verification · Answer, step 1 | FAIL — on app commit 628f4987, two clean zero-context submissions of “Why can we see the Moon?” produced one POST /api/spectra/run HTTP 500 with no response and one HTTP 200 with a relevant no-ID answer after resubmission; the failed prompt was absent after reload. A later clean submission on this app code returned a relevant no-ID answer after Thinking and persisted after reload. A separate fresh zero-context question about tides returned a relevant one-sentence answer; two POST /api/spectra/run responses were HTTP 200, all 42 captured Spectra API responses were HTTP 200, the browser was online, and the settled page had 0 console errors. On 7407840f, another clean Moon answer completed while one POST /api/spectra/run (`ui_observer`) returned 409 and one GET `runTabs` returned 500 INTERNAL_ERROR (request ID af14ec59); two failed-resource console entries were recorded with the browser online. A separate clean weather answer and follow-up completed despite one POST /api/spectra HTTP 500 console error. See the additional occurrence below. The required provider-call-count check is BLOCKED because the browser view exposes only the route request. Evidence: .spectra-local/live-verification/LV039-moon-current-628f4987-redacted.txt; .spectra-local/live-verification/LV039-moon-current-628f4987-no-response.png; .spectra-local/live-verification/LV039-moon-current-628f4987-after-reload.png; .spectra-local/live-verification/LV039-moon-first-response-live-rerun-628f4987.png; .spectra-local/live-verification/LV039-moon-next-answer-628f4987.png; .spectra-local/live-verification/LV039-moon-next-answer-628f4987-redacted.txt; .spectra-local/live-verification/LV039-ai-request-errors-7407840f.png; .spectra-local/live-verification/LV039-ai-request-errors-7407840f-redacted.txt | LV-039 (NEEDS-INFO) | 628f4987; 7407840f |
| Free exploration — title after a successful AI answer | exploration · first-week chat; user flagged missing thread titles | FAIL — after a relevant Moon answer on app commit 628f4987, both the header and most-recent row still read “New conversation” after completion and reload. See LV-040. Evidence: .spectra-local/live-verification/LV040-current-628f4987-answer-title.png; .spectra-local/live-verification/LV040-current-628f4987-answer-title-after-reload.png; .spectra-local/live-verification/LV040-new-chat-title-after-reload-628f4987.png; .spectra-local/live-verification/LV040-moon-title-628f4987-redacted.txt | LV-040 (NEEDS-DECISION) | 628f4987 |
| Free exploration — sidebar thread-title typography | user-reported desktop UX; P3-UI-SYSTEM type scale | FAIL — on /library and /chat at 1280×720, recent chat-title text computed to 15px/24px at weight 400; the adjacent main-destination link also computed to 15px/24px. The user requested smaller sidebar thread-title text. Evidence: .spectra-local/live-verification/LV047-sidebar-thread-title-size-628f4987.png; .spectra-local/live-verification/LV047-sidebar-thread-title-size-628f4987-redacted.txt | LV-047 (VERIFIED) | 628f4987 |
| P3-UI-SYSTEM — sidebar title typography after fixer recheck | LV-047 desktop shared-typography follow-up | PASS — on app code 7407840f, pinned/recent/search titles were 12px in Default and 13px in Large interface text; metadata remained smaller, search no-results rendered, and keyboard focus remained visible on navigation. Preference was restored to Default. Evidence: .spectra-local/live-verification/LV047-postfix-default-sidebar-7407840f.png; .spectra-local/live-verification/LV047-postfix-large-sidebar-7407840f.png; .spectra-local/live-verification/LV047-postfix-verification-7407840f-redacted.txt | LV-047 (VERIFIED) | 7407840f |
| P3-AI-ENGINE — 4,000-word essay | P3-AI-ENGINE · Needs live verification · Answer, step 2 | PASS — after the fix, a fresh no-context request returned a 3,730-word completed answer without repeated paragraphs; Retry on the earlier paused request returned a 4,479-word completed answer without repeated paragraphs | LV-019 (VERIFIED) | 427cb3c9 |
| P3-AI-ENGINE — no-context “Tighten my notes summary” response status | P3-AI-ENGINE · Answer, step 3 | FAIL — with 0 context objects selected, the assistant said it could not edit the matched locked item but the result card said “Saved progress and results”; see LV-022 (NEEDS-DECISION). Evidence: `.spectra-local/live-verification/LV-025-postfix-skip-final-reply-after-reload-45281d26-redacted.png`; `.spectra-local/live-verification/LV-025-postfix-skip-observations-redacted.txt` | LV-022 (NEEDS-DECISION) | 45281d26 |
| P3-AI-ENGINE — clarification Skip repeated-conflict recheck | P3-AI-ENGINE · Answer, step 3; fixer neighbor check | PASS — after one Skip in a fresh zero-context chat, no 409 console errors were recorded; after the final answer appeared, an 8-second sample saw 0 `/api/spectra/run` responses and the console still had 0 errors. LV-025 verified; its response-pending observation is tracked separately under LV-027. Evidence: `.spectra-local/live-verification/LV-025-postfix-skip-observations-redacted.txt` | LV-025 (VERIFIED), LV-027 (OPEN) | 45281d26 |
| P3-AI-ENGINE — clarification continuation pending state | P3-AI-ENGINE · Answer, step 3; fixer neighbor check | FAIL — after Skip, the run still showed “Thinking / Getting ready” at 120 seconds; after selecting an offered item, it still showed that state after at least 70 seconds. No Stop or Retry control appeared at the last pre-reload checks; final answers were visible after reload. Evidence: `.spectra-local/live-verification/LV-027-clarification-pending-observations-redacted.txt`; `.spectra-local/live-verification/LV-025-postfix-skip-run-after-120s-45281d26-redacted.png`; `.spectra-local/live-verification/LV-025-postfix-choice-run-pending-45281d26-redacted.png` | LV-027 (OPEN) | 45281d26 |
| P3-AI-ENGINE — clarification continuation post-fix recheck | P3-AI-ENGINE · Answer, step 3; fixer re-check | PASS — on 104ac5e8, offered-choice, Skip and typed-answer continuations each reached a visible final response without a reload; the choice and Skip replies remained after reload. Stop was visible during the active choice and Skip workers; terminal state cleared it. See LV-027. Evidence: `.spectra-local/live-verification/LV-027-postfix-observations-104ac5e8-redacted.txt`; `.spectra-local/live-verification/LV-027-postfix-choice-terminal-104ac5e8.png`; `.spectra-local/live-verification/LV-027-postfix-skip-terminal-104ac5e8.png` | LV-027 (VERIFIED) | 104ac5e8 |
| P3-AI-ENGINE — typed clarification answer | P3-AI-ENGINE · Answer, step 3; fixer neighbor check | PASS — a typed answer using made-up Photosynthesis text returned a concise rewrite in the reply with 0 context objects and 0 console errors; its result-card wording remains under LV-022 | LV-022 (NEEDS-DECISION) | 45281d26 |
| P3-AI-ENGINE — Stop mid-stream on a long document create | P3-AI-ENGINE · Stop and steer | PASS — stopped with 3 live document blocks formed; the progress and Stop control disappeared, and no exact-title or generic “New document” row appeared in Library. Evidence: `.spectra-local/live-verification/P3-AI-ENGINE-stop-long-create-before-stop-45281d26-redacted.png`; `.spectra-local/live-verification/P3-AI-ENGINE-stop-long-create-after-stop-nonzero-45281d26-redacted.png`; `.spectra-local/live-verification/P3-AI-ENGINE-stop-long-create-redacted.txt` | — | 45281d26 |
| P3-AI-ENGINE — Stop mid-stream on a long create post-fix neighbor recheck | P3-AI-ENGINE · Stop and steer · fixer re-check | BLOCKED — the fresh 4,000-word create repeat on 104ac5e8 showed the prompt and “Saved progress and results” after reload, with no assistant response or active stream to stop. The adjacent create failure is tracked under LV-039; Stop behavior could not be rechecked. Evidence: `.spectra-local/live-verification/LV-039-long-create-stop-neighbor-104ac5e8-redacted.txt`; `.spectra-local/live-verification/LV-039-long-create-stop-neighbor-104ac5e8-redacted.png` | LV-039 (NEEDS-INFO) | 104ac5e8 |
| Free exploration — Library full-title search | exploration · Library and search; LV-026 post-fix recheck | PASS — on app commit 104ac5e8, both reported queries clearly distinguished partial matches, Enter targets were named, an exact-title query showed Exact title match badges, the unique query showed 0 items, ArrowDown/Enter opened the selected second result, clearing search restored the empty query, and workspace-scoped search showed its exact and partial matches | LV-026 (VERIFIED) | 104ac5e8 |
| P3-AI-ENGINE — document create/edit with detailed answer | P3-AI-ENGINE · Document · create and edit; fixer re-check | FAIL — on app commit 94a44078, the exact zero-context create prompt was submitted twice: the first POST returned HTTP 500; the second returned HTTP 200, followed by three runEvents GET HTTP 500 responses. The chat retained “Spectra could not complete this request” after reload. The Live Dock showed “Could not finish” and 12 blocks formed in the live artifact, but Library search showed no newly saved Document row for this run. The browser was online and no offline-status banner was visible. See LV-039. Evidence: .spectra-local/live-verification/LV039-current-create-94a44078-redacted.txt; .spectra-local/live-verification/LV039-current-create-94a44078-after-reload.png; .spectra-local/live-verification/LV039-current-create-library-search-94a44078.png; .spectra-local/live-verification/LV-039-clean-repeats-20261001-redacted.txt | LV-039 (NEEDS-INFO) | 94a44078 |
| P3-AI-ENGINE — Document / Create fresh repeat (628f4987) | P3-AI-ENGINE · Document · Create; live reliability recheck | FAIL — the zero-context create produced three POST /api/spectra/run HTTP 200 responses, then four runEvents and one overview HTTP 500 INTERNAL_ERROR before later reads returned HTTP 200. The chat showed “Chat context could not load,” then “Spectra paused this run”; reload retained Retry, with no document editor or open control visible. A Library full-title search showed no exact-title row. See LV-039. Evidence: .spectra-local/live-verification/LV039-document-create-628f4987-redacted.txt; .spectra-local/live-verification/LV039-document-create-running-628f4987.png; .spectra-local/live-verification/LV039-document-create-after-reload-628f4987.png; .spectra-local/live-verification/LV039-library-search-exact-title-628f4987.png | LV-039 (NEEDS-INFO) | 628f4987 |
| P3-AI-ENGINE — Document / Create Retry after pause (628f4987) | P3-AI-ENGINE · Document · recovery action | FAIL — one Retry briefly showed resumed/document progress, then returned to “Spectra paused this run”; reload retained the paused card. One runEvents read returned HTTP 500 INTERNAL_ERROR (request ID 8c8deff4). The Document-filtered Library query showed no exact-title row. See LV-039. Evidence: .spectra-local/live-verification/LV039-document-create-628f4987-redacted.txt; .spectra-local/live-verification/LV039-document-create-retry-paused-628f4987.png; .spectra-local/live-verification/LV039-document-create-retry-after-reload-628f4987.png; .spectra-local/live-verification/LV039-library-document-filter-after-retry-628f4987.png | LV-039 (NEEDS-INFO) | 628f4987 |
| Free exploration — chat history restoration on reload | free exploration · AI chat and reloads | PASS — on checkout 60e2ba0c (includes chat change b27682c2), four post-fix same-page reloads across the completed Moon chat (4.166 s, 2.943 s) and settled failed document-create chat (3.445 s, 2.838 s) restored saved content. At about 150 ms the failed chat showed “Loading conversation...” and placeholders; saved prompt, paused state and Retry were present after settling. Browser stayed online; selected-thread GETs returned HTTP 200 and started 31 ms/13 ms after recent threads GETs; observed runTabs reads returned HTTP 200; Playwright recorded 0 errors, 1 warning. No Retry or new prompt was submitted. Evidence: .spectra-local/live-verification/LV042-postfix-0d1f4e16-redacted.txt; .spectra-local/live-verification/LV042-postfix-moon-initial-b27682c2.png; .spectra-local/live-verification/LV042-postfix-moon-settled-b27682c2.png; .spectra-local/live-verification/LV042-postfix-failed-initial-0d1f4e16-trial-1.png; .spectra-local/live-verification/LV042-postfix-failed-settled-0d1f4e16-trial-1.png; .spectra-local/live-verification/LV042-postfix-failed-initial-0d1f4e16-trial-2.png; .spectra-local/live-verification/LV042-postfix-failed-settled-0d1f4e16-trial-2.png | LV-042 (VERIFIED) | 60e2ba0c |
| P3-AI-ENGINE — fresh `/chat` runTabs read after commit | P3-AI-ENGINE · reliability; Playwright console error check | FAIL — 1 of 2 `/chat` route load/reload checks recorded HTTP 500 for GET `/api/spectra?action=runTabs&limit=120&surface=chat`; the subsequent completed-chat reload had 0 console errors. This request failure is recorded under LV-039. Evidence: `.spectra-local/live-verification/LV-039-postfix-recheck-96f3b05d-redacted.txt` | LV-039 (NEEDS-INFO) | 96f3b05d |
| P3-AI-ENGINE — connected `/chat` route read after Profile A restore | P3-AI-ENGINE · reliability; LV-039 adjacent recheck | PASS — on app commit 96f3b05d, both `runTabs` requests for `/chat` returned HTTP 200, the browser was online, the page had no offline-status text and Playwright recorded 0 console errors (1 warning in the CLI page summary). No prompt was submitted; the route load does not resolve LV-039's missing-result report. The DOM contained 37 exact `New conversation` labels; completion state for those rows was not inspected. Evidence: `.spectra-local/live-verification/LV-039-chat-route-runTabs-post-96f3b05d-redacted.txt` | — | 96f3b05d |
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
| P3-WORKSPACE-FLOWS — Calendar DST view and default event time | P3-WORKSPACE-FLOWS · step 2 | PASS — the date-range portion was verified on 7bce0577: every date from 20 Oct through 3 Nov appeared once, including 27 Oct. The default-time portion was rechecked after the fix on 96f3b05d: a fresh form showed 09:00–10:00 local, a disposable event displayed the same time in Calendar and its details, and it remained removed after reload. No midnight/DST time transition was simulated in the latest recheck. Evidence: `.spectra-local/live-verification/LV-029-calendar-dst-postfix-7bce0577-redacted.png`; `.spectra-local/live-verification/LV-029-calendar-postfix-7bce0577-observations-redacted.txt`; `.spectra-local/live-verification/LV-033-postfix-observations-96f3b05d-redacted.txt`; `.spectra-local/live-verification/LV-033-postfix-saved-event-96f3b05d-redacted.png`; `.spectra-local/live-verification/LV-033-postfix-event-details-96f3b05d-redacted.png` | LV-029 (VERIFIED), LV-033 (VERIFIED) | 7bce0577 / 96f3b05d |
| P3-WORKSPACE-FLOWS — public agent preview and install | P3-WORKSPACE-FLOWS · step 7 | BLOCKED — after the local catalog migration, `/agents` reached its empty state; no authorized public agent fixture was available for the preview/install actions | LV-030 (VERIFIED) | 7bce0577 / local migration `17f7a5f9` |
| Free exploration — `/agents` library | exploration · first-week /agents | PASS — after the local catalog migration, all four collections showed “No agents in this collection yet.” The measured reload reached the empty state in 3.6 seconds; no load error, Retry action, or HTTP error was observed. Evidence: `.spectra-local/live-verification/LV-030-agents-empty-state-17f7a5f9-redacted.png`; `.spectra-local/live-verification/LV-030-agents-empty-state-observations-redacted.txt` | LV-030 (VERIFIED) | 7bce0577 / local migration `17f7a5f9` |
| P3-WORKSPACE-FLOWS — Library Trash and offline Undo | P3-WORKSPACE-FLOWS · step 8 | PASS — LV-031 permanent deletion passed; LV-032 displayed Retry offline and a Retry after reconnection restored the item once and persisted after reload; LV-034 Trash pointer activation passed at 1280×720. Evidence: .spectra-local/live-verification/LV-031-postfix-empty-trash-a1bd0258-redacted.png; .spectra-local/live-verification/LV-032-postfix-offline-undo-toast-35921472-redacted.png; .spectra-local/live-verification/LV-034-postfix-pointer-35921472-redacted.png | LV-031 (VERIFIED), LV-032 (VERIFIED), LV-034 (VERIFIED) | a1bd0258 / 35921472 |
| P3-WORKSPACE-FLOWS — Retry while already offline | LV-032 post-fix adjacent check | PASS — after the fix, offline Undo showed one Retry notice; two consecutive retries while offline retained exactly one notice; online Retry restored the uniquely named disposable verifier document, cleared the notice, and the item remained in Recent after reload. Evidence: .spectra-local/live-verification/LV-035-postfix-retry-one-e9d438e9-redacted.png; .spectra-local/live-verification/LV-035-postfix-retry-two-e9d438e9-redacted.png; .spectra-local/live-verification/LV-035-postfix-console-summary-e9d438e9-redacted.txt | LV-035 (VERIFIED) | 51d6529a (app code at 3e22ac4c) |
| P3-WORKSPACE-FLOWS — Library work open while offline | exploration · LV-035 adjacent reliability check | PASS — after commit d3d5baa6, three fresh desktop Profile A contexts each retained 174 articles and both targets through a 75-second offline open; after reconnect, the offline message cleared by 25 ms, overview returned 200 at 2.5 and 20 seconds, and an online click opened the editor without reloading. See LV-036. Evidence: .spectra-local/live-verification/LV-036-d3d5baa6-three-cold-contexts-redacted.txt; .spectra-local/live-verification/LV-036-d3d5baa6-verified-library-row-redacted.png | LV-036 (VERIFIED) | d3d5baa6 |
| P3-WORKSPACE-FLOWS — route-side conversation open while offline | LV-035 adjacent verification · “route-side work/conversation load retries when feasible” | FAIL — on d5a53285, two clean Profile A page trials confirmed the disposable conversation opened online. Opening it offline showed the exact offline message and Try again control; two offline retries left the notice present. After reconnect the offline message cleared, but the conversation panel did not open: in one trial Try again disappeared by 2.5 seconds, and in the other, activating the remaining Try again online removed it without opening the panel within 5 seconds. See LV-037 (REOPENED). Evidence: .spectra-local/live-verification/LV-037-d5a53285-reconnect-loss-redacted.txt; .spectra-local/live-verification/LV-037-d5a53285-offline-retry-redacted.png | LV-037 (REOPENED) | d5a53285 |
| P3-WORKSPACE-FLOWS — route-side conversation open after the later fixer commit | LV-035 adjacent verification · fixer re-check | FAIL — on app commit 96f3b05d, two offline opens of an existing disposable conversation both left the panel closed after reconnect. One trial retained exactly one Try again action through two offline retries; in both, the action was gone by 2.5 seconds after reconnect and no offline status remained. No online retry action was available to activate. See LV-037 (REOPENED). Evidence: `.spectra-local/live-verification/LV-037-post-96f3b05d-observations-redacted.txt`; `.spectra-local/live-verification/LV-037-post-96f3b05d-offline-retry-button-redacted.png`; `.spectra-local/live-verification/LV-037-post-96f3b05d-reconnected-dock-redacted.png` | LV-037 (REOPENED) | 96f3b05d |
| P3-WORKSPACE-FLOWS — route-side conversation open after commit cd04b06a | LV-035 adjacent verification · fixer re-check | FAIL — one offline LiveDock open showed separate work and conversation notices with two Try again controls. In 2 full holds of at least 12.9 seconds, the first visible Retry left the panel closed; the foreground notice covered the conversation Retry click point. After the work notice was closed, the conversation-specific retry returned HTTP 200 and opened the panel. See LV-037. Evidence: .spectra-local/live-verification/LV-037-cd04b06a-live-recheck-redacted.txt; .spectra-local/live-verification/LV-037-cd04b06a-work-notice-copy-redacted.png; .spectra-local/live-verification/LV-037-cd04b06a-conversation-notice-copy-redacted.png; .spectra-local/live-verification/LV-037-cd04b06a-panel-open-control-redacted.png | LV-037 (REOPENED) | cd04b06a (app code; documentation HEAD 36ec4071) |
| Free exploration — /school route-side conversation panel and artifact split | exploration · first-week school administrator, desktop | PASS — verified on d5a53285 at 1280×720 in two Profile A pages: Live chat measured 480 px and the disposable prompt bubble 360 px across three lines; drag expanded it to 520 px and close/reopen retained 520 px. With Work studio open beside Live chat, their panes measured 424 px and 360 px, the editor remained mounted, and document scroll width stayed 1280 px. Work studio alone resized 483→542 px without horizontal overflow. See LV-038. Evidence: .spectra-local/live-verification/LV-038-d5a53285-layout-recheck-redacted.txt; .spectra-local/live-verification/LV-038-d5a53285-route-chat-recheck-redacted.png; .spectra-local/live-verification/LV-038-d5a53285-workstudio-livechat-split-redacted.png | LV-038 (VERIFIED) | d5a53285 |
| Free exploration — /school page-scoped AI composer | exploration · first-week school administrator, AI from the School page | FAIL — 2 of 3 submissions of the same benign online prompt returned HTTP 500; the third clean repeat returned HTTP 200 and completed a visible 106-character answer. The exact offline message remained absent in all three. See LV-039. Evidence: .spectra-local/live-verification/LV-039-ai-run-observations-d5a53285-redacted.txt; .spectra-local/live-verification/LV-039-clean-repeats-20261001-redacted.txt | LV-039 (NEEDS-INFO) | d5a53285 |
| Offline status while connected and after reconnect | exploration · reliability | PASS — prior d3d5baa6 offline cycles showed the exact message only when navigator.onLine=false and absent after reconnect. Fresh Profile A recheck at 1280×720 on app code d5a53285: both tabs showed the exact banner during an offline pulse and cleared it within 25 ms after reconnect. On /chat, a real overview request intercepted during reload with synthetic HTTP 503 and a separate timed-out abort both left navigator.onLine=true, exact offline text absent, and visible “Check your connection” copy absent. A separate 3-second delayed overview read also left the banner absent. The console had one unrelated Clerk development advisory and one net::ERR_TIMED_OUT error from the deliberately aborted request; no offline-related console warning matched. All synthetic routes were removed. Recheck on app commit 076101f3: six synthetic HTTP 503 responses for /api/spectra reads and a 3-second delayed overview response (HTTP 200) left the page online with no offline or connection-check copy; the clean post-route reload had 0 console errors (one warning). Evidence: .spectra-local/live-verification/LV-036-d3d5baa6-three-cold-contexts-redacted.txt; .spectra-local/live-verification/offline-status-false-positive-d3d5baa6-redacted.txt; .spectra-local/live-verification/LV-039-ai-run-observations-d5a53285-redacted.txt; .spectra-local/live-verification/LV-039-clean-repeats-20261001-redacted.txt; .spectra-local/live-verification/offline-banner-online-recheck-20261001.txt; .spectra-local/live-verification/offline-banner-chat-503-20261001.js; .spectra-local/live-verification/offline-banner-chat-timeout-20261001.js; .spectra-local/live-verification/offline-status-076101f3-redacted.txt | — | 076101f3 (earlier evidence: d5a53285) |
| P3-AI-ENGINE — Presentation create and artifact-type display | P3-AI-ENGINE · Presentation · Create | FAIL — the exact prompt “Make a 6-slide deck on plate tectonics” displayed “Opened a live flashcard deck canvas” and “Creating New flashcard deck”; after 105 seconds no presentation editor or answer appeared; Retry returned to Paused in about 3 seconds after two runEvents HTTP 500 responses. See LV-049; the same run's HTTP errors and paused-after-Stop state are recorded under LV-039. Evidence: .spectra-local/live-verification/LV039-presentation-create-105s-7407840f.png; .spectra-local/live-verification/LV039-presentation-create-7407840f-redacted.txt; .spectra-local/live-verification/LV039-presentation-retry-paused-7407840f.png | LV-049 (FIXING), LV-039 (NEEDS-INFO) | 7407840f |
| P3-AI-ENGINE — Presentation Retry recovery | P3-AI-ENGINE · recovery; adjacent check | FAIL — after reloading the paused presentation request and activating Retry, POST /api/spectra/run returned HTTP 200 but two runEvents reads returned HTTP 500; in about 3 seconds the run returned to Paused with Retry and no presentation. See LV-039. Evidence: .spectra-local/live-verification/LV039-presentation-retry-paused-7407840f.png; .spectra-local/live-verification/LV039-presentation-create-7407840f-redacted.txt | LV-039 (NEEDS-INFO) | 7407840f |
| P3-AI-ENGINE — Presentation edit (slide 3) | P3-AI-ENGINE · Presentation · Edit | BLOCKED — no presentation was created or opened by the Create action, so “Tighten slide 3's bullets.” could not be applied; see LV-049. | LV-049 (FIXING) | 7407840f |
| P3-AI-ENGINE — Presentation append (summary slide) | P3-AI-ENGINE · Presentation · Append | BLOCKED — no presentation was available for “Add a summary slide.” because the Create action produced no presentation; see LV-049. | LV-049 (FIXING) | 7407840f |
| P3-AI-ENGINE — Planner task create | P3-AI-ENGINE · Planner and Calendar · Create | FAIL — the exact prompt remained “Still running” beyond 120 seconds with four runEvents and three overview HTTP 500 responses; after several minutes and one Retry, Apply changes returned HTTP 409 and the Planner Task showed an incomplete draft with one “First task” row and Due “Add date.” No Calendar block was visible. The progress text said 4–5pm UTC while the browser timezone was Europe/Madrid. The run was submitted on application code 7407840f; the checkout advanced to a35e7edf while it was still pending, so later Retry/approval activity was not a controlled version recheck. See LV-039. Evidence: .spectra-local/live-verification/LV039-planner-create-7407840f-redacted.txt; .spectra-local/live-verification/P3-AI-ENGINE-planner-create-120s-7407840f.png; .spectra-local/live-verification/P3-AI-ENGINE-planner-artifact-incomplete-7407840f.png; .spectra-local/live-verification/P3-AI-ENGINE-planner-apply-409-7407840f.png | LV-039 (NEEDS-INFO) | 7407840f at submission; checkout advanced to a35e7edf |
| P3-AI-ENGINE — Planner block edit (move to 6pm) | P3-AI-ENGINE · Planner and Calendar · Edit | BLOCKED — the create request did not leave a scheduled Calendar block, so “Move my Revise chemistry block to 6pm.” could not be applied. See LV-039. | LV-039 (NEEDS-INFO) | 7407840f |
| P3-AI-ENGINE — Code chat response create and follow-up | P3-AI-ENGINE · Code · Create/Edit response | PASS — both exact prompts completed with HTTP 200 responses and 0 console errors; the second code response contained `plot_wave()` and remained in the chat after reload. The title and identifier-preservation limits are covered separately under LV-040 and the BLOCKED row below. Evidence: .spectra-local/live-verification/P3-AI-ENGINE-code-chat-7407840f-redacted.txt; .spectra-local/live-verification/P3-AI-ENGINE-code-edit-after-reload-7407840f.png | LV-040 (NEEDS-DECISION) | 7407840f |
| P3-AI-ENGINE — Code identifier preservation in an editable file (F3) | P3-AI-ENGINE · Code · Edit | BLOCKED — the create response was an inline code block with no function definition and no editable Code file was opened; the follow-up introduced `plot_wave()` rather than renaming an existing function. The exact byte-for-byte file comparison could not be performed. Evidence: .spectra-local/live-verification/P3-AI-ENGINE-code-chat-7407840f-redacted.txt | — | 7407840f |
| P3-AI-ENGINE — Whiteboard create and Retry | P3-AI-ENGINE · Whiteboard · Create; recovery | FAIL — “Draw a mind map of the water cycle” paused after 53 seconds with four runEvents HTTP 500 responses. Retry progressed for about a minute, then paused again without a whiteboard editor or answer; after reload the UI briefly showed Still running with no Stop/Retry before returning to Paused. See LV-039. Evidence: .spectra-local/live-verification/LV039-whiteboard-create-retry-7407840f-redacted.txt; .spectra-local/live-verification/P3-AI-ENGINE-whiteboard-create-53s-7407840f.png; .spectra-local/live-verification/P3-AI-ENGINE-whiteboard-retry-60s-7407840f.png; .spectra-local/live-verification/P3-AI-ENGINE-whiteboard-after-reload-25s-7407840f.png | LV-039 (NEEDS-INFO) | 7407840f |
| P3-AI-ENGINE — Whiteboard edit (recolor evaporation) | P3-AI-ENGINE · Whiteboard · Edit | BLOCKED — the Create action did not produce or open a whiteboard with an evaporation node, so “Recolor the evaporation node” could not be applied; see LV-039. | LV-039 (NEEDS-INFO) | 7407840f |
| P2-EXPERIENCE step 5 — offline actions and navigation | P2-EXPERIENCE · step 5 | FAIL — on post-fix commit 2741fd45, the exact prescribed toast was absent in 4/4 offline navigation clicks (Calendar→Library 2/2; Chat→Calendar 1/1; Admin Overview→People 1/1), although the app route and offline shell stayed visible; reconnecting and activating the same control navigated immediately in all 3 paths. The already-open Add event and comment action checks remain PASS below. See LV-048. Evidence: .spectra-local/live-verification/LV048-postfix-recheck-2741fd45-redacted.txt; .spectra-local/live-verification/LV048-postfix-offline-calendar-library-2741fd45.png; .spectra-local/live-verification/LV048-postfix-offline-chat-calendar-2741fd45.png; .spectra-local/live-verification/LV048-postfix-offline-admin-people-2741fd45.png | LV-048 (REOPENED) | 2741fd45 |
| Free exploration — app navigation while offline | reliability · Library, Calendar and Admin People surfaces | FAIL — after commit 2741fd45, the same three paths kept the current Spectra view and offline shell but omitted the exact prescribed toast in 4/4 offline clicks; each path navigated immediately after reconnection. See LV-048. Evidence: .spectra-local/live-verification/LV048-postfix-recheck-2741fd45-redacted.txt; .spectra-local/live-verification/LV048-postfix-offline-calendar-library-2741fd45.png; .spectra-local/live-verification/LV048-postfix-offline-chat-calendar-2741fd45.png; .spectra-local/live-verification/LV048-postfix-offline-admin-people-2741fd45.png | LV-048 (REOPENED) | 2741fd45 |
| P2-EXPERIENCE step 5 — offline Add event action on an already-open Calendar | P2-EXPERIENCE · step 5 partial action check | PASS — while /calendar and the Add personal event dialog were already loaded, submitting a disposable event with the browser offline showed exactly “Spectra could not reach the server. Check your connection, then try again.” The dialog stayed open and the event was not saved; Cancel closed it. Evidence: .spectra-local/live-verification/P2-EXPERIENCE-offline-actions-7407840f-redacted.txt; .spectra-local/live-verification/P2-EXPERIENCE-offline-calendar-event-7407840f.png | — | 7407840f |
| P2-EXPERIENCE step 5 — offline comment action and recovery | P2-EXPERIENCE · step 5 partial action check | PASS — on a disposable Document, offline Post comment showed the exact prescribed toast; the draft remained in the field and 0 comments were saved (4/4 submits). Three controlled online recovery repeats retained the draft after 3–18 seconds, with no offline or Reconnecting status (3/3). One earlier blank-field read after an unauthenticated diagnostic request did not recur in these repeats; see the redacted note. Evidence: .spectra-local/live-verification/P2-EXPERIENCE-offline-actions-7407840f-redacted.txt; .spectra-local/live-verification/P2-EXPERIENCE-offline-comment-toast-7407840f.png; .spectra-local/live-verification/P2-EXPERIENCE-comment-before-recovery-7407840f.png; .spectra-local/live-verification/P2-EXPERIENCE-comment-after-recovery-7407840f.png | — | 7407840f |
| Mobile-dimension checks | explicit user scope instruction · 2026-09-30 | BLOCKED — the user explicitly instructed the verifier not to conduct mobile-dimension testing; no further phone-width or mobile-drawer verification will be run | — | — |

| P3-WORKSPACE-FLOWS — stale Calendar conflict | P3-WORKSPACE-FLOWS · step 1 | BLOCKED — Calendar returned HTTP 500 before a block could be loaded or dragged; see LV-029 | LV-029 (OPEN) | 45281d26 |
| P3-WORKSPACE-FLOWS — Calendar removal and official-event controls | P3-WORKSPACE-FLOWS · step 3 | BLOCKED — the Calendar data view remained unavailable after HTTP 500, so no personal event, plan block, or official event control could be inspected; see LV-029 | LV-029 (OPEN) | 45281d26 |
| P3-WORKSPACE-FLOWS — scheduled plan block details | P3-WORKSPACE-FLOWS · step 4 | BLOCKED — the Calendar and Plans panels did not load, so no scheduled block could be opened; see LV-029 | LV-029 (OPEN) | 45281d26 |
| P3-WORKSPACE-FLOWS — Chat search workspace selection | P3-WORKSPACE-FLOWS · step 6 | PASS — searched for `Wa`, selected the `General` workspace result, and the dialog closed with focus on the search button; reopening showed an empty field. Console: 0 errors, 1 Clerk warning | — | 45281d26 |

| P3-WORKSPACE-FLOWS — conversation and work retries after notification-stack update | LV-035 adjacent verification · route-side conversation/work retry | PASS — on app commit 076101f3, both separate notices and visible Try again actions remained after two offline conversation retries and a 10.5-second hold; the conversation retry opened the panel after reconnect, and the independent work retry preserved the open panel. The route stayed /school in one page. A clean online reload at 08:56:29 UTC had 0 console errors, 0 HTTP failures, 0 request failures and 0 pageerrors, with no offline copy. See LV-037. Evidence: `.spectra-local/live-verification/LV-037-076101f3-recheck-redacted.txt` | LV-037 (VERIFIED) | 076101f3 |

| LV-006 post-fix `/analytics` no-membership recheck | Exploration · first-week superadmin | BLOCKED — the required no-membership state is unavailable with the only supplied login: saved Profile A currently has a school-admin membership. The state was not changed and no second identity was created. Evidence: `.spectra-local/live-verification/LV-006-no-membership-recheck-blocked-redacted.txt` | LV-006 | 076101f3 (app environment) |

| Free exploration — `/analytics` with supplied Profile A | exploration · first-week platform superadmin / school admin | PASS — on app commit 076101f3, `/analytics` rendered its Work created by type, AI run outcomes, Recent work, Recent AI runs and Privacy and source boundary sections with one main content region. No unavailable, no-membership, loading, error or offline copy was visible; 0 HTTP errors, failed requests and console errors were captured. This active-member check does not replace LV-006’s blocked no-membership recheck. | — | 076101f3 |

| Free exploration — `/superadmin` platform administration | exploration · first-week platform superadmin | PASS — on app commit 076101f3, `/superadmin` rendered Platform administration, Platform usage, Service health, Feedback overview, Operational queues, Top schools by usage and Recent activity in one main region. No access-denied, empty, loading, error or offline state was visible; 0 HTTP errors, failed requests and console errors were captured. | — | 076101f3 |

| P3-AI-ENGINE — connected `/chat` home and recent-history shell, no new prompt | reliability adjacent recheck | PASS — on app commit 076101f3, signed-in `/chat` loaded and reloaded twice online in one page with one main region, no offline/connection-check copy, 0 console errors, 0 HTTP errors, 0 request failures and 0 pageerrors. No AI generation was attempted; this route check does not resolve LV-039. | LV-039 (NEEDS-INFO) | 076101f3 |

| Free exploration — `/admin` with supplied Profile A | exploration · first-week school administrator | PASS — on app commit 076101f3, `/admin` rendered School administration, Workspace overview, Feedback inbox, Recent activity, Usage, ManageBac connection and School settings in one main region. No access-denied, empty, loading, error or offline state was visible; 0 HTTP errors, failed requests and console errors were captured. | — | 076101f3 |

| Free exploration — `/school-data` with supplied Profile A | exploration · first-week school administrator | PASS — on app commit 076101f3, `/school-data` remained online and rendered the School, Overview and Upcoming headings. No sign-in, membership, loading, error or offline state was visible; 0 HTTP errors, failed requests and console errors were captured. No sync action was activated. | — | 076101f3 |

| W1-16 · Retry the newest partial ManageBac run | W1-16 · step 6; LV-015 recovery neighbor check | PASS — the latest history row was Partially complete with its explicit Retry sync action. One retry produced a new Complete row with “School data is current” by 09:20:56 UTC; Sync now was enabled, the connection-attention/gaps state cleared, and the new result persisted after reload while the older partial row remained in history. No ManageBac write action was used. Evidence: `.spectra-local/live-verification/ManageBac-partial-retry-076101f3-redacted.txt`; before/after screenshots in the same directory. | LV-015 (VERIFIED) | 076101f3 |

| Free exploration — desktop dark-mode appearance across primary surfaces | free exploration · appearance and theme | PASS — changed the user-facing Theme setting from System to Dark, then navigated `/chat`, `/library`, `/school`, `/analytics`, `/admin`, `/superadmin` and `/managebac`; every route retained the dark class and dark body background, with no large light surfaces, console errors, HTTP errors or failed requests. Restored the original System setting afterward. Evidence: `.spectra-local/live-verification/Appearance-dark-076101f3.png` | — | 076101f3 |

| Free exploration — keyboard-only skip navigation | free exploration · first-week keyboard-only use | PASS — on app commit 0522680b, Tab then Enter on Settings focused MAIN#main-content and the next Tab landed on Restore defaults inside main; 0 console errors, 1 warning. See LV-041 and post-fix evidence. | LV-041 (VERIFIED) | 0522680b |
| LV-041 fixer follow-up — /school AppShell keyboard route | fixer follow-up · neighboring route | PASS — after Enter, the next Tab landed on the Overview control inside main; 0 console errors, 1 warning. Evidence: .spectra-local/live-verification/LV-041-postfix-recheck-0522680b-redacted.txt; .spectra-local/live-verification/LV-041-postfix-school-content-focused-0522680b.png | LV-041 (VERIFIED) | 0522680b |
| LV-041 fixer follow-up — standalone /legal/privacy Skip to content | fixer follow-up · standalone fallback | PASS — after Enter, focus moved to #page-content; the next Tab landed on Cookie Policy within that content; 0 console errors, 1 warning. Evidence: .spectra-local/live-verification/LV-041-postfix-recheck-0522680b-redacted.txt; .spectra-local/live-verification/LV-041-postfix-legal-content-focused-0522680b.png | LV-041 (VERIFIED) | 0522680b |
| LV-041 fixer follow-up — unauthenticated /sign-in fallback | fixer follow-up · sign-in fallback | BLOCKED — authenticated saved Profile A redirected /sign-in to /workspace; no sign-out or authentication change was made, so the unauthenticated fallback was not opened. | LV-041 | 0522680b |
| P3-AI-ENGINE — Sheet create with monthly totals | P3-AI-ENGINE · Sheet · Create | FAIL — on app code 7407840f, “Make a budget sheet with monthly totals” remained in progress, then paused after reload; three reads returned HTTP 500 INTERNAL_ERROR while the browser was online. No sheet editor or result appeared; Library search showed only two pre-existing “Monthly Budget” rows marked 1d ago. See LV-039. Evidence: .spectra-local/live-verification/LV039-budget-sheet-stuck-before-reload-7407840f.png; .spectra-local/live-verification/LV039-budget-sheet-paused-after-reload-7407840f.png; .spectra-local/live-verification/LV039-budget-sheet-library-search-7407840f.png; .spectra-local/live-verification/LV039-budget-sheet-retry-stop-7407840f-redacted.txt | LV-039 (NEEDS-INFO) | 7407840f |
| P3-AI-ENGINE — Sheet create Retry and Stop | P3-AI-ENGINE · recovery; Stop and steer adjacent check | FAIL — Retry stayed in “Resuming from the last safe point” for about 4m46 without a result. Stop sent POST /api/spectra/run action=stop and returned HTTP 409; after reload the run remained paused with Retry and no visible “Stopped” label. Evidence: .spectra-local/live-verification/LV039-budget-sheet-retry-pending-120s-7407840f.png; .spectra-local/live-verification/LV039-budget-sheet-after-stop-7407840f.png; .spectra-local/live-verification/LV039-budget-sheet-retry-stop-7407840f-redacted.txt | LV-039 (NEEDS-INFO) | 7407840f |

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

- **Status:** VERIFIED — app commit 6451c630, 2026-09-30.
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

- **Status:** VERIFIED — app commit 7c4169a8, 2026-09-30.
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

- **Status:** VERIFIED — fix commit 7a1a8508, 2026-09-30.
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

- **Status:** VERIFIED
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

**Verification** (verifier): VERIFIED on app commit `104ac5e8`, 2026-10-01. In saved Profile A at desktop size, the two reported queries showed ranked partial results with the partial-match label; the result status named the target opened by Enter. The unique query `ZZZVERIFICATIONNORESULT812` showed “Nothing matches” and 0 items. The exact query `Water Cycle Field Guide` showed exact-title badges for its matching rows and partial-match badges for related rows. Pressing ArrowDown twice selected a different row; Enter opened the named “Water Cycle Long Create” chat. Clearing search restored the unfiltered Library view. In workspace `General`, the scoped search showed the same exact-versus-partial distinction and returned four items for the reported partial query. The browser recorded 0 errors and 1 Clerk development-key warning. Screenshots: `.spectra-local/live-verification/LV-026-postfix-stop-query-104ac5e8.png`; `.spectra-local/live-verification/LV-026-postfix-partial-query-104ac5e8.png`; `.spectra-local/live-verification/LV-026-postfix-no-match-104ac5e8.png`; `.spectra-local/live-verification/LV-026-postfix-exact-title-104ac5e8.png`; `.spectra-local/live-verification/LV-026-postfix-workspace-search-104ac5e8.png`. Redacted observation log: `.spectra-local/live-verification/LV-026-postfix-observations-104ac5e8-redacted.txt`.

### LV-027 · AI clarification follow-up remains in progress during extended waits

- **Status:** VERIFIED
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

**Live verification (2026-10-01; application commit 104ac5e8):** In saved Profile A at 1280×720, fresh zero-context chats completed the offered-choice, Skip and typed-answer continuations without reloading. The selected-choice and Skip replies remained after reload. Stop was visible while the choice and Skip workers were active and disappeared when each reached a final response; the page no longer showed Thinking / Getting ready. The browser console had 0 errors and 1 Clerk development-key warning; the Skip check had no 409 errors. The separate long-create Stop neighbor could not be exercised because no active stream or Stop control appeared; that attempt is recorded under LV-039. The answer/card save-state wording remains in LV-022.

**Verification evidence:** `.spectra-local/live-verification/LV-027-postfix-observations-104ac5e8-redacted.txt`; `.spectra-local/live-verification/LV-027-postfix-choice-terminal-104ac5e8.png`; `.spectra-local/live-verification/LV-027-postfix-skip-terminal-104ac5e8.png`.

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

- **Status:** VERIFIED
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

**Live verification (2026-10-01; application commit 96f3b05d):** In saved Profile A at desktop 1280×720 with `Europe/Madrid`, Add event showed 09:00–10:00 after a fresh open. A uniquely named disposable personal event was saved; Calendar and its details panel both showed 09:00–10:00. The event was removed through the UI and remained absent after reload. The browser console had 0 errors and 1 Clerk development-key warning. This recheck did not simulate midnight or a DST transition.

**Verification evidence:** `.spectra-local/live-verification/LV-033-postfix-observations-96f3b05d-redacted.txt`; `.spectra-local/live-verification/LV-033-postfix-saved-event-96f3b05d-redacted.png`; `.spectra-local/live-verification/LV-033-postfix-event-details-96f3b05d-redacted.png`.

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

- **Status:** VERIFIED — after commit d3d5baa6, three clean contexts retained the Library list through a 75-second offline interval and opened the selected work after reconnect without a browser reload.
- **Severity:** High
- **Surface / role:** Library work open / signed-in Profile A school administrator
- **Report script:** exploration · LV-035 adjacent reliability check
- **Commit tested:** d3d5baa6 (local instance 8, web port 3000, Convex port 3002)
- **Frequency:** 3 of 3 clean in-memory Profile A contexts after the reconnect correction

**Steps**
1. Load the application at d3d5baa6 in a fresh in-memory desktop Playwright CLI context using saved Profile A state. Open http://localhost:3000/library, verify no active route rules, both named targets are present among 174 articles, and the document-studio resource has not loaded.
2. Set that browser context offline and click either LV-035 Route-side Retry Verifier 2026-09-30 or LV-035 Library Action Retry Verifier 2026-09-30. Inspect the page after 12 seconds and again after 75 seconds.
3. Restore the browser connection. Check navigator.onLine, the exact global offline message, Library article count and target titles after 25 ms, 2.5 seconds and 20 seconds. At 2.5 and 20 seconds, issue a read-only same-origin GET to /api/spectra?action=overview.
4. Without reloading, click the same target online and confirm that its document editor opens.

**Expected (fixer post-commit recheck):** “Library rows should stay/return and online work open/persist without manual reload.”

**Actual:** All three contexts started online with 174 articles, both targets present, the document-studio resource unloaded, and no offline message. At both 12 and 75 seconds offline, all three retained 174 articles and both targets; the offline message was visible once. After reconnect, navigator.onLine was true and the offline message was absent by the first 25 ms observation. All rows remained present at 2.5 and 20 seconds; the overview GET returned HTTP 200 at both points in every context. Clicking the target without reloading mounted one document-studio panel, one contenteditable editor and one ProseMirror editor in each context.

**Evidence:** .spectra-local/live-verification/LV-036-d3d5baa6-three-cold-contexts-redacted.txt; .spectra-local/live-verification/LV-036-d3d5baa6-verified-library-row-redacted.png.


**Assessment / question** (fixer)
- Observed code: Library mounts `SpectraShell` and its `useShellArtifactOpen` path, not `RouteSidePanelHost` (the latter only serves school/analytics/settings/managebac/admin/superadmin routes). Library's failed-open callback currently emits a plain error toast with no Retry; this confirms the recovery-control gap but does not explain the persistent blank view.
- Reproduction against real code: An isolated jsdom probe uses the real same-origin request wrapper, authoritative access coordinator, open hook and content-retention hook. A rejected fetch produces the readable connection failure, clears loading/pending state, retains the listed Library title, and accepts a fresh authorized detail on the second request: **1/1 passed**. Log/script: `.spectra-local/LV036-probe.log`, `.spectra-local/LV036-probe.test.tsx`. The blank-view failure is not reproduced at that boundary; it may occur elsewhere in rendering, navigation or transport, so no root cause is assumed.
- Verifier answer received: The click did not navigate, the URL stayed `/library`, no recovery action appeared and reconnect did not recover before manual reload. The error entries are browser resource failures (`net::ERR_INTERNET_DISCONNECTED`) with no application frame; the report's surface is now correctly Library work open. These facts do not identify which UI region or resource is failing.
- Verifier follow-up (2026-09-30; same app code): Two fresh reload-and-click attempts with disposable Library works did **not** reproduce the recorded blank state. In both, `/library` stayed visible with no `artifactId`, the clicked item remained visible, the shell had 5 `nav`, 1 `aside`, 2 `main`, and 2 Library navigation links, 174 `article` nodes remained, and two retry-matching button nodes were present. There was no exact `Folders` text node or semantic `grid`/`list` role. The single `[data-spectra-app-surface]` had one `DIV` child (`spectra-wave-y relative flex h-full min-h-0 bg-[var(--bg-primary)]`) and text length 43,695 / 43,694. A role=status notice contained offline text (97 characters). On the first attempt, 2 failed requests were classified as Spectra detail/other API; no script/module, stylesheet, or auth failures were counted. After reconnecting, clicking the first retry-matching control yielded a URL containing `artifactId`, but the `Work Studio` text marker count was 0 and editor content was not established. Sanitized details: `.spectra-local/live-verification/LV-036-dom-inventory-4bccfbf2-redacted.txt`.
- Verifier correction to the follow-up inventory: The two earlier button nodes matched a substring search for “retry”/“try again”, but the disposable work titles contain “Retry”; those counts do not establish Retry actions. The earlier click on the first substring match is not evidence that a recovery action worked or that editor content loaded.
- Assessment after follow-up: **CANNOT-REPRODUCE** for the persistent blank Library view. The real request/access/open/content probe and two fresh browser attempts on the same application code retain the Library; the original observations remain above, and no root cause or fix is claimed. Failed detail/API requests are consistent with offline transport but do not explain the original disappearance; the fresh attempts provide no evidence of failed script, stylesheet or authentication resources.
- Observation limits: A button name matching “retry” is insufficient to identify a recovery control, since both disposable work titles themselves contain “Retry”. An artifactId URL alone and the absence of a literal “Work Studio” marker establish neither success nor failure of the editor body. Library's plain failed-open toast remains a confirmed recovery-control limitation in the source, distinct from the un-reproduced blank-view cause; no speculative render/cache change was made. Reopen this entry if the blank state recurs, retaining the sanitized app-surface inventory and failed resource categories from that exact state.
- Verifier re-reproduction (2026-09-30; current application code `3e22ac4c`): Two fresh online loads and offline clicks were performed with the two disposable Library works. Attempt 1 left `/library` with `artifactId`, 3 `main` nodes and 174 articles; exact accessible button names `Retry` and `Try again` both counted 0. Attempt 2 left `/library` with no `artifactId`, 0 `main`, `nav`, `aside`, `article`, or `[data-spectra-app-surface]` nodes, and one exact `Try again` action. The visible error view stated “Something went wrong” and “Failed to load chunk” and showed `Try again` and `Reload page`. After reconnecting and waiting 2.5 seconds, the error view remained. Clicking exact `Try again` while online and waiting 3 seconds left the same view with both actions present and no `main` or articles. In the blank attempt, 18 failed script/module, 2 Spectra detail/other API and 4 other requests were counted; stylesheet and auth failures counted 0. Sanitized evidence: `.spectra-local/live-verification/LV-036-reopened-blank-after-reconnect-4bccfbf2-redacted.png`; `.spectra-local/live-verification/LV-036-reopened-try-again-still-error-64db689f-redacted.png`; `.spectra-local/live-verification/LV-036-reopened-observations-64db689f-redacted.txt`. This recurrence reopens LV-036.

**Reopened investigation** (fixer)
- Investigation on reopening: The new live evidence identifies a full error screen after failed script/module requests, rather than an empty Library data result. React lazy imports retain a rejected loader result; clearing the shared boundary or refreshing a router segment does not replace that client module runtime. The real lazy-loader regression exercised the ineffective recovery before the shared global/route screen changed.

**Fix** (fixer)
- Commit: `ff4d20f9839da198d0e2626d86c88d0a5e38492e`.
- Root cause: Offline script/module requests can reject a lazy import and replace the app with the shared error boundary. React's lazy payload retains that rejection, and Next's dynamic loader uses the same lazy mechanism, so clearing the boundary or refreshing a server segment cannot fetch that client module anew. The shared screen nevertheless offered Try again, which repeated the cached failure and exposed technical chunk text rather than explaining the required recovery.
- Change: Module-load failures now show clear reconnect-and-reload instructions with one Reload page action. The shared screen covers both GlobalErrorBoundary and app-router errors, including the browser module-loader variants; ordinary render and server errors retain their existing retry actions. This is explicit user-triggered reload, with no automatic navigation/reload, runtime-cache manipulation, parallel import mechanism or speculative body cache. It provides a mechanical exit when code has not loaded; it does not make never-loaded editor code available offline or claim that every failed detail request removes Library.
- Test: Seven regressions fail before the fix. A real React lazy loader demonstrates the rejected payload stays cached after the old boundary reset, while a fresh page payload accepts the next successful load; the first offered recovery now invokes reload. Five loader-error variants prove public copy and a single reload control, and the app-router case proves the same recovery instead of refresh/reset. An ordinary-render recovery and the existing navigation-state/server-retry cases remain passing. All **42 focused tests**, both TypeScript projects, full lint and all five gates pass; staged secret scan covers 3,321 tracked files. Logs: `.spectra-local/LV036-{before,focused-final,tsc,convex-tsc,lint,gates}.log`. Full suite: **4,465 passed, 2 failed, 1 skipped**; **506 passed files, 2 failed, 1 skipped** (509 files), 375.46 seconds. Failures are the existing Stop-auth timeout and pending LV-017 hosted package omission; the full Stop-auth file subsequently passes **59/59** in isolation. Logs: `.spectra-local/launch-fixer-LV036-full.log`, `.spectra-local/LV036-run-route-recheck.log`. This full result is not green.
- Re-check nearby: Frontend reload only; no backend sync/deploy/codegen. Reproduce the offline first-open script-load failure. Expect explanatory reconnect/reload copy, one exact Reload page button and no ineffective Try again; reconnect, activate Reload page and verify Library content and an online work open. Count exact accessible recovery names so disposable titles cannot masquerade as Retry. Also check ordinary render/server failure recovery if available; do not treat an artifactId URL alone as proof that editor content loaded.
- Verifier post-fix recheck (2026-09-30; HEAD `0c1a28f7`, application code `ff4d20f9`): Two fresh Profile A contexts kept the Library visible during an offline click; after reconnect, a manual online click opened the actual document editor (one `.spectra-document-studio`, one `[contenteditable=true]`, one `.ProseMirror`). In a third fresh context, the offline click removed all `main`, `nav`, `aside`, `article`, and `[data-spectra-app-surface]` nodes and showed only “That work could not be opened.”; no reconnect/reload copy or recovery action was present. After reconnect, the blank page persisted until browser reload. The online open then showed the expected reconnect/reload copy and one exact `Reload page` action; clicking it returned Library briefly, then the same error view returned with no editor. The controlled route pattern matched 0 responses. The blank-state session had 13 console error lines (8 script/module, 2 Spectra API, 1 auth, 2 other; 3 contained `ERR_INTERNET_DISCONNECTED`; no stylesheet errors). Evidence: `.spectra-local/live-verification/LV-036-postfix-controlled-chunk-failure-ff4d20f9-redacted.png`; `.spectra-local/live-verification/LV-036-postfix-offline-blank-after-reconnect-ff4d20f9-redacted.png`; `.spectra-local/live-verification/LV-036-postfix-online-open-error-ff4d20f9-redacted.png`; `.spectra-local/live-verification/LV-036-postfix-reload-still-error-ff4d20f9-redacted.png`; `.spectra-local/live-verification/LV-036-postfix-verification-0c1a28f7-redacted.txt`. This does not meet the requested post-fix recovery sequence; LV-036 is REOPENED.

**Second reopening assessment / live question** (fixer)
- The full-page module error now has the intended action, but the online reload itself reaches another module failure in the third context. The earlier real-lazy regression proves boundary-reset behavior, not that a fresh page can obtain the failed server asset. The initial blank state also contains a toast but no ErrorScreen controls, so it cannot yet be attributed to that same boundary. No speculative cache, lazy-loader reset or render boundary is being added.
- Question for verifier: In the online error after Reload page, record the failed script/module's pathname or basename (omit query strings and any personal identifiers), whether its failure is HTTP (status only) or a browser request error (exact error name), and the phase of each failure: original offline click, first online open, or online Reload page. Capture the console exception name/message with only internal asset paths or component/module basenames retained, omitting content/account/token data. Also record navigator.onLine and whether ordinary same-origin API requests succeed in the final online-error state. If available, capture the first React/component-stack module names at that transition. These are observations, not a request for diagnosis.
- Status: NEEDS-INFO. The production change `ff4d20f9` remains a tested correction to an ineffective chunk-error action, but LV-036's persistent blank/reload behavior is unresolved.

**Clean offline reproduction follow-up** (fixer)
- The verifier clarified that the repeated online chunk failure came from a test-only document-studio route returning 503. Removing that route lets Reload page load the real chunk with 200 and mount the editor. This validates the earlier chunk recovery correction, while the clean offline blank state is separate: no document-studio request or ChunkLoadError occurs; Library first remains with its failed-open toast, then disappears around ten seconds. Reconnect leaves the blank state even though navigator.onLine is true and the same-origin overview returns 200; an ordinary reload restores Library and the work opens/persists online. The original and corrected live evidence remain above.
- Observed code boundaries: Library/AppShell, AccountStorageBoundary, ThemeProvider and Convex's auth provider continue rendering children during offline/auth-loading states; the Library detail-open rejection is caught. That rules out the earlier claimed chunk error as the clean branch's cause but does not identify which ancestor removes the AppShell. No new runtime change is made for this unresolved branch.
- Updated question for verifier: In the clean reproduction, retain a reference to the AppShell before the offline click; at the blank transition record whether it is disconnected or only hidden, the tags/classes of its immediate parent before/after, and child tags/classes/text lengths of #main-content and body. Include counts of nextjs-portal, iframe and template nodes, current pathname, navigator.onLine, and any new exception/component-stack names (without work/person text or token/query data). A child-list observer can timestamp the first parent removal; capture only the target and added/removed element tags/classes. This identifies the actual render boundary from observations. LV-036 remains NEEDS-INFO.

**Verifier response to updated question (2026-09-30)**

- Four new clean cold contexts used saved Profile A state with no active route rules and an unloaded document-studio chunk. All became blank by 6 seconds after reconnect. Two blanked while `navigator.onLine=false`; two kept Library visible for 12 and 22 seconds offline, then blanked within 2.5 seconds after reconnect.
- Before the click, body child `DIV#main-content` was connected and held `DIV.spectra-app-shell`, connected and visible with three children. At the blank transition, the saved `DIV.spectra-app-shell` reference was disconnected without a hidden attribute. Its prior parent `DIV#main-content` remained connected and visible with two children and text length 0. The saved primary `MAIN` and `[data-spectra-app-surface]` references were disconnected; live main/article/app-surface counts were 0. The body still contained `DIV#main-content` with two children and text length 0; one `nextjs-portal`, no iframe, and no template were present. The first transition sample reported `navigator.onLine=false`.
- The clean offline console showed browser network errors only: same-origin `/api/spectra`, the local Convex sync WebSocket, and development-auth requests had `net::ERR_INTERNET_DISCONNECTED` while offline. No document-studio request, HTTP module status, ChunkLoadError, JavaScript exception or React component stack appeared in that transition. Six seconds after reconnect, `navigator.onLine=true`, same-origin GET `/api/spectra?action=overview` returned 200 and the page remained blank without a retry/reload action.
- The separate online 503 observation came from an active test route in LV036-fault. With the route present, the browser reported 503 for `/_next/static/chunks/src_features_spectra_components_document-studio_tsx_09pb2bf._.js` and a ChunkLoadError naming `src/features/spectra/components/document-studio.tsx`; `navigator.onLine=true`. After removing the test route, the exact Reload page action loaded the chunk with status 200 and mounted the editor. This corrects the prior note that the route matched zero responses.
- After ordinary online reload, Library returned; opening the work loaded the editor and a disposable marker remained after reload/reopen. Diagnostics and screenshots: `.spectra-local/live-verification/LV-036-postfix-clean-offline-dom-observations-2026-09-30-redacted.txt`; `.spectra-local/live-verification/LV-036-postfix-appshell-detached-after-offline-2026-09-30-redacted.png`; `.spectra-local/live-verification/LV-036-postfix-uncached-offline-blank-after-delay-2026-09-30-redacted.png`; `.spectra-local/live-verification/LV-036-postfix-reconnected-still-blank-2026-09-30-redacted.png`.

**Detached-shell investigation** (fixer)
- The retained AppShell, main and app-surface references are disconnected while #main-content stays connected. No document module request, ChunkLoadError or component exception occurs; the earlier chunk-error diagnosis therefore applies only to the separately injected 503 branch. Source inspection shows AccountStorageBoundary and the installed Convex auth provider continue rendering their children when auth/connection state changes, and ThemeProvider/Clerk React context also render children; none of these contains a matching blank-return gate.
- Candidate to observe, not an established cause: installed Clerk's Next client registers an after-session-change callback that invokes router.refresh. Installed Next's refresh reducer invalidates route data and refetches the current RSC tree. A route-data replacement could disconnect AppShell without throwing in a component; no auth refresh, middleware behavior, cache or SDK configuration is changed on this inference.
- Narrow live question: Record the tag/class and text length of each of the two remaining #main-content children. During the same clean offline/reconnect sequence, count calls to window.__unstable__onBeforeSetActive and window.__unstable__onAfterSetActive with only timestamp, callback name, navigator.onLine and pathname; preserve/delegate the existing callbacks without invoking them yourself or changing their return values, and restore any observer wrappers afterward. Record route/RSC requests around the removal using only method, pathname, RSC-header presence, Next-Action-header presence and status or browser failure name; omit query strings, header values, IDs, bodies and personal content. In particular, identify whether /library or a server action is requested at that moment, rather than only the /api/spectra and auth-token failures. This tests a concrete source path instead of adding a speculative render fallback.
- Work completed: distinguish physical subtree removal from hiding, rule out the document-module failure in the clean branch, inspect the real ancestor/auth/route-refresh implementations, and retain the requested marker-persistence evidence. Runtime source is unchanged; this branch needs the refresh/route-request observation before a reproducible root fix.

**Account-readiness root cause and correction** (fixer, 2026-10-01)
- Correction to the earlier source assessment: AccountStorageBoundary always renders its children, but AppShell itself conditionally mounts AppShellContent using useAccountStorageReady. That readiness depended on the current Convex authentication/query result; a temporary token-refresh failure made the scope unavailable and removed the prepared shell, matching the disconnected DOM evidence. This supersedes the speculative Clerk/RSC candidate; further callback instrumentation is unnecessary for this fix.
- Change: Remember the prepared Clerk owner and deployment alongside the canonical account scope. During transient backend authentication/query loss, retain the existing readers only for that same known owner; initial preparation, unknown identity, account switch, deployment switch, sign-out and resolved backend-account changes still block or clear references before restoring readers. No auth or server authorization behavior changes.
- Affected nearby surface: LV-037. Removing the route host stranded its toast callback on an unmounted component; keeping the same prepared shell also preserves the real conversation retry operation. This is one shared boundary correction, not an additional retry mechanism.
- Before/after proof: The mounted-reader continuity test and real account-gated RouteSidePanelHost retry test both fail without this change; the existing and new privacy/storage/retry tests pass 22/22 across three files. Includes temporary authentication loss, pending reauthentication query, user/deployment/unknown-identity changes, backend reset/bootstrap and sign-out. Logs: .spectra-local/LV036-owner-before.log and .spectra-local/LV036-owner-focused.log.
- Re-check after committed hash is provided: Frontend reload only. Use a clean cold Library context without fault routes; fail the offline open, remain offline through the auth refresh window, reconnect and verify the same shell stays usable and an online work opens/persists. Repeat LV-037 offline/repeated-Retry/reconnect with the actual conversation panel. Preserve the separately verified client-chunk Reload page behavior. No backend sync, codegen or deployment required.


- Shared boundary fix commit: `07cfa20d6df5cd43c12ae50d685488d1163d6084`. All **22 focused tests**, both TypeScript projects, full lint and all five gates pass. The two continuity/retry regressions fail before this change. Full-suite run is in progress; frontend-only live recheck requested, and only the verifier sets VERIFIED.

**Live verifier post-fix recheck (2026-10-01)**

- **Status:** REOPENED — the Library item list remained empty after the offline open and reconnect on `07cfa20d`.
- **Steps**
  1. On local instance 8 with application code `07cfa20d`, open `http://localhost:3000/library` in a clean saved Profile A browser context with no active Playwright route rules.
  2. Confirm the Library list contains `LV-035 Route-side Retry Verifier 2026-09-30` and 173 article nodes.
  3. Set the browser context offline, click that exact title, and observe the Library for at least 23 seconds; keep the context offline through the 68-second observation.
  4. Restore the browser connection. Check the visible Library state after 2.5 seconds and again after 20 seconds; issue a read-only GET to `/api/spectra?action=overview` at each point.
  5. Click the visible List view control, then perform a normal browser reload and wait 5 seconds. Check whether the article list and exact target title return.
- **Expected:** “On the offline first-open failure, the user sees ‘Part of Spectra could not load. Reconnect, then reload the page.’ and one exact ‘Reload page’ action; after reconnecting and activating it, Library is present and the work opens online with its editor content loaded.”
- **Actual:** At 23.294 seconds offline, the article count was 0; the `.spectra-app-shell` remained connected, but the Library content was empty. At 68.149 seconds it was still empty, with no exact `Try again`, `Retry` or `Reload page` action. After reconnect, `navigator.onLine=true` and the offline banner cleared, but the article count remained 0; the overview request returned HTTP 401 at 2.5 seconds and HTTP 200 after 20 seconds. Clicking List view and then reloading online did not restore the articles or target title; after reload the URL remained `/library` and a Home tab was visible.
- **Frequency:** 1 of 1 clean post-fix attempts on application code `07cfa20d`.
- **Evidence:** `.spectra-local/live-verification/LV-036-postfix-07cfa20d-2026-10-01-redacted.txt`; `.spectra-local/live-verification/LV-036-07cfa20d-empty-library-main-2026-10-01-redacted.png`.

**Residual authenticated-read investigation** (fixer, 2026-10-01)
- The latest post-fix evidence differs from the original disconnected shell: AppShell remains connected while Library shows its existing WorkBoard loading placeholder. Tree/board hooks use useAuthedArgs, which correctly skips subscriptions when current Convex authentication or school membership is unavailable; the loading view does not identify which condition is blocking. Same-origin Clerk-backed overview recovery does not establish that the separate Convex WebSocket is authenticated, and the observed online reload remaining empty is not explained by the mounted-shell correction.
- Reproduction over the installed real models: a synthetic, read-only tsx probe imports Convex's actual AuthenticationManager and LocalSyncState. Cached authentication succeeds; the next token fetch returns null (the installed Clerk adapter's catch behavior for a fetch exception), confirmed authentication clears, and a subsequent server transition after simulated recovery does not fetch again. Assertions pass; no network, real tokens, environment or deployment data used. Script/log: .spectra-local/LV036-auth-manager-probe.ts and .spectra-local/LV036-auth-manager-probe.log. This proves an SDK lifecycle candidate, not that the live residual took this branch. Existing school-auth-skip tests preserve sign-out/revoked-membership privacy; no bypass, row cache or speculative token adapter added.
- Question for verifier: In the same failing context after reconnect and after online reload, record only Clerk token request status/browser error and category (session token versus convex-template token; omit full URL/session identifiers/query/body/token); whether the Convex socket connects/closes and its close code; sanitized Convex auth console error. If frames are observable, retain only message type/auth error names, never token/query args/results. Compare the same saved Profile A state in a fresh online-only context without disconnect: does Library populate and overview return 200? These observations distinguish terminal token failure, socket failure and missing membership; no account/deployment changes needed.
- Status NEEDS-INFO. The live remaining empty Library is unresolved; 07cfa20d corrects shell removal and its regression tests remain passing. No new runtime change made before identifying the remaining auth/read boundary.

**Token transport recovery correction** (fixer, 2026-10-01)
- The verifier's fresh online-only control loads 175 items and overview 200; two of three cold offline contexts lose the board, while the shell now remains connected. Sanitized tracing records a session-token fetch TypeError around reload, later session/Convex-template requests with 200, an open socket and Transition/MutationResponse/Ping frames without an observed AuthError. These observations identify intermittent transport failure without implying that healthy same-origin HTTP or socket pings confirm reactive authentication.
- Root cause: The installed Convex Clerk adapter catches every getToken rejection and returns null. Its real authentication manager treats null as terminal missing credentials, clears confirmed authentication and stops scheduled refresh; useAuthedArgs then correctly skips school reads, leaving the board loading. A transient transport failure needs to finish its existing token request, rather than enter that terminal credential path; the earlier shell-retention correction alone could not restore subscriptions.
- Change: Wrap only Clerk getToken transport failures before passing the hook to the existing ConvexProviderWithClerk. Retry TypeError/NetworkError and typed Clerk 429/5xx failures using the shared exponential retry policy; wait for the online event without polling offline. Cancel on owner/session/organization/role changes or unmount, and discard a late old-session response. Genuine null tokens, non-transient failures and 401/403 retain the adapter's existing terminal behavior. Convex still selects the token audience/template, confirms tokens and authorizes each read/write; school membership gates remain unchanged.
- Before/after proof: Three regressions fail with the original hook through the actual installed ConvexProviderWithClerk: offline pending/reconnect recovery, online transport retry and lifecycle cancellation. The final 11 integration tests additionally cover typed transient HTTP responses, terminal null/401/403, session changes and late old-session token responses. All **34 tests across four files** pass including the existing account boundary, school-auth-skip and real route-host recovery tests. Real SDK manager probe separately demonstrates the terminal-null behavior. Logs: .spectra-local/LV036-token-before.log, .spectra-local/LV036-token-focused-final.log and .spectra-local/LV036-auth-manager-probe.log.
- Re-check after committed hash: Frontend reload only, three or more clean cold contexts without fault routes, work studio not loaded. Open a disposable work offline; remain offline through at least one token-refresh window, reconnect and allow token confirmation; Library rows must stay/return and online work must open/persist without manual reload. Also exercise online reload around the same failure window and LV-037 repeated-offline-Retry/reconnect. Retain healthy offline-banner observations. No backend sync/deploy/codegen needed.

- Token transport recovery commit: `fb6725a679cf8ae533f7a1090cdae84fbd6e1d95`. Three failing-before regressions; **34/34 focused tests**, both TypeScript projects, full lint and all five gates pass, including 3,324 staged/tracked files in the secret scan. Logs: `.spectra-local/LV036-token-{before,focused-final,types-complete,lint-complete,gates-final}.log`. Full suite running. Verifier received the hash for frontend-only cold-context/reconnect/reload and nearby LV-037 checks; only it sets VERIFIED.
**Core 2 offline-null contract correction** (fixer, 2026-10-01)
- The three 75-second cold-context failures prove fb6725a6 did not resolve this branch. The exception-only tests missed Clerk Core 2's distinct offline-null contract: BaseResource catches failed requests and returns null when the browser is offline, so an empty Token yields null from Session.getToken without throwing. The installed useAuth forwards that result; the Convex adapter/authentication manager then interprets it as terminal missing credentials and stops reactive reads. This matches the remaining loss after the token refresh interval, while the shell and browser offline notice behave correctly.
- Primary source: [Clerk v5.128.0 Base resource](https://github.com/clerk/javascript/blob/%40clerk%2Fclerk-js%405.128.0/packages/clerk-js/src/core/resources/Base.ts), [Session token method](https://github.com/clerk/javascript/blob/%40clerk%2Fclerk-js%405.128.0/packages/clerk-js/src/core/resources/Session.ts), and [Core 3 upgrade guide's documented Core 2 ambiguity](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3). Source excerpts saved under .spectra-local/LV036-clerk-{base-resource,session}-v5.ts. SDK/dependency files are read only; no version upgrade or experimental option enabled.
- Change: Extend the existing token wrapper to recheck a null result only for the same known signed-in owner when the request began offline or the browser is currently offline. Wait without offline polling, then fetch again online; a fresh online null remains terminal. Also recognize Clerk's typed network_error through its public runtime-error guard. Existing request options, SDK audience/template selection, terminal auth failures, membership checks and owner-change cancellation remain intact; no additional data cache or recovery layer.
- Before/after: Four new regressions fail on fb6725a6; the final **38/38 tests across four files pass**. A 75-second synthetic offline hold keeps the fetch pending without additional calls, reconnect gets the new token, an online null then ends recovery, and an offline-started request resolving just after reconnect is rechecked rather than dropped. All prior isolation, terminal HTTP and actual conversation retry tests remain green. Logs: .spectra-local/LV036-null-before.log and .spectra-local/LV036-null-focused.log.
- Re-check after hash: Frontend reload only. Repeat at least three clean cold contexts with the same 75-second offline hold and original failed work open. At reconnect verify Library rows stay/return, exact offline message clears, and an online work open/persistence check succeeds without browser reload. Repeat LV-037's original Try again action after a long offline interval. Only the verifier sets VERIFIED; no backend sync/deploy/codegen.

- Core 2 offline-null correction commit: `d3d5baa699b9133db7e6655b001ee715a0caa9b8`. Four new regressions fail before; **38/38 focused tests**, both TypeScript projects, full lint and all five gates pass. Full suite running. Frontend-only repeated 75-second cold-context recheck requested; LV-037 is now VERIFIED independently by the verifier.

### LV-037 · Offline LiveDock opening shows overlapping work and conversation notices

- **Status:** VERIFIED
- **Severity:** Medium
- **Surface / role:** `/school` route-side LiveDock conversation / signed-in Profile A school administrator
- **Report script:** P3-WORKSPACE-FLOWS · LV-035 adjacent verification: “Check repeated retry on another Library action, a pending online retry, and route-side work/conversation load retries when feasible.”
- **Commit tested:** 076101f3 (application code; local app on port 3000); earlier live checks: 91bbe7f6 (ac9167eb), ff4d20f9, fb6725a6, d5a53285, 96f3b05d and cd04b06a.
- **Frequency:** Initial offline-open failure: 13 of 13; the fb6725a6 recheck opened once; on d5a53285, 2 of 2 reconnect/retry sequences did not open the panel; on 96f3b05d, 2 of 2 offline opens still left the panel closed 2.5 seconds after reconnect. On cd04b06a, 2 of 2 full offline-hold/reconnect trials left the panel closed after a Try again click: trial 1 after the foreground work notice was closed and trial 2 after the first visible Retry was clicked. Five of five clean one-click offline opens showed both a work and a conversation notice, each with Try again and Close toast. Of 2 online activations of the conversation-specific Retry after the foreground work notice was dismissed, 1 opened the panel and 1 left it closed with one retry still visible.

**Steps**
1. Sign in through saved Profile A and open `http://localhost:3000/school` while online.
2. Create a disposable test conversation by entering `Reply with one short sentence confirming this temporary route-panel check.` in the school chat composer and submit. Close the live chat panel; reload `/school` online and confirm one `Open chat for …` button is visible.
3. Set the browser network offline, click the single `Open chat for …` button, wait 1.8 seconds, and inspect the route, main content, live panel, offline status, and exact `Retry` / `Try again` actions.
4. Restore the network and wait 2.5 seconds without reloading; inspect whether the panel opens or a recovery action appears.
5. Repeat steps 2–4 until 13 offline-open attempts have been made. After one reconnect, click the same `Open chat for …` button online and inspect whether the live panel opens.

**Expected:** The adjacent LV-035 check asks for “route-side work/conversation load retries when feasible.” After an offline open failure, the user can retry after reconnecting and see the conversation panel open.

**Actual:** The live panel did not open in 13/13 offline clicks. In 12 attempts, `/school` retained 2 `main` nodes, one `Open chat for …` button and no `Close live chat` button; no exact `Retry` action appeared. An offline status notice appeared and cleared after reconnect, but the panel remained closed and the open button remained. Exact `Try again` appeared in 2 attempts; after reconnect, clicking it once made it disappear but left the panel closed. In 1/13 attempts, `/school` had no `main` or chat buttons during offline use and remained blank for 2.5 seconds after reconnect until reload. A manual online click opened the panel in the checks where attempted. The post-fix neighboring check produced the same closed-panel state, one offline status notice, no exact recovery action, and no automatic recovery; a manual online click opened it. Classified failed requests in the recorded route-side attempts were Spectra detail/other API, auth, and other; no script/module or stylesheet errors were counted.

**Evidence:** `.spectra-local/live-verification/LV-037-conversation-offline-observations-64db689f-redacted.txt`; `.spectra-local/live-verification/LV-037-conversation-live-dock-offline-attempt-7-64db689f-redacted.png`; `.spectra-local/live-verification/LV-037-conversation-offline-status-attempt-12-64db689f-redacted.png`; `.spectra-local/live-verification/LV-037-postfix-dock-offline-ff4d20f9-redacted.png`; `.spectra-local/live-verification/LV-037-postfix-status-offline-ff4d20f9-redacted.png`; `.spectra-local/live-verification/LV-037-postfix-recheck-2026-10-01-redacted.txt`; `.spectra-local/live-verification/LV-037-postfix-offline-status-2026-10-01-redacted.png`.

**Post-fix live verification (verifier, 2026-10-01):** In two fresh Profile A browser pages at 1280×720, the disposable target was confirmed openable online, then reloaded before the offline step. Each offline-open showed the exact offline message and a Try again control. Two Retry clicks while still offline left the control count unchanged. After reconnect, the message cleared in both trials, but neither opened the panel. In the first trial Try again had disappeared by 2.5 seconds. In the second, one Try again remained at 2.5 seconds; activating it online removed the notice without opening the panel for 5 seconds. No unhandled rejections or window errors were observed.

**Post-fix evidence:** .spectra-local/live-verification/LV-037-d5a53285-reconnect-loss-redacted.txt; .spectra-local/live-verification/LV-037-d5a53285-offline-retry-redacted.png.
**Final post-fix live verification (verifier, 2026-10-01; application commit 076101f3):** In saved Profile A at 1280×1100, two distinct notices showed their own visible Try again and Close toast actions. After moving the pointer away from the notices, the conversation Retry remained visible and hit-tested to its button. Two conversation Retry clicks while offline preserved both notices. Both actions remained after a 10.5-second offline hold. After reconnect, the conversation-specific Retry opened the panel within five seconds while the work notice remained. Clicking the work-specific Retry with the conversation panel open cleared the notices and left the panel open. The route remained `/school` in one browser page. A clean online reload at 08:56:29 UTC showed no offline or connection-check copy, console errors, HTTP errors, request failures or pageerrors. During the deliberate offline interval, the session console contained offline resource failures and one local Bridge chunk connection-refused entry; the CLI did not provide per-message timestamps. No failing online Retry occurred in this repeat.
**Final recheck evidence:** `.spectra-local/live-verification/LV-037-076101f3-recheck-redacted.txt`. No new AI prompt was submitted.
**Investigation** (fixer)
- Investigation on claim: The live Dock sends run.openConversation to RouteSidePanelHost. That handler currently calls openThread directly, bypassing the host's existing loadThread retry wrapper used by restored conversations; work.open already uses its corresponding retry wrapper. The caller and shared command paths will be checked before reusing the existing failure mechanism.

**Fix** (fixer)
- Commit: `ac9167ebfe32c9fd881a3de0a142c91a663c66ed`.
- Root cause: The Dock's run.openConversation handler called the unwrapped thread reader, while only restored conversations used the existing retry wrapper. The fire-and-forget semantic bus does not await that reader's promise, so an offline rejection had no recovery notice and could escape as an unhandled rejection. Run-to-thread lookup also happened outside the existing latest-request fence, allowing a late lookup to replace a newer selected conversation.
- Change: Dock opens, restored opens and application-command conversation previews share the existing retry/error path, including the run-to-thread lookup; application-command work previews also reuse their existing retry wrapper. The same latest-request coordinator accepts a typed target with a stable key so it fences the complete lookup/detail operation, and cancelled lookups cannot start an old detail read. Failure and cancellation return explicit failed command outcomes; retries retain one notice, and successful retry opens the requested panel and clears it.
- Test: Three transport/host regressions fail before the initial correction, and a fourth late-lookup regression fails before moving the full pipeline inside the existing coordinator. The actual host, semantic bus, request wrapper, request coordinator, session persistence and Sonner toaster are exercised with only transport and unrelated visual/provider dependencies replaced. Tests cover repeated offline failures, reconnect/retry, run lookup retry, online success, fire-and-forget delivery and a late lookup superseded by a newer conversation. All **33 focused tests**, both TypeScript projects, full lint and all five gates pass; the staged secret scan covers 3,322 tracked files. Logs: `.spectra-local/LV037-{before,stale-before,focused-final,tsc-final,convex-tsc-final,lint-final,gates-final}.log`. Full suite: **4,459 passed, 13 failed, 1 skipped**; **503 passed files, 6 failed, 1 skipped** (510 files), 562.44 seconds. Twelve failures in five unchanged backend/native/document files then pass **134/134** in a one-worker recheck with original assertions/time limits; pending LV-017 hosted packaging remains unresolved. Logs: `.spectra-local/launch-fixer-LV037-full.log` and `.spectra-local/LV037-full-failures-recheck.log`. This full result is not green.
- Re-check nearby: Frontend reload only. On /school, open a Dock conversation offline: expect one exact Try again action while school/Dock remain visible. Retry twice offline, then reconnect and activate that action: expect the actual conversation panel and no recovery notice. Also check a run-only open, a fast switch to another conversation and an application-command conversation/work preview. Automatic opening on reconnect is not promised; use the offered retry. No backend sync/deploy/codegen.

**Live verifier post-fix recheck (2026-10-01)**
- **Status:** FIXED — on `91bbe7f6` (application code at `ac9167eb`), the specified retry flow did not open the LiveDock conversation panel.
- **Reproduction:** With saved Profile A at `/school` online and one disposable `Open chat for …` button visible, set the browser offline and click that button. One exact `Try again` button appeared while the school shell remained visible. Clicking it twice while offline retained exactly one `Try again` button. Reconnect, then activate the remaining `Try again` action.
- **Expected:** “On /school, open a Dock conversation offline: expect one exact Try again action while school/Dock remain visible. Retry twice offline, then reconnect and activate that action: expect the actual conversation panel and no recovery notice.”
- **Actual:** After the online retry, `navigator.onLine=true`, the offline status was absent, the shell remained mounted, and the same-origin overview returned HTTP 200, but neither a `Close live chat` control nor an `Open chat for …` control was present; the conversation panel did not open. The retry notice cleared. During the intentional offline phase the browser recorded three same-origin conversation GET failures with `net::ERR_INTERNET_DISCONNECTED`; query parameters and thread IDs are redacted in the evidence file. No false offline notice was observed after reconnect.
- **Frequency:** 1 of 1 complete post-fix sequence.
- **Evidence:** `.spectra-local/live-verification/LV-037-postfix-recheck-2026-10-01-redacted.txt`; `.spectra-local/live-verification/LV-037-postfix-offline-status-2026-10-01-redacted.png`.

**Live verifier follow-up (2026-10-01; app code fb6725a6)**
- **Status:** VERIFIED
- **Steps:** On /school, submit the specified disposable route-panel prompt if no test conversation exists; close the panel and reload online. Set the browser offline, click the single Open chat for … button, and activate the exact Try again action twice while offline. Reconnect and activate the remaining exact Try again action.
- **Expected:** “After an offline open failure, the user can retry after reconnecting and see the conversation panel open.”
- **Actual:** The offline open showed one exact Try again action. Two retries while offline retained exactly one action. At reconnect the global offline message was absent by 25 ms and the Try again action remained. Activating it opened the panel within 5 seconds; one Close live chat control and the disposable prompt were present, with no Try again action or offline message.
- **Frequency:** 1 of 1 complete sequence.
- **Evidence:** .spectra-local/live-verification/LV-037-fb6725a6-recheck-redacted.txt; .spectra-local/live-verification/LV-038-route-side-panel-narrow-redacted.png.


**Shared account-boundary follow-up** (fixer, 2026-10-01)
- The account-readiness gate used by AppShell could unmount RouteSidePanelHost while the same Clerk owner temporarily lost Convex authentication. The recovery toast survived outside that gate, but its callback then updated the old unmounted host, explaining a dismissed notice with no panel after reconnect. LV-036's shared owner-aware preparation correction retains this host across transient backend identity loss while preserving account/deployment isolation.
- Before/after test: The real host, semantic bus, transport, retry notice and AccountStorageBoundary are exercised together using the same readiness gate as AppShell. Temporary authentication loss must retain the same context node; after reconnect the original Try again action mounts the conversation and clears its notice. This regression fails before the boundary correction and passes after; all 22 focused storage/boundary/host tests pass. Commit and required checks will be recorded after completion.


- Shared boundary fix commit: `07cfa20d6df5cd43c12ae50d685488d1163d6084`. All **22 focused tests**, both TypeScript projects, full lint and all five gates pass. The two continuity/retry regressions fail before this change. Full-suite run is in progress; frontend-only live recheck requested, and only the verifier sets VERIFIED.

**Reopened investigation and question (fixer, 2026-10-01):** Re-read P3-WORKSPACE-FLOWS and traced run.openConversation through RouteSidePanelHost, the latest-request coordinator and the real Sonner retry. All six host tests pass, including two offline retries, run-to-thread lookup, reconnect opening, late-response fencing and same-account auth refresh. Repeated all six with the actual useArtifactStudioState hook (only studio visuals replaced); they also pass, and the temporary diagnostic source substitution was restored byte-for-byte. Logs: .spectra-local/LV037-reopened-focused.log and .spectra-local/LV037-reopened-real-studio-hook.log. This does not reproduce the live residual or establish its cause.

**Question for verifier:** For one clean failed reconnect trial, record the exact toast message/description surrounding each Try again control, the UTC time and action URL/status of each retry request (especially runDetail and thread), and sanitized returned thread-presence/error-code facts. Does clicking the conversation-specific notice issue a thread request online, and does it return a conversation? Record whether the main shell/panel host is removed or replaced during reconnect versus remaining mounted with a closed panel; use DOM identity/ancestor facts if observable without app changes. Do not assume the second Try again belongs to this operation. These observations distinguish an unrelated/expired notice, cancelled request, remounted host or successful read followed by UI loss. No additional retry mechanism or guessed auth change was made.

**Live verifier post-fix recheck (2026-10-01; app code 96f3b05d)**
- **Status:** FIXED — after the fixer recorded commit `07cfa20d`, two live offline opens still did not show the conversation panel after reconnect.
- **Steps:** In saved Profile A at 1280×720 on `/school`, reuse the existing disposable Moon conversation with one `Open chat for …` control. Set the browser offline, click that control, and wait 1.8 seconds. In the first trial, click the single `Try again` action twice while still offline. Restore the network and wait 2.5 seconds without reloading.
- **Expected:** “On /school, open a Dock conversation offline: expect one exact Try again action while school/Dock remain visible. Retry twice offline, then reconnect and activate that action: expect the actual conversation panel and no recovery notice.”
- **Actual:** Each offline open showed one `Try again` action. The first trial retained one action after each of two offline retries. At 2.5 seconds after reconnect, both trials had `navigator.onLine=true`, no offline status notice, no `Try again` action, and no `Close live chat` control. The conversation panel did not open. Since the action was gone, no online retry could be activated and no online retry response was observed. The second trial's notice read “This conversation could not be opened. Check your connection, then try again.”
- **Frequency:** 2 of 2 offline opens did not show the panel at the reconnect check; 1 of 1 trial with two offline retries retained exactly one action through both clicks; the Try again count was 0 at the 2.5-second reconnect check in 2 of 2 trials.
- **Console:** Playwright recorded 111 errors / 1 warning before the two deliberate offline cycles, 115 / 1 after the first and 116 / 1 after the second. Raw console text and URLs were not copied because the stored offline log may contain authentication query data. No conclusion about unhandled rejections or panel-host DOM identity was recorded.
- **Evidence:** `.spectra-local/live-verification/LV-037-post-96f3b05d-observations-redacted.txt`; `.spectra-local/live-verification/LV-037-post-96f3b05d-offline-dock-redacted.png`; `.spectra-local/live-verification/LV-037-post-96f3b05d-offline-retry-button-redacted.png`; `.spectra-local/live-verification/LV-037-post-96f3b05d-reconnected-dock-redacted.png`.

**Root cause and lifetime correction (fixer, 2026-10-01):** The shared retry helper inherited Sonner's 4,000 ms auto-expiration, so its original recovery action disappeared while the person waited offline or reconnected. Preventing the click's default dismissal did not stop that timer; the product Toaster does not override it. Earlier conversation tests explicitly mounted Toaster with duration=Infinity, masking the production behavior and explaining why short recovery checks passed while the live action disappeared.

- Change: Set lifetime=Infinity on actionable notices in the existing showRetryToast helper and enable Sonner's existing accessible close control. The caller still dismisses on successful retry, repeated failure still updates the same ID, and pending retries remain guarded. No automatic reopen, second retry mechanism, native UI or global change to ordinary toast duration.
- Affected nearby: route-side conversation lookup/load, route-side artifact load, and Library tree actions/Undo using showRetryToast. Explicit dismissal lets a person abandon the notice; it does not submit or cancel the underlying action.
- Before/after proof: With the real default Toaster, the conversation regression fails before at the ten-second offline hold because Try again is gone. After correction it preserves exactly one action through two offline retries and that hold, opens the original conversation on an online retry, and dismisses on success. Added explicit-close coverage; **29/29 focused tests across four files pass**, including Library retries, pending-submit guard and source closure. Removed the Infinity override from both existing route-host test mounts. Logs: `.spectra-local/LV037-lifetime-{before,focused-final,types,lint,gates}.log`. Both TypeScript projects, full lint and all five gates pass.
- Recheck after committed hash: frontend reload only; reuse the confirmed disposable conversation, open offline and retry twice, remain offline at least ten seconds, then reconnect. The same conversation-specific Try again must remain until clicked or explicitly closed; click online and verify the actual conversation opens and the notice disappears. Recheck a route work load/Library retry and the explicit close control. Ordinary notification expiry and the truthful global offline banner remain unchanged. No backend sync, deploy or codegen required.
- Lifetime correction commit: `cd04b06a7339671546c6c76bb2a603bf294e92a6`. **29/29 focused tests**, both TypeScript projects, full lint and all five gates pass; full suite is running. Configured human Git identity without AI attribution. Verifier received the committed frontend-only ten-second hold/reconnect/original-action recheck.

**Live verifier post-fix recheck (2026-10-01; application code cd04b06a; documentation HEAD 36ec4071)**

- **Status:** REOPENED — with both notices present, the foreground work notice covered the conversation Retry and the first visible Retry did not open the conversation. After the work notice was dismissed, two conversation-specific online Retry checks opened the panel once and left it closed once.
- **Steps:**
  1. In saved Profile A at desktop 1280×1100, reload http://localhost:3000/school online. Confirm one Live Dock region, one Open chat for control and no retry notices. Reuse the existing route-side conversation.
  2. Set the browser offline and click the single Open chat for control once. Wait 1.8 seconds; inspect all visible notices and their Try again and Close toast controls.
  3. While offline, click the frontmost Try again twice and remain offline for at least ten seconds. Reconnect, then inspect and activate the conversation-specific retry.
  4. Separately dismiss the foreground work notice using Close toast and activate the remaining conversation-specific Try again. Inspect the panel, notices, request statuses and shell after five seconds.
- **Expected:** “On /school, open a Dock conversation offline: expect one exact Try again action while school/Dock remain visible. Retry twice offline, then reconnect and activate that action: expect the actual conversation panel and no recovery notice.”
- **Actual:** In each full trial, one offline Open chat click showed two separate notices: “This work could not be opened. Check your connection, then try again.” and “This conversation could not be opened. Check your connection, then try again.” Each showed Try again and Close toast. Two offline clicks on the frontmost Try again left both notices visible through holds of 12,967 ms and 12,928 ms. In trial 1, after one Close toast removed the foreground notice, the remaining conversation retry was activated online; the panel stayed closed and one retry remained after five seconds. In trial 2, clicking the first visible retry online left the panel closed and one notice remained after five seconds. The offline copy was absent after reconnect.
- **Actual — action identity:** The two notices were the work and conversation messages above. At 1280×1100, their bounds were x=900,y=24,w=356,h=93 and x=909,y=40,w=338,h=89. Hit testing at the center of the conversation retry returned the foreground work notice. A locator click on the conversation retry timed out after five seconds because the foreground notice intercepted the pointer. After closing the work notice, the conversation-specific retry was accessible and was activated at 2026-10-01T08:12:37.491Z UTC. It sent three GET /api/spectra?action=thread requests and one GET /api/spectra?action=runTabs&limit=120&surface=chat; all four returned HTTP 200. Within five seconds, Close live chat was present and both notices were gone. The two main nodes, Live Dock section and app-surface node checked before the action remained connected and identical after it. The previously used report prompt literal was not present in the exact-text check, so transcript identity was not asserted.
- **Frequency:** Two of two full offline-hold/reconnect trials left the panel closed after a Try again click (trial 1 after closing the work notice; trial 2 on the first visible notice). Five of five clean one-click offline opens produced both notices. Of two online activations of the conversation-specific retry after the work notice was dismissed, one opened the panel and one left it closed with one retry still visible. Explicit Close toast controls removed the notices one at a time without opening the panel.
- **Console/network:** During the second full offline trial, four console errors were classified as network errors; four same-origin /api/spectra requests failed with ERR_INTERNET_DISCONNECTED and one other request failed with ERR_ABORTED. There were zero page errors and zero unhandled rejections. The online conversation-specific retry had no failed requests or new console/page errors; all four API responses were HTTP 200.
- **Evidence:** .spectra-local/live-verification/LV-037-cd04b06a-live-recheck-redacted.txt; .spectra-local/live-verification/LV-037-cd04b06a-work-notice-copy-redacted.png; .spectra-local/live-verification/LV-037-cd04b06a-conversation-notice-copy-redacted.png; .spectra-local/live-verification/LV-037-cd04b06a-retry-copy-redacted.png; .spectra-local/live-verification/LV-037-cd04b06a-after-10s-redacted.png; .spectra-local/live-verification/LV-037-cd04b06a-close-toast-redacted.png; .spectra-local/live-verification/LV-037-cd04b06a-panel-open-control-redacted.png.

**Fixer investigation (2026-10-01; overlapping recovery actions):** GlobalRouteWorkbench deliberately dispatches conversation and associated-work opens from the same Dock action. Both offline failures therefore produce distinct notices. The product Toaster uses Sonner's collapsed default stack, which can cover the older notice's action; reproduce using the actual Providers/Toaster before enabling its built-in expansion. The separate conversation-specific online failure without a request trace remains unconfirmed and will not be claimed fixed by a layout correction.

**Stack correction and remaining live question (fixer, 2026-10-01):** The Dock intentionally opens the conversation and its associated work as independent operations. Both recovery notices were correct, but the shared Toaster rendered them in Sonner's collapsed stack, covering the older conversation action with the newer work notice; retrying work does not open a conversation. Enable Sonner's existing expand option on the product Toaster so each visible notice and its own recovery/close controls occupy separate space, without a second notification mechanism or changing the existing two-target open policy.

- Before/after: The actual Providers and real Sonner regression fails before because the conversation notice uses the collapsed layout; it passes after expansion without hover/focus or closing the work notice. **43/43 focused tests across four files pass**, including independent recovery in both orders through the actual GlobalRouteWorkbench callback/RouteSidePanelHost, persistent offline actions, pending guard, explicit close, and ordinary four-second notification expiry. Both TypeScript projects, full lint, all five gates and the scoped design detector pass. The staged secret scan covers 3,327 files. Logs: `.spectra-local/LV037-stack-{before,focused-final,types-web-final,types-convex,lint,gates,secrets-staged}.log`.
- Affected nearby: all product Toaster callers, especially simultaneous route work/conversation loads and distinct Library operations; ordinary lifetime and operation-specific retry identities remain unchanged. Frontend reload only; no backend sync, deploy or codegen required.
- Remaining question for verifier: On the committed stack correction, keep both notices present and verify the conversation-specific button is directly clickable without hover or dismissing work. Retry that conversation online. If it again stays closed with its notice, capture that failing activation's UTC time, sanitized thread/runDetail request status and error code/message/request ID (or absence of a request), and host continuity. The prior trace captures only the successful activation; the separate one-of-two online failure remains unresolved, so LV-037 is NEEDS-INFO rather than claiming full recovery. Recheck work retry independently and preservation of any already-open conversation; no new AI submission is needed.

- Stack correction commit: `076101f3803148d96ceec8582d536ab2138527a0`. Verifier received frontend-only recheck instructions and the narrow failing-activation trace question. Full suite finished with **4,512 passed, 3 failed, 1 skipped**; final isolation results are recorded in the closeout below. Source/tests remained frozen throughout validation; configured human Git identity, no AI attribution/co-author trailer.

**Verifier follow-up received (2026-10-01; application code 076101f3):** In saved Profile A at 1280×1100 on /school, with the pointer on blank page space, both notices had separate bounds and both Try again actions were visible without hover or dismissing the other notice. The conversation action passed its center hit-test. Two offline conversation retries and a 10,514 ms offline hold preserved both actions. After reconnect, the conversation-specific retry opened the panel within five seconds and left the work notice available; retrying work then cleared both notices and preserved the conversation after 2.5 seconds. One browser page remained on /school; no new AI prompt was submitted.

- The transaction observer captured no Spectra HTTP response >=400, Spectra request failure or pageerror. The cumulative offline console excerpt included deliberate offline reads/token transport and an untimed local Bridge chunk connection refusal; this does not establish which click emitted that chunk error. A clean online reload at 08:56:29 UTC had zero console errors, HTTP errors, failed requests and pageerrors, no offline/connection-check copy, and one warning.
- Evidence: `.spectra-local/live-verification/LV-037-076101f3-recheck-redacted.txt`. The failing-activation question has no new failure to correlate in this repeat. FIXED records the corrected stack and successful live recovery; the earlier one-of-two untraced failure remains historical evidence, without a claimed new diagnosis. Only the verifier may promote the entry to VERIFIED. No additional runtime patch or repeated full suite was needed for this evidence-only update.

### LV-038 · Route-side conversation panel content is squeezed into a narrow column

- **Status:** VERIFIED — the desktop route conversation remained readable through drag resize and close/reopen, and the document/chat split had no horizontal overflow on d5a53285.
- **Severity:** Medium
- **Surface / role:** /school route-side LiveDock conversation / signed-in Profile A school administrator
- **Report script:** Free exploration · first-week school administrator, desktop route-side conversation
- **Commit tested:** d5a53285 (application code; documentation HEAD b13c9599; local app on port 3000)
- **Frequency:** 2 of 2 fresh in-memory Profile A contexts; the first context also reproduced the width after closing and reopening the panel online.

**Steps**
1. At desktop viewport 1280×720, load /school in a fresh in-memory Playwright CLI context using saved Profile A state.
2. If no disposable Open chat for … target is present, submit “Reply with one short sentence confirming this temporary route-panel check.” in the School chat composer. Close the panel, reload /school online, and confirm the open-chat control is present.
3. Click the Open chat for … control online and wait 2.5 seconds.
4. Inspect the route-side panel and a message bubble. Close and reopen the panel while still online, then repeat the open in a second fresh Profile A context.

**Expected:** At a 1280×720 desktop viewport, route-side conversation text is readable in a panel wide enough to show message lines without per-character wrapping or clipping.

**Actual:** In both contexts, the route-side panel’s scroll area measured 79 CSS pixels wide and the disposable message bubble measured 34 CSS pixels wide. The message wrapped one or a few characters per line and appeared clipped. Closing and reopening online in the first context retained the same measurements. The browser body remained 1280 CSS pixels wide without horizontal scroll.

**Evidence:** .spectra-local/live-verification/LV-038-fb6725a6-recheck-redacted.txt; .spectra-local/live-verification/LV-038-route-side-panel-narrow-redacted.png.


**Post-fix live verification (verifier, 2026-10-01):** At 1280×720, two Profile A pages opened the confirmed disposable route conversation. Both showed a 480 px Live chat panel and 360 px prompt bubble across three lines. Drag expanded the first panel from 480 to 520 px; after close/reopen it remained 520 px with a 393 px bubble. No body horizontal scroll was present. A disposable Library work opened in Work studio. With Live chat also open, the panes measured 424 px and 360 px and the document editor remained mounted; with Work studio alone its resize changed width from 483 to 542 px. Document scroll width stayed 1280 px throughout.

**Post-fix evidence:** .spectra-local/live-verification/LV-038-d5a53285-layout-recheck-redacted.txt; .spectra-local/live-verification/LV-038-d5a53285-route-chat-recheck-redacted.png; .spectra-local/live-verification/LV-038-d5a53285-workstudio-livechat-split-redacted.png.
**Root cause and correction** (fixer, 2026-10-01)
- The generic split-panel CSS reserved 280 px from its containing block, but a route-preview wrapper is already only the panel's width: a 360 px preview was capped at 80 px, leaving the observed 79 px scroll area after its border. The shared fitter and drag handler also measured that panel-sized wrapper, clamping wider intent back to the floor; after selecting the real canvas, its padding must be excluded from the width, drag edge and overlay threshold. These are shared sizing-container errors, not message wrapping or typography problems.
- Change: Keep the shared 880 px upper bound on every panel and keep the existing canvas reserve on the workbench-row selector. Fit and resize against the established split host or AppShell global stage, measuring its content box once for padding/border; use that same width for the existing split/overlay resolver. Reuse StudioSplitShell and the existing allocation model; no route-specific style override or new pane mechanism.
- Affected nearby: LiveThreadPanel and all ArtifactStudio route previews, initial fitting, user width intent/drag, workbench split budgets and padded overlay promotion. Normal workbench reserve and full-width overlay behavior remain covered. Recheck a route-side work preview, resize/close/reopen and a Library/workspace split next to the main canvas.
- Before/after: Four regressions fail on the original source (actual Chromium production-CSS measurements plus real component fit/drag); two padding regressions and one overlay-padding regression fail before the shared content-box correction. **41/41 focused tests across four files pass**. Requested 360/520 px route widths now render at 360/520; the 880 px cap, 720 px workbench CSS limit, overlay fill, fit/drag budgets and existing conversation retry are exercised. Logs: .spectra-local/LV038-before.log, .spectra-local/LV038-padding-before.log, .spectra-local/LV038-overlay-before.log and .spectra-local/LV038-focused-final.log.
- Browser test scope: scripts/route-panel-layout.test.mjs renders a static fixture with the production CSS in an isolated headless Chromium profile at 1280×720; it never loads the product, reads account data or hunts new issues. Hosts without Chromium skip this optional probe; all five browser cases ran and passed here. Temporary generated profiles are removed only after checking their task-owned directory boundary.
- Re-check after committed hash: Frontend reload only, desktop 1280×720. Repeat the disposable route-side conversation open and close/reopen; verify readable message lines, a roughly 360 px panel rather than a 79 px scroll strip, drag expansion and no body horizontal scroll. Check an artifact route preview and main-canvas split/overlay nearby. Mobile dimensions remain outside the verifier's authorized scope. No backend sync, deploy or codegen needed.

- Commit: `d5a532856911ae2b5457d5ed42f87e5a8b7cb5d1`. Both TypeScript projects, full lint and all five gates pass; full-suite validation follows in the final closeout. Configured human Git identity, no AI attribution.

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

## Fixer closeout · LV-036

- Commit: `ff4d20f9839da198d0e2626d86c88d0a5e38492e` — give rejected client-module loads explicit reconnect/reload recovery across the global and route screens. Seven regressions fail before; **42/42 focused tests**, both TypeScript projects, full lint and all five gates pass. Existing human Git identity, no AI attribution/co-author trailers. The verifier has the hash and frontend-only recovery check; only it sets VERIFIED.
- Full suite: **4,465 passed, 2 failed, 1 skipped**; **506 passed files, 2 failed, 1 skipped** (509 files), **375.46 seconds**. Failures: unchanged signed-out Stop-auth test timeout and LV-017 hosted Docker packaging omitting a shared runtime module. The complete Stop-auth file passes **59/59** separately. Logs: `.spectra-local/launch-fixer-LV036-full.log`, `.spectra-local/LV036-run-route-recheck.log`. This full result is not green; the prohibited Docker COPY change remains unapplied.
- **NEEDS-DECISION:** LV-028 — shortcut mapping; LV-022 — post-save prose versus saved-result presentation; LV-003 — expired-invite HTTP semantics; LV-012 — automatic Bridge discovery versus explicit activation. **CANNOT-REPRODUCE:** LV-007 — original idle versus pending confirmation, whose controls remain disabled. LV-004 — original invitation encoding artifact; decoded generated token works. Its unrelated reopen-status change contained no new invitation evidence and was reconciled with the prior real-model/live assessment when LV-036's scoped status was corrected. **NEEDS-INFO:** LV-017 — hosted-package exception unanswered. Earlier assessments and original live observations remain preserved as history.
- LV-036 is FIXED pending live reconnect/reload recovery. No backend sync, deployment, codegen, production-data or environment changes occurred.
- No OPEN, REOPENED or FIXING entry remains. Stop between tasks as requested and resume on a new/reopened ledger issue.

## Fixer closeout · LV-037 and LV-036 clean reproduction

- Commit: `ac9167ebfe32c9fd881a3de0a142c91a663c66ed` — reuse conversation-open recovery and fence run lookup with the existing request coordinator (LV-037). **33/33 focused tests**, both TypeScript projects, full lint and all five gates pass; the staged secret scan includes 3,322 files. Four regressions fail before their corrections, with a fifth checking real fire-and-forget delivery. Existing human Git identity, no AI attribution/co-author trailers.
- Full suite: **4,459 passed, 13 failed, 1 skipped**; **503 passed files, 6 failed, 1 skipped** (510 files), **562.44 seconds**. Twelve failures occur in unchanged AI live-write admission, DOCX lens, PPTX materialization route, run-route and S11 Office-model files; all five files subsequently pass **134/134** with one worker and unchanged assertions/time limits. The thirteenth failure is pending LV-017 hosted packaging. Logs: `.spectra-local/launch-fixer-LV037-full.log`, `.spectra-local/LV037-full-failures-recheck.log`. This full result is not green; deployment-configuration edits remain prohibited and the hosted COPY patch is unapplied.
- **NEEDS-INFO:** LV-036 — clean offline use still removes or hides Library without requesting a document chunk or presenting an error-screen action; exact DOM/ancestor transition requested. The verifier identified its repeated online chunk error as a leftover test-only 503 route; removing that route validates the real reload recovery at `ff4d20f9`, but does not resolve the separate clean blank state. LV-017 — narrow hosted-package exception unanswered. **NEEDS-DECISION:** LV-028 — shortcut mapping; LV-022 — post-save prose versus saved-result presentation; LV-003 — expired-invite HTTP semantics; LV-012 — automatic Bridge discovery versus explicit activation. **CANNOT-REPRODUCE:** LV-004 — original invitation encoding artifact, decoded token works; LV-007 — idle versus pending confirmation, whose pending controls remain disabled.
- No OPEN, REOPENED or FIXING entry remains. LV-037 is FIXED and the verifier has offline/repeated-retry/reconnect checks; LV-036 is unresolved as NEEDS-INFO. Stop between tasks as requested and resume when actionable evidence arrives. No backend sync, deployment, codegen, production-data or environment changes occurred.

## Fixer assessment closeout · LV-036 detached AppShell

- This assessment preserves the verifier's four clean no-route reproductions and the DOM removal evidence, and records source inspection plus a narrow auth-callback/RSC-request question. No runtime code or dependencies changed. Preceding implementation/audit commits remain `ac9167eb` and `9f1bff60` (LV-037); `ff4d20f9` only corrects the separately confirmed chunk-error recovery action. Commits use the human Git identity without AI attribution/co-author trailers.
- Latest full suite remains **4,459 passed, 13 failed, 1 skipped**; **503 passed files, 6 failed, 1 skipped** (510 files). Twelve backend/native/document failures subsequently pass **134/134** across all five affected files with one worker and unchanged assertions/time limits; LV-017 hosted packaging remains unresolved. LV-037 focused **33/33**, both TypeScript projects, lint and all five gates passed. No full-suite rerun was needed for this documentation-only assessment; logs remain in the preceding closeout.
- **NEEDS-INFO:** LV-036 — actual AppShell removal is reproduced, but the ancestor's refresh/route-data transition is not identified; remaining child tags/classes and Clerk callback/RSC-request observations requested. LV-017 — narrow hosted-package exception unanswered. **NEEDS-DECISION:** LV-028 — shortcut mapping; LV-022 — post-save prose versus saved-result presentation; LV-003 — expired-invite HTTP semantics; LV-012 — automatic Bridge discovery versus explicit activation. **CANNOT-REPRODUCE:** LV-004 — invitation encoding artifact, decoded generated token works; LV-007 — idle versus pending confirmation with pending controls disabled.
- No OPEN, REOPENED or FIXING entry remains. LV-037 remains FIXED pending its live retry check, and LV-036 is unresolved as NEEDS-INFO. Stop between tasks as requested, then resume when the requested observation or another actionable ledger issue arrives. No auth/middleware weakening, speculative cache or render fallback, deployment, codegen, production-data or environment change occurred.

## Fixer closeout · account readiness and conversation recovery · 2026-10-01

- Implementation commit: `07cfa20d6df5cd43c12ae50d685488d1163d6084` — retain the prepared shell through temporary token refresh (LV-036), also correcting LV-037's stranded route-host callback. This audit records the hash and final validation. Commits use the configured human Git identity and have no AI attribution or co-author trailer.
- Before/after: **Two regressions fail before**, **22/22 focused tests pass** across storage, account boundary and real conversation host. Both TypeScript projects, full lint and all five gates pass. Existing CRLF endings preserved. Logs: `.spectra-local/LV036-owner-{before,focused,types,lint,gates}.log`.
- Full suite: **4,469 passed, 11 failed, 1 skipped**; **501 passed files, 8 failed, 1 skipped** (510 files), **493.63 seconds**. Ten failures occur in seven unchanged actor-graph/native-document/run/spreadsheet files; all seven subsequently pass **289/289** with one worker and unchanged assertions/time limits (**77.38 seconds**). The remaining failure is LV-017 hosted packaging. Logs: `.spectra-local/launch-fixer-LV036-owner-full.log` and `.spectra-local/LV036-owner-full-failures-recheck.log`. The full suite is not green; the prohibited deployment-configuration patch remains unapplied.
- **NEEDS-DECISION:** LV-028 — shortcut mapping; LV-022 — post-save prose versus saved-result presentation; LV-003 — expired-invite HTTP semantics; LV-012 — automatic Bridge discovery versus explicit activation. **CANNOT-REPRODUCE:** LV-004 — original invitation encoding artifact, decoded generated token works; LV-007 — idle versus pending confirmation with pending controls disabled. **NEEDS-INFO:** LV-017 — narrow hosted-package exception unanswered. No pending decision was assumed.
- LV-036 and LV-037 are FIXED pending live recheck; only the verifier sets VERIFIED. The verifier received the committed hash, frontend-only reload instructions, clean cold Library/auth-refresh checks and repeated-offline-Retry/reconnect conversation checks. No OPEN, REOPENED or FIXING entry remains. Stop between tasks as requested. No auth/server authorization weakening, backend sync, deploy, codegen, production-data or environment changes occurred.

### LV-039 · AI runs fail to return requested results on School and chat surfaces

- **Status:** NEEDS-INFO
- **Severity:** High
- **Surface / role:** /school page-scoped AI composer and /chat artifact creation, Retry and Stop / signed-in Profile A school administrator
- **Report script:** P3-AI-ENGINE · Document, Sheet, Presentation and Whiteboard create/recovery; free exploration · first-week school administrator, School page AI composer
- **Commit tested:** 628f4987 (latest local app recheck on port 3000; earlier commits are recorded below)
- **Frequency:** The School prompt failed with HTTP 500 in 2 of 3 submissions; the third clean repeat returned HTTP 200 and a completed short answer. The four document create/retry actions all produced no visible requested document. The latest clean repeat returned HTTP 200 from the prompt POST, followed by HTTP 500 from overview and runEvents reads. On app commit 94a44078, another fresh no-context document-create sequence required two submissions: the first POST returned HTTP 500; the second returned HTTP 200, followed by three HTTP 500 runEvents reads and a visible failed/paused state. The latest two clean zero-context Moon submissions had one POST HTTP 500 with no reply and one POST HTTP 200 with a relevant reply; the failed prompt disappeared on reload and the successful chat remained titled “New conversation.” On 7407840f, a fresh Moon answer completed with one POST HTTP 409 (`ui_observer`) and one runTabs HTTP 500; a separate weather answer and follow-up completed despite one POST HTTP 500. A clean budget-sheet create remained in progress through three online HTTP 500 reads and paused after reload; its Retry remained in progress for about 4m46, and one Stop request returned HTTP 409. Library showed no new sheet row.

**Steps**
1. At 1280×720 in saved Profile A, with the browser online and no active route rules, open http://localhost:3000/school.
2. Enter “Reply with one short sentence confirming this temporary route-panel check.” in the “Ask Spectra from this page…” field, activate “Send command,” and wait 9 seconds. Reload /school online and repeat once.
3. In /chat, start a fresh chat with 0 context objects selected. Enter “Create a document on the causes of WW1 with 4 sections. Title it LV-038 Route Preview Layout Check.” and activate “Send command.”
4. Wait 18 seconds; inspect the assistant result and document-open controls. Retry the earlier failed create once when its Retry action is offered, then inspect the result again.

**Expected:** P3-AI-ENGINE · Document · Create asks: “Create a document on the causes of WW1 with 4 sections.” The request should produce a four-section document that can be opened. The ordinary School-page chat prompt should return a short assistant sentence.

**Actual:** Both initial /school submissions returned HTTP 500 from POST /api/spectra/run while navigator.onLine remained true; no assistant answer or Retry control appeared, and the global offline message stayed absent. The failed School conversation panel showed the submitted prompt and a “Saved progress and results” card. A third clean /school repeat, submitted at 2026-10-01 02:05:35 UTC, returned HTTP 200 and displayed a 106-character confirmation answer; its final run card status was completed. For /chat document creation, the initial POST returned HTTP 500; its Retry returned HTTP 200 without a visible document. A later clean create produced two POST HTTP 200 responses alongside two HTTP 500 console errors and no four-section result after 18 seconds. In the latest clean no-context create, the prompt-bearing POST /api/spectra/run returned HTTP 200 at 02:14:38 UTC. Later GET /api/spectra?action=overview returned HTTP 500 at 02:14:48 UTC and GET /api/spectra?action=runEvents returned HTTP 500 at 02:14:49 UTC. Both responses had code INTERNAL_ERROR and message “Spectra could not finish this request. Check your connection, then try again.”; request IDs are in the verifier follow-up below. At the 18-second check the page remained visibly in Thinking and showed “Saved progress and results”; no Stop or Retry control, four-section result, editable document surface, or artifact-open control appeared. The unique title was present only in the submitted prompt. At 02:17:53 UTC, a later runEvents GET returned HTTP 200 with one error event and card status failed, but the page did not render the error or a Failed label. After a 02:33:49 UTC reload, the page still showed “Saved progress and results” without Thinking, Paused or Failed text, Stop/Retry control, editable document surface or artifact-open control. The browser remained online; the exact offline banner, visible offline text and visible “Check your connection” copy were absent. The normal Moon question did stream a relevant answer without console errors. Across the instrumented failures there were no unhandled rejections or window errors.

**Evidence:** .spectra-local/live-verification/LV-039-ai-run-observations-d5a53285-redacted.txt; .spectra-local/live-verification/LV-039-ai-run-500-d5a53285-redacted.png; .spectra-local/live-verification/LV-039-clean-repeats-20261001-redacted.txt; .spectra-local/live-verification/LV-039-document-repeat-prompt-redacted.png; .spectra-local/live-verification/LV-039-document-repeat-progress-card-redacted.png; .spectra-local/live-verification/LV-039-document-repeat-after-reload-prompt-redacted.png; .spectra-local/live-verification/LV-039-document-repeat-after-reload-progress-redacted.png.


**Fixer investigation / live question (2026-10-01):** Read the P3-AI-ENGINE report and traced run admission, stream reporting and durable run polling. Existing local logs show broad Convex 1-second execution timeouts (including run reporting, runTabs/runEvents and replicas reads) plus selectTab optimistic-concurrency retries, but the initial plain HTTP 500 responses lack a correlated error body/stage. This is insufficient to identify the root cause of the reported failed submission; no provider/model/context changes or speculative retry were made.

**Question for verifier:** On one clean online repeat of the School prompt and the document-create prompt, capture UTC request times, the failed response's sanitized plain-text body/error code and any request-ID correlation, and the final visible run state after it stops (or remains running). Also distinguish which URLs emitted the later HTTP 500 errors, whether an actual stream error arrived, and whether any empty document shell was created. Redact credentials and user content; do not print headers/tokens. These observations will tie the existing server logs to the failed boundary. NEEDS-INFO until the failure boundary is identified.

**Verifier response (2026-10-01; application code d5a53285; documentation HEAD b13c9599):**

1. **School clean repeat.** In saved Profile A at 1280×720 with no route overrides and navigator.onLine=true, I submitted the exact School prompt once at 02:05:35 UTC. The prompt-bearing POST /api/spectra/run returned HTTP 200 at 02:05:38 UTC with application/x-ndjson; charset=utf-8. The response exposed a run_created event; subsequent runEvents reads returned HTTP 200, including text_replace and final. The final card status was completed; a visible 106-character answer matched the requested confirmation. No offline banner or visible offline text appeared. This is one successful clean repeat after the two previously recorded School failures; the successful response had no error code or request ID.

2. **Document clean repeat.** In a fresh /chat with 0 context objects selected, I submitted “Create a document on the causes of WW1 with 4 sections. Title it LV-039 Verifier repeat 2026-10-01.” once at 02:14:36 UTC. The prompt-bearing POST /api/spectra/run returned HTTP 200 at 02:14:38 UTC. The later GET /api/spectra?action=overview returned HTTP 500 at 02:14:48 UTC with error.code=INTERNAL_ERROR, error.status=500, error.requestId=7c5d2c3c, and error.message="Spectra could not finish this request. Check your connection, then try again." The later GET /api/spectra?action=runEvents returned HTTP 500 at 02:14:49 UTC with the same code/message and error.requestId=6628247b. The request URLs are recorded with run/thread identifiers omitted. The prompt POST returned a 57-character NDJSON body with no error marker; no final run event was observed before the later runEvents request failed.

3. At the 18-second check, completed at 02:15:16 UTC, the visible page remained in Thinking and showed Saved progress and results. No Stop or Retry control, four-section content, editable document surface, or artifact-open control was visible. The unique title appeared in the submitted prompt only. The browser remained online; neither the exact offline message nor the response’s “Check your connection” wording appeared in the visible page. The browser recorded failed-resource errors for the overview and runEvents HTTP 500 responses.

4. At 02:17:53 UTC, a later runEvents GET returned HTTP 200 with one event of type error. The event card status was failed; its message and card summary were “The remaining step could not be completed.” There was no error code or request ID in that event. After reloading at 02:33:49 UTC, the chat still showed Saved progress and results, with no visible Failed label, Thinking or Paused state, Stop/Retry control, editable document surface or artifact-open control. The browser remained online and the offline message remained absent.

**Follow-up evidence:** .spectra-local/live-verification/LV-039-clean-repeats-20261001-redacted.txt; .spectra-local/live-verification/LV-039-document-repeat-prompt-redacted.png; .spectra-local/live-verification/LV-039-document-repeat-progress-card-redacted.png; .spectra-local/live-verification/LV-039-document-repeat-after-reload-prompt-redacted.png; .spectra-local/live-verification/LV-039-document-repeat-after-reload-progress-redacted.png.

**Additional verifier occurrence (2026-10-01; application commit 104ac5e8):**

1. In saved Profile A at desktop 1280×720, with `navigator.onLine=true`, start a fresh `/chat` with 0 context objects selected.
2. Submit “Create a detailed 4,000-word document about the causes of World War I with four sections and a conclusion.”
3. Wait for the run, inspect the visible response and controls, then reload and inspect the chat title and result.

**Expected:** P3-AI-ENGINE · Document · Create asks for “Create a document on the causes of WW1 with 4 sections.”; the requested multi-section document should be returned and openable. The Stop-and-steer script says, “The partial must disappear, with no spinner left and no write.”

**Actual:** After waiting and reloading, the visible chat showed the submitted prompt and a “Saved progress and results” card, with no assistant reply, document editor or visible artifact-open control. The header remained “New conversation.” The recent-chat row subtitle was truncated as “New document · New docume…”; the screenshot alone did not establish whether a document shell was empty or contained content. No Stop control or active stream was available to interrupt. The browser remained online; the exact offline banner and visible “Check your connection” copy were absent. Before reload, the Playwright console reported HTTP 500 for GET `/api/spectra?action=overview` and GET `/api/spectra?action=runEvents`. Query values and run identifiers are omitted. The response body, request IDs and a server-log correlation were not captured for this repeat.

**Additional evidence:** `.spectra-local/live-verification/LV-039-long-create-stop-neighbor-104ac5e8-redacted.txt`; `.spectra-local/live-verification/LV-039-long-create-stop-neighbor-104ac5e8-redacted.png`.

**Correlated fixer investigation (2026-10-01):** The latest document run's scheduled worker entered intake at 02:14:40 UTC and logged spectra.run.failure at 02:14:44.008 UTC. Its Convex mutation request `eabba4afbf830c75` timed out at the platform's 1-second execution limit; commitStarted=false, publicTextLength=0, and planning/resolve/gather/act/verify were skipped. The exact function name is absent from the timeout stack. Source inspection places early createPending shell allocation in this intake interval, but that call is an inference, not a confirmed backend function record. The recorded overview `7c5d2c3c` and runEvents `6628247b` HTTP 500s occur afterward; later event reads returned HTTP 200 at 02:14:51/52. This establishes a worker failure before planning, rather than simply slow model generation; it does not establish why the mutation exceeded its limit or whether final failure delivery succeeded.

- Validation: **9/9** existing real Convex artifact-creation scope tests pass, covering exact allocation/write authority and ownership. No test assertion/limit was changed, and no runtime patch was made. Log: `.spectra-local/LV039-creation-scope-focused.log`.
- Remaining live question: Observe the existing disposable run after its worker has settled/reload, without a new submission: final status, Retry, and empty artifact-shell presence; sanitized later runEvents error/final/card-status facts. If the owned local backend execution-log UI exposes request `eabba4afbf830c75`, record exact function name/duration/error only, without credentials/configuration changes. NEEDS-INFO remains until allocation/runtime failure and terminal-state delivery are distinguished. No guessed model, context, provider or retry change was made.
**Concrete recovery-display correction (fixer, 2026-10-01):** The later long-create worker failed during intake at 06:01:32.843 UTC with mutation request `ff802199da3a0c38` timing out at 1 second. A bounded read-only query of the owned instance-8 backend confirmed its durable run is failed/retryable, its result card is Paused with a Retry action, and its terminal error event carries a stale queued card. Reads used only the verified loopback deployment; no database/configuration changes or AI submission occurred, and only sanitized status/action facts were printed. The old backend execution record was no longer available in the current log page, so the exact timed-out function remains unconfirmed.

- Recovery display root: Thread detail intentionally omits historical traces and its active-execution projection drops terminal runs. ConversationSurface left the latest unanswered request behind a generic Show details disclosure after that projection became null, so a saved retryable failure could remain invisible after reload or a live-to-terminal transition.
- Correction: For the selected thread's latest run, when its last message is the unanswered user request and the authoritative active-execution projection is null, reuse the existing bounded trace loader once. Its existing failure/partial-result components show the saved outcome and Retry; completed answers and older history remain on demand. Failed trace reads retain the existing explicit Try again action and do not form an automatic request loop. Shared callers include chat, workspace and route-side conversations.
- Before/after: The restored failure/Retry test fails before the change; **18/18 focused tests across two files pass**, including live-to-terminal transition, failed-read explicit retry, existing thread-switch fences/history and real Convex creation authority. Both TypeScript projects and all five gates pass; full lint and full suite are completing. Logs: `.spectra-local/LV039-recovery-{before,focused-final}.log`, `.spectra-local/LV039-{types,lint,gates}.log`, `.spectra-local/LV039-durable-state-probe.log`.
- Remaining root-cause work: The underlying intake mutation timeout is still unresolved. This correction restores the durable recovery state and does not claim document generation is fixed. After a committed hash, frontend reload only: reopen the existing failed document conversation, verify its saved pause/failure and Retry are visible without Show details; verify ordinary completed answers still use on-demand history. No backend sync, deploy or codegen needed.
- Recovery-display commit: `96f3b05d2e1abf24d4ccd4f2a190c4601953f28b`. Full lint also passes; full-suite validation is running. LV-039 remains NEEDS-INFO for the exact intake mutation timeout, with the display correction ready for frontend-only recheck.

**Verifier post-fix recheck (2026-10-01; application code 96f3b05d):**

1. Reload the frontend in saved Profile A and reopen the existing failed 4,000-word document-create conversation from the recent-chat row, without submitting another prompt.
2. Inspect the settled run state and available actions without opening Show details or activating Retry.
3. Reopen the completed “Why can we see the Moon?” conversation and reload it to check completed history.

**Expected:** The saved paused/failure state and Retry action are visible without Show details; a completed chat answer remains visible after reopen/reload.

**Actual:** The failed conversation showed “Spectra paused this run,” “The remaining step could not be completed.” and a visible Retry button without Show details. The prompt remained visible, but no generated document/editor was visible. Retry was not activated and no new AI request was submitted. The completed Moon answer remained visible after reopen/reload. On the first fresh `/chat` route load in this recheck, the browser console recorded HTTP 500 for GET `/api/spectra?action=runTabs&limit=120&surface=chat`; after the later completed-chat reload the console had 0 errors and 1 Clerk development-key warning. No response body or request ID was captured for that runTabs error.

**Verifier evidence:** `.spectra-local/live-verification/LV-039-postfix-recheck-96f3b05d-redacted.txt`; `.spectra-local/live-verification/LV-039-postfix-paused-retry-96f3b05d-redacted.png`; `.spectra-local/live-verification/LV-039-postfix-error-card-96f3b05d-redacted.png`.

**Verifier recheck on current application commit (2026-10-01; 28f82f36):**

1. Reopen the existing settled 4,000-word document-create conversation in saved Profile A at 1280×720.
2. Inspect the saved run without submitting another prompt, opening Show details, or activating Retry.

**Expected:** P3-AI-ENGINE · Document · Create asks: “Create a document on the causes of WW1 with 4 sections.”; the requested document should be returned and openable.

**Actual:** The saved prompt remained visible. The settled run showed “Spectra paused this run,” “The remaining step could not be completed.” and a visible Retry button without Show details. No generated document, editable document surface, or artifact-open control was visible. Retry was not clicked and no new AI request was submitted. The browser remained online; Playwright recorded 0 console errors and 1 Clerk development-key warning.

**Verifier evidence:** `.spectra-local/live-verification/LV039-current-28f82f36-redacted.txt`; `.spectra-local/live-verification/LV039-current-28f82f36-failed-chat.png`.

**Additional verifier occurrence (2026-10-01; application commit 94a44078, local app on port 3000):**

1. In saved Profile A at desktop 1280×720, open a fresh `/chat` with 0 context objects selected and submit “Create a document on the causes of WW1 with 4 sections.”
2. Wait 20 seconds. With the prompt still available in the composer and no assistant response visible, submit the same prompt once more.
3. Inspect the settled conversation and Live Dock. Search Library for “Causes of World War,” then reload the chat and inspect the saved state.

**Expected:** P3-AI-ENGINE · Document · Create asks: “Create a document on the causes of WW1 with 4 sections.”; the requested four-section document should be returned and openable.

**Actual:** The first prompt-bearing POST `/api/spectra/run` returned HTTP 500 at 13:19:16 UTC. The second prompt-bearing POST returned HTTP 200 at 13:21:55 UTC, followed by three GET `/api/spectra?action=runEvents` HTTP 500 responses at 13:22:03, 13:22:32 and 13:22:35 UTC. The Playwright CLI exposed no response content for those failed requests and no request-ID header, so no request-ID correlation or raw stream-error payload was available. After waiting, the chat showed “Spectra could not complete this request” and “The remaining step could not be completed.” The Live Dock showed “Could not finish” and “12 blocks formed in the live artifact”; another card showed “Paused” and “The run was interrupted before changes were applied and can be retried safely.” No four-section document editor or openable new document appeared. Library search showed the new chat plus two older matching Document rows, but no newly saved Document row for this run. After reload, the submitted prompt and failure card remained. `navigator.onLine` was `true`, and no offline-status banner was visible. The browser console recorded one failed POST and three failed runEvents requests before reload; after reload it had 0 errors and 1 Clerk development-key warning.

**Additional verifier evidence:** `.spectra-local/live-verification/LV039-current-create-94a44078-redacted.txt`; `.spectra-local/live-verification/LV039-current-create-94a44078-after-reload.png`; `.spectra-local/live-verification/LV039-current-create-library-search-94a44078.png`.

## Fixer assessment closeout · LV-036 authenticated-read residual · 2026-10-01

- Commits for the prior actual fix: `07cfa20d` — account-readiness shell continuity; `d11cec6c` — final validation/audit. This assessment preserves the verifier's new evidence and requests narrowly sanitized auth/socket observations. No new runtime code changed; configured human Git identity with no AI attribution.
- Installed real SDK model probe passes; this establishes a possible terminal token-fetch-null lifecycle while the live residual remains unconfirmed. Latest full suite remains **4,469 passed, 11 failed, 1 skipped**, with all seven unchanged files containing ten failures subsequently passing **289/289** in isolation; LV-017 hosted packaging is unresolved. Both TypeScript projects, lint, all five gates and **22/22 focused tests** passed for 07cfa20d. Documentation-only assessment requires no repeated full run.
- **NEEDS-INFO:** LV-036 — mounted Library remains loading even after online reload; need token/socket/membership observations to distinguish the remaining boundary. LV-017 — prohibited hosted-package deployment-configuration exception unanswered. **NEEDS-DECISION:** LV-028 — shortcut mapping; LV-022 — post-save prose; LV-003 — expired-invite status; LV-012 — Bridge activation. **CANNOT-REPRODUCE:** LV-004 — invitation encoding artifact, decoded token works; LV-007 — idle versus pending confirmation behavior.
- No OPEN, REOPENED or FIXING issue remains. LV-037 remains FIXED pending verifier recovery check. Stop between tasks as requested; resume when actionable live observations arrive. No subscriptions/auth authorization bypass, parallel row cache, deployment, codegen, production-data or environment changes occurred.

## Fixer closeout · token transport recovery · LV-036 · 2026-10-01

- Implementation commit: `fb6725a679cf8ae533f7a1090cdae84fbd6e1d95` — recover transient Clerk token transport failures within the existing Convex integration; this audit records the final result. Existing human Git identity, no AI attribution/co-author trailers. Earlier `07cfa20d` fixes the separate mounted-shell readiness gate; no history rewritten.
- Before/after: **Three regressions fail before**; **34/34 focused tests across four files pass**, including 11 tests through the installed Clerk adapter plus existing account isolation, membership skip and conversation recovery. Both TypeScript projects, full lint and all five gates pass; the staged secret scan includes **3,324 files**. CRLF endings preserved. Logs: `.spectra-local/LV036-token-{before,focused-final,types-complete,lint-complete,gates-final}.log`.
- Full suite: **4,487 passed, 4 failed, 1 skipped**; **506 passed files, 4 failed, 1 skipped** (511 files), **377.80 seconds**. Three failures occur in unchanged account-erasure lifecycle, DOCX performance and Stop-route tests; all three files subsequently pass **116/116** with one worker and unchanged assertions/time limits (**46.98 seconds**). The fourth is pending LV-017 hosted packaging. Logs: `.spectra-local/launch-fixer-LV036-token-full.log` and `.spectra-local/LV036-token-full-failures-recheck.log`. Full suite is not green; prohibited deployment edits remain unapplied.
- **NEEDS-DECISION:** LV-028 — shortcut mapping; LV-022 — post-save prose versus saved-result presentation; LV-003 — expired-invite HTTP semantics; LV-012 — automatic Bridge discovery versus explicit activation. **CANNOT-REPRODUCE:** LV-004 — original invitation encoding artifact, decoded generated token works; LV-007 — idle versus pending confirmation with pending controls disabled. **NEEDS-INFO:** LV-017 — narrow hosted-package deployment-configuration exception unanswered. No pending decision was assumed.
- LV-036 is FIXED pending repeated clean cold-context verification; LV-037 is FIXED pending its related recovery check. The verifier received `fb6725a6`, frontend-only reload instructions and the offline token-refresh/reconnect/online-open/persistence and reload checks. Only the verifier sets VERIFIED. No OPEN, REOPENED or FIXING issue remains; stop between tasks as requested. No model/context constraints, auth/membership bypass, row cache, node_modules edits, backend sync, deployment, codegen, production-data or environment changes occurred.

## Fixer validation · Core 2 offline-null recovery · LV-036 · 2026-10-01

- Commits: `d3d5baa699b9133db7e6655b001ee715a0caa9b8` — recheck the legacy offline-null token and typed network-error contracts; this audit records validation and the next ledger task. Human Git identity, no AI attribution/co-author trailers. Four regressions fail before; **38/38 focused tests**, both TypeScript projects, full lint and all five gates pass.
- Full suite: **4,445 passed, 50 failed, 1 skipped**; **485 passed files, 25 failed, 1 skipped** (511 files), **777.23 seconds**. All 24 failed files other than LV-017 hosted packaging were rerun with one worker and original assertions/limits: **458 passed, 1 failed** (459 tests; 23 passed files, 1 failed), **352.13 seconds**. Remaining spreadsheet dense-cell performance test also fails alone: **76 passed, 1 failed** in its file; the 40 ms limit is unchanged. Full result is not green, and this remaining performance failure is not claimed resolved. Logs: `.spectra-local/launch-fixer-LV036-null-full.log`, `.spectra-local/LV036-null-full-failures-recheck.log`, `.spectra-local/LV036-null-sheets-recheck.log`.
- LV-036 is FIXED pending the repeated 75-second cold-context recheck of `d3d5baa6`. LV-037 is now VERIFIED by the live verifier: its original Try again opens the actual conversation after reconnect. LV-038 is OPEN and is the next code task: route-side panel width and clipping. No runtime changes for LV-038 were made during the preceding full or isolated runs.
- Pending decisions remain LV-028 (shortcut mapping), LV-022 (post-save prose), LV-003 (expired-invite HTTP semantics), LV-012 (Bridge activation); CANNOT-REPRODUCE remains LV-004 (invitation encoding artifact) and LV-007 (idle/pending confirmation); LV-017 remains NEEDS-INFO for the prohibited hosted-package deployment-configuration exception. No option assumed or deployment change made.

## Fixer closeout · route panel sizing · LV-038 · 2026-10-01

- Implementation commit: `d5a532856911ae2b5457d5ed42f87e5a8b7cb5d1` — size route previews against the real canvas content box, retaining the shared cap, workbench reserve and overlay allocation. This audit commit records the hash and final validation. Configured human Git identity; no AI attribution or co-author trailer.
- Before/after: Seven regressions fail before their respective corrections; **41/41 focused tests** pass across four files, including five isolated production-CSS Chromium measurements and actual shared-shell fitting/dragging. Both TypeScript projects, full lint and all five gates pass. Existing CRLF endings preserved. Logs: `.spectra-local/LV038-{before,padding-before,overlay-before,focused-final,types-final,lint-final,gates-final}.log`.
- Full suite: **4,505 passed, 1 failed, 1 skipped**; **511 passed files, 1 failed, 1 skipped** (513 files), **1,499.58 seconds**. All tests ran with one worker and unchanged assertions/timeouts. The only failure is LV-017 hosted Docker packaging omitting `shared/yjs-collections.mjs`; the prohibited deployment-configuration patch remains unapplied. The prior spreadsheet performance failure passes in this run. Full suite is not green. Log: `.spectra-local/launch-fixer-LV038-full.log`.
- **NEEDS-DECISION:** LV-028 — shortcut mapping; LV-022 — post-save prose latency/usage versus saved-result presentation; LV-003 — expired-invite HTTP semantics; LV-012 — automatic Bridge discovery versus explicit activation. **CANNOT-REPRODUCE:** LV-004 — original invitation encoding artifact, decoded generated token works; LV-007 — idle versus pending confirmation behavior, with pending controls disabled. **NEEDS-INFO:** LV-017 — narrow hosted-package deployment-configuration exception unanswered. No pending option was assumed.
- No OPEN, REOPENED or FIXING entry remains. LV-036 and LV-037 are VERIFIED by the live verifier; LV-038 is FIXED pending its desktop recheck. The verifier received the hash and frontend-only readable-width, drag, close/reopen, artifact-preview and nearby split/overlay checks. Stop between tasks as requested. No deployment, codegen, production-data, environment, model/context or dependency changes occurred.

## Fixer assessment closeout · LV-037 and LV-039 · 2026-10-01

- This assessment preserves the verifier's LV-038 VERIFIED evidence, LV-037 reconnect residual and new LV-039 AI failure report, and adds narrow live questions. No runtime changes or dependencies were changed. Both issues are NEEDS-INFO pending correlated failure-boundary observations, not claimed resolved.
- LV-037: six existing real-host recovery cases pass, then all six pass again using the actual studio-state hook. The temporary diagnostic substitution was restored byte-for-byte. The browser's two failed reconnect trials remain authoritative evidence of an unresolved residual; their clicked notice identity and request/host transition are still unknown. LV-039: inspected admission, stream reporting and durable polling plus local logs; broad Convex timeouts are observed, but the initial HTTP 500 body/stage is not correlated.
- Latest full suite remains **4,505 passed, 1 failed, 1 skipped** (511 passed files, 1 failed, 1 skipped; 513 files). Sole failure is LV-017 hosted packaging; deployment-configuration changes remain prohibited. No full-suite rerun was needed for this documentation-only assessment. Application/audit commits remain `d5a53285` and `b13c9599`; this assessment commit uses configured human Git identity without AI attribution.
- **NEEDS-DECISION:** LV-028 — shortcut mapping; LV-022 — post-save prose latency/usage versus saved-result presentation; LV-003 — expired-invite HTTP semantics; LV-012 — automatic Bridge versus activation. **CANNOT-REPRODUCE:** LV-004 — original invitation encoding artifact, decoded generated token works; LV-007 — idle versus pending confirmation, pending controls disabled. **NEEDS-INFO:** LV-037 — exact clicked notice, request outcome and host continuity; LV-039 — correlated HTTP 500 body/stage and final run/result state; LV-017 — prohibited hosted-package exception unanswered.
- No OPEN, REOPENED or FIXING entry remains. Stop between tasks as requested and resume when the verifier supplies actionable evidence. No provider/model/reasoning/context constraints, speculative mechanisms, backend sync, deployment, codegen, production-data or environment changes occurred.

## Fixer assessment closeout · LV-039 correlated timeout · 2026-10-01

- This assessment preserves the successful third School submission and the latest failed document run, correlates its pre-planning Convex mutation timeout, and requests the exact backend function record plus final recovery state. No runtime code changed; **9/9** real creation-scope tests pass. LV-039 remains NEEDS-INFO. Prior assessment commit: `80d12991`; this follow-up uses the configured human Git identity without AI attribution.
- Latest full suite remains **4,505 passed, 1 failed, 1 skipped** (511 passed files, 1 failed, 1 skipped; 513 files). Sole failure: LV-017 hosted packaging, whose deployment-configuration exception is unanswered. No full-suite rerun was needed for this documentation-only investigation.
- **NEEDS-DECISION:** LV-028 shortcut mapping, LV-022 post-save prose latency/usage, LV-003 expired-invite HTTP semantics, LV-012 Bridge activation. **CANNOT-REPRODUCE:** LV-004 original invitation encoding artifact, decoded token works; LV-007 idle versus pending confirmation, pending controls disabled. **NEEDS-INFO:** LV-037 clicked notice/request/host continuity, LV-039 exact timed-out mutation and terminal recovery delivery, LV-017 prohibited hosted-package exception. No option assumed.
- No OPEN, REOPENED or FIXING issue remains. Stop between tasks as requested; resume when actionable observations arrive. No deployment, codegen, production-data, environment, dependency or AI capability changes occurred.


**Additional verifier occurrence (2026-10-01; application commit 628f4987):**

1. In saved Profile A at desktop 1280×720, start a fresh `/chat` with 0 context objects selected and submit “Why can we see the Moon?”
2. Inspect the chat header, visible answer, browser console and `POST /api/spectra/run` result. With `navigator.onLine=true`, reload the page and inspect whether the prompt or a thread appears.
3. Submit the same prompt once from the blank chat, wait up to 10 seconds, and inspect the answer, title and recent-chat row. Reload and inspect again.

**Expected:** P3-AI-ENGINE · Answer, step 1 says: “Why can we see the Moon?” It expects one model call and streamed text with no IDs. The browser-visible route result does not expose the provider-call count.

**Actual:** The first clean submission returned HTTP 500 from `POST /api/spectra/run`. The page remained a blank “New conversation” with no assistant response or thread title, while the prompt remained in the composer. After reload, the prompt was absent and the page remained blank. The second submission returned HTTP 200 and produced a relevant Moon answer within about 10 seconds, with no visible IDs. After completion and reload, the answer remained but both the header and recent-chat row still read “New conversation” (the title occurrence is tracked under LV-040). The browser was online; the first failed attempt recorded one console error for the 500, and the successful answer recorded no console errors before reload.

**Evidence:** `.spectra-local/live-verification/LV039-moon-current-628f4987-redacted.txt`; `.spectra-local/live-verification/LV039-moon-current-628f4987-no-response.png`; `.spectra-local/live-verification/LV039-moon-current-628f4987-after-reload.png`; `.spectra-local/live-verification/LV040-current-628f4987-answer-title.png`; `.spectra-local/live-verification/LV040-current-628f4987-answer-title-after-reload.png; .spectra-local/live-verification/LV040-new-chat-title-after-reload-628f4987.png; .spectra-local/live-verification/LV040-moon-title-628f4987-redacted.txt`.

**Fixer assessment of the additional Moon occurrence (2026-10-01):** The sanitized browser evidence confirms an online first-submit HTTP 500 with no created conversation visible, followed by a successful retry; it does not identify the failing server function or error stage. Existing instance-8 stack stdout/stderr logs end before this occurrence, so they cannot correlate it. LV-039 remains NEEDS-INFO: on the next naturally failed submission, capture the UTC time plus sanitized response body/request correlation or current web-server error, if available, without credentials or environment values. No speculative intake/provider retry, model restriction or title behavior is introduced.
**Additional verifier occurrence (2026-10-01; application code 628f4987; document create and Retry):**

**Steps**
1. In saved Profile A on the local app at port 3000, open a fresh /chat with 0 context objects selected.
2. Submit "Create a document on the causes of WW1 with 4 sections. Title it LV039 live reliability retest October 1 2026." and wait for the run to settle.
3. Inspect the run status, document-open controls and Library; reload the same chat and inspect it again.
4. Search Library for the exact requested title with Document selected.
5. Activate Retry once from the paused card; wait for the run to settle, reload the chat and search Library for the exact title again.

**Expected:** The P3-AI-ENGINE script says: “Create: "Create a document on the causes of WW1 with 4 sections."”

**Actual:** The initial submission returned three HTTP 200 responses from POST /api/spectra/run at 15:38:24.674Z, 15:38:26.840Z and 15:38:26.967Z. Before later reads returned HTTP 200, four GET /api/spectra?action=runEvents requests returned HTTP 500 INTERNAL_ERROR (request IDs 5f84d073, 95e5cfa0, dd74ceca and e297a49f) and one overview read returned HTTP 500 INTERNAL_ERROR (950d7a95). The page showed “Chat context could not load,” then “Spectra paused this run” and “The remaining step could not be completed”; reload retained Retry. navigator.onLine was true after reload, and no document editor or open control was visible. The exact-title Library query showed no matching Document row. After one Retry, the UI briefly showed resumed/document progress, then paused again; one runEvents read returned HTTP 500 INTERNAL_ERROR (8c8deff4), reload retained the paused state, and another exact-title query showed no matching Document row. The chat title was visible as “LV039 live reliability retest.” The browser console had 1 error before reload and 0 afterward, with 1 Clerk development warning.

**Frequency:** 1 of 1 fresh create run paused; 1 of 1 Retry returned to the paused state.

**Evidence:** .spectra-local/live-verification/LV039-document-create-628f4987-redacted.txt; .spectra-local/live-verification/LV039-document-create-running-628f4987.png; .spectra-local/live-verification/LV039-document-create-after-reload-628f4987.png; .spectra-local/live-verification/LV039-library-search-exact-title-628f4987.png; .spectra-local/live-verification/LV039-document-create-retry-paused-628f4987.png; .spectra-local/live-verification/LV039-document-create-retry-after-reload-628f4987.png; .spectra-local/live-verification/LV039-library-document-filter-after-retry-628f4987.png.

**Commit tested:** Application code 628f4987; local web app on port 3000.

**Additional verifier occurrence (2026-10-01; application code 7407840f; clean chat requests):**

**Steps**
1. In saved Profile A at 1280×720, with `navigator.onLine=true`, open a fresh `/chat` with 0 context objects selected.
2. Submit “Why can we see the Moon?” and wait for the final response.
3. Inspect the browser console and network statuses after the answer appears.
4. In a separate fresh zero-context chat, submit “What is the difference between weather and climate? Answer in one sentence.”, wait for the answer, then submit “Add one example that shows how a local forecast differs from a climate average.”

**Expected:** The P3-AI-ENGINE Answer step 1 script says: “Expect one model call and streamed text with no ids.”

**Actual:** The fresh Moon question received a relevant final answer. During that run, one `POST /api/spectra/run` with request action `ui_observer` returned HTTP 409 with no readable response body, and one `GET /api/spectra?action=runTabs` returned HTTP 500, code `INTERNAL_ERROR`, request ID `af14ec59`, with “Spectra could not finish this request. Check your connection, then try again.” Playwright recorded two failed-resource console entries for the trial. The browser remained online, and no offline banner or offline text appeared. A separate fresh weather question and its follow-up both received relevant completed answers, while one `POST /api/spectra` returned HTTP 500 and generated a failed-resource console entry; its request action and request ID were not captured. The CLI request-list recheck confirmed one 409 and one 500 for the Moon trial; the response-event capture initially had duplicate listeners, so duplicate rows were not counted as extra occurrences.

**Frequency:** 1 of 1 fresh Moon response completed with one observed 409 and one observed 500; 1 of 1 separate fresh weather response and its follow-up completed with one additional observed POST 500.

**Evidence:** `.spectra-local/live-verification/LV039-ai-request-errors-7407840f.png`; `.spectra-local/live-verification/LV039-ai-request-errors-7407840f-redacted.txt`.

**Commit tested:** Application code 7407840f; local web app on port 3000; documentation checkout HEAD e5905d99.

**Additional verifier occurrence (2026-10-01; application code 7407840f; budget sheet create, Retry and Stop):**

**Steps**
1. In saved Profile A at 1280×720 with `navigator.onLine=true`, open a fresh `/chat` with 0 context objects selected.
2. Submit the P3-AI-ENGINE sheet prompt: “Make a budget sheet with monthly totals.”
3. Wait while the run is in progress. Open Show details, then inspect the prompt, composer and run state.
4. Reload the chat, activate Retry once, and observe the run for about 4m46.
5. Activate Stop once, inspect the chat state, reload, then search Library for “budget.”

**Expected:** P3-AI-ENGINE · Sheet asks: “Make a budget sheet with monthly totals.” The requested sheet should be returned; a stopped run should leave no active spinner or write.

**Actual:** The browser remained online. The first run showed “Chat context could not load” / “Your messages are available. Work and workspace information could not load. Try again.” and then “Still running” with the composer disabled and no answer. GET overview, runEvents and runTabs each returned HTTP 500 `INTERNAL_ERROR` (request IDs `c171ef94`, `7b37c682`, `23fd2ee6`). After clicking Show details, the progress card disappeared while the prompt remained and the composer stayed disabled. Reload showed “Spectra paused this run” and “The run was interrupted before changes were applied and can be retried safely.” Retry displayed “Thinking” / “Resuming from the last safe point” at 17:17:36 UTC and remained in that state until 17:22:22 UTC, with no answer and no new failed requests or console errors. Stop sent `POST /api/spectra/run` with action `stop` and returned HTTP 409; its response body was not readable and one failed-resource console entry was recorded. The spinner cleared, but the main card showed “Thought” and Retry without a visible “Stopped” label or sheet. Reload restored the paused card and Retry. Library search showed two partial-match “Monthly Budget” rows, each marked “1d ago”; no new sheet row appeared. No offline banner or offline copy appeared.

**Frequency:** 1 of 1 fresh sheet create entered “Still running,” then paused after reload; 1 of 1 Retry remained in progress for about 4m46; 1 of 1 Stop request returned HTTP 409.

**Evidence:** `.spectra-local/live-verification/LV039-budget-sheet-stuck-before-reload-7407840f.png`; `.spectra-local/live-verification/LV039-budget-sheet-paused-after-reload-7407840f.png`; `.spectra-local/live-verification/LV039-budget-sheet-retry-pending-120s-7407840f.png`; `.spectra-local/live-verification/LV039-budget-sheet-after-stop-7407840f.png`; `.spectra-local/live-verification/LV039-budget-sheet-library-search-7407840f.png`; `.spectra-local/live-verification/LV039-budget-sheet-retry-stop-7407840f-redacted.txt`.

**Commit tested:** Application code 7407840f; local web app on port 3000; documentation checkout HEAD e5905d99.

**Additional verifier occurrence (2026-10-01; application code 7407840f; presentation request):

1. In saved Profile A on the local app at port 3000, open a fresh `/chat` with 0 context objects selected and `navigator.onLine=true`.
2. Submit “Make a 6-slide deck on plate tectonics.”
3. Inspect the browser console and request statuses while the run is active; wait 105 seconds, then activate Stop once and inspect after reload.

**Expected:** P3-AI-ENGINE · Presentation · Create asks: “Make a 6-slide deck on plate tectonics.” The requested six-slide presentation should be returned.

**Actual:** The prompt POST returned HTTP 200. The page remained “Still running” / “Thinking” without an assistant answer or presentation editor. The browser response capture recorded 10 `GET /api/spectra?action=runEvents` responses with HTTP 500 and one `GET /api/spectra?action=runTabs` response with HTTP 500; later reads returned HTTP 200. Playwright recorded 11 failed-resource console entries before Stop. After 105 seconds, the page still showed the active run. Stop sent `POST /api/spectra/run` and returned HTTP 409; the UI then showed “Spectra paused this run” with Retry and no visible “Stopped” label. Reload retained the paused state. `navigator.onLine` remained true and no offline banner appeared. The visible activity identified a “live flashcard deck canvas” and “New flashcard deck” during the presentation request; this artifact-type mismatch is tracked separately under LV-049. The response body for Stop was not captured. The user later reported an antivirus alert roughly 20 minutes before their message; no relationship to this browser trial was established.

**Frequency:** 1 of 1 clean presentation create remained without a final answer or presentation editor at 105 seconds; 1 of 1 Stop request returned HTTP 409 and left a paused card after reload.

**Evidence:** `.spectra-local/live-verification/LV039-presentation-create-7407840f-redacted.txt`; `.spectra-local/live-verification/LV039-presentation-create-after-20s-7407840f.png`; `.spectra-local/live-verification/LV039-presentation-create-45s-7407840f.png`; `.spectra-local/live-verification/LV039-presentation-create-75s-7407840f.png`; `.spectra-local/live-verification/LV039-presentation-create-105s-7407840f.png`; `.spectra-local/live-verification/LV039-presentation-after-stop-7407840f.png`; `.spectra-local/live-verification/LV039-presentation-paused-settled-7407840f.png`.

**Commit tested:** Application code 7407840f; local web app on port 3000; documentation checkout HEAD e5905d99.

**Retry recheck (2026-10-01; application code 7407840f):

1. Reload the same paused `/chat` request and wait for the paused card to appear.
2. Activate Retry once and inspect the run card, answer, presentation surface, browser console and request statuses.

**Expected:** Retry should resume the requested presentation run and return a visible result or terminal state.

**Actual:** The Retry `POST /api/spectra/run` returned HTTP 200. Two `GET /api/spectra?action=runEvents` responses returned HTTP 500, followed by a 200 response. In about 3 seconds the UI again showed “Spectra paused this run” with Retry. No presentation editor or assistant answer appeared. The browser remained online. Playwright recorded two failed-resource console entries. No response body for the runEvents failures was captured.

**Frequency:** 1 of 1 Retry attempts returned to the paused state within about 3 seconds.

**Evidence:** `.spectra-local/live-verification/LV039-presentation-retry-paused-7407840f.png`; `.spectra-local/live-verification/LV039-presentation-create-7407840f-redacted.txt`.

**Commit tested:** Application code 7407840f; local web app on port 3000; documentation checkout HEAD e5905d99.

**Additional verifier occurrence (2026-10-01; application code 7407840f; Whiteboard create and recovery):

1. In saved Profile A on the local app at port 3000, open a fresh `/chat` with 0 context objects selected and `navigator.onLine=true`.
2. Submit “Draw a mind map of the water cycle.” and wait for the visible run state.
3. On the paused card, activate Retry once. Observe for 60 seconds, then reload and inspect the run card and available controls.

**Expected:** P3-AI-ENGINE · Whiteboard · Create asks: “Draw a mind map of the water cycle.” The requested whiteboard should be created; an available Retry should resume and reach a visible result or terminal state.

**Actual:** The prompt POST returned HTTP 200. At 23 seconds the page remained “Still running” / “Thinking / Getting ready,” with no whiteboard editor or result. By 53 seconds, it showed “The remaining step could not be completed.” / “Spectra paused this run” with Retry. Four `GET /api/spectra?action=runEvents` responses returned HTTP 500 and four failed-resource console entries were captured; other observed Spectra requests returned HTTP 200. The browser remained online. Retry showed “Thinking / Resuming from the last safe point” at 10 seconds and a planning event at 30 seconds, but by 60 seconds it had paused again without an editor or answer; no HTTP failures or console errors were captured during this retry. After reload it showed “Still running” with “Show details” and no Stop or Retry control for at least 8 seconds; by approximately 25 seconds after reload it showed “Spectra paused this run” with Retry. No offline banner appeared.

**Frequency:** 1 of 1 clean Whiteboard create paused; 1 of 1 Retry returned to Paused within about 60 seconds; after reload the pending state changed to Paused within approximately 25 seconds.

**Evidence:** `.spectra-local/live-verification/LV039-whiteboard-create-retry-7407840f-redacted.txt`; `.spectra-local/live-verification/P3-AI-ENGINE-whiteboard-create-23s-7407840f.png`; `.spectra-local/live-verification/P3-AI-ENGINE-whiteboard-create-53s-7407840f.png`; `.spectra-local/live-verification/P3-AI-ENGINE-whiteboard-retry-10s-7407840f.png`; `.spectra-local/live-verification/P3-AI-ENGINE-whiteboard-retry-30s-7407840f.png`; `.spectra-local/live-verification/P3-AI-ENGINE-whiteboard-retry-60s-7407840f.png`; `.spectra-local/live-verification/P3-AI-ENGINE-whiteboard-after-retry-reload-7407840f.png`; `.spectra-local/live-verification/P3-AI-ENGINE-whiteboard-after-reload-25s-7407840f.png`.

**Commit tested:** Application code 7407840f; local web app on port 3000; documentation checkout HEAD e5905d99.




### LV-040 · Completed AI chats remain titled “New conversation”

- **Status:** NEEDS-DECISION
- **Severity:** Low
- **Surface / role:** `/chat` header and recent-chat list / signed-in Profile A school administrator
- **Report script:** Free exploration · first-week AI chat and chat recovery; the P3 reports do not specify automatic title generation.
- **Commit tested:** `104ac5e8` (original observation); rechecked on `28f82f36` (local app on port 3000).
- **Frequency:** 4 of 4 observed completed AI-response chats retained the generic title in the header; all 3 checked Moon chats also retained it in the recent-chat row after reload.

**Steps**
1. In saved Profile A at desktop 1280×720, open a fresh `/chat` with 0 context objects selected.
2. Submit `Why can we see the Moon?` and wait for the assistant's final response.
3. Inspect the chat header and its recent-chat row, then reload the same chat and inspect both again.

**Expected:** After a chat receives a final response, its header and recent-chat row should show a title that distinguishes it from other completed conversations. This is a free-exploration expectation raised by the user's explicit concern; no P3 report script covers automatic chat titles.

**Actual:** The assistant returned a relevant answer and it remained visible after reload, but the header and recent-chat row both continued to read `New conversation` (the row subtitle was `Inbox`). A separately completed clarification thread on the same commit also retained the generic header title. The browser console showed 0 errors and 1 Clerk development-key warning.

**Evidence:** `.spectra-local/live-verification/LV-040-moon-title-observations-104ac5e8-redacted.txt`; `.spectra-local/live-verification/LV-040-moon-main-104ac5e8-redacted.png`; `.spectra-local/live-verification/LV-040-moon-recent-row-104ac5e8-redacted.png`; `.spectra-local/live-verification/LV-040-moon-main-after-reload-104ac5e8-redacted.png`.

**Additional verifier occurrence (2026-10-01; application commit 28f82f36):**

1. In saved Profile A at desktop 1280×720, open a fresh `/chat` with 0 context objects selected.
2. Submit `Why can we see the Moon?` and wait for the final response.
3. Inspect the header and most-recent sidebar row, then reload the same chat and inspect them again after the transcript returns.

**Actual:** A relevant answer about reflected sunlight and lunar phases appeared. Before reload, the header and most-recent row both read `New conversation` and the row subtitle was `Inbox`. After reload, the prompt and answer remained visible, while the header and row still read `New conversation`; the result area read `Saved progress and results` with `Show details`. The browser remained online; Playwright recorded 0 console errors and 1 Clerk development-key warning.

**Additional evidence:** `.spectra-local/live-verification/LV040-current-28f82f36-redacted.txt`; `.spectra-local/live-verification/LV040-current-28f82f36-answer-and-title.png`.

**Additional verifier occurrence (2026-10-01; application code 628f4987; clean Moon answer):**

**Steps**
1. In saved Profile A on the local app at port 3000, open a fresh /chat with 0 context objects selected.
2. Submit “Why can we see the Moon?” and wait for the answer.
3. Inspect the response, chat header and most-recent sidebar row. Reload the chat and inspect them again.

**Expected:** P3-AI-ENGINE says: “Expect one model call and streamed text with no ids.”

**Actual:** A relevant no-ID answer about reflected sunlight and lunar phases appeared after the visible Thinking state and remained visible after reload. The header and most-recent sidebar row both read “New conversation”; the row subtitle read “Inbox.” The settled page showed 0 console errors and 1 Clerk development warning.

**Frequency:** 1 of 1 clean submissions returned and retained a relevant answer; 1 of 1 completed chat retained the generic header and sidebar row title after reload.

**Evidence:** .spectra-local/live-verification/LV039-moon-first-response-live-rerun-628f4987.png; .spectra-local/live-verification/LV040-new-chat-title-after-reload-628f4987.png; .spectra-local/live-verification/LV040-moon-title-628f4987-redacted.txt.

**Commit tested:** Application code 628f4987; local web app on port 3000.

**Additional verifier occurrence (2026-10-01; application code 7407840f; Code create/edit chat):

1. In saved Profile A at desktop 1280×720, open a fresh `/chat` with 0 context objects selected and `navigator.onLine=true`.
2. Submit “Write a Python script that plots a sine wave.” and wait for the answer.
3. Submit “Rename the function to plot_wave.” and wait for the answer.
4. Inspect the header and most-recent sidebar row, reload the same chat, then inspect the title and both code responses.

**Actual:** Both requests completed with code-block responses and all captured Spectra API requests returned HTTP 200; Playwright recorded 0 errors. The second answer showed a `plot_wave()` function and call. Both code responses remained after reload. The header and most-recent sidebar row still read “New conversation”; the row subtitle was “Inbox.” The first code block had no function to rename, and no editable Code file was open, so the report's byte-for-byte identifier-preservation behavior was not verified. The browser remained online.

**Frequency:** 1 of 1 two-prompt code chats retained the generic title after reload.

**Additional evidence:** `.spectra-local/live-verification/P3-AI-ENGINE-code-chat-7407840f-redacted.txt`; `.spectra-local/live-verification/LV040-code-chat-sidebar-row-7407840f.png`; `.spectra-local/live-verification/P3-AI-ENGINE-code-edit-after-reload-7407840f.png`.

**Commit tested:** Application code 7407840f; local web app on port 3000; documentation checkout HEAD e5905d99.

- Option A: Use the first prompt as a fallback, then replace it if the existing model result supplies a title. No additional provider call or latency; titles may be longer/raw prompt excerpts. Preserve explicitly edited titles and existing metadata authority.
- Option B: Generate a short title using the configured model when metadata is absent. Better summary titles, with extra provider usage/latency and a recoverable title-generation failure. Do not mandate planning for ordinary answers, lower reasoning/model capability or truncate AI context.
- User question submitted through the async input tool. NEEDS-DECISION until answered; no naming behavior changed.

## Fixer closeout · saved run recovery and title decision · 2026-10-01

- Implementation commit: `96f3b05d2e1abf24d4ccd4f2a190c4601953f28b` — reveal the latest unanswered settled run's saved failure/recovery using the existing bounded trace loader. The restored failure/Retry regression fails before; **18/18 focused tests** pass, including active-to-terminal transition, failed-read explicit recovery and real creation authority. Both TypeScript projects, full lint and all five gates pass. Configured human Git identity, no AI attribution or co-author trailer. This audit commit records final validation and preserves the verifier's findings.
- Full suite: **4,508 passed, 1 failed, 1 skipped**; **511 passed files, 1 failed, 1 skipped** (513 files), **800.07 seconds**, three workers with unchanged assertions/timeouts. Sole failure is LV-017 hosted Docker packaging omitting `shared/yjs-collections.mjs`; the prohibited deployment-configuration patch remains unapplied. The full result is not green. Log: `.spectra-local/launch-fixer-LV039-full.log`.
- LV-039 remains **NEEDS-INFO**: the recovery-display cause is corrected, but its upstream intake mutation timeout is unresolved and the exact backend function record is unavailable in the retained log page. The verifier has the hash and frontend-only recheck of the existing failed conversation's outcome/Retry; no new submission is needed. LV-037 remains **NEEDS-INFO** for exact clicked notice, request outcome and host continuity. LV-017 remains **NEEDS-INFO** for the unanswered hosted-package exception.
- **NEEDS-DECISION:** LV-040 — first-prompt title fallback versus an additional configured-model title call, with naming quality and latency/usage consequences; the async user question is pending. Earlier decisions remain LV-028 shortcut mapping, LV-022 post-save prose latency/usage, LV-003 expired-invite HTTP semantics, LV-012 Bridge activation. **CANNOT-REPRODUCE:** LV-004 — original invitation encoding artifact, decoded token works; LV-007 — idle versus pending confirmation, pending controls disabled. No option was assumed.
- No OPEN, REOPENED or FIXING entry remains. LV-026 and LV-027 are now VERIFIED by the verifier; LV-038 remains VERIFIED. Stop between tasks as requested. No deployment, codegen, production-data, environment, dependency or model/provider/reasoning/context changes occurred. The local state diagnostic was read-only and printed only sanitized matching-run state/action facts.

## Fixer closeout · retry notice lifetime · LV-037 · 2026-10-01

- Implementation commit: `cd04b06a7339671546c6c76bb2a603bf294e92a6` — retain the shared original recovery action until success or explicit dismissal. The real default-Toaster regression fails before at the ten-second offline hold; **29/29 focused tests** pass across four files, including repeated route failures, successful reconnect/open, explicit close, pending guard and Library behavior. Both TypeScript projects, full lint and all five gates pass. Source/test files retain their existing LF or CRLF endings. Configured human Git identity, no AI attribution/co-author trailer. This audit commit records final validation.
- Full suite: **4,509 passed, 2 failed, 1 skipped**; **510 passed files, 2 failed, 1 skipped** (513 files), **772.42 seconds**, three workers with unchanged assertions/timeouts. Failures: LV-017 hosted packaging omits `shared/yjs-collections.mjs`; the unchanged dense-sheet cell performance assertion measured 44.2297 ms against its original 40 ms limit. The complete spreadsheet file subsequently passes **77/77** alone with one worker (**3.97 seconds**). Full suite is not green. Logs: `.spectra-local/launch-fixer-LV037-lifetime-full.log`, `.spectra-local/LV037-lifetime-sheets-recheck.log`. No performance threshold or deployment configuration was changed.
- LV-037 is FIXED pending the verifier's ten-second offline hold, reconnect and original Try again action check on `cd04b06a`. The hash, frontend-only instructions, explicit close behavior and nearby route-work/Library checks were sent. Only the verifier sets VERIFIED. LV-039's saved recovery display has passed live verification, while its upstream intake mutation timeout remains NEEDS-INFO; that broader issue is not claimed resolved. LV-033 is now VERIFIED by the verifier.
- **NEEDS-DECISION:** LV-040 — first-prompt fallback title versus an extra configured-model title call; LV-028 — shortcut mapping; LV-022 — post-save prose latency/usage; LV-003 — expired-invite HTTP semantics; LV-012 — Bridge activation. **CANNOT-REPRODUCE:** LV-004 — original invitation encoding artifact, decoded token works; LV-007 — idle versus pending confirmation, pending controls disabled. **NEEDS-INFO:** LV-039 — exact intake timeout cause; LV-017 — prohibited hosted-package exception unanswered. No option was assumed.
- No OPEN, REOPENED or FIXING entry remains. Stop between tasks as requested. No deployment, codegen, production-data, environment, dependency or model/provider/reasoning/context changes occurred.

## Fixer closeout · independent recovery actions · LV-037 · 2026-10-01

- Commit: `076101f3803148d96ceec8582d536ab2138527a0` — use the shared Toaster's existing expanded layout so simultaneous work/conversation recovery controls remain separately accessible. This documentation commit records final validation. The real provider regression fails before; **43/43 focused tests** pass, including both independent recovery orders and ordinary notification expiry. Both TypeScript projects, full lint, all five gates and the scoped design detector pass. Existing CRLF endings preserved; configured human author/committer identity, no AI attribution or co-author trailer.
- Full suite: **4,512 passed, 3 failed, 1 skipped**; **510 passed files, 3 failed, 1 skipped** (514 files), **773.18 seconds**, three workers with original assertions/timeouts. Failures: LV-017 hosted packaging omits shared/yjs-collections.mjs; the unchanged Stop-route status assertion expected 403 and received 409; the unchanged dense-sheet timing measured 44.2132 ms against 40 ms. The latter two complete files were rerun with one worker: **135 passed, 1 failed** (136 tests), **37.65 seconds**; Stop passes, spreadsheet timing still fails at 71.563 ms. One final fresh-worker spreadsheet-only check yields **76 passed, 1 failed** (77 tests), **2.77 seconds**, timing 43.6497 ms. Full suite is not green; no timing threshold, source assertion or deployment configuration was changed. Logs: `.spectra-local/launch-fixer-LV037-stack-full.log`, `.spectra-local/LV037-stack-full-failures-recheck.log`, `.spectra-local/LV037-stack-sheets-alone.log`.
- **NEEDS-INFO:** LV-037 — the stack cause is corrected; one prior conversation-specific online failure lacks a failing request trace and remains unresolved. The verifier received the commit, frontend-only direct-action recheck and a narrow failing-activation question. LV-039 — upstream intake mutation timeout remains unresolved, while saved failure/Retry display has passed live verification. LV-017 — prohibited hosted-package deployment-configuration exception unanswered.
- **NEEDS-DECISION:** LV-040 first-prompt fallback title versus extra configured-model title generation; LV-028 shortcut mapping; LV-022 post-save prose latency/usage; LV-003 expired-invite HTTP semantics; LV-012 automatic Bridge discovery versus explicit activation. **CANNOT-REPRODUCE:** LV-004 original invitation encoding artifact, decoded generated token works; LV-007 idle versus pending confirmation, with pending controls disabled. No option assumed.
- No OPEN, REOPENED or FIXING entry remains. Stop between tasks as requested and resume on actionable verifier evidence. Only the verifier sets VERIFIED. No deployment, codegen, production-data, environment, dependency or model/provider/reasoning/context changes occurred; source/tests stayed frozen during full and isolated validation.

## Fixer follow-up · LV-037 live recovery confirmation · 2026-10-01

- Commits: `076101f3` stack correction; `1d45fdba` final validation/audit; this documentation commit records the subsequent sanitized live pass. Configured human Git identity, no AI attribution/co-author trailer. LV-037 is FIXED pending the verifier's VERIFIED assessment; no runtime change accompanies this follow-up.
- Full-suite result remains **4,512 passed, 3 failed, 1 skipped**. Stop passes in the isolation recheck; LV-017 packaging and the unchanged dense-sheet timing remain unresolved, with all original assertions/limits retained. The preceding closeout contains exact isolated counts and logs; focused recovery tests, both TypeScript projects, lint and all five gates passed.
- NEEDS-DECISION remains LV-040 title fallback/model generation, LV-028 shortcuts, LV-022 post-save prose latency/usage, LV-003 expired-invite status, LV-012 Bridge activation. CANNOT-REPRODUCE remains LV-004 original invitation encoding artifact (decoded token works) and LV-007 idle/pending confirmation (pending controls disabled). NEEDS-INFO remains LV-039 exact intake mutation timeout and LV-017 prohibited hosted-package exception. No option assumed.
- No OPEN, REOPENED or FIXING entry remains. Stop between tasks as requested; the verifier may continue the existing verification and message actionable observations. No deployment, codegen, production-data, environment, dependency or AI capability changes occurred.

### LV-041 · “Skip to content” returns keyboard focus to the sidebar

- **Status:** VERIFIED
- **Severity:** Medium
- **Surface / role:** Global keyboard navigation and Settings / signed-in Profile A school administrator
- **Report script:** Free exploration · first-week keyboard-only use; no report script defines the Skip to content behavior.
- **Commit tested:** 0522680b (application code; local app on port 3000)
- **Frequency:** 2 of 2 fresh `/settings?section=appearance` route visits.

**Steps**
1. In saved Profile A at desktop 1280×720 with the browser online, open `http://localhost:3000/settings?section=appearance`.
2. Press Tab once and confirm the visible “Skip to content” link receives focus.
3. Press Enter.
4. Press Tab once more and inspect the focused control.

**Expected:** Activating “Skip to content” should move keyboard navigation past the global navigation and into the main content. The next Tab should continue within or after the main content rather than returning to the global sidebar.

**Actual:** In both trials, Enter changed the URL fragment to `#main-content` and focused a full-viewport `DIV#main-content` that contained both a `nav` and a `main` region. The next Tab focused the sidebar button “Collapse sidebar”; later tab stops included Spectra home, Search recent chats, Chat, Workspace, Library and the remaining navigation links before the content controls.

**Evidence:** `.spectra-local/live-verification/LV-041-keyboard-skip-observations-redacted.txt`; `.spectra-local/live-verification/LV-041-skip-link-focused-redacted.png`; `.spectra-local/live-verification/LV-041-tab-after-skip-sidebar-focused-redacted.png`. Console: 0 errors and 1 warning; HTTP errors, failed requests, pageerrors and unhandled rejections: 0.

**Root cause and correction (fixer, 2026-10-01):** The root layout assigned the fragment target to its full-app wrapper, placing the global sidebar inside the supposedly skipped region. Native fragment focus correctly started sequential navigation at that wrapper, so the next Tab entered the sidebar again. Move main-content and tabindex=-1 to AppShell's actual main landmark; retain a separately named page-content wrapper for standalone/loading pages and use the shared SkipLink primitive to select that fallback only when the shell target is absent. Native anchor navigation handles focus and the fragment, without a custom focus manager, route-specific selectors or styling changes.

- Affected nearby: every AppShell route, including School, Settings, Library, Workspace, Chat and administrative pages. Standalone pages retain their wrapper fallback; landing-page files were not touched. Existing link copy/classes and file CRLF endings are preserved.
- Before/after: Two regressions fail on the original root/layout source: the unique target is a DIV containing navigation rather than MAIN, and Chromium's real Tab/Enter sequence focuses that DIV. **35/35 focused tests across three files pass**, including four skip-link cases: actual server-rendered RootLayout/AppShell landmark identity, native Tab/Enter/Tab into the page, shell behavior before hydration, and standalone fallback. The isolated browser loads only rendered fixtures and the actual skip-link enhancement, never the live app or saved browser/account state. Logs: `.spectra-local/LV041-{before,focused-final,types-web-final,types-convex,lint,test-lint-final,gates,secrets-staged}.log`.
- Validation: Both TypeScript projects, full lint and all five gates pass; scoped design detector reports no findings. The staged secret scan covers 3,329 files. No dependencies were installed or node_modules edited; the fixture uses the already-installed jsdom/Chromium tooling. Full suite follows after the committed change, with source/tests frozen.
- Verifier recheck after committed hash: frontend reload only, saved Profile A at 1280×720 on /settings?section=appearance. Tab to Skip to content, Enter: focus MAIN#main-content; next Tab proceeds to a page control rather than Collapse sidebar. Repeat on another AppShell page and a standalone legal/sign-in page to check the wrapper fallback when feasible. No AI submission, backend sync, deploy or codegen needed. Only the verifier sets VERIFIED.

- Fix commit: `0522680b91ef2de9bccb10bbc4eb1fae1b3fec3e`. Verifier received frontend-only native keyboard/fallback recheck instructions. Full suite finished with **4,517 passed, 2 failed, 1 skipped**, and the unchanged Stop-route file subsequently passes **59/59** alone. Source/tests remained frozen during both runs; configured human Git identity, no AI attribution or co-author trailer.
**Verifier verification · 2026-10-01:** On commit 0522680b in saved Profile A at 1280×720, the exact Settings reproduction focused MAIN#main-content after Enter; the next Tab focused Restore defaults inside main and outside the global sidebar. On /school, the next Tab landed on Overview inside main. On /legal/privacy, the standalone skip link focused #page-content and the next Tab landed on Cookie Policy inside that content. All three pages had 0 console errors and 1 warning. Evidence: `.spectra-local/live-verification/LV-041-postfix-recheck-0522680b-redacted.txt`; `.spectra-local/live-verification/LV-041-postfix-settings-content-focused-0522680b.png`; `.spectra-local/live-verification/LV-041-postfix-school-content-focused-0522680b.png`; `.spectra-local/live-verification/LV-041-postfix-legal-content-focused-0522680b.png`. On /sign-in, authenticated Profile A redirected to /workspace; the unauthenticated sign-in fallback was not opened.

## Fixer closeout · verified keyboard skip target · LV-041 · 2026-10-01

- Commit: `0522680b91ef2de9bccb10bbc4eb1fae1b3fec3e` — place the native fragment target on AppShell's actual main landmark, with the shared standalone/loading fallback. This documentation commit records final validation and preserves the verifier's VERIFIED evidence. Two original-source regressions fail before; **35/35 focused tests** pass, including four actual-render/native-browser skip-link cases. Both TypeScript projects, full lint, all five gates and the scoped design detector pass. Existing CRLF endings preserved; configured human Git identity, no AI attribution or co-author trailer.
- Full suite: **4,517 passed, 2 failed, 1 skipped**; **512 passed files, 2 failed, 1 skipped** (515 files), **753.84 seconds**, three workers with unchanged assertions/timeouts. Failures: LV-017 hosted packaging omits shared/yjs-collections.mjs; the unchanged Stop-route assertion expected 403 and received 409. The complete Stop-route file subsequently passes **59/59** alone with one worker (**33.53 seconds**). The dense-sheet timing test passes in this full run. Full suite remains non-green; no assertion, time limit or deployment configuration was changed. Logs: `.spectra-local/launch-fixer-LV041-full.log`, `.spectra-local/LV041-full-failure-recheck.log`. Source/tests stayed frozen throughout both runs.
- LV-041 is VERIFIED by the verifier on Settings and School: Enter focuses MAIN#main-content and the next Tab proceeds to Restore defaults/Overview within main. Standalone Privacy also passes its wrapper fallback to Cookie Policy. The authenticated Sign-in redirect prevented an unauthenticated sign-in check; that check remains BLOCKED, without signing out or claiming it exercised. No new AI prompt was submitted.
- NEEDS-DECISION: LV-040 first-prompt fallback title versus extra configured-model generation; LV-028 shortcut mapping; LV-022 post-save prose latency/usage; LV-003 expired-invite status; LV-012 automatic Bridge discovery versus explicit activation. CANNOT-REPRODUCE: LV-004 original invitation encoding artifact (decoded token works); LV-007 idle/pending confirmation (pending controls disabled). NEEDS-INFO: LV-039 exact intake mutation timeout and LV-017 prohibited hosted-package exception unanswered. No option assumed.
- No OPEN, REOPENED or FIXING entry remains. Stop between tasks as requested; the verifier may continue verification and message actionable ledger observations. No landing-page files, deployment, codegen, production-data, environment, dependency or AI capability changes occurred.


### LV-042 · Existing chat reload shows only a loading placeholder for several seconds

- **Status:** VERIFIED — 2026-10-01 (live recheck on checkout 60e2ba0c; chat code from b27682c2)
- **Severity:** Medium
- **Surface / role:** `/chat` conversation reload / signed-in Profile A school administrator
- **Report script:** Free exploration · AI chat; user-requested reload and reliability checks. No report specifies a loading-state duration.
- **Commit tested:** `28f82f36` (local app on port 3000)
- **Frequency:** 4 of 4 same-page reloads across one completed and one failed conversation showed no saved messages or settled run state for 5.189–5.975 seconds before the content returned.

**Steps**
1. In saved Profile A at desktop 1280×720, open an existing `/chat` conversation with a completed prompt and answer.
2. Reload that same conversation in-page and inspect the main pane while it loads.
3. Repeat with an existing settled failed document-create conversation; do not activate Retry.

**Expected:** After reloading a settled chat, the saved prompt, response or failure state should be apparent when the conversation returns. The exploratory script calls for reloads while checking AI chat reliability; no report defines a numeric load-time expectation.

**Actual:** On all four measured reloads, the main pane initially showed only the generic `New conversation` header, `Chat · Shared Spectra conversation`, and `0 context objects selected`. The prior prompt and response or failure state were absent; pale placeholder bars occupied the message area. The saved messages and terminal state then appeared after 5.189 seconds, 5.631 seconds, 5.772 seconds and 5.975 seconds. Two trials used a completed Moon chat and two used the failed document-create conversation. The browser remained online. Playwright console summary: 0 errors and 1 Clerk development-key warning.

**Evidence:** `.spectra-local/live-verification/LV042-chat-reload-observations-28f82f36-redacted.txt`; `.spectra-local/live-verification/LV042-chat-reload-empty-at-2s-28f82f36.png`; `.spectra-local/live-verification/LV042-chat-reload-restored-at-28f82f36.png`.

**Root cause and correction (fixer, 2026-10-01):** ChatShell awaited the recent-chat list and workspace/artifact overview before requesting the selected conversation. Those supplementary reads therefore added their latency to the critical saved-message path, and a catalog failure prevented that path from running at all; the absent detail also fell back to a misleading New conversation heading. Start the existing bounded catalog reads and selected-thread read together, publish the authoritative thread independently, and fence both publications/errors to the current route generation and thread.

- Change: Saved messages/title and terminal-state hydration complete when the selected-thread read completes, without waiting for the catalogs. Catalog failures have their own truthful, retryable context notice beside available messages; primary-read failures retain their existing error/retry and confirmed-missing redirect. Existing mounted-artifact preservation, recent-list refresh and complete context reads remain intact. While an existing thread is genuinely pending, its header says Loading conversation rather than New conversation; stored titles and the separate LV-040 naming decision are unchanged.
- Before/after: **Four regressions fail before**; **26/26 focused tests across two files pass**, covering pending catalog independence, catalog failure/retry, immediate primary failure, late catalog rejection after route switching, existing primary response fences, both background failure scopes, and saved run history/recovery. Both TypeScript projects, full lint, final scoped lint, all five gates and the scoped design detector pass. Logs: `.spectra-local/LV042-{before,focused-final,types-web-final,types-convex,lint,scoped-lint-final,gates-final}.log`. CRLF endings preserved; no assertions/time limits weakened.
- Affected nearby: ChatShell route loads, title/pin refreshes, run-driven background refresh, context hydration and recovered paused/failure messages. No parallel transcript cache, extra fetch/retry system, context truncation or model/provider/reasoning change. This removes a measured code dependency; it does not claim a numeric end-to-end load time before the live recheck, which may include auth/backend latency.
- Verifier recheck after committed hash: frontend reload only, the same existing completed and failed chats, four reloads at the authorized desktop viewport. Measure saved-message/outcome return, verify the initial header reads Loading conversation, and confirm the selected-thread request begins without waiting for overview/recent-chat reads. If a similar delay remains, record sanitized UTC/action/status/timing for that primary read and supplementary reads, so the remaining boundary can be identified. Check saved paused/Retry remains visible without Show details; do not activate Retry or submit a new AI prompt. No backend sync, deploy or codegen needed. Only the verifier sets VERIFIED.

- Fix commit: `b27682c2cb31350fab92a9a600b638983941c80a`. The verifier received frontend-only existing-chat timing/recovery recheck instructions. Full suite finished with **4,522 passed, 2 failed, 1 skipped**. The unchanged spreadsheet file subsequently passes **77/77** alone; source/tests stayed frozen throughout both runs. Configured human Git identity, no AI attribution or co-author trailer.

- **Live recheck (2026-10-01):** On checkout 60e2ba0c (chat change b27682c2), saved Profile A at 1280×720 reloaded the same completed Moon conversation twice; its saved prompt and answer returned in 4.166 s and 2.943 s. The same settled failed document-create conversation was reloaded twice; its saved prompt, paused state and visible Retry returned in 3.445 s and 2.838 s. At about 150 ms the failed chat showed “Loading conversation...” and placeholders. Filtered resource timings recorded selected-thread GETs returning HTTP 200 and starting 31 ms and 13 ms after the recent threads reads; the observed runTabs reads returned HTTP 200. The browser remained online. Playwright reported 0 errors and 1 warning. No prompt was submitted and Retry was not activated. Evidence: .spectra-local/live-verification/LV042-postfix-0d1f4e16-redacted.txt; .spectra-local/live-verification/LV042-postfix-moon-initial-b27682c2.png; .spectra-local/live-verification/LV042-postfix-moon-settled-b27682c2.png; .spectra-local/live-verification/LV042-postfix-failed-initial-0d1f4e16-trial-1.png; .spectra-local/live-verification/LV042-postfix-failed-settled-0d1f4e16-trial-1.png; .spectra-local/live-verification/LV042-postfix-failed-initial-0d1f4e16-trial-2.png; .spectra-local/live-verification/LV042-postfix-failed-settled-0d1f4e16-trial-2.png; .spectra-local/live-verification/LV042-postfix-reload-0d1f4e16.js.

### LV-043 · DOCX write remains “Waiting for Office” after Word closes the file

- **Status:** VERIFIED — 2026-10-01 (commit 60e2ba0c)
- **Severity:** High
- **Surface / role:** Bridge / Word DOCX / signed-in Profile A school administrator
- **Report script:** P3-BRIDGE-LENS · step 10, B1
- **Commit tested:** 28f82f36 (local app on port 3000)
- **Frequency:** 1 of 1 DOCX B1 trials.

**Steps**
1. In saved Profile A at desktop 1280×720, with the Bridge connected to the disposable bridge-office-disposable-20261001-run2 folder, open the exact Library item Bridge-long-name-footnotes-endnotes.docx in Spectra.
2. Open the same disposable DOCX in Word and confirm its paragraphs and footnotes/endnotes are visible.
3. In Spectra, append the exact text “Bridge live verifier edit.” to the first paragraph.
4. Confirm the new text appears in the editor and the studio reports “Waiting for Office”.
5. In Word, choose **File → Close** for this document.
6. Wait 5 seconds and inspect the Library row and open Spectra studio.
7. Reopen the same file in Word and inspect the first paragraph and word count.

**Expected:** P3-BRIDGE-LENS B1 says: “Edit them in Spectra: the write must park with "A file is open in Office…". Close Office: the write must land.”

**Actual:** Before Word closed the document, Spectra showed the appended text and “Waiting for Office”. Five seconds after **File → Close**, the Library row and studio still showed “Waiting for Office”, with the status “Office still has this file open. Spectra will verify it after Office finishes saving.” After reopening the file in Word, the original first paragraph still ended with “attached.”; “Bridge live verifier edit.” was absent, and Word showed 52 words. The footnotes/endnotes remained visible and Word showed no repair prompt. Playwright reported 0 console errors and 1 warning.

**Evidence:** .spectra-local/live-verification/LV043-bridge-office-close-redacted.txt; .spectra-local/live-verification/LV043-bridge-spectra-waiting-after-office-close-28f82f36.png; .spectra-local/live-verification/P3-BRIDGE-LENS-footnotes-reopened-after-ui-close-28f82f36.png.

- Fix commit: `0d1f4e165d5298455bfc5687ec9c17dac78dc54e`. Verifier received native-build and repeated-session recheck instructions.

**Root cause and correction (fixer, 2026-10-01):** Bridge derives lock-report journal identities from the resource, path and native revision, which can remain unchanged across Office sessions. It renewed a completed lock operation for a later session but reused the completed unlock operation, silently suppressing every later unlock at that revision and clearing its local hold marker without notifying Convex. Renew completed operations for both transitions using the existing durable identity mechanism; the same hold marker continues to suppress repeated probes, and the existing cloud unlock handler restores the short retry window for parked writes.

- Before/after: `repeated_office_sessions_report_each_unlock_without_a_new_file_revision` exercises the real app enqueue function and SQLite journal through three Office sessions, checks all six reports have distinct durable operations, and checks duplicate probes both before and after acknowledgements. It fails on the original implementation at session 2 / unlocked (0 queued, expected 1), and passes with the fix. **31/31 Bridge app tests**, **88/88 Bridge core tests** (66 unit, 21 chaos, 1 granted-tree) and **52/52 Convex Bridge tests** pass, including the existing parked-write release, claim/unlock race, stale owner-file and staging-lock cases. Offline Cargo uses installed dependencies only; Rust format check passes.
- Validation: Both TypeScript projects, full lint and all five gates pass. Full Vitest finishes with **4,521 passed, 3 failed, 1 skipped**; the complete Stop-route and spreadsheet files subsequently pass **136/136** in isolation. Source/tests stayed frozen throughout both runs. Logs: `.spectra-local/LV043-{before,rust-app,rust-core,rust-format,convex-focused,types-web,types-convex,lint,gates}.log` and `.spectra-local/launch-fixer-LV043-full.log`. Existing CRLF source endings and the ledger's mixed endings are preserved; configured human Git identity, no AI attribution or co-author trailer.
- Affected nearby: repeated Word, Excel and PowerPoint sessions at an unchanged revision, watcher-originated lock reports and the per-file hold scan. Actual owner-file/share-lock checks, native readback/receipt requirements, write ordering and bounded backoff remain in force. No UI-only status clearing, forced writes, extra polling mechanism, deployment or Convex codegen is needed.
- Live evidence limit: The original five-second trial does not record the running Bridge build or prior lock cycles, so that exact observation still needs correlation with the confirmed journal defect. Bridge remote discovery can take up to 15 seconds, and parked-write backoff can reach 60 seconds if unlock reporting is absent. The verifier was asked to leave the disposable document closed for 90 seconds, record status/timestamps and the Bridge build, and report whether the unchanged document had earlier Office sessions; this distinguishes suppressed unlock recovery from simply reopening before a retry.
- Additional pre-fix live evidence (verifier, 2026-10-01): the disposable document stayed closed from 11:25:18 to 11:37:04 UTC (11m46s), with Waiting for Office still displayed and the browser online. The unchanged DOCX had prior Word open/close sessions, matching the reproduced journal defect; the running Bridge started September 30 and its binary was last written September 24, before fix commit 0d1f4e16. This rules out only a five-second retry wait, but remains pre-fix native evidence; the web checkout hash does not identify the running Rust binary. Evidence: `.spectra-local/live-verification/LV043-bridge-90s-end-0d1f4e16.png`. Updated native-build recheck requested; unrelated user-owned Word processes remain untouched.
- Verifier recheck after committed hash: use a native Bridge built from the fix (a frontend reload alone cannot update Rust), retaining the disposable mount and existing identity. Repeat at least two open/edit/close cycles on the unchanged DOCX, leave it closed until the write verifies before reopening, and confirm the exact marker lands in Word with footnotes/endnotes and no repair prompt. Check XLSX/PPTX nearby when continuing B1; one held file must not block unrelated files. Do not delete owner files or bypass Office locks. Only the verifier sets VERIFIED.

**Verifier verification (2026-10-01):** Built and loaded the Bridge binary after commit `0d1f4e16`; binary SHA-256 `CF342BD0CD296B27F73966D56D0D668C5972A9EAE7299EEC0A54CA18898BD096`. On local instance 8, Settings showed the selected disposable folder Ready by 12:01:56 UTC, within 93 seconds of the new Bridge process start at 12:00:23 UTC. After the DOCX was closed in Word, the exact Spectra marker was visible in the Library item and the file was reopened in Word three times. Each readback showed “Bridge live verifier edit.”, 56 words, footnote markers and endnote entries, with no repair prompt. The file remained 10,395 bytes with SHA-256 `3064ECD8D4E6103F1B476DBE3214EF8C848F531FF871F27E5C3E5AEE5EC26A02` after close/reopen sessions.

Evidence: `.spectra-local/live-verification/LV043-postfix-repeated-word-readback-redacted.txt`; `.spectra-local/live-verification/LV043-bridge-postfix-word-maximized-60e2ba0c.png`; `.spectra-local/live-verification/LV043-bridge-postfix-word-session2-max-settled-60e2ba0c.png`; `.spectra-local/live-verification/LV043-bridge-postfix-word-session3-max-60e2ba0c.png`.

### LV-044 · XLSX cell commits show failure and do not update the native workbook

- **Status:** VERIFIED — 2026-10-01 (commit 628f4987)
- **Severity:** High
- **Surface / role:** Bridge / Sheets XLSX / signed-in Profile A school administrator
- **Report script:** P3-BRIDGE-LENS · step 10, B1 (adjacent cross-file check)
- **Commit tested:** 628f4987 (application code on local app port 3000; checkout HEAD 18d33f99 is a later documentation update)
- **Frequency:** Initial trial: 3 of 3 cell commits and 1 of 1 Try again; the recheck before commit 628f4987 produced four HTTP 400 responses. On 628f4987, B3, B5, and A3 each completed and persisted after reload; no HTTP 400 occurred.

**Steps**
1. In saved Profile A on the local app, use the selected `bridge-office-disposable-20261001-run2` folder with Bridge status Ready and select “Native write & sync” in Settings → Files and devices.
2. Leave the separate disposable `Bridge-long-name-complex-structure.docx` open in Word.
3. In Library, open `Bridge-workbook-complex-preservation.xlsx` in the Sheets studio.
4. Enter `LV043 XLSX native mode 20261001` in cell B3 and press Enter.
5. Inspect the Sheets studio and browser console. Reload the same Library item, then compare the disposable native XLSX with `fixtures/office/xlsx/complex-preservation.xlsx`.

**Expected:** P3-BRIDGE-LENS step 10 B1 says: “Edit them in Spectra: the write must park with \"A file is open in Office…\". Close Office: the write must land.” In this adjacent trial, Word held a different DOCX; the separate XLSX edit should complete without a failure notice and reach its native file.

**Actual:** The commit displayed “Spectra could not finish this step. Keep working here, or open the file from Library with Spectra Bridge connected.” The browser console recorded HTTP 400 (Bad Request) from `/api/spectra/lenses/office`. The same notice and 400 followed edits to B1 and B2, and a Try again also returned 400. After reloading, the B1, B2 and B3 values remained in the Sheets studio. The native XLSX stayed 116,672 bytes with last-write time 2026-08-20 20:59:46.8435816 UTC and SHA-256 `86E256876DC2B6F4ED15CC0FFAAFB4C5161B46294A19F2FE47FD6E5974906190`, equal to the repository fixture. During the B3 attempt, Bridge showed Connected/Ready and “Native write & sync” was selected.

**Evidence:** `.spectra-local/live-verification/LV044-xlsx-office-errors-redacted.txt`; `.spectra-local/live-verification/LV044-xlsx-bridge-ready-native-write-60e2ba0c.png`; `.spectra-local/live-verification/LV043-bridge-xlsx-studio-before-60e2ba0c.png`; `.spectra-local/live-verification/LV043-bridge-xlsx-native-mode-edit-60e2ba0c.png`; `.spectra-local/live-verification/LV044-xlsx-after-reload-values-60e2ba0c.png`.

- Fix commit: `94a44078cfbcab48ace6d773470721504473b78b`. Verifier received frontend/native-readback recheck instructions.

**Root cause and correction (fixer, 2026-10-01):** Every workbook value/formula edit refreshes native chart caches. The shared chart-reference writer also reserialized unchanged source formulas, adding quotes to the imported Sheet1 reference; the requested projection retained its original spelling, so the strict semantic readback correctly refused that unintended drift before payload upload/admission. Preserve an existing formula when the requested reference is identical, while continuing to refresh the cache and applying the existing reference writer to authored reference changes.

- Before/after: Three actual-materialization route regressions over `fixtures/office/xlsx/complex-preservation.xlsx` fail on the original B1/B2/B3 edits with OFFICE_READBACK_MISMATCH. **56/56 focused tests across four files pass**, including four real native candidates, exact retained chart-series references, refreshed cached chart data after editing A3, requested/readback receipt digest equality, and deliberate writer-loss rejection before upload or admission. Existing chart creation, native row insertion/reference rebasing, preservation and preparation suites pass. Logs: `.spectra-local/LV044-before.log`, `.spectra-local/LV044-focused.log`; sanitized fixture-only differential probe: `.spectra-local/LV044-semantic-probe.log`.
- Affected nearby: all human/AI/restore XLSX edits through the shared writer that refresh chart caches, including source-cell edits, formula edits, sheet changes and authored chart updates. Formula-cache invalidation, native chart cache refresh, preservation proof, semantic readback, durable admission and Office per-file locks remain enforced. No digest-version change, weaker guard, retry workaround or special case for this workbook/marker.
- Validation: Both TypeScript projects, full lint and all five gates pass; the staged secret scan covers 3,330 tracked files. Full suite finishes after LV-045 with **4,533 passed, 1 failed, 1 skipped**; source/tests remained frozen. The only failure is the unchanged LV-017 hosted-package omission. Existing CRLF source endings and the ledger's mixed endings preserved; configured human Git identity, no AI attribution or co-author trailer.
- Verifier recheck after committed hash: frontend refresh with the current native Bridge; no native rebuild, deployment or codegen is needed for this TypeScript writer change. Retry the retained workbook edit, then change a plain cell and a chart source cell; confirm the HTTP400/generic failure is gone, the native XLSX changes and Excel shows the values, working formulas/charts, preserved formatting/other sheets and no repair prompt. Keep the unrelated DOCX open to confirm per-file isolation. Only the verifier sets VERIFIED.

**Verifier post-fix recheck (2026-10-01):** After reloading Settings, “Native write & sync” remained selected and the disposable folder showed Ready. Profile A used the same app on port 3000 (repository commit `ea08bdda`; frontend fix commits include `94a44078` and `c63a52c0`).

**Steps**
1. In saved Profile A, select the Ready `bridge-office-disposable-20261001-run2` folder and confirm “Native write & sync” remains selected after reloading Settings. Leave the separate disposable DOCX open in Word.
2. Open `Bridge-workbook-complex-preservation.xlsx` from Library in Sheets. Enter `LV044 XLSX native sync retest 20261001` in B3 and press Enter; inspect the visible notice and browser console. Select **Try again**, wait 10 seconds, and inspect again.
3. Enter `LV044 XLSX plain cell native 20261001` in B5 and press Enter. Enter `10` in chart-source cell A3 and press Enter. Inspect the visible notice and browser console after each edit.
4. Reload the same Library item and inspect cells B3, B5 and A3. Check `navigator.onLine` and compare the native XLSX SHA-256 and last-write time with the repository fixture.

**Expected:** P3-BRIDGE-LENS step 10 B1 says: “Edit them in Spectra: the write must park with \"A file is open in Office…\". Close Office: the write must land.” Here Word held a different DOCX, so the XLSX changes should complete in the native workbook without a failure notice.

**Actual:** The B3 edit, its **Try again**, the B5 edit and the A3 edit each displayed “Spectra could not finish this step. Keep working here, or open the file from Library with Spectra Bridge connected.” Each generated HTTP 400 (Bad Request) from `/api/spectra/lenses/office`. After reload, B3 still contained `LV044 XLSX native sync retest 20261001`, B5 still contained `LV044 XLSX plain cell native 20261001`, and A3 still contained `10` in the Sheets studio. `navigator.onLine` returned `true`. The native file remained 116,672 bytes, with last-write time 2026-08-20 20:59:46.8435816 UTC and SHA-256 `86E256876DC2B6F4ED15CC0FFAAFB4C5161B46294A19F2FE47FD6E5974906190`, equal to the repository fixture. The browser console recorded four HTTP 400 errors before reload; the reload completed with 0 console errors.

**Evidence:** `.spectra-local/live-verification/LV044-xlsx-native-mode-enabled-c63a52c0.png`; `.spectra-local/live-verification/LV044-xlsx-native-mode-reloaded-c63a52c0.png`; `.spectra-local/live-verification/LV044-xlsx-native-mode-requests-ea08bdda-redacted.txt`; `.spectra-local/live-verification/LV044-xlsx-native-mode-B3-failure-c63a52c0.png`; `.spectra-local/live-verification/LV044-xlsx-native-mode-B3-retry-c63a52c0.png`; `.spectra-local/live-verification/LV044-xlsx-native-mode-B5-failure-ea08bdda.png`; `.spectra-local/live-verification/LV044-xlsx-native-mode-A3-failure-ea08bdda.png`; `.spectra-local/live-verification/LV044-xlsx-native-mode-after-reload-ea08bdda.png`.

- Follow-up fix commit: `628f4987a09c80860c0bad64af8929f8508714fd`. Verifier received persisted-workbook and nearby native readback recheck instructions.

**Reopened correction (fixer, 2026-10-01):** The first fix corrected real chart-reference drift, but its direct-import tests missed the persisted editor path. Yjs canonical storage sorts nested object keys, while XLSX readback constructs cell-format keys in another order; the spreadsheet semantic digest used raw JSON insertion order and rejected equivalent formats. Use the existing recursive, locale-independent key ordering for the same semantic fields, extracted into one shared helper also used by Yjs and PPTX; field values and array order remain authoritative.

- Reproduction: Local Office-route logs still name OFFICE_READBACK_MISMATCH. A bounded, read-only loopback-instance probe compared the actual retained workbook content with the unchanged native fixture and confirmed equivalent requested/readback semantic values but different nested format key order. After correction, the real saved-content probe produces equal semantic digests; raw native style/formula-cache fields already excluded by the existing semantic contract are not claimed to be identical. No live workbook, canonical state, environment or production data was modified.
- Before/after: All three persisted route regressions (B3, B5 and chart-source A3) fail before this correction, while the original five direct-import tests pass. **111/111 focused tests across eight files pass** afterward, including real encode/canonicalize/decode persistence, native value readback and receipt digests, deliberate writer-loss rejection, changed values/formats/chart sources/array order remaining detectable, and fresh native-source fencing when an editor retains an older binding digest. Existing XLSX/PPTX materialization, Yjs decomposition, native preparation and Convex receipt tests pass. Logs: `.spectra-local/LV044-reopened-before.log`, `.spectra-local/LV044-reopened-focused-final.log`, `.spectra-local/LV044-reopened-semantic-probe-after.log`.
- Validation: Both TypeScript projects, full lint, final scoped lint and all five gates pass. Newly computed XLSX semantic tokens use ordered object keys; native binary hashes, revision/ancestry fences and stored immutable receipts retain their existing contracts. No codegen, deployment, migration, weaker readback guard or native rebuild is required. Source CRLF and existing mixed ledger endings preserved; configured human Git identity, no AI attribution or co-author trailer. Final full-suite results and the follow-up commit hash are recorded below after the frozen-source run.
- Nearby verifier recheck: Refresh the frontend and retry the existing retained workbook with Native write & sync selected and the folder Ready. Repeat plain-cell and chart-source edits, including after reload; confirm HTTP 400 and the generic failure disappear, the native hash changes, Excel shows the values/formulas/charts/formatting/other sheets with no repair prompt, and an unrelated held DOCX does not block this workbook. Only the verifier sets VERIFIED.

**Verifier post-fix verification (2026-10-01):** Rechecked on application code commit 628f4987 (checkout HEAD 18d33f99) at port 3000 in saved Profile A. Settings showed Native write & sync selected and the disposable folder Ready. The separate DOCX remained open in Word.

**Steps**
1. In Sheets, replace B3 with “LV044 XLSX semantic retest 20261001” and press Enter.
2. Replace B5 with “LV044 XLSX plain retest 628f4987” and press Enter. Change chart-source cell A3 from 10 to 11 and press Enter.
3. Reload the same Library item and inspect B3, B5, and A3.
4. Open the matching file from the selected disposable folder in Excel. Inspect the formula result, chart, Sheet1 formatting, other sheet, and any repair prompt.

**Expected:** P3-BRIDGE-LENS step 10 B1 says: “Edit them in Spectra: the write must park with ‘A file is open in Office…’. Close Office: the write must land.” With a separate DOCX open, these XLSX edits should complete in Native write & sync and be visible in the native workbook. Formulas and chart ranges should reflect the changed source cell, and existing formatting and other sheets should remain present.

**Actual:** B3, B5, and A3 each completed without the generic failure alert or HTTP 400. B3 briefly showed “Syncing,” then the indicator cleared. After reload, B3 and B5 retained the submitted markers and A3 remained 11; the visible formula result changed from 22 to 23. Excel opened the native XLSX without a repair prompt and showed the edited cells, formula result 23, an updated chart, the existing Sheet1 table/formatting/link/comment, and the existing Sheet2 content and shapes. The native workbook was 105,182 bytes with last-write time 2026-10-01T15:04:43.4056783Z and SHA-256 7FEB7472BA50E2573534A37AFB3872CE2A99BADE5C3B0152253C8D48D2951E94. The separate DOCX remained open. Browser console: 0 errors and 1 Clerk development-key warning.

**Evidence:** .spectra-local/live-verification/LV044-native-mode-recheck-628f4987-redacted.txt; .spectra-local/live-verification/LV044-settings-628f4987.png; .spectra-local/live-verification/LV044-word-disposable-held-628f4987.png; .spectra-local/live-verification/LV044-B3-semantic-retest-628f4987.png; .spectra-local/live-verification/LV044-B5-plain-retest-628f4987.png; .spectra-local/live-verification/LV044-A3-chart-source-retest-628f4987.png; .spectra-local/live-verification/LV044-persisted-reload-settled-628f4987.png; .spectra-local/live-verification/LV044-native-excel-reopened-628f4987.png; .spectra-local/live-verification/LV044-native-excel-sheet2-628f4987.png.

### LV-045 · PPTX edit shows failure after its body later appears in the native deck

- **Status:** VERIFIED — 2026-10-01 (commit 628f4987)
- **Severity:** Medium
- **Surface / role:** Bridge / Presentation PPTX / signed-in Profile A school administrator
- **Report script:** P3-BRIDGE-LENS · step 10, B1 (same-file PPTX lock)
- **Commit tested:** 628f4987 (application code on local app port 3000; checkout HEAD 18d33f99 is a later documentation update)
- **Frequency:** Original trial: 1 of 1 same-file edit and 1 of 1 post-close Try again returned HTTP 400, while 1 of 1 PowerPoint readbacks showed the body. After the fix, 3 of 3 edit/close/readback cycles succeeded with no HTTP 400 or generic failure alert.

**Steps**
1. In saved Profile A on the local app, use the selected `bridge-office-disposable-20261001-run2` folder with Bridge status Ready and “Native write & sync” selected.
2. Open `Bridge-deck-transition-law.pptx` from that folder in PowerPoint and confirm its body reads `Original body LV043 adjacent check 20261001`.
3. In Library, open the matching presentation in Spectra. Replace the slide body with `PPTX B1 same-file lock LV044 20261001`, press Enter and wait 10 seconds.
4. Inspect the header, visible alert and browser console. Close the disposable PPTX window in PowerPoint, select **Try again** in Spectra, wait 10 seconds, and inspect the same state and console again.
5. Reopen the disposable PPTX in PowerPoint and read the slide body.

**Expected:** P3-BRIDGE-LENS step 10 B1 says: “Edit them in Spectra: the write must park with \"A file is open in Office…\". Close Office: the write must land.”

**Actual:** While PowerPoint held the PPTX open, Spectra displayed “Waiting for Office” in the header and the generic alert “Spectra could not finish this step. Keep working here, or open the file from Library with Spectra Bridge connected.” The slide-body textbox showed the entered marker. The browser console recorded HTTP 400 (Bad Request) from `/api/spectra/lenses/office`. After the disposable PowerPoint window was closed, **Try again** produced a second HTTP 400; the same failure alert and “Waiting for Office” header remained. A subsequent readback in PowerPoint showed the new body marker and no repair prompt. The native file was 30,937 bytes with SHA-256 `447a976ea0b16ca64f3ac52bb8be0e465f700423c97282dfdc813a82fa6a580b`.

**Evidence:** `.spectra-local/live-verification/LV045-pptx-office-live-check-redacted.txt`; `.spectra-local/live-verification/LV044-pptx-native-before-lock-60e2ba0c.png`; `.spectra-local/live-verification/LV044-pptx-office-open-failed-60e2ba0c.png`; `.spectra-local/live-verification/LV044-pptx-after-office-close-retry-60e2ba0c.png`; `.spectra-local/live-verification/LV044-pptx-native-after-office-close-retry-60e2ba0c.png`.

- Fix commit: `c63a52c0d28f33d22251ce133501105d57bfcbd0`. Verifier received frontend/native-readback and same-file lock recheck instructions.

**Root cause and correction (fixer, 2026-10-01):** Enter left a trailing blank rich paragraph and newline in the editor's redundant text field. PowerPoint readback retained the authored paragraphs but its flattened shape-text display omitted empty lines and outer whitespace; the existing mirror normalization covered slide text/title/order, leaving this object-level mirror to trigger OFFICE_READBACK_MISMATCH. Extend that same normalization to text objects only when the text field agrees with their complete authored paragraphs or native display; preserve every paragraph, run and format, and refuse independently conflicting mirror text.

- Reproduction: The local Office-route logs name OFFICE_READBACK_MISMATCH. A bounded read-only probe of the disposable deck's canonical content and current native file reproduces exactly one semantic difference: content.text has a final newline in the request and none in readback. After the fix the probe's semantic digests match and its difference count is zero. The probe checked loopback instance 8 ports/name before reading; no production, environment, credential, data or file writes were made beyond ignored diagnostic output. Logs: `.spectra-local/LV045-canonical-read.log`, `.spectra-local/LV045-semantic-probe{,-after}.log`.
- Before/after: **Five regressions fail before**: three actual route cases over the real PowerPoint `transition-law.pptx` fixture (one blank paragraph, two blank paragraphs, multiline text with a final blank paragraph), and two mirror proof/refusal cases. **76/76 focused tests across six files pass**, including exact native paragraph readback, receipt digest equality, repeat-after-landed candidates returning unchanged with no upload/admission, retained spaces/run formatting and detection of a deliberately lost blank paragraph. Existing tests still reject lost text/transition, mismatched independent slide title/text/order, incomplete native mappings, missing media and lost authored fields. Logs: `.spectra-local/LV045-{before,readback-before,focused-final}.log`.
- Affected nearby: human typing/Enter and multiline paste, AI native preparation, rich text in grouped objects, inserted objects/slides, and Retry after the native paragraphs already landed. The shared normalizer is already used by complete content projection before operation planning and by requested-digest verification; no parallel model, UI-only error clearing, forced native write, weakened preservation/readback guard or digest-version change.
- Validation: Both TypeScript projects, full lint, final scoped lint and all five final gates pass. The TypeScript check caught the helper's array-callback option/index mismatch; that callback is corrected and focused tests/types/scoped lint/gates were rerun against the final source. Existing CRLF source and mixed ledger endings preserved; configured human Git identity, no AI attribution or co-author trailer. Full suite finishes with **4,533 passed, 1 failed, 1 skipped**; source/tests remained frozen. The only failure is the unchanged LV-017 hosted-package omission.
- Verifier recheck after committed hash: frontend refresh only with the current native Bridge; no native rebuild, deploy or codegen needed. Retry the retained PPTX body once, then repeat a same-file Office-lock edit with Enter: the authored paragraphs remain, the generic failure/HTTP400 is gone, the save parks truthfully while held and settles after closing the exact disposable deck. Reopen in PowerPoint and check body, blank paragraphs, transition, notes/layout/media and no repair prompt; leave unrelated PowerPoint documents untouched. Also repeat Retry after the bytes have already landed to confirm unchanged success. Only the verifier sets VERIFIED.

**Verifier post-fix verification (2026-10-01):** Rechecked with the disposable PPTX in PowerPoint and the matching Library item in Spectra. The separate DOCX remained open in Word. The app code was 628f4987 on the final two cycles; the first cycle shown here ran with code through c63a52c0.

**Steps**
1. With Native write & sync selected and the folder Ready, edit the slide body while the same disposable Bridge-deck-transition-law.pptx is open in PowerPoint.
2. Close only that disposable deck, wait for the native file write, and reopen it in PowerPoint.
3. Repeat with a second body marker and with the multiline text PPTX LV045 paragraph A, blank paragraph, and PPTX LV045 paragraph C.

**Expected:** P3-BRIDGE-LENS step 10 B1 says: “Edit them in Spectra: the write must park with ‘A file is open in Office…’. Close Office: the write must land.” The file should open in PowerPoint without a repair prompt and retain the authored paragraphs.

**Actual:** All three post-fix edits avoided the generic failure alert and HTTP 400; each marker appeared in PowerPoint after the target deck closed, without a repair prompt. The multiline readback retained the blank paragraph between A and C. The header’s Waiting for Office indicator differed across the three cycles; its post-write persistence is recorded separately as LV-046. Browser console errors: 0. No Try again control was presented after these successful writes, so the fixer’s extra repeat-after-landed action was unavailable.

**Evidence:** .spectra-local/live-verification/LV045-pptx-postfix-console-network-ea08bdda-redacted.txt; .spectra-local/live-verification/LV045-pptx-postfix-native-reopened-ea08bdda.png; .spectra-local/live-verification/LV045-pptx-postfix-multiline-held-628f4987.png; .spectra-local/live-verification/LV045-pptx-postfix-multiline-after-close-628f4987.png; .spectra-local/live-verification/LV045-pptx-postfix-multiline-native-628f4987.png.

### LV-046 · PPTX remains marked “Waiting for Office” after the native write lands

- **Status:** NEEDS-INFO
- **Severity:** Medium
- **Surface / role:** Bridge / Presentation PPTX / Library sync status / signed-in Profile A school administrator
- **Report script:** P3-BRIDGE-LENS · step 10, B1 (same-file Office lock and write status)
- **Commit tested:** Reproduction after c63a52c0 on application code through ea08bdda; two later cycles on application code 628f4987 did not persist beyond 45 seconds.
- **Frequency:** 1 of 3 post-fix edit/close cycles showed “Waiting for Office” for at least 50 seconds after the native write landed; in the other two cycles it was absent while the file was held or cleared within 45 seconds after close.

**Steps**
1. In saved Profile A on the local app at port 3000, use the Ready bridge-office-disposable-20261001-run2 folder with Native write & sync selected. Keep the separate disposable DOCX open in Word.
2. Open Bridge-deck-transition-law.pptx in PowerPoint and the matching Library item in Spectra. Replace the slide body with “PPTX LV045 post-fix retained body 20261001”, press Enter, and wait 10 seconds.
3. Close only the target disposable PPTX in PowerPoint and wait at least 50 seconds. Inspect the Spectra Library/Studio status, then reopen the PPTX in PowerPoint and inspect the body.
4. Reload the same Spectra page and inspect the status and body again.

**Expected:** P3-BRIDGE-LENS step 10 B1 says: “Edit them in Spectra: the write must park with ‘A file is open in Office…’. Close Office: the write must land.” After the native write lands, Spectra should no longer show “Waiting for Office” without a manual page reload.

**Actual:** In the first post-fix cycle, the native PPTX changed and PowerPoint showed the new body without a repair prompt, while Spectra continued to show “Waiting for Office” for at least 50 seconds after close. Reloading the same page cleared the status and retained the body. Two subsequent cycles on code 628f4987 did not repeat the same duration: one showed no Waiting for Office status while the deck was held open, and one cleared within 45 seconds after close. The browser was online; the cycle evidence showed 0 console errors and no generic failure alert.

**Evidence:** .spectra-local/live-verification/LV045-pptx-postfix-waiting-after-close-ea08bdda.png; .spectra-local/live-verification/LV045-pptx-postfix-native-reopened-ea08bdda.png; .spectra-local/live-verification/LV045-pptx-postfix-multiline-held-628f4987.png; .spectra-local/live-verification/LV045-pptx-postfix-multiline-after-close-628f4987.png; .spectra-local/live-verification/LV045-pptx-postfix-multiline-native-628f4987.png; .spectra-local/live-verification/LV045-pptx-postfix-console-network-ea08bdda-redacted.txt.

**Fixer investigation (2026-10-01):** The studio consumes the live `replicas.forWork` query; the Library snapshots `presentationsForAccount`, parks its subscription after one result, and refreshes on focus/visibility or the existing 180-second idle cadence. A verified `bridgeSync.completeWrite` clears the replica's Office error, and stale/terminal acknowledgements are fenced; the current retained disposable PPTX has cloud and local replicas current with no Office error. These checks establish possible paths but do not identify which one produced the historical label; the named waiting-after-close screenshot shows the body without a visible Waiting for Office label.

- **Question for verifier:** Which exact surface showed Waiting for Office for at least 50 seconds: studio header, Library row, replica disclosure/popover, or several? If it recurs naturally, capture its visible location and UTC time before reloading, plus the write/replica verification state if available; native body readback alone does not establish when the acknowledgement arrived. No extra edits or browser hunting are required for this question.
- Checks: **81/81 tests across four files pass** (sync presentation, replica truth, organizer interactions and real Convex Bridge acknowledgement/lock lifecycle), including rejection of stale waiting acknowledgements after verification. Read-only probe verified loopback instance 8 identity/ports before reading the retained disposable artifact; no live/native/canonical/production state was changed. Logs: `.spectra-local/LV046-status-assessment.log`, `.spectra-local/LV046-canonical-read.log`.
- Status is NEEDS-INFO until label location or correlated stale-state evidence distinguishes a missed Library refresh, studio subscription, or delayed device acknowledgement. No runtime fix, faster polling, speculative label clearing, deployment or codegen change has been made. The verifier received the question and continues other coverage. Only the verifier sets VERIFIED.
**Verifier clarification (2026-10-01):** The verifier independently inspected the named waiting-after-close screenshot and confirmed that it contains the edited PPTX body and a separate failed-chat dock card, but no visible Waiting for Office label. The written observation does not distinguish studio header, Library row or replica disclosure; a later natural recurrence will be captured with the exact label location and UTC time before reload. No product state was changed for this clarification. LV-046 remains NEEDS-INFO; assessment commit `526ab7a6` and its 81/81 checks remain applicable, with no runtime/test changes or additional full-suite run.
### LV-047 · Sidebar chat-thread titles look oversized on desktop

- **Status:** VERIFIED
- **Severity:** Low
- **Surface / role:** Global navigation sidebar, recent chat titles / signed-in Profile A school administrator
- **Report script:** Free exploration · signed-in desktop navigation; user-reported title-size concern. P3-UI-SYSTEM documents the typography scale but no sidebar-title size target.
- **Commit tested:** 7407840f (local app on port 3000, desktop viewport 1280×720)
- **Frequency:** 2 of 2 route views (/library and /chat) showed 15px recent-title text.

**Steps**
1. In saved Profile A at desktop 1280×720, open /library.
2. Inspect a recent chat title in the left sidebar and compare it with a main-destination link.
3. Open /chat and inspect a recent chat title there.

**Expected:** The user said: “The sidebar thread title text is also unnaturally big. Reduce font size.”

**Actual:** On both /library and /chat, recent chat-title text computed to 15px with a 24px line height and weight 400. The adjacent main-destination link also computed to 15px with a 24px line height, at weight 500. The thread title remained visible in the recent list on both routes. Both settled page snapshots reported 0 console errors and 1 Clerk development warning.

**Evidence:** .spectra-local/live-verification/LV047-sidebar-thread-title-size-628f4987.png; .spectra-local/live-verification/LV047-sidebar-thread-title-size-628f4987-redacted.txt.

- Fix commit: `7407840f890a7f44cfe83120221b9c126b534e14`. Verifier received default/large-text and nearby shared typography recheck instructions.

**Verifier recheck (2026-10-01):** Repeated the sidebar title checks in saved Profile A on `7407840f` at 1280×720. In Default interface text, pinned/recent/search titles measured 12px/16.8px, metadata 11px, navigation 13px/18.85px and the New chat button 11px. In Large interface text, titles measured 13px/18.2px, metadata 12px and navigation 14px/20.3px. A matching search result and a no-results query both rendered; long titles retained their accessible names while truncating visually. Tab reached Chat with a 2px focus-visible outline. The browser remained online with no offline-status text. Interface text was restored to Default. Evidence: `.spectra-local/live-verification/LV047-postfix-default-sidebar-7407840f.png`; `.spectra-local/live-verification/LV047-postfix-large-sidebar-7407840f.png`; `.spectra-local/live-verification/LV047-postfix-verification-7407840f-redacted.txt`.

**Root cause and correction (fixer, 2026-10-01):** The sidebar already requests the shared caption-size token, but `cn` used the default Tailwind merger without Spectra's custom type scale. It classified text-caption and the other semantic sizes as text colours, so a following colour class removed the size and the title inherited the 15px body size and 24px line height. Register the existing ten semantic font-size roles with the shared merger; this restores caption-sized thread titles across pinned/recent/chat/sidebar-search rows and preserves the same size/colour distinction across other callers.

- Before/after: **14 regressions fail before**, with only the unrelated conditional/layout check passing. All **15 merger tests pass afterward**, using the real CSS type-role definitions to cover both class orders, caller font-size overrides, variant sizes/colours, slash line-height overrides and independent colour replacement. **38/38 focused tests across five files** pass, including sidebar sections, accessibility, workbench and UX closure. Logs: `.spectra-local/LV047-before.log`, `.spectra-local/LV047-focused.log`.
- Nearby verifier recheck: Refresh /library and /chat at the authorized desktop viewport. Confirm pinned/recent/search-result thread titles render with the existing caption token (12px default, 13px with larger interface text), remain legible and truncate correctly, and metadata remains smaller. Check navigation links, buttons, selected/hover states and keyboard focus nearby because shared cn callers now retain their intended type scale. No per-title literal, global font reduction or accessibility-size bypass is introduced.
- Validation: Both TypeScript projects, full lint and all five gates pass; staged secret scan covers 3,332 tracked files. Scoped design detector has no findings. Existing CRLF source endings are preserved, and the commit uses configured human Git identity with no AI attribution or co-author trailer. Final full-suite result and fix hash are recorded after the frozen-source run. No codegen or deploy is required.

- Final validation: Full suite **4,555 passed, 2 failed, 1 skipped** (514 passed files, 2 failed, 1 skipped; 517 files). Failures are the unchanged LV-017 hosted-package omission and DOCX long-essay timing at 1,502.4615 ms versus its 1,500 ms limit. The complete DOCX file subsequently passes **50/50** in isolation; source/tests remained frozen and no assertions or thresholds changed. See final closeout below.

## Fixer validation · independent saved-chat hydration · LV-042 · 2026-10-01

- Commit: `b27682c2cb31350fab92a9a600b638983941c80a` — remove the catalog waterfall from selected-thread hydration and preserve independent context recovery, route fences and truthful pending identity. This documentation commit records final validation. Four regressions fail before; **26/26 focused tests**, both TypeScript projects, full/scoped lint, all five gates and the scoped design detector pass. Existing file endings preserved; configured human Git identity, no AI attribution or co-author trailer.
- Full suite: **4,522 passed, 2 failed, 1 skipped**; **512 passed files, 2 failed, 1 skipped** (515 files), **813.52 seconds**, three workers with original assertions/timeouts. All 17 ChatShell load cases pass in the full run. Failures: LV-017 hosted packaging omits shared/yjs-collections.mjs; unchanged dense-sheet timing measured 48.4018 ms against 40 ms. The complete spreadsheet file subsequently passes **77/77** alone with one worker (**3.22 seconds**). Full suite remains non-green; no threshold, assertion or deployment configuration was changed. Logs: `.spectra-local/launch-fixer-LV042-full.log`, `.spectra-local/LV042-full-failure-recheck.log`. Source/tests stayed frozen throughout full and isolated validation.
- LV-042 is FIXED pending the verifier's repeated existing-chat timing/recovery check; no numeric live latency is claimed yet. LV-043 is newly OPEN, High, and is the next ledger investigation after this audit commit. No native-write source changed during the preceding validation. No cache/context/model/provider/reasoning, dependency, environment, production-data, deployment or codegen changes occurred.

## Fixer closeout · repeated Office unlock reporting · LV-043 · 2026-10-01

- Commit: `0d1f4e165d5298455bfc5687ec9c17dac78dc54e` — renew completed unlock reports as well as lock reports when Office sessions repeat without changing the native revision. This documentation commit records final validation and the additional pre-fix live evidence. The real app/SQLite regression fails on the original second unlock; **31/31 Bridge app, 88/88 Bridge core and 52/52 Convex Bridge tests** pass. Both TypeScript projects, full lint, Rust formatting and all five gates pass. Source CRLF and the ledger's mixed endings preserved; configured human Git identity, no AI attribution or co-author trailer.
- Full suite: **4,521 passed, 3 failed, 1 skipped**; **511 passed files, 3 failed, 1 skipped** (515 files), **835.28 seconds**, three workers with original assertions/timeouts. Failures: LV-017 hosted package omits shared/yjs-collections.mjs; unchanged Stop-route assertion expects 403 and receives 409; unchanged dense-sheet timing measures 51.2736 ms against 40 ms. Complete Stop-route and spreadsheet files subsequently pass **136/136** together with one worker (**36.00 seconds**). The full run remains non-green; no assertion, threshold or deployment configuration changed. Logs: `.spectra-local/launch-fixer-LV043-full.log`, `.spectra-local/LV043-full-failure-recheck.log`. Source/tests stayed frozen throughout full and isolated validation.
- LV-043 is FIXED pending updated-native-build verification. The verifier's pre-fix document stayed closed for 11m46s and still showed Waiting for Office; earlier Word sessions match the reproduced journal defect. The running September 24 native executable predates this fix, so a current frontend hash alone cannot prove the native correction was exercised. Native-build/repeated-session recheck instructions were sent; only the verifier sets VERIFIED.
- NEEDS-DECISION: LV-040 first-prompt title fallback versus extra configured-model title generation; LV-028 shortcut mapping; LV-022 post-save prose latency/usage; LV-003 expired-invite status; LV-012 automatic Bridge discovery versus explicit activation. CANNOT-REPRODUCE: LV-004 original invitation encoding artifact (decoded token works); LV-007 idle/pending confirmation (pending controls disabled). NEEDS-INFO: LV-039 exact intake mutation timeout; LV-017 prohibited hosted-package exception remains unanswered. No option assumed.
- No OPEN, REOPENED or FIXING entry remains. Stop between tasks as requested; the verifier continues existing verification and can message the next actionable ledger observation. No landing-page, deployment, codegen, production-data, environment, dependency or AI capability changes occurred.

## Fixer closeout · native workbook and presentation readback · LV-044/LV-045 · 2026-10-01

- Commits: `94a44078cfbcab48ace6d773470721504473b78b` — preserve unchanged chart source references during XLSX cache refresh (LV-044); `c63a52c0d28f33d22251ce133501105d57bfcbd0` — verify PPTX object-text mirrors against their authored rich paragraphs without losing blank paragraphs (LV-045). This documentation commit records final validation and the verifier's live evidence. Configured human Git identity, no AI attribution or co-author trailer.
- Before/after: three real complex-workbook route regressions fail before LV-044; **56/56 focused tests** pass afterward, including updated chart source caches and writer-loss rejection. Five regressions fail before LV-045; **76/76 focused tests** pass afterward, including the real PowerPoint transition fixture's trailing/multiline paragraph readback, unchanged repeat-after-landed candidate, mirror disagreement refusal, retained formatting and lost-paragraph detection. Both TypeScript projects, full lint, final scoped lint and all five gates pass. Source CRLF and existing mixed ledger endings preserved.
- Full suite: **4,533 passed, 1 failed, 1 skipped**; **514 passed files, 1 failed, 1 skipped** (516 files), **655.33 seconds**, three workers with original assertions/timeouts. All new XLSX/PPTX regressions pass in the full run. The only failure is LV-017: hosted packaging omits shared/yjs-collections.mjs. The previously intermittent Stop-route and dense-sheet tests pass in this full run, so no isolated rerun is needed. The full run remains non-green; no assertion, threshold or deployment configuration changed. Log: `.spectra-local/launch-fixer-LV045-full.log`. Source/tests stayed frozen throughout full validation.
- LV-042 and LV-043 are VERIFIED by the live verifier; that evidence is preserved. LV-044 and LV-045 are FIXED pending their frontend/native-readback rechecks. The verifier received each committed hash and nearby check instructions. Current native Bridge remains sufficient for these TypeScript-only corrections; no native rebuild, deploy or codegen is required. Only the verifier sets VERIFIED.
- NEEDS-DECISION: LV-040 first-prompt title fallback versus an extra configured-model title generation; LV-028 shortcut mapping; LV-022 post-save prose latency/usage; LV-003 expired-invite status; LV-012 automatic Bridge discovery versus explicit activation. CANNOT-REPRODUCE: LV-004 original invitation encoding artifact (decoded token works); LV-007 idle/pending confirmation (pending controls disabled). NEEDS-INFO: LV-039 exact failing Convex function remains unidentified, including the newly recorded failed document-create/runEvents occurrence; LV-017 prohibited hosted-package exception remains unanswered. No product option or speculative timeout workaround assumed.
- No OPEN, REOPENED or FIXING entry remains. Stop between tasks as requested; the verifier continues the existing verification and can message the next actionable observation. No landing-page, deployment, codegen, production-data, environment, dependency or AI capability changes occurred.

## Fixer closeout · persisted workbook semantic comparison · LV-044 · 2026-10-01

- Commit: `628f4987a09c80860c0bad64af8929f8508714fd` — compare equivalent persisted/native XLSX cell formats independently of nested object insertion order, reusing the same canonical ordering helper across XLSX, Yjs and PPTX. The prior chart-reference correction `94a44078` remains necessary. Three persisted route cases fail before; **111/111 focused tests** pass afterward, including detection of actual semantic loss and fresh native fencing with an older editor binding. Both TypeScript projects, full/scoped lint and all five gates pass; staged secret scan covers 3,331 files. Human Git identity, no AI attribution or co-author trailer; existing source CRLF and mixed ledger endings preserved.
- Full suite: **4,540 passed, 2 failed, 1 skipped**; **513 passed files, 2 failed, 1 skipped** (516 files), **915.01 seconds**, three workers with original assertions/timeouts. All new workbook regressions pass. Failures: LV-017 hosted packaging omits shared/yjs-collections.mjs; unchanged dense-sheet single-cell timing measures **45.755 ms** against **40 ms**. The complete spreadsheet file subsequently has **76 passed, 1 failed** in isolation (**3.81 seconds**), with the same assertion measuring **40.1956 ms**. Full validation remains non-green; no threshold, assertion or deployment configuration changed. Logs: `.spectra-local/launch-fixer-LV044-reopened-full.log`, `.spectra-local/LV044-reopened-full-failure-recheck.log`. Source/tests remained frozen throughout full and isolated validation.
- LV-044 is FIXED pending live verification. The verifier received the follow-up hash and instructions for retained/reloaded content, plain cells, chart-source cells, Excel preservation and unrelated Office-file isolation. Current native Bridge is sufficient; no native rebuild, codegen or deploy is required. The additional LV-039 first-submit Moon failure is preserved separately and remains NEEDS-INFO because its sanitized response/server correlation is missing. Only the verifier sets VERIFIED.
- NEEDS-DECISION: LV-040 first-prompt title fallback versus extra configured-model title generation; LV-028 shortcut mapping; LV-022 post-save prose latency/usage; LV-003 expired-invite status; LV-012 automatic Bridge discovery versus explicit activation. CANNOT-REPRODUCE: LV-004 original invitation encoding artifact (decoded token works); LV-007 idle/pending confirmation (pending controls disabled). NEEDS-INFO: LV-039 exact failing server function/stage; LV-017 deployment-configuration exception remains unanswered. No option assumed.
- No OPEN, REOPENED or FIXING entry remains. Stop between tasks as requested; the verifier continues verification and can message the next actionable observation. No landing-page, deployment, codegen, production-data, environment, dependency or AI capability changes occurred.

## Fixer assessment closeout · post-write Office status · LV-046 · 2026-10-01

- No runtime commit: current backend acknowledgement and status tests pass, but the historical stale label's exact surface remains unidentified. LV-046 is NEEDS-INFO with a precise location/time/verification-state question; **81/81 focused tests** pass. This documentation commit preserves the verifier's LV-044/LV-045 VERIFIED evidence and records the assessment. Configured human Git identity, no AI attribution or co-author trailer.
- Latest full suite remains **4,540 passed, 2 failed, 1 skipped** (513 passed files, 2 failed, 1 skipped; 516 files), recorded after code commit `628f4987`. Failures: LV-017 hosted-package omission and the unchanged dense-sheet 40 ms assertion, which also failed complete-file isolation (76 passed, 1 failed). No source/tests changed in this assessment, so no full rerun is required.
- NEEDS-DECISION: LV-040 first-prompt title fallback versus extra configured-model title generation; LV-028 shortcut mapping; LV-022 post-save prose latency/usage; LV-003 expired-invite status; LV-012 automatic Bridge discovery versus explicit activation. CANNOT-REPRODUCE: LV-004 original invitation encoding artifact (decoded token works); LV-007 idle/pending confirmation (pending controls disabled). NEEDS-INFO: LV-046 stale label location/correlation; LV-039 exact failed server stage; LV-017 prohibited deployment-configuration exception. No option assumed.
- No OPEN, REOPENED or FIXING entry remains. Stop between tasks as requested; the verifier can return actionable evidence and continue other coverage. No runtime, environment, model/provider/reasoning/context, dependency, deployment, codegen, landing-page or production-data changes occurred.

## Fixer closeout · shared semantic typography · LV-047 · 2026-10-01

- Commit: `7407840f890a7f44cfe83120221b9c126b534e14` — register Spectra's existing semantic font-size scale with the shared class merger, preventing text colours from removing font-size tokens. Fourteen regressions fail before, all **15 new merger tests** pass afterward, and **38/38 focused tests** pass. Both TypeScript projects, full lint, all five gates and the scoped design detector pass; staged secret scan covers 3,332 files. Existing source CRLF and mixed ledger endings preserved; configured human Git identity, no AI attribution or co-author trailer.
- Full suite: **4,555 passed, 2 failed, 1 skipped**; **514 passed files, 2 failed, 1 skipped** (517 files), **907.43 seconds**, three workers with original assertions/timeouts. All new typography regressions pass in the full run. Failures: LV-017 hosted packaging omits shared/yjs-collections.mjs; unchanged DOCX long-essay timing measured **1,502.4615 ms** against **1,500 ms**. The complete DOCX file subsequently passes **50/50** in isolation (**44.82 seconds**). Dense-sheet and Stop-route checks pass in the full run. Full validation remains non-green; no threshold, assertion or deployment configuration changed. Logs: `.spectra-local/launch-fixer-LV047-full.log`, `.spectra-local/LV047-full-failure-recheck.log`. Runtime source/tests stayed frozen throughout full and isolated validation.
- LV-047 is FIXED pending the verifier's default/large-text, pinned/recent/search and nearby shared-component recheck. LV-044/LV-045 VERIFIED evidence remains preserved. The displaced LV-040 heading is restored so its unchanged decision status remains a distinct entry; the existing first-prompt fallback versus additional configured-model generation options remain open.
- NEEDS-DECISION: LV-040 first-prompt title fallback versus extra configured-model title generation; LV-028 shortcut mapping; LV-022 post-save prose latency/usage; LV-003 expired-invite status; LV-012 automatic Bridge discovery versus explicit activation. CANNOT-REPRODUCE: LV-004 original invitation encoding artifact (decoded token works); LV-007 idle/pending confirmation (pending controls disabled). NEEDS-INFO: LV-046 stale label location/correlation; LV-039 exact failing server function/stage (new create/Retry response IDs and Library absence are preserved but do not identify that function); LV-017 prohibited deployment-configuration exception. No option assumed.
- No OPEN, REOPENED or FIXING entry remains. Stop between tasks as requested; the verifier continues verification and can message the next actionable observation. No landing-page, deployment, codegen, production-data, environment, dependency or AI capability changes occurred.

**Additional verifier occurrence (2026-10-01; Planner and Calendar; application code 7407840f at submission):**

**Steps**
1. In saved Profile A, open a fresh `/chat` while online with 0 context objects selected.
2. Submit “Create a task 'Revise chemistry' and schedule it tomorrow 4–5pm.”
3. Inspect the run at 15–120 seconds and continue observing until it reaches a visible state.
4. When the Live Dock showed Paused, activate Retry once and inspect the resumed state.
5. When the Live Dock requested “Approve calendar.schedule,” activate Apply changes once. Inspect the Planner Task and Calendar views.

**Expected:** P3-AI-ENGINE · Planner and Calendar asks: “Create a task 'Revise chemistry' and schedule it tomorrow 4–5pm.” and then “Move my Revise chemistry block to 6pm.” The create request should leave a scheduled block available for the edit request.

**Actual:** The browser remained online. At 15 seconds the run showed “Still running” / “Thinking” / “Getting ready,” with no answer. At 30–75 seconds it remained active and showed “Taking another careful pass” / “Finding relevant work”; its visible plan text specified 4–5pm UTC while the browser timezone was Europe/Madrid. At about 105–120 seconds the page showed “Chat context could not load” and “Your messages are available. Work and workspace information could not load. Try again.” The run remained active without an answer. The browser request list showed four `GET /api/spectra?action=runEvents` HTTP 500 responses and three `GET /api/spectra?action=overview` HTTP 500 responses; their response bodies and request IDs were not captured. After several minutes the Live Dock showed Paused with Retry. One Retry resumed the operation and later showed “Needs input” / “Ready for your input” with “Editing Revise chemistry · Approve calendar.schedule.” Clicking Apply changes sent `POST /api/spectra` and returned HTTP 409 Conflict; the card still required input. The Planner Task work surface showed the title “Revise chemistry,” summary “Incomplete draft preserved from an interrupted Spectra run,” one task named “First task” with status “To do” and Due “Add date.” The visible Calendar week (28 Sept–4 Oct 2026) had no Revise chemistry block. The scheduled block was absent, so the edit prompt was not applied. The initial create request was sent before the fixer checkout advanced to a35e7edf; the later Retry/approval observations continued without a controlled app restart and are not a version-specific post-fix check. No offline banner appeared.

**Frequency:** 1 of 1 fresh create remained active beyond 120 seconds and later showed Paused; 1 Retry resumed to a required-input card; 1 Apply changes request returned HTTP 409. No scheduled block was visible.

**Evidence:** `.spectra-local/live-verification/LV039-planner-create-7407840f-redacted.txt`; `.spectra-local/live-verification/P3-AI-ENGINE-planner-create-30s-7407840f.png`; `.spectra-local/live-verification/P3-AI-ENGINE-planner-create-105s-7407840f.png`; `.spectra-local/live-verification/P3-AI-ENGINE-planner-create-120s-7407840f.png`; `.spectra-local/live-verification/P3-AI-ENGINE-planner-artifact-incomplete-7407840f.png`; `.spectra-local/live-verification/P3-AI-ENGINE-planner-retry-20s-7407840f.png`; `.spectra-local/live-verification/P3-AI-ENGINE-planner-apply-409-7407840f.png`.

**Commit tested:** Application code 7407840f at initial submission; checkout later advanced to a35e7edf while the run was pending; no restart before the final Retry/approval observation.

### LV-048 · Offline navigation keeps the shell but omits the prescribed toast

- **Status:** NEEDS-INFO
- **Fix commit:** `2741fd45` (2026-10-01). Both TypeScript projects, full lint and all five gates pass; staged secret scan covers 3,335 files.
- **Severity:** Medium
- **Surface / role:** Main navigation to Library and Calendar, plus `/admin` People view / signed-in Profile A school administrator
- **Report script:** P2-EXPERIENCE · step 5; free exploration · reliability during offline navigation
- **Commit tested:** Application code 7407840f; local web app on port 3000; documentation checkout HEAD e5905d99
- **Frequency:** 2 of 2 offline attempts to open Library from `/calendar`; 1 of 1 to open Calendar from `/chat`; 1 of 1 to open People from `/admin` Overview.

**Steps**
1. In saved Profile A at 1280×720, open `http://localhost:3000/calendar` online and wait for the Calendar view to load.
2. Set the browser network offline and verify `navigator.onLine=false`.
3. Activate the main-navigation Library link and inspect the URL and visible page.
4. Restore the browser online, open `/chat`, set the browser offline, and activate Calendar in main navigation.
5. Restore online, open `/admin`, set the browser offline, and activate the People button in School administration.

**Expected:** P2-EXPERIENCE step 5 says: “DevTools offline, then add a comment, open the Calendar, add a personal event, and open school admin People. Each toast reads ‘Spectra could not reach the server. Check your connection, then try again.’” The Spectra shell and its offline state should remain visible while the requested view is unavailable.

**Actual:** In all three navigation trials, the browser changed to `chrome-error://chromewebdata/`, title `localhost`, and displayed `ERR_INTERNET_DISCONNECTED`; the Spectra navigation, requested app view, and in-app offline message were absent. After restoring online and using Back, the prior route returned. The already-open Calendar Add event action is separately covered: it showed the script's exact toast and kept the event dialog open.

**Evidence:** `.spectra-local/live-verification/P2-EXPERIENCE-offline-actions-7407840f-redacted.txt`; `.spectra-local/live-verification/LV048-offline-library-navigation-repeat-7407840f.png`; `.spectra-local/live-verification/LV048-offline-calendar-navigation-7407840f.png`; `.spectra-local/live-verification/P2-EXPERIENCE-offline-admin-people-7407840f.png`.

**Fixer diagnosis (2026-10-01):** Route navigation bypassed the connection-failure copy used by Spectra's API client. The installed Next.js route-fetch implementation falls back to browser navigation when an RSC fetch fails, so an offline link or router replacement could replace the mounted app with the browser error page; the Admin tab also changed its local view before attempting that replacement.

**Change:** One shared navigation policy checks the browser's existing online signal at activation time and uses SPECTRA_REQUEST_UNREACHABLE for the toast. AppShell captures ordinary internal link activation before navigation starts; the 12 product router consumers reuse the same guard for push, replace and refresh, and skip background prefetch while offline. Admin changes its selected tab only after the guarded replacement is accepted. Local fragments, editing controls, downloads, external/new-tab/modified activations and browser history retain their normal behavior, and reconnecting immediately re-enables navigation without a stale cached online flag.

**Proof:** The real Library, Calendar and Admin People component regressions all failed before the fix (.spectra-local/LV048-before.log); the online control passed. The initial 70-test run in 10 files passes after it; the final run passes all 71 assertions, with an unchanged 10-second browser-cleanup hook timeout subsequently passing in a complete 4/4 isolated recheck. The focused cases include those three paths, command routing, reconnect, local fragments/history, downloads/new tabs, chat/public-share routes and existing connection copy (.spectra-local/LV048-focused-final.log).

**Verifier re-check:** Repeat the exact offline Calendar-to-Library, Chat-to-Calendar and Admin Overview-to-People steps. Confirm one exact connection toast, unchanged current view and visible offline shell; reconnect and retry the same control. Nearby, check sidebar work/thread links, keyboard search navigation and Settings, and confirm open-work editing and fragment links still work offline. No shared deployment, environment, dependency or production-data change is required.

**Verifier re-check (2026-10-01; application commit 2741fd45):**

**Steps**
1. In saved Profile A at 1280×720, load `/calendar` while online and verify `navigator.onLine=true`.
2. Set the Playwright browser context offline and verify `navigator.onLine=false`. Activate Library in main navigation.
3. Restore online, activate Library again, and confirm it opens. Repeat the offline/online control on `/chat` → Calendar and `/admin` Overview → People.

**Expected:** P2-EXPERIENCE step 5 says: “DevTools offline, then add a comment, open the Calendar, add a personal event, and open school admin People. Each toast reads ‘Spectra could not reach the server. Check your connection, then try again.’”

**Actual:** In all four offline clicks, the browser stayed on the current Spectra route and the visible offline shell remained, but the exact prescribed toast was absent from the page text. The three paths were Calendar → Library (2/2), Chat → Calendar (1/1), and Admin Overview → People (1/1). After reconnecting, the same control navigated immediately in 3/3 paths: `/calendar` → `/library`, `/chat` → `/calendar`, and `/admin` → `/admin?tab=people`. No browser error document replaced the app in these post-fix trials.

**Frequency:** Exact toast absent 4/4 offline clicks; offline route retained 4/4; same-control navigation after reconnect succeeded 3/3.

**Evidence:** `.spectra-local/live-verification/LV048-postfix-recheck-2741fd45-redacted.txt`; `.spectra-local/live-verification/LV048-postfix-offline-calendar-library-2741fd45.png`; `.spectra-local/live-verification/LV048-postfix-offline-chat-calendar-2741fd45.png`; `.spectra-local/live-verification/LV048-postfix-offline-admin-people-2741fd45.png`.

**Console excerpt:** With Playwright intentionally offline, repeated resource errors reported `net::ERR_INTERNET_DISCONNECTED` for local `/api/spectra?action=runEvents` and `runTabs` requests, Clerk session-token requests, and the local Convex WebSocket. Query values, session identifiers and tokens are omitted in the redacted evidence note. Fresh online route loads before the offline clicks reported zero console errors. These controlled offline errors do not establish an antivirus, server, Convex or gateway cause.

**Commit tested:** `2741fd45`.



**Fixer follow-up question (2026-10-01):** Please record the elapsed time between the offline click and inspection, and whether the exact connection toast is absent immediately (within the first second) or expires before a later screenshot. The shared guard calls the existing Sonner error toast, whose ordinary default duration is four seconds; the existing mocked-toast tests prove the call but do not establish the live rendering interval. Route preservation and immediate reconnect passed the live recheck; toast rendering needs this observation before a further code change.

### LV-049 · Six-slide presentation request displays a flashcard-deck canvas

- **Status:** FIXED
- **Fix commit:** `a35e7edf` (2026-10-01). Both TypeScript projects, full lint and architecture/copy/design-token/capability/staged-secret gates passed. Follow-up test commit: `3d2b2a22` covers optional guidance through model-selected creation; 78 focused tests, both TypeScript projects, full lint and all five gates pass. Full-suite results are recorded in the fixer closeout.
- **Severity:** High
- **Surface / role:** `/chat` AI presentation creation / signed-in Profile A school administrator
- **Report script:** P3-AI-ENGINE · Presentation · Create
- **Commit tested:** Application code 7407840f; local web app on port 3000; documentation checkout HEAD e5905d99
- **Frequency:** 1 of 1 clean request.

**Steps**
1. In saved Profile A at 1280×720, open a fresh `/chat` with 0 context objects selected and `navigator.onLine=true`.
2. Submit “Make a 6-slide deck on plate tectonics.”
3. Observe the run activity and artifact surface while it is in progress.

**Expected:** P3-AI-ENGINE · Presentation · Create asks: “Make a 6-slide deck on plate tectonics.” A six-slide presentation should be created.

**Actual:** The visible run activity read “Opened a live flashcard deck canvas” and “Creating New flashcard deck.” After 105 seconds there was no presentation editor or assistant answer. After returning to a different `/chat` page, the recent row for the conversation read “New conversation” with subtitle “New flashcard deck · New flashcard deck,” still present about 24 minutes after the request; no presentation editor appeared. The run's terminal errors and paused-after-Stop state are recorded under LV-039.

**Evidence:** `.spectra-local/live-verification/LV039-presentation-create-105s-7407840f.png`; `.spectra-local/live-verification/LV039-presentation-create-7407840f-redacted.txt`; `.spectra-local/live-verification/LV049-sidebar-flashcard-row-7407840f.png`.

**Fixer diagnosis (2026-10-01):** Creation intake interpreted the phrase "deck on" as a flashcard request before consulting the model. Runtime opened that guessed shell, the model harness forced its creation blueprint, and resolver reconciliation independently inferred that same type; the cause therefore affected all creation families and could also split or filter multi-output and mixed requests.

**Change:** Removed automatic prose-to-blueprint dispatch and pre-model shell creation. Ordinary requests now use the existing full agent tool palette and model-selected typed operations, with optional skill/source retrieval and ordinary final responses; single-creation reconciliation follows the model's declared typed intent. Existing content, ownership, dependent-link, approval, durable admission, readback and exact Planner requirement checks remain on that shared path. No model, provider, reasoning, context limit, deployment or environment configuration changed.

**Proof:** The three real-route routing regressions failed before the fix (all three failed; .spectra-local/LV049-before.log). The exact six-slide prompt now creates one presentation shell after the model selects a presentation, saves all six authored slides and completes readback verification. The final focused run passed 198 tests in 12 files, including independent outputs, mixed creation/edit/link graphs, existing sheet/presentation edits, exact Planner due time and subtasks, agent authority and quality checks (.spectra-local/LV049-focused-final.log).

**Verifier re-check:** Start a fresh six-slide presentation request on the fix commit; confirm the first canvas and persisted sidebar subtitle describe a presentation, and verify slide 3 edit and summary-slide append. Nearby, re-check flashcard, document, sheet and whiteboard creation plus a two-output request and a create-with-existing-edit request. The LV-039 HTTP 500, Retry and paused-run observations still need separate backend evidence and are not claimed fixed by this artifact-type correction.

### Fixer closeout · LV-048 and LV-049 · 2026-10-01

- Commits: `a35e7edf` fixes model-selected artifact creation (LV-049); `2741fd45` keeps the mounted shell during offline navigation (LV-048); `3d2b2a22` exercises optional guidance through the shared model-selected creation path (LV-049). All use the configured human Git author, with no AI attribution or co-author trailer.
- Focused validation: LV-049 passed 198 tests in 12 files; the guidance follow-up passed 78 tests in three files. LV-048 passed all 71 focused assertions; an unchanged browser-cleanup hook timeout subsequently passed in a complete four-test isolated recheck. Both TypeScript projects, full lint, architecture, copy, design-token, capability and secret gates pass.
- Final full suite: **4,570 passed, 1 failed, 1 skipped**; **517 passed files, 1 failed, 1 skipped** (519 files), **653.63 seconds**, three workers. The sole failure is the existing LV-017 hosted gateway package omission of shared/yjs-collections.mjs. Its fix requires a prohibited deployment-configuration change; no exception was assumed. The earlier full run was 4,569 passed, two failed and one skipped; its obsolete creation-tool expectation is corrected by 3d2b2a22. The DOCX long-essay, dense-sheet, Stop-route and browser-cleanup checks pass in the final full run. Source and tests remained frozen during both full runs. Log: `.spectra-local/launch-fixer-LV048-LV049-final-full.log`.
- Live recheck: LV-048 retains the route and offline shell in four of four attempts, and reconnect immediately restores navigation in all three reported paths. The exact toast was absent at inspection; LV-048 is NEEDS-INFO until the verifier records whether it is absent within the first second or has expired before inspection. LV-049 remains FIXED pending a fresh presentation-create and nearby creation/edit recheck.
- NEEDS-DECISION: LV-003 expired-invite HTTP behavior; LV-012 automatic Bridge discovery versus explicit activation; LV-022 post-save prose latency/usage; LV-028 shortcut mapping; LV-040 first-prompt title fallback versus additional configured-model generation. CANNOT-REPRODUCE: LV-004 original invitation encoding artifact (decoded token works); LV-007 idle/pending confirmation behavior (pending controls are disabled). NEEDS-INFO: LV-017 deployment-configuration exception; LV-039 exact failing backend function/stage; LV-046 stale waiting-label location/correlation; LV-048 immediate toast visibility and inspection timing.
- No OPEN, REOPENED or FIXING entry remains at closeout. Stop between tasks as requested; the verifier can message the next actionable observation. No landing-page, deployment, codegen, production-data, environment, dependency or AI model/provider/reasoning changes were made.
