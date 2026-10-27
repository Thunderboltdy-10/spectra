# Spectra user-flow launch audit — 27 October 2026

Branch: `launch-readiness-audit`. Baseline: `5f7865c8` (`Improved landing page`, no co-author).

**Follow-up:** the owner subsequently repaired and expanded the app. Read [the deeper review against baseline 12186235](2026-10-27-DEEP-REVIEW.md) for revalidated failures, fixes and current handoff evidence. This original ledger remains historical; its findings are not all independently revalidated by the follow-up.

This is an execution ledger, not a launch certification. **Do not launch on the strength of the passing automated suite: FLOW-001 and FLOW-011 reproduce document content corruption.** Other unresolved sync, publication, access and onboarding failures are listed below. Routine screenshots were inspected in memory; retained screenshots are evidence for fixes and follow-up findings. Larger changes were deferred as requested. The subsequently requested individual/multi-file sync feature is implemented separately and described in [FILE-SELECTION-SYNC.md](2026-10-27-FILE-SELECTION-SYNC.md).

## Environments and precautions

- Instance 8: populated, http://localhost:3000, existing database and Bridge state.
- Instance 9: sparse, http://localhost:3160, existing database; stopped at the start of the audit.
- Existing Clerk development accounts; expired saved login restored using a short-lived Clerk sign-in ticket. No passwords changed or authentication bypass added.
- Use clearly named audit records for creation/edit/delete checks. Preserve existing school work and integration credentials. Do not send real invitations merely to test delivery.

## Change log

| ID | Issue and action | Verification |
| --- | --- | --- |
| FIX-001 | Local instances shared `.next/dev`, causing Next.js to reject the second server and risking cross-instance client configuration. Give configured local instances their own build directory under `.next/instances/<id>`. | Both `/api/health` endpoints ready concurrently, identifying their respective saved Convex deployments (`…-6` and `…-7`). |
| FIX-002 | Two stale tests failed against intentional existing UI: consent positioning asserted adjacent class names; manual Bridge pairing clicked the download action instead of “I already have it”. Corrected the expectations without changing product behavior. | 3 files, 25 tests passed, including local stack configuration. |
| OPS-001 | Instance 9 had not completed the documented summary migration. Ran bounded `spectraArtifacts:backfillSummaries` traversal with its local administrator credential, 10 records/page. | 2 pages, 14 records, `isDone: true`; Agents reload succeeds. Instance 8 Agents subsequently loaded its two existing agents. No secret retained in evidence. |
| FIX-003 | A grid with zero layout size repeatedly expanded its sheet on every render, hanging four Sheets component suites and potentially hidden editor panes. Ignore viewport measurement until width and height are positive; the existing ResizeObserver handles visibility. | All four previously stalled suites completed: 21 tests passed, including clipboard, editing, view rendering and collaborative undo. Subsequent complete suite finished. |
| FIX-004 | History tests expected collaborator access contrary to the authoritative owner-only history policy. AI reach catalog omitted existing user-only sharing/setup mutations and login-sync plumbing. | Corrected tests/catalog declarations; no new AI authority or history access granted. |
| FIX-005 | Shelf folder Rename had no input, and New folder immediately lost rename focus to the closing menu. Temporarily show the existing list editor and coordinate Radix close focus with the rename input. | Two component regressions; 13 Library organizer tests passed. [Before](2026-10-27-evidence/library-folder-rename-no-field.png). |
| FIX-006 | Signed-out access guidance redirected back to sign-in; mobile Clerk forms clipped; hosted footer links lost local auth continuity. Make request-access public, size Clerk forms to the auth container and provide local cross-links with the invitation redirect. | Public/protected/API guard tests; actual sign-in/sign-up at 390px and invitation redirect across both forms. [Before](2026-10-27-evidence/mobile-signin-form-clipped.png), [after](2026-10-27-evidence/mobile-signin-form-after-fix.png). No landing changes. |
| FIX-007 | Explicitly removed Bridge selections remained as disconnected tiles and made a healthy computer say Needs attention. Exclude detached mounts from current Devices views. | Model regression and actual removal of an isolated audit file. Active but unreachable mounts remain visible. |
| FEATURE-001 | Native single/multi-file sync from Library and Devices, with one narrow persistent grant per file. | See separate implementation and validation record linked above. |

## Coverage ledger

