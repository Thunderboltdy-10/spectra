# Spectra deeper launch review — 27 October 2026

Continuation of [the original user-flow audit](2026-10-27-USER-FLOW-AUDIT.md), after the owner's intervening repairs and additions. The original ledger describes an earlier baseline; do not treat its findings as independently revalidated here unless listed below.

**Current status:** [REMAINING-IMPLEMENTATION](2026-10-27-REMAINING-IMPLEMENTATION.md) supersedes the handoffs below where it supplies an implementation and acceptance record. Read it first when continuing the audit.

**Later functional repairs:** after the owner authorized complex non-frontend fixes, [the functional follow-up](2026-10-27-FUNCTIONAL-FIXES.md) repaired the document typing/navigation and quiz publication/submission paths, hardened native pairing, and partially addressed conflict comparison and agent evaluation. Read that report for current validation and remaining limitations; the findings below describe the earlier review baseline.

Baseline commit: `12186235` — `Improve launch flows and administration`, created before this review, without a co-author. Branch: `launch-readiness-audit`. This is an execution ledger, not a launch certification.

**Release assessment: blocked by DEEP-001 content corruption.** DEEP-006 also reproduces a publication delay beyond the existing retry window. The native identity-change concern in DEEP-002 still needs an isolated regression before Bridge can be called reliable across accounts. Passing automated tests do not close these live findings.

## Changes pursued

- **DEEP-FIX-001 / FLOW-005:** `bridge/use-bridge.ts` retained the previous computer and mounts in React state after authenticated status and resume both rejected the session, despite the client clearing their persisted cache. Clear that in-memory identity when the remembered cache has been invalidated; preserve it during a temporary network outage. Explicit Forget also clears the state. Regression failed before the fix and passes afterward. Discovery/model/Devices suites: **36 passed**. This does not delete cloud devices or infer that two similarly named computers are the same machine.
- **DEEP-FIX-002:** three pre-existing test expectations still described earlier UI: the removed School context panel/Member roles action, raw `membership` target text, and the conflict label `Keep in Spectra`. Updated them to the current People navigation, humanized Member target, and Keep mine label. Both affected suites: **12 passed**; no product behavior changed for those expectations.
- **DEEP-FIX-003:** at 390px, the Devices card footer clipped Remove and reduced its device facts to zero width. A small media rule in `src/styles/spectra-devices.css` lets the footer wrap and gives the facts their own line. Actual browser measurement after the fix: footer `scrollWidth === clientWidth === 294`; all action buttons stay inside it. [Before](2026-10-27-deep-evidence/mobile-devices-actions-clipped.png), [after](2026-10-27-deep-evidence/mobile-devices-actions-after.png). No redesign.
- **DEEP-FIX-004 / FLOW-009 partial recovery:** a live immediate quiz attempt returned a generic 500, hiding `QUIZ_PRACTICE_NOT_PUBLISHED` from the already implemented retry. Give that specific backend refusal a safe sentence and HTTP 409; inspect the structured error code in `quiz-studio.tsx`; show a failed start in preview, where its error is visible. Retries remain bounded and reuse the same attempt ID. Three regressions failed before the fix; all **16 tests** in the two focused suites pass afterward. Actual browser now receives coded 409s, retries five times, then displays a specific publishing message. **The underlying publication latency remains DEEP-006.**

## Findings and handoff

### DEEP-001 / FLOW-001 — P0: ordinary document typing still corrupts text

**Live, instance 8, after the new baseline.** Library → New → Document. At 80 ms/character type `First typing line.`, Enter, Ctrl+B, `Second bold line.`, Ctrl+B, Enter, `Third plain line.`.

Actual persisted HTML:

```html
<p data-block-id="intro">First typing line.</p>
<p data-block-id="block_e663feec-18f9-4781-a91d-d2698518923f"><strong>econd bold line.</strong></p>
<p data-block-id="block_47c5a666-148f-44fc-872f-e07945196a79"><strong>Third plain line.S</strong></p>
```

The leading `S` migrates from the second paragraph to the end of the third; the intended plain third paragraph stays bold. Reload, wait for room hydration, and the corruption remains. No page exception or failed HTTP request accompanied this reproduction. Do not mistake the editor's initial empty hydration frame for content loss.

