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
- **Local test authorization (2026-09-30):** The user explicitly authorized edits to the repository-root `.env.local` for this verification run. Profile A may be used as the initial administrator of a locally created test school, and the configured ManageBac API key with its standard base URL may be used for non-mutating connection/read checks. The authorization does not permit sending real invitation emails or changing data at a real school. Convex is configured to a fresh local deployment; SMTP uses loopback with no listener, so invitation email is not sent and the app's manual-link path is used.

## Coverage

| Script or area | Report | Result | Issues | Commit tested |
| --- | --- | --- | --- | --- |
| Local runtime bootstrap (fresh Convex) | Run and test · local startup | PASS | LV-001 | 690266bc |
| Signed-in workspace gate with no school | exploration · first use | PASS | LV-008 | 683803d1 |
| Artifact read during Workspace and Library navigation | exploration · workspace surfaces | FAIL | LV-009 | 683803d1 |
| P2-EXPERIENCE step 1 — `/join` without token | P2-EXPERIENCE · step 1 | PASS | — | 690266bc |
| P2-EXPERIENCE step 2 — expired invitation | P2-EXPERIENCE · step 2 | BLOCKED — no actual expired stored invitation was available; LV-003 is NEEDS-DECISION | LV-003 | d551198a |
| Superadmin local school record creation | exploration · create school | PASS | — | 683803d1 |
| Initial school administrator invitation acceptance | W2-14 · step 1 | PASS | LV-004 (CANNOT-REPRODUCE) | 683803d1 |
| W2-14 step 1 — initial-admin workspace/Library reloads | W2-14 · step 1 | FAIL | LV-009 | 683803d1 |
| ManageBac admin token connection | README · Open launch risks | BLOCKED — not yet run | — | 683803d1 |
| `/school-data` without membership | exploration · first-week superadmin | FAIL | LV-005 | d551198a |
| ManageBac personal overview without membership | exploration · first-week superadmin | FAIL | LV-005 | d551198a |
| `/analytics` without membership | exploration · first-week superadmin | FAIL | LV-006 | d551198a |
| P3-SURFACES-2 · step 8 — ManageBac disconnect | P3-SURFACES-2 · step 8 | PASS | LV-007 (CANNOT-REPRODUCE) | d712d92b |

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

- **Status:** FIXED
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

- **Status:** NEEDS-INFO
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
- Commit: assessment only; no application change yet.
- Root cause: Not established from the redacted request. The shell can restore and hydrate saved open-artifact IDs on Workspace and Library; the route forwards its artifactId to the typed spectraArtifacts:get query. That path enforces membership and resource capability, while argument validation runs outside the worded-error handler; the specific response/backend reason is needed to distinguish a stale or malformed ID from a genuine backend failure.
- Change: none pending the diagnostic evidence below. Code inspection also finds the restored-artifact hydration effect uses Boolean(overview), so a no-school overview starts detail reads; that accounts for the separately observed pre-membership 403. Do not convert arbitrary backend failures to missing work or discard saved work based on a transient error.
- Test: **43/43** current API-route, shell-artifact-access, shell-artifact-content and deployed worded-error tests passed. A temporary real-model diagnostic reproduced HTTP 500 / INTERNAL_ERROR for a generated different-table ID submitted as artifactId; argument validation precedes the worded function boundary. Its deployed-error suite passed **5/5**, and the diagnostic source edit was restored byte-for-byte. This demonstrates a possible cause without establishing that the live request has such an ID; its backend reason is still needed.
- Re-check nearby: saved open work and deep links on both surfaces, before membership and after acceptance, with separate outcomes for invalid IDs, deleted/denied work and transient failures.

**Question for verifier:** Please report the failed response's structured error.code and matching local server/Convex error reason with IDs, tokens and identity redacted. Was the artifact created in instance 8, or restored from saved browser state? For a validation error, report only the field/table name and generic reason, never the ID value. The verifier has confirmed INTERNAL_ERROR and generic public copy but cannot identify provenance from the UI. The fixer found no persisted server logs in the instance 8 logs directory or live-verification folder; please provide the local Next/Convex stdout log path or launch terminal/exec session ID so the fixer can read the diagnostic. No diagnosis, database inspection, environment contents or provider/production change is requested from the verifier.

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

- Implementation commits: `454a7bbe` — complete foreground Convex selection (LV-001); `94d3cbb3` — settle account reads before school membership (LV-002); `95243861` — gate School and ManageBac readers on current membership (LV-005); `66179153` — reuse the membership gate for Analytics (LV-006); `683803d1` — wait for reactive membership before school subscriptions (LV-008).
- Audit/assessment commits: `690266bc`, `3df6301a`, `d551198a`, `d3bac8ce`, `6f1391aa`, `d4e0f766`, and `d712d92b` record validation, decisions, and live evidence. Each implementation entry gives its full commit hash and re-check instructions.
- Latest full suite (`npx vitest run`): **4,330 passed, 2 failed, 1 skipped**; **496 passed files, 2 failed, 1 skipped**. Duration: 301.20 seconds. Raw local result: `.spectra-local/launch-fixer-LV008-full.log`. The unchanged no-school Stop case returned 409 instead of 403, and the unchanged dense-sheet timing assertion took 43.89 ms against 40 ms. Both files passed **136/136** tests in an isolated rerun (`.spectra-local/launch-fixer-LV008-isolated.log`). The preceding full run was green: 4,326 passed, 0 failed, 1 skipped.
- LV-009 is **NEEDS-INFO**: 43 triage tests pass; the exact failed request needs a structured response code, redacted backend reason, and saved-versus-new artifact provenance before a root fix can be selected.
- Focused validation: LV-005 **29 passed**; LV-006 **34 passed**; LV-008 **47 passed**; both TypeScript checks, full lint and all five gates passed for each fix. LV-008’s five original regression cases failed before the fix; its six-case guard suite now passes, including saved open-object reads and reactive membership transitions. LV-004's temporary generated-token real-model diagnostic and related suites passed **16 tests**, and its diagnostic source edits were restored. Earlier LV-001, LV-002 and LV-003 results remain in their entries.
- LV-007 assessment: **8 tests passed**, including temporary idle-versus-pending Escape diagnostics; no application/test source change remains. It is **CANNOT-REPRODUCE** for the report's pending-disconnect requirement because the live steps only opened the idle confirmation.
- LV-003 remains **NEEDS-DECISION**: keep the intended invalid/expired 404/410 responses, or change the API/client contract to a normal unavailable-preview result. LV-004 is **CANNOT-REPRODUCE**: the original mail link contained MIME encoding artifacts; the verifier followed the decoded 43-character-token href and obtained a valid preview with Join school enabled. No invitation authentication patch was needed.
- No issue remains OPEN, REOPENED or FIXING in this pass. The verifier has marked LV-001 and LV-002 VERIFIED; LV-008 is now VERIFIED; LV-005 and LV-006 await live re-check. Initial-admin acceptance continues using the decoded invitation link.
- Live coverage continues under the recorded local-verification authorization. Per the user's instruction, the fixer stops between tasks and resumes when the verifier messages it about a ledger issue.