| Surface / flow | Instance 8 | Instance 9 | Evidence / notes |
| --- | --- | --- | --- |
| Sign-in, expired session, redirect | Existing account session restored | Signed-out guards, local auth links, invalid form, invitation redirect, access guidance, real sign-out and protected-route denial exercised | Password reset/OAuth/email delivery unverified. |
| Home, weekly tasks, recent work, thread navigation | Populated Home inspected, recent work/threads opened | Empty/memberless and newly joined states inspected | Responsive overlap FLOW-018; missing-school recovery FLOW-017. |
| Library, places, search, sorting, selection, menus | Populated shelves, search, New/menu and Bridge imports | Shelf/list, folder rename, selection, search, workspace settings, drag placement | FIX-005; contextual navigation/discoverability notes below. |
| Work creation, rename, move, copy, trash, restore | Audit artifacts created across editor types | Copy, drag move, trash/restore and workspace export/import/removal exercised | Ordinary file import works; workspace command fails FLOW-022. |
| Documents, formatting, save, reopen, history | Create, text/bold, autosave, reload/history; native Word round trip | Imported/copied document inspected | **Content corruption FLOW-001/011.** |
| Sheets, formulas, save, reopen, import/export | Cells/formula persisted; real Excel/Spectra save paths and conflict resolution | Sparse state and imported work inspected | Native sequential conflict FLOW-012; arbitrary complex workbooks unverified. |
| Presentations, save, reopen, import/export | Two-slide edits, notes, speaker/audience views, blackout, PPTX export, native PowerPoint save | — | FLOW-013. Controls initially thought blocked were a transition/idle-state false alarm. |
| Flashcards, study, edit, save | Two cards, reveal, typing, ratings and finished queue | Imported reference opens correct deck | FLOW-007; import card projection FLOW-023. |
| Quiz, play, edit, results | Create, publish, attempt, submit 42, score/explanation inspected | — | FLOW-009 publication race. |
| Tasks/plans, dates, completion, undo | Notes/checklist, date, completion/reopen, high priority, weekly repeat, reminder, estimate, linked work, ICS export | — | FLOW-024; repeat/reminder reset after testing. |
| Timetable, whiteboard, code | Timetable route aliases Calendar; board create/edit/reopen; HTML preview/JS and file create/delete | — | Anonymous board geometry FLOW-014. |
| Calendar, views, navigation, task CRUD | View/navigation and disposable task creation/completion/removal | Empty calendar/memberless recovery inspected | All-day rescheduling FLOW-019; timed drag remains unverified. |
| School, classes, ManageBac task details/resources | Classes, task/resource navigation, sync/history/conflicts | Sparse school and missing access/key states | FLOW-004/016/017. |
| ManageBac setup, missing key, sync, retry | Real source fetch updates titles; existing conflicts preserved | Dummy credential rejected; checking state sticks; disposable connector disconnected | No real key replaced. Production blank-key setup still needs separate validation. |
| Bridge pairing, device state, files, round trip | Native pairing, pause/resume, folder selection/removal, Word/Excel/PowerPoint, single/multi-file selection and restart | Different instance inspected without transferring native ownership | Narrow-file feature record; native projection failures remain open. |
| Threads, island, AI creation/edit, cancel/retry | Existing threads/run bar opened | AI deck creation/edit, cancel/stop, search, rename, pin/reload/unpin, soft trash/restore and run history | Thread list can lag restore until reload; needs repeated reproduction before code changes. |
| Sharing, access, read-only, collaboration | Read-only public board, anonymous denial after revoke; two-browser editor checks | Work references, invite acceptance and invalid invite inspected | No full multi-role concurrent editing matrix certified. |
| Onboarding, first use, empty state, no school/users | Tour and tips visually inspected | Existing unassigned account, zero-member audit school, initial-admin invitation accepted, keyless/invalid key setup | School retained as named audit fixture; no email sent. |
| Admin: people, invitations, settings, integrations | Populated context inspected | All 11 sections; People search/refresh, invite parsing/validation/cancel, group create/archive, profile invalid timezone, announcement form/cancel | FLOW-003/010. No announcement or invitation delivery sent. |
| Superadmin: schools, usage, operations, feedback | — | All seven sections, school search, new school create/idempotency, Inspect/start/end context | FLOW-015. Emergency stop/lifecycle destructive actions unverified. |
| Agents: list, create, edit, run | Existing two agents load | Migration repair; create mission, edit, try, bench test/evaluation | FLOW-002/008. |
| Settings, appearance, account, preferences | Current native-write policy preserved | Light/dark, preferences, profile modal, analytics 7/30/90 days, notification empty state/disabled mark-read | Theme transition was a false contrast alarm. No account/security mutation. |
| Public/share, join, request access, signed-out guards | Public read-only/revoke | Valid initial-admin invite and invalid token; signed-out admin redirect; public request-access | Auth fixes verified on real browser. |
| Narrow viewport, keyboard, dark mode | 390px, 768px and desktop Home | 390px auth; keyboard help, Ctrl+J composer and Ctrl+Shift+S settings | FLOW-018; exhaustive mobile editor/action coverage remains open. |