Fixture: instance 8 work `z97cvt1x6ewz80facyqg6vh3118h268k`, renamed `DEEP-AUDIT-20261027 Document typing`. [Screenshot](2026-10-27-deep-evidence/document-typing-still-corrupts.png).

**Handoff:** investigate the live TipTap/Yjs selection and local-update feedback paths in `components/document-studio.tsx`, `editor/document-studio-projection.ts`, and `collaboration/use-artifact-collaboration.ts`. The intervening fixes did not close this acceptance case. Shared-editor changes are deliberately deferred. Require an exact real-browser regression for Enter + immediate formatting/typing, undo/redo, hydration, two browsers and offline replay before marking fixed.

### DEEP-002 / FLOW-005 — P1 investigation: native pairing can reuse old folder state across identity changes

**Source-confirmed concern, not a demonstrated cross-account data transfer.** The actual installed Bridge was stopped at review start. Starting the existing executable and clicking I already have it resumed its existing device `n5753s5e641m9a85hke5gmcc6n8h2d6z` as THUNDERBOLTDY10 with zero selections. This run did not reproduce old folders returning under a healthy same-account pairing.

Two distinct state paths need care:

1. The rejected browser-session stale React state is fixed in DEEP-FIX-001. Fault injection returned 401 for authenticated status and resume while the real health endpoint stayed healthy. Before the fix the UI still labelled the remembered identity This computer although both cache/session keys were gone.
2. Native `main.rs::deployment_for_offer` persists the offered deployment URL **before** resume/confirmation succeeds. `complete_pairing_offer` can repair invalid credentials and overwrite `device_id` without clearing or re-binding the existing in-memory grants and `cloud_mount:` mappings. Startup binds `file-mount:` grants to the persisted device, but legacy `mount:` folder grants have no equivalent ownership field. A cancelled switch, deployment replacement, or repair into another account needs an isolated two-account/two-deployment regression before release. Do not solve this by deleting the owner's cloud devices or silently adopting all remembered folders.

**Handoff/acceptance:** keep the old pairing intact on cancel or failed handshake; commit deployment/identity atomically with successful pairing; preserve same-owner reconnect selections; explicitly reset or re-authorize selections on ownership/deployment change; ensure active watchers, pending writes, cloud mount IDs and migration flags cannot target the wrong account. Re-run installed-binary restart, revoked credentials, account switch and deployment switch with disposable files. This is broader native lifecycle work, deferred rather than patched speculatively.

Relevant code: `bridge/bridge-app/src/main.rs`, `src/features/spectra/bridge/client.ts`, `src/features/spectra/bridge/use-bridge.ts`, and `src/features/spectra/devices/model.ts`. [Rejected-session page after the browser fix](2026-10-27-deep-evidence/bridge-rejected-session-after.png); the healthy cloud device row legitimately remains, but it is no longer labelled This computer. See original FLOW-005 for the earlier offline-folder observation.

### DEEP-003 — P1: school administration reports no action needed despite unresolved sync conflicts

**Live, instance 8.** Admin Overview says Nothing needs you right now and ManageBac Connected, with an old freshness date. ManageBac → Sync history reports Needs review and three unresolved conflicts, including after a real manual Sync now. No owner conflict was resolved for testing.

Evidence: [admin overview](2026-10-27-deep-evidence/admin-connected-despite-conflicts.png), [latest sync](2026-10-27-deep-evidence/managebac-latest-run-needs-review.png). `pages/school-admin-shell.tsx::schoolNeedsNothing` only checks connection state, school status, invitations and feedback; its overview contract has no unresolved-conflict count. Connected transport and completed useful synchronization are different facts and should both be visible. **Handoff:** extend `convex/administration.ts` and the administration projection with authoritative review/freshness status, then give the operator a direct review action. Verify healthy, stale, failed, missing-key and unresolved-conflict cases consistently across Overview, Integrations, School and ManageBac. Shared status/UI work deferred.

### DEEP-004 / FLOW-004 remaining — P1: conflict choices still lack the full information needed to choose

