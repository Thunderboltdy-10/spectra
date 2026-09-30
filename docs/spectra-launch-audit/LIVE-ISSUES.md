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

## Summary

_Written by the verifier at the end._

## Coverage

| Script or area | Report | Result | Issues | Commit tested |
| --- | --- | --- | --- | --- |
| Local runtime bootstrap (fresh Convex) | Run and test · local startup | PASS | LV-001 | 690266bc |
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
| P3-EDITORS — quiz same-prompt concurrent text edits (E2 quiz portion) | P3-EDITORS · Needs live verification · save does not revert a peer | FAIL — in two valid concurrent runs, A and B stayed on different prompt text for more than six seconds with no conflict banner; after reload, one run showed `colors` and one showed `color` | LV-018 | 7c0e4b55 (app code) |
| P3-BRIDGE-LENS — new document and Library browser health requests | P3-BRIDGE-LENS · step 9 | FAIL — Browser B initial open showed 180 console errors and reload showed 4 more; Browser A's later Library/editor session log had 96 CORS and 96 `net::ERR_FAILED` lines for Bridge health requests | LV-012 | 6451c630 (app code; Bridge predated this task) |
| P3-BRIDGE-LENS — post-fix Bridge restart | P3-BRIDGE-LENS · step 9 | BLOCKED — the Bridge was already running before this task; the user instructed the verifier not to stop or restart a process it did not start | LV-012 | ed76ef1f |

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

- **Status:** FIXED
- **Severity:** High
- **Surface / role:** Quiz editor / signed-in school administrator using two browser sessions
- **Report script:** P3-EDITORS · Needs live verification · Save does not revert a peer (E2), step 2
- **Commit tested:** `7c0e4b55` (app code; local instance 8)
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