## Findings needing another agent

Record each medium/large issue with severity, user-visible reproduction, actual/expected behavior, screenshot, affected files, scope and acceptance checks. Never mark a mocked or source-only result as a live pass.

### FLOW-001 — P0: document typing changes the order of characters

- **Live, instance 8.** Library → New → Document → rename → type a paragraph → Enter → toggle bold → type `Bold survives reopening.`. Actual text: `old survives reopening.B`. Save completes and reopening retains the wrong text.
- Reproduced in full view at a normal typing speed (80 ms/character): append `First typing line.`, Enter, then `Second bold line.`. Actual paragraphs: `irst typing line.` and `Second bold line.F`.
- Screenshot: [document-typing-reorders-characters.png](2026-10-27-evidence/document-typing-reorders-characters.png). Disposable work: `z976ny4c2qzgpx6jxg8p6snz2s8h360j`, named `AUDIT-20261027 Document`.
- Investigate `components/document-studio.tsx`, `editor/stable-block-id.ts`, the TipTap/Yjs binding and selection restoration. Block IDs in the faulty paragraphs were distinct. No browser exception accompanied the corruption. Do not assume a formatting-only issue: it also occurred after plain Enter.
- **Acceptance:** exact text order during typing, Enter, bold toggle, undo/redo, save/reopen, two-browser concurrent editing and offline reconnect. This affects content integrity and needs a focused regression reproduction before changing the shared collaboration path.

### FLOW-002 — P1: Agents fails repeatedly on sparse instance

- **Live, instance 9.** Open Agents or press its Retry. `GET /api/spectra?action=agentGraphPage` returns 400, code `CATALOG_READ_MODEL_REQUIRED`, message `Library metadata needs its bounded migration.`
- The UI shows both an error and “Make your first agent”, which can mislead someone into thinking they have no agents. New agent creates a draft but does not repair the failed catalog read.
- Screenshot: [agents-first-load-failed.png](2026-10-27-evidence/agents-first-load-failed.png).
- `docs/README.md` already requires a complete `spectraArtifacts:backfillSummaries` traversal before deploy. Verify that setup/startup makes this operator requirement visible; a user's Retry cannot perform a privileged migration.
- **Acceptance:** complete the bounded metadata migration, verify both empty and populated Agents, and make catalog failure distinct from a true empty state. No scanning of private content as a fallback.

### FLOW-003 — P1: member-list failure is presented as an empty school

- **Live, instance 9.** Admin overview shows one active member. First People visit showed “Members 0”, “No one has joined yet” and a toast “Could not read the invitations.” Refresh then returned the actual member and two earlier invitations.
- `administration/people/people-surface.tsx` initializes both lists to `[]`; caught errors leave them empty and member loading finishes. Invitation loading has no distinct failure/loading state.
- **Acceptance:** fail either request deliberately; show an inline error/retry and preserve previously loaded records. Say no members/invitations only after a successful empty response. Keep overview/list totals consistent.
- Reproduced with Playwright request interception returning 503 for People/invitations, then remounting People. Screenshot: [admin-people-outage-as-empty.png](2026-10-27-evidence/admin-people-outage-as-empty.png). Interception removed and Refresh restored the member/invitations. The fault-injection reproduction is synthetic; the original transient was live.

### FLOW-004 — P1: ManageBac recovery does not explain the real conflict

- **Live, instance 8.** School starts with a classes sync error and “Some ManageBac changes need review. You can fix this.” Try again reads real source data and refreshes task titles, but repeated runs still contain the same three conflicts.
- Connection → Review conflicts shows `customization overlap`, `planner task`, and e.g. `Quiz changed to “Quiz”.` Only “Keep in Spectra” is offered, without identifying the conflicting fields. The School error path sends the user toward another retry rather than that comparison.
- Screenshot: [managebac-conflicts.png](2026-10-27-evidence/managebac-conflicts.png).
- **Acceptance:** expose the conflicting local/source fields, explain the consequence of each supported resolution, link directly from School's problem state, and ensure resolving a conflict settles the subsequent sync without erasing customized work. Do not resolve the owner's existing conflicts blindly.

### FLOW-005 — P2: Bridge discovery contradicted a working connection