**Live, instance 8; source confirms the truncation.** Conflict view now explains its three choices and shows source before → after, an improvement over the earlier audit. But long descriptions are cut to 80 characters with no expand/full-text control, and the actual current Spectra value is absent. [Screenshot](2026-10-27-deep-evidence/conflict-comparison-truncated.png).

`pages/managebac-integration-shell.tsx::fieldValue`, `changedFields`, `ConflictList`: comparison uses the already truncated display string, so changes after the first 79 characters can also disappear from the displayed field list. This latter masking is a source-confirmed edge case, not a newly synthesized live conflict. **Handoff:** compare complete normalized values before presentation, offer complete source-before/source-after/current-local values and keep the three choices understandable. Preserve real owner overlays. Test long text with identical prefixes, empty/removal values, rich text and dates. Deferred because this needs a coherent comparison surface and authoritative local-value projection.

### DEEP-005 — P2: school feedback inbox omits submitted visual evidence

**Live existing report plus source contract inspection.** Instance 8 Admin → Feedback → the existing report titled Testing an attached picture alongside the page shot shows message, status and response but no image, attachment or page capture. [Screenshot](2026-10-27-deep-evidence/admin-feedback-no-picture.png). This review did not submit a fresh feedback upload and does not certify that the historical attachment bytes still exist.

`convex/administration.ts::feedbackInbox` does not return screenshot/attachment URLs or identifiers, and `pages/school-admin-shell.tsx::FeedbackSurface` has no viewer. The platform feedback inbox has a richer attachment projection. **Handoff:** expose permission-checked available files to the school operator and reuse an accessible preview/download treatment; test missing/revoked storage and school isolation. Backend plus medium UI work deferred.

### DEEP-006 / FLOW-009 remaining — P1: new quiz publication takes longer than the attempt recovery window

**Live twice before the narrow recovery fix; live again afterward on current local functions.** New Quiz → edit short-answer question and expected answer → Publish → immediately Attempt. Before DEEP-FIX-004: repeated clicks appeared inert in the builder, because the error only became visible after opening Your attempts; exact response was HTTP 500 / INTERNAL_ERROR, request `b58b15d4`. [Builder with no visible error](2026-10-27-deep-evidence/quiz-attempt-no-visible-error.png), [error found in results](2026-10-27-deep-evidence/quiz-attempt-error-hidden-in-results.png). First fixture later started, accepted `42`, and submitted 100%.

After DEEP-FIX-004, a normally hydrated new quiz asking What is nine plus nine? receives five **409 / QUIZ_PRACTICE_NOT_PUBLISHED** responses using the existing bounded retry, then displays It is still publishing. Press Attempt again in a moment. [After recovery fix](2026-10-27-deep-evidence/quiz-publication-bounded-recovery.png). This is honest recovery, not a successful first-attempt flow. A previous post-fix fixture started when retried later without republishing.

Fixtures on instance 9: `hd7pqpznpg7mvzt8advndztgjd8h3m0s` (42, submitted), `hd7rznhh1hc5944sq135c2tp2s8h2znr` (4, initial captured 500), `hd7vb4p8a9cbxs6mj1wq7fmqjn8h3md8` (early-hydration control, see scope below), `hd7kyn9s6weq4vft40cz5nq9tx8h3xwc` (18, five captured 409s). [Eventual private attempt on the first fixture](2026-10-27-deep-evidence/quiz-attempt-eventual-success.png).

**Handoff:** trace `components/quiz-studio.tsx::publishQuiz`, artifact collaboration/snapshot acknowledgement and `convex/quizPractice.ts::start`. The publication guard is authoritative and must remain. Attempt should be enabled against the acknowledged published version; identify why a Saved-looking client remains ahead of authoritative content beyond the roughly 8.5-second retry delay. Test delayed projection, immediate publication, reload, two browsers and unpublish while retrying. Do not increase retry limits to conceal a broken publication seam.

### DEEP-007 / FLOW-008 follow-up — P1: agent evaluation rejects correct arithmetic through literal phrase checks