- **Live, instance 8.** Devices initially said “Something else is using the Spectra Bridge connection on this PC”, while the running Spectra Bridge returned a valid health payload and Connect opened its native prompt. Screenshot: [bridge-not-recognized.png](2026-10-27-evidence/bridge-not-recognized.png).
- Native code matched the page. Background click of native Connect succeeded. Devices then recognized “This computer”; pause and resume succeeded. Native Office round trips were separately exercised later (FLOW-011/012/013).
- After pairing, this computer showed no folders, whereas the earlier offline cloud row showed Physics with 16 files. Investigate stale cloud device identity versus local credentials/mounts before concluding anything was deleted; no file deletion was performed.
- **Acceptance:** expired/missing browser token must say reconnect, not port occupied; reconnect must preserve or clearly distinguish existing mounts/device identity.

### FLOW-006 — P2: early work rename can be lost during hydration

- **Live, instance 8.** Create Sheets and immediately edit `Untitled work` to `AUDIT-20261027 Sheets`, Enter. Title reverted to `New Sheets`. Renaming again after the editor settled worked. Document rename after its settled load worked.
- Verify the studio's initial metadata/collaboration merge does not overwrite a name typed while it loads. Need a repeatable before/after capture before broad changes.

### FLOW-007 — P1: single-editor saves briefly raise a competing-version warning

- **Live, instance 8.** Create a flashcard deck, edit the first front/back, add a second card with Enter, then start studying. A warning offered “Keep local edits” / “Reload latest” although only this browser was editing the new deck. It disappeared before either action was selected. Content and both study ratings subsequently persisted.
- Screenshot: [flashcards-single-editor-sync-warning.png](2026-10-27-evidence/flashcards-single-editor-sync-warning.png).
- **Acceptance:** trace save acknowledgements versus remote versions; a browser's own successful save must not look like a concurrent edit. Repeat rapid edits, immediate study, reopen and a real second editor before altering conflict handling.

### FLOW-008 — P1: agent evaluation counts and recovery contradict backend requirements

- **Live, instance 9.** New mission → Try it answers `6 times 7` correctly. Checks says “3 checks” and enables Run checks, but the server rejects it with `AGENT_EVAL_CASE_REQUIRED: Compile at least one skill, or add an evaluation case.` UI only says the checks did not finish and to run again. Screenshot: [agent-checks-failed.png](2026-10-27-evidence/agent-checks-failed.png).
- After saving a concrete bench test requiring `42`, running checks returns one passed case. The run badge says **Failed**, the expanded body says **Every check passed**, and the toast says **1 of 1 checks passed**. The page explicitly says it does not read everything the run could not establish; that missing evidence may explain the overall failure but is not exposed. Screenshot: [agent-checks-contradict-status.png](2026-10-27-evidence/agent-checks-contradict-status.png).
- `components/agent-foundry.tsx` (`ChecksPanel` / evaluation status and case summary) and evaluation API. **Acceptance:** display the overall gate reason, distinguish generated coverage estimates from executable cases, and make the offered recovery achievable. Never turn a failed run green merely because returned individual cases passed.

### FLOW-009 — P1: starting a newly published quiz can fail before authoritative publication settles

- **Live, instance 8.** Create a one-question short-answer quiz, edit question/answer/explanation, Publish, then Attempt. First two starts returned server errors; backend log includes `QUIZ_PRACTICE_NOT_PUBLISHED`. Generic 500 request reference `77ed056f` captured. A later Attempt succeeded with no content change; `42` synchronized, submitted and scored 100%, with correct explanation/result inspection.
- Screenshot captured during the initial failure: [quiz-attempt-fails.png](2026-10-27-evidence/quiz-attempt-fails.png). Work ID `z977hwnvxjxm9k3h7mna9ccmjh8fdft4`.
- **Acceptance:** a newly enabled Attempt must operate on an authoritative published version, or show a specific wait/retry state. Test rapid Publish → Attempt, slow save, reopen and two browsers. Investigate snapshot/collaboration publication timing rather than masking the server guard.

### FLOW-010 — P2: administration describes implementation contracts instead of helping a school operator

- All 11 school-admin sections and seven superadmin sections were opened. Several are mostly explanations of internal boundaries. Integrations leads with “verified tenant capabilities, exact identity matching, provenance, quarantine” and lists tombstones/manifests. Governance is a capability charter with no review queue despite Overview's “Review governance” action. Agents/resources describes permission inheritance rather than the next useful action. Superadmin exposes similarly dense operational vocabulary.
- Evidence: [admin-integrations-jargon.png](2026-10-27-evidence/admin-integrations-jargon.png), [admin-usage-chart-without-context.png](2026-10-27-evidence/admin-usage-chart-without-context.png). Usage's large chart has no visible axes, category labels or legend at rest, so its bars cannot be interpreted without hovering; metrics above mix bytes and model tokens.
- **Designer follow-up:** retain the established paper/ink type hierarchy, make real status and next actions primary, translate required technical settings, and remove internal contract explanations from routine user flows. Check context drawer density, meaningful empty states, accessible chart descriptions and narrow widths. This is intentionally deferred rather than changing the admin information architecture piecemeal.

### FLOW-011 — P0: reopening a Word-saved linked document duplicates earlier paragraphs in Spectra

- **Live, instance 8 + installed Microsoft Word.** Dedicated audit folder: create DOCX → Bridge imports → edit last paragraph in Spectra → verify physical DOCX → external three-paragraph rewrite converges live → close editor → Microsoft Word COM opens that exact DOCX, appends one paragraph, saves/closes → reopen in Spectra.
- Physical DOCX independently read with Mammoth contained exactly four paragraphs. Spectra displayed those four, then the earlier three again (seven paragraphs). No deliberate duplicate was typed. Screenshot: [native-word-reopen-duplicates-content.png](2026-10-27-evidence/native-word-reopen-duplicates-content.png). The physical file still contained only four paragraphs when read after observing the bad editor.
- Investigate the native projection/Yjs bootstrap merge, stable paragraph identities across Word serialization, and `editor/document-studio-projection.ts` / `components/document-studio.tsx`. Preserve the local disposable file for reproduction.
- **Acceptance:** native save/reopen must show each paragraph once, subsequent Spectra edits must not materialize duplicates, with content/formatting preserved in Word and two browsers. This is a launch blocker requiring work on the shared document path.

### FLOW-012 — P1: a sequential Excel save raises an opaque conflict over untouched cells

- **Live, instance 8 + installed Microsoft Excel.** Imported workbook A1=12, A2=30, A3=SUM(A1:A2). Spectra changes A1 to 20; wait for Saved and independently verify disk A1=20. Microsoft Excel opens it, confirms A3=50, changes A2 to 22 and saves/closes. No concurrent Spectra edit.
- Spectra flags A2 and A3 as changed by both sides, retains A2=30/A3=50, and exposes truncated JSON as the conflict comparison, including `formulaCache: absent/present`. Screenshot: [native-excel-sequential-edit-conflict.png](2026-10-27-evidence/native-excel-sequential-edit-conflict.png).
- **Acceptance:** baseline acknowledgement must settle before reporting Saved; an ordinary later Excel edit must merge when Spectra has no pending changes. Show human-readable sheet/cell/value comparisons for real conflicts. Keep Excel version was exercised only on this disposable fixture; owner's files were untouched.

The file-selection follow-up also reproduced FLOW-012 with a freshly selected workbook that was only opened/viewed in Spectra: external Excel changed A1 from 20 to 25, yet Spectra raised a competing-version warning over A1/A3. Keep Excel recovered 25/22/47. [Additional evidence](2026-10-27-evidence/file-sync-excel-existing-conflict.png). Investigate bootstrap/baseline state as well as acknowledgement after actual edits.

### FLOW-013 — P1: a sequential PowerPoint save also produces a false competing version

- **Live, instance 8 + installed Microsoft PowerPoint.** Exported the two-slide audit presentation into the dedicated Bridge folder. Edit its first title in Spectra to `Edited slide in Spectra`; wait for Saved. PowerPoint COM independently reads that exact title, changes it to `Saved by Microsoft PowerPoint`, saves and closes. Spectra returns to an older title and presents both slides as competing changes, including the untouched second slide.
- Evidence: [native-powerpoint-sequential-edit-conflict.png](2026-10-27-evidence/native-powerpoint-sequential-edit-conflict.png). Keep PowerPoint version recovers the expected title. No owner presentation was edited.
- **Acceptance:** acknowledge the native baseline before Saved, merge an ordinary later native save, preserve slide content and geometry, and show a readable comparison for real conflicts. Investigate alongside FLOW-012; do not paper over conflicts globally.

### FLOW-014 — P1: a public whiteboard loses its authored geometry and appearance