**Live, instance 9.** AUDIT-20261027 Agent → Checks → Run checks ran the current 16-case suite against gpt-6-luna. Result: 11/16, Failed. The page now explains overall failures and missing coverage, fixing the earlier contradictory presentation for this path. But required failures include a correct answer `18 + 24 = 42, because adding 18 and 24 gives 42.` marked missing The calculated answer / A clear explanation of the calculation; `90 ÷ 2` marked missing dividing; `12 divided by 0 is undefined` marked missing zero; and correctly evaluating `3 × (4 + 2)` marked missing parentheses. [Overview](2026-10-27-deep-evidence/agent-checks-false-negatives.png), [exact failures](2026-10-27-deep-evidence/agent-checks-false-negatives-detail.png).

`agents/foundry/evaluation.ts::gradeDeterministically` uses literal substring inclusion; `contractCasesForSkill` passes descriptive output requirements into that literal check. **Handoff:** distinguish exact-token assertions from semantic requirements when compiling/checking agent skills. Accept valid mathematical notation and paraphrases while retaining tests for incorrect math and missing explanations. Do not just weaken all checks or turn this run green. The fifth failure concerns a permissions-boundary answer and is not automatically a false negative. Keep the page's explicit warning that judge scores are not independently verified. Evaluation/compiler work deferred.

## Exercised behavior

| Flow | Result |
| --- | --- |
| Actual installed Bridge startup and existing-account reconnect | Healthy `/v1/health`, resumed same identity, Connected, no selections. Ask first preserved. |
| Bridge expired-browser-session recovery | Fault injection reproduced stale in-memory identity; focused hook regression fixed it. Temporary outage regression preserves remembered state. |
| Existing populated and sparse instances | Instance 8 already ready. Started saved instance 9 without reset; current Convex functions applied through normal startup. Both sign-in contexts load. Instance 9 now has synced school data, so it is no longer a pristine empty-school fixture. |
| Class selection on first visit after changes | Both instances presented the new onboarding dialog. Kept the existing eight selected classes using Use selected classes; completed and navigated onward. |
| Document typing/save/reopen/full view | **Failed DEEP-001.** Header rename works in full view. |
| Task creation and properties, instance 9 | Title, tomorrow due date, high priority, weekly repeat, 30-minute estimate, prior-day reminder, checklist item and notes saved; completion/reopen toggled; reload retained fields/notes. |
| Actual task ICS download | Updated title and work-specific UID, PRIORITY:1, weekly RRULE/BYDAY, estimate and VALARM included. Earlier FLOW-024 omissions addressed for this fixture. Recurring all-day alarm behavior in a third-party calendar remains unverified. |
| ManageBac manual sync, history, conflicts and settings | Sync completes with Needs review and retains three owner conflicts. Frequency 180 minutes visible. No replacement key, disconnect or owner resolution performed. DEEP-003/004. |
| All 11 school-admin sections | Overview, People, Groups, Communication, Usage, Feedback, Integrations, Agents, School profile, Rights & privacy, Activity log inspected. Updated typography/copy and labelled usage chart preserved. Invalid invite disables submission; announcement targeting opened/cancelled. |
| People refresh failure | Actual browser route fault injection: 503 leaves the existing member/count visible with retry. Removing the fault and Try again recovers. Earlier FLOW-003 addressed for this path. |
| All seven superadmin sections | Overview, Schools, Operations, Usage, Requests, Rights & privacy, Security inspected. Lifecycle change dialog opened/cancelled. No destructive operation executed. |
| Real look-only school inspection, instance 9 | Entered named empty audit school with a reason; banner and school context correct; Invite people, Fix connection and ManageBac settings disabled. Leave ends the session and returns to platform Schools. Earlier FLOW-015 addressed for this path. |
| Anonymous whiteboard viewing and revoke | Source 240×150 light-cyan Launch checklist card matches anonymous geometry and styling, no editing surface. Both test links revoked; anonymous reload is unavailable. Earlier FLOW-014 addressed for this board. |
| Mobile Home and Devices | 390px Home week scroll now preserves usable day widths. Devices footer clipping fixed in DEEP-FIX-003. No broad restyling. |
| Command search and workspace import entry | Analytics settles with Open Analytics first; Import a workspace opens a real Playwright filechooser. Cancelled without import. Earlier FLOW-021/022 addressed for these entry paths; not a fresh complete workspace backup/restore certification. |
| Agent live checks | Current 16-case suite executes, coverage and overall gate explanations visible. 11 passed, 5 failed; semantic false negatives DEEP-007. No agent published or permission enlarged. |
| Newly published quiz | Initial attempt failure remains DEEP-006; coded bounded recovery fixed, and later first-fixture answer/submission gives 100%. |