- **Live, instance 8, anonymous second browser.** Create an audit board with a cyan rectangle approximately 240 × 150 and text `Launch checklist`. Reopen retains the original. Create a read-only public link, then open it anonymously: the shape is rendered as a small white text card approximately 220 × 32, losing its authored size, fill and placement.
- Evidence: [public-whiteboard-loses-layout.png](2026-10-27-evidence/public-whiteboard-loses-layout.png). The public view correctly withheld editing controls; revoking the link then reloading denied access. The audit link is revoked.
- **Acceptance:** public and embedded read-only renderers must preserve board geometry and styling, with no edit capabilities or private metadata exposed. Review the public projection/rendering path rather than redesigning the board editor.

### FLOW-015 — P1: operator connector navigation silently leaves the selected school

- **Live, instance 9.** Superadmin → Schools → enter `AUDIT-20261027 Empty School` in Inspect mode with an explicit audit reason. The banner identifies that school and the overview correctly shows zero members and ManageBac Not configured. Press **Sync settings** in its context panel.
- Actual destination is plain `/managebac`, the operator banner disappears, and the page shows **The Global College**, Connected, with its 22 classes and Disconnect action. The destination uses the operator's own membership instead of the operational school. No change to that connection was made.
- Before/after evidence: [operator-empty-school-context.png](2026-10-27-evidence/operator-empty-school-context.png), [operator-sync-settings-opens-own-school.png](2026-10-27-evidence/operator-sync-settings-opens-own-school.png). Back restores the operator banner; End session returns to Schools.
- **Acceptance:** carry authorized operational context to supported admin routes, or explicitly explain and disable unsupported operations. Never silently switch school identity from an operational action. Inspect mode also leaves Invite people enabled; verify all write controls clearly reflect inspect permissions and the server still rejects writes. No invitation was sent.

### FLOW-016 — P1: invalid first ManageBac credentials leave setup in a contradictory state

- **Live, isolated audit school on instance 9.** Accept its initial administrator invitation through `/join`, open School → Connection → Connect ManageBac, and enter the deliberate dummy credential `invalid-audit-key` (not a real secret). The dialog closes, the page says **Validating… / Checking ManageBac** and the normal Sync action remains disabled.
- After more than a minute, Resolve my school identity returns `INTEGRATION_SYNC_BUSY` (409), followed by `INTEGRATION_CREDENTIAL_REJECTED` (500). The page tells the already signed-in school administrator to ask an administrator to reconnect, while still showing Checking. Evidence: [managebac-invalid-key-stuck-validating.png](2026-10-27-evidence/managebac-invalid-key-stuck-validating.png).
- Disconnect confirmation and completion worked on the disposable connection; its secret was revoked. The original school's key was untouched. Local development deliberately offers a server test-key fallback; source/tests restrict this away from production. That fallback is not a reported production defect.
- **Acceptance:** credential rejection must settle the validation state, release leases and offer the administrator a direct corrective action. Distinguish user credential errors from a generic 500 and competing sync from credential failure. Test blank key in production configuration separately.

### FLOW-017 — P2: the unassigned account's Home sends it to another failed surface

- **Live, instance 9, second existing Clerk account before joining any school.** Home shows `Your calendar couldn't load. Open Calendar to see your week.` rather than explaining that school membership is required. School correctly says to accept an invitation, and Open invitation without a token leads to useful instructions to contact a teacher/admin.
- After accepting the isolated school invitation, Home correctly shows an empty week and no deadlines. The acceptance completed without email delivery, using a token created through the normal authorized school mutation. No Clerk account/password was created or changed.
- **Acceptance:** no-membership Home and Calendar should offer the actionable invitation path, with truthful empty/error states and no suggestion that navigation alone repairs missing access. Re-capture this state using a fresh unassigned fixture before implementing.

### FLOW-018 — P2: Home's week columns collide at narrow widths

- **Live, instance 8.** At 390 × 844 and 768 × 1024, weekday/date labels overlap or clip. Desktop Home also becomes cramped with the Threads rail open. Evidence: [mobile](2026-10-27-evidence/mobile-home-overlapping-columns.png), [tablet](2026-10-27-evidence/tablet-home-date-labels-overlap.png).
- Preserve the Home's established appearance; this needs a responsive layout decision, not a redesign. **Acceptance:** readable dates/tasks without overlapping columns, including rail-open desktop, keyboard navigation and touch scrolling.

### FLOW-019 — P2: all-day calendar tasks lack an obvious reschedule path

- **Live, instance 8.** A disposable all-day personal task's popup offered completion/removal, with no date/reschedule control. Dragging did nothing, although the page said to drag a task to another day. Source confirms these all-day chips are not draggable; this does not establish that timed tasks fail.
- Evidence: [calendar-all-day-task-no-reschedule-control.png](2026-10-27-evidence/calendar-all-day-task-no-reschedule-control.png). The disposable task was removed through its normal confirmation.
- **Acceptance:** all-day and timed personal tasks have a clear working reschedule action, consistent with page instructions, and update Home/Calendar after reload.

### FLOW-020 — P2: plain-text import flattens a single newline

- **Live, instance 9.** Importing an audit `.txt` containing two lines separated by one newline produced one paragraph joined by a space; copy/reopen retained the flattened text. Evidence: [plain-text-import-flattens-newline.png](2026-10-27-evidence/plain-text-import-flattens-newline.png).
- Establish intended plain-text semantics before changing the importer; a line break and a blank paragraph should be tested separately. **Acceptance:** import faithfully preserves meaningful lines and paragraphs without interpreting plain text as markup.

### FLOW-021 — P2: command search ranks unrelated work above an exact navigation command

- **Live, instance 9.** Search `Analytics`, wait for results to settle: unrelated work/thread results occupy the visible list and **Open Analytics** is below them; Enter opens unrelated work. The workspace import command has the same discoverability problem.
- Evidence: [command-search-unrelated-results.png](2026-10-27-evidence/command-search-unrelated-results.png). `commands/kbar.ts` assigns result entries a fixed score of 100, above a matching command's score. That is a source inference explaining the observed order, not a relevance evaluation of every result.
- **Acceptance:** an exact command name is easy to discover and execute; semantic suggestions do not unexpectedly intercept a clear navigation request.

### FLOW-022 — P1: workspace import command does not open its picker

- **Live, instance 9.** Invoke **Import workspace** through the command bar: no file chooser appears, and the command reports that its handler did not confirm completion. Evidence: [workspace-import-command-unavailable.png](2026-10-27-evidence/workspace-import-command-unavailable.png).
- Investigate the `spectra-shell` `library.import` handler's void return and browser user-activation timing around the command dialog. Do not merely return success without a working picker.
- The import processor was separately exercised with Playwright `setInputFiles` on its existing input using an actual exported audit workspace. Processing succeeded; this **does not count as a successful user entry flow**. The resulting temporary workspace was removed through typed confirmation, leaving source artifacts intact.

### FLOW-023 — P2: imported workspace references look empty despite linking to intact work

- **Live, instance 9.** Workspace export downloaded a 684-byte metadata/placement JSON. Importing it created two references whose shelf cards said generic **File / Nothing in it yet**; opening the deck still showed its original two cards.
- Evidence: [workspace-import-reference-cards-empty.png](2026-10-27-evidence/workspace-import-reference-cards-empty.png). This is a reference/card projection issue, not proven content loss. The export toast's “1 fidelity note” does not explain backup limitations in context.
- **Acceptance:** reference cards show their correct type/preview, and export/import clearly explains whether content bytes or references are being transferred. Preserve the original work's identity.

### FLOW-024 — P1: task calendar export drops the settings shown in the task

- **Live, instance 8.** Configure the audit task with weekly repeat, a reminder, a 30-minute estimate and High priority, then Export to calendar. The downloaded VTODO contained UID, summary, status, due date and description, without the repeat rule, alarm, duration or priority. Calendar display name was still `New Task` despite the edited title.
- Evidence: [task-calendar-export-drops-settings.png](2026-10-27-evidence/task-calendar-export-drops-settings.png). `plan/projections.ts` `planToIcs` emits only those basic properties. The UID uses `task-1@spectra`; collisions across separate task works are a **source-based concern requiring a two-file calendar import test**, not a claimed live reproduction.
- **Acceptance:** exported recurrence/reminders/identity are preserved where supported, unsupported fields are clearly disclosed, two exported task works remain distinct, and importing into an actual calendar produces the advertised schedule. Repeat/reminder were reset to none after the audit to avoid future notifications.

### Additional exercised behavior