## Verification record

- Baseline full suite: **614 files passed, 2 failed, 1 skipped; 5,320 tests passed, 3 failed, 1 skipped**. Failures were the three stale UI assertions addressed in DEEP-FIX-002; those two suites subsequently passed all 12 tests.
- New Bridge regressions and model/page checks: **36 passed**.
- Full suite after Bridge/test fixes: **616 files passed, 1 skipped; 5,325 tests passed, 1 skipped**. After the quiz follow-up: **5,328 assertions passed, 1 skipped**, but two suites failed only in their browser-close `afterAll` hooks (10-second timeouts), during concurrent build/test activity. The affected skip-link and conversation-history suites, together with quiz/route tests, then passed separately: **4 files, 45 tests**. Do not describe the second full run as an all-green suite.
- Quiz/route regressions: **3 failed before the fix; 16 passed afterward** across the two focused files. They cover structured error-code retry with the same attempt ID, visible non-retryable start failure and safe HTTP 409 mapping.
- Node harness/security checks: **12 passed**. Final production build **passed**, including TypeScript and all **35 static pages** (`deep-audit-build-3.log`). A test-only Playwright-style `exact` option was caught by the intervening type check and corrected to an anchored Testing Library name matcher before the successful build. Changed-file ESLint **passed**.
- Final architecture, user-facing copy, capability IR and skills-bundle checks **passed**. Final staged secret scan **passed across 3,906 tracked files**; all 16 local evidence/report links resolve.
- Design-token gate **fails with 14 existing violations**, in files unchanged by this review: five lucide imports (`number-field.tsx`, `code-tray.tsx`, `document-status-rail.tsx`, `quiz/question-answer.tsx`, `workbar-item-selector.tsx`) and nine below-floor font sizes in desk/editor-chrome/editors/embeds/island/school styles. This is recorded design debt, not silently fixed across shared UI. Final diff whitespace check passed. Auto-generated instance-specific `tsconfig.json` additions were restored; generic globs already cover those directories.
- Baseline and focused output retained under ignored `.spectra-local/deep-audit-*.log`; no credentials in this report.

## Scope and fixtures

Routine screenshots are inspected in memory. Only actionable handoff evidence is retained in [2026-10-27-deep-evidence](2026-10-27-deep-evidence/). No landing page changes, real invitation emails or owner credential replacements. Native account/deployment-switch concerns above are clearly separated from actual UI reproductions. Disposable task `hd7s8r6c4tb7zrfbcfjqy5txf58h3dyz` on instance 9 is named `DEEP-AUDIT-20261027 Repeat task`.

Task recurrence and reminders were reset to none; reload confirmed Does not repeat and zero reminders. No public audit links or operator inspection session remain active. The existing native helper remains connected to its original instance 8 device, Ask first, zero selections. Both saved local Convex deployments were refreshed with current functions, without resetting data.

An early post-fix quiz control was edited as soon as its contenteditable mounted, during dev reload/build activity; initial question/answer reverted to defaults. Do not count that as a clean publication test or silently call it fixed. The final DEEP-006 reproduction waited for normal editor hydration and retained its question. Together with original FLOW-006, early editable/title hydration still deserves a dedicated cold-load regression.

**Not certified by this review:** production identity/email delivery, OAuth/password recovery, actual third-party calendar import, native account/deployment-switch or fresh external Office round trips, destructive school lifecycle/emergency controls, complete multi-role concurrent/offline collaboration, every mobile editor control, or a truly pristine production school setup. Previously reported FLOW-011/012/013 and other original findings remain open unless separately closed with evidence by their implementing agent. No universal every-action pass or launch guarantee is implied.