- Flashcards: two cards edited/added; reveal, typed correct answer, Good rating and finished queue showing two Good results. Transient warning is FLOW-007.
- Task: title/notes, tomorrow without a time, checklist creation/tick, complete/reopen, high priority and reload all retained. Audit task `z975aym5t83kz68sdvs501nt758h2way`. Repeats, reminder, duration and ICS were exercised (FLOW-024). Linking a document survived reload, opened the correct work, then removed successfully. All combinations remain unverified.
- Presentation: two edited slides, speaker notes, slide navigation, audience/speaker view, blackout/unblack and exit. Reopen retained title/content. PowerPoint export downloaded a 50,443-byte package with both slide XML parts. Export filename came from first slide (`Launch-readiness.pptx`) rather than the work title; assess naming consistency. Audit work `z972wp74k0b2f8sv3x4h6ff76s8h375b`.
- Code: HTML preview rendered, its button ran JavaScript, new `audit.js` created and deleted through confirmation, saved index content survived reload. Audit work `z978kkkj7wr50f1mdafb9m594n8h3z2z`.
- Admin: temporary group created with self as member, then archived; announcement immediate/scheduled form and cancel; profile rejected invalid IANA timezone and did not save it. No announcement sent. Audit/feedback/resources/integrations/governance/profile/usage all inspected.
- Bridge: selected a dedicated `.spectra-local/launch-readiness-native` folder through the native Windows picker; DOCX/XLSX/PPTX appeared in Library. Actual installed Word/Excel/PowerPoint COM save/reopen paths were exercised, with independent physical file readback (FLOW-011/012/013). Folder removal preserved all three physical SHA-256 hashes. “Ask first” remains the user's policy. See the separate record for isolated file selection, multi-select and restart.
- Library: workspace icon/description persisted, dragging the copied imported document by its icon into the visible audit workspace worked and survived reload. Copy → Trash → Restore returned to its original workspace. Failed drag attempts from text/offscreen targets were automation mistakes, not reported product defects.
- Threads: search, rename, pin/reload/unpin, stopped runs and run history inspected. A deleted audit thread restored from Library Trash reappeared after reload; rail invalidation needs a repeated reproduction before altering shared caching.
- Analytics: 7/30/90-day selection changed the date range correctly and partial coverage is disclosed. A displayed workspace count differed from the visible Library root count, but those populations were not established as equivalent; no data-integrity bug is claimed.
- Confirmed false alarms excluded: presentation controls during a transition/idle state; brief Bridge code before automatic resume; tour highlight during animation; apparent dark-mode contrast before the theme settled; development-only ManageBac server-key fallback. These are not findings.

## Behaviors exercised successfully so far

- Both instances' home and School pages load their own populated/sparse state, with current week and due tasks.
- School tabs, class selection display, connection navigation, history and conflict navigation work; live sync fetched updated source titles. Unresolved conflicts remain above.
- Admin overview and People refresh/search; invitation modal invalid address rejection, case-insensitive duplicate removal, pasted `Name <email>` parsing, role change, plural submit label and cancel. No invitation email was sent.
- Superadmin Overview, Schools/search surface, Operations, Usage & finance, Feedback & requests, Governance, Audit & security, Add school dialog and cancel. Lifecycle, emergency-stop and other global mutations have not been exercised.
- Bridge native pairing, global and per-file pause/resume, native folder selection/removal, single/multi-file selection and process restart. Native edits reached Spectra, but the documented content/conflict defects prevent a general round-trip pass.
- Document creation, rename, autosave, reopen and history view (content corruption above prevents a pass).
- Sheets: create, settled rename, A1=12, A2=30, A3=`SUM(A1:A2)` evaluates to 42; reload preserved all three cells. Audit work `z97dtg7yvtmp19vfc9ewygdya98h38ag`.

## Automated verification and remaining release work

- Final complete Vitest suite: **615 files passed, one skipped; 5,317 tests passed, one skipped**. Node suites: **12 passed**. One earlier feature run exceeded the unchanged dense-workbook timing assertion (283 ms against 250 ms) under concurrent load; isolated and final full-suite checks passed without weakening the threshold.
- TypeScript passed; Rust workspace **154 tests passed**; native app and production Next builds succeeded; architecture/capability/copy/secret gates passed. Details are recorded alongside the file-selection implementation. A build or suite pass does not invalidate the live failures above.
- Existing lint debt: four CommonJS import errors in ignored `.backups/managebac-local9-deploy.cjs`, plus six warnings (unused authority argument, cookie-banner tokens, calendar effect dependency, artifact history memo dependency, avatar image). Design token check reports 14 existing violations, including icon imports and very small typography. Do not redesign the landing page to clear unrelated warnings.
- Production deployment environment validation was **skipped by its script** because this is a local environment. Production credentials, email delivery/OAuth/reset, released installers/updater, emergency-stop/school lifecycle operations, every role combination, arbitrary Office formats, long-lived/offline collaborative sessions and exhaustive mobile editor interactions remain unverified.
- Before launch: resolve and repeat the two P0 document cases, native sequential sync conflicts, quiz publication race, ManageBac first-setup recovery, misleading People failures and cross-school operator navigation. Then repeat the affected live paths and release checks against the actual production candidate. The scope above is broad but is not proof that every possible flow works.
