# P2 — Account lifecycle (Phase 2)

Branch `p2/account-lifecycle`, from `main` a00ede57. This report closes the
account-level findings from `P2-SECURITY-PRIVACY.md`:

- R2 and R3: account erasure.
- R1: school AI cost ceiling.
- R6, R7 and R9: small items.

It is written from the view of a school data-protection officer who is
responsible for minors' data, and of a school paying for model usage.

## Findings ledger

### Fixed

| # | Sev | Finding | Root fix | Test |
|---|-----|---------|----------|------|
| A1 (R2+R3) | High (minors' data) | **No account-level erasure existed.** When an identity was deleted at Clerk, the Spectra account (name, email, avatar), its memberships, and all AI runs, threads, memory, calendars, reminders, ManageBac mirrors, Bridge devices and payloads, and private work stayed live. The school purge also kept `accounts` rows and account-scoped tables. Only per-work and per-school deletion existed. | New `convex/accountErasure.ts`. `requestForDeletedIdentity` (:675) works in three steps. **(1) Freeze:** it deactivates the account, ends every membership, revokes operator sessions, audits `account.erasure.requested` and inserts one `accountErasureJobs` row. **(2) Stage machine:** `process` (:638) is a step-guarded, self-scheduling, bounded stage machine (`works → await_works → account_rows → placements → workspaces → finalize`). It deletes owned works that nothing shares, through the existing artifact deletion jobs, and waits for them. Shared works are kept, because the school owns them once they are shared. It waits for live run leases, then drains the `ACCOUNT_TABLES` list (:349). That list is ordered source-before-derived so trigger-maintained read models are not re-created, and blobs are deleted and payload refs released. It then purges private org-tree placements and private workspaces. **(3) Finalize** (:582): it deletes memberships and tombstones the account as `"Former member"`, clearing the email, avatar and last-seen time. The `clerkId` is kept as the resurrection guard. It audits `account.erasure.completed` with counts only. The row is a tombstone rather than a delete, so audit, meter and kept-work references stay valid. `resumeStalled` (:742) runs on a 5-minute cron (`convex/crons.ts`) and restarts any job whose chain stalled. `purgeNode` is factored out in `convex/orgTreeShared.ts` and shared with the existing purges. | `convex/account-erasure-lifecycle.test.ts` (4 tests). It covers a full erasure across two schools with shared and private work, a run lease, calendars, memory and Bridge. It also covers a tombstone for a subject that never registered, waiting for a live run lease, and the bridge signature checks. The first two tests also assert that `registerSelf` fails with `IDENTITY_ACCOUNT_ERASED`. |
| A2 (R2) | High (minors' data) | **The Clerk `user.deleted` webhook was skipped** (`src/app/api/webhooks/clerk/route.ts:62`). | `route.ts:63`. After svix verification, the route calls `requestIdentityErasure` (`src/lib/server-secrets.ts`). That calls the new public action `secretBridge:eraseDeletedIdentity` (`convex/secretBridge.ts:309`), which is HMAC-signed with `SPECTRA_SECRET_BRIDGE_KEY` (operation `erase-account` and a ±60 s window). The action is idempotent, so a failure returns 500 and svix redelivery is the retry. The failure log carries a reason only, with no id or email. | `src/app/api/webhooks/clerk/route.test.ts` (4 tests, real svix signing): a deleted user starts erasure with a bridge signature over its subject; an unsigned event is rejected; a Convex failure gives 500 so svix redelivers; `user.created` still writes nothing. |
| A3 | Medium | **An erased subject could write itself back.** A Clerk session JWT can outlive the IdP identity. The next `registerSelf` would have restored the name and email on the tombstone. | `convex/identity.ts:67`. `registerSelf` throws `IDENTITY_ACCOUNT_ERASED` when the account has an erasure job. | `account-erasure-lifecycle.test.ts`, tests 1 and 2. |
| A4 (R1) | High (cost) | **`limitPolicies` "enforced" was never enforced.** Nothing read a school's model-token maximum before model work. | `convex/metering.ts`. Every `model_input_tokens` and `model_output_tokens` meter event with a school now also upserts the `schoolUsageTotals` rollups (`day:YYYY-MM-DD`, `month:YYYY-MM`, `total`, all UTC; `addSchoolModelTokens` :134). `assertSchoolModelTokenCeiling` (:186) reads the effective policy: the school's own policy, otherwise the platform default. That is the same resolution the `effectivePolicy` query now reuses. The check applies only when the policy is `enforced`, and blocks when usage is at or above any `model_tokens` rule's maximum for the current window. It is called in `beginRun` right after `assertRunAdmission` (`convex/spectraRuns.ts:663`). This makes three index reads. `simulate` still only reports, and `storage_bytes` never blocks. The superadmin limit dialog copy now says exactly this (`superadmin-shell.tsx`). | `convex/school-ai-ceiling.test.ts` (2 tests). The first shows a request is blocked at the day maximum, other schools are unaffected, and requests reopen the next UTC day. The second shows that simulate never blocks, that an enforced platform default applies, and that the school's own policy wins over the default. |
| A5 (R6) | Low | The dead allowlist sanitizer `src/lib/sanitize-html.ts` was a parallel, unused implementation. | Deleted, together with its test. Nothing imported it. | `tsc` and `check:architecture`. |
| A6 (R9) | Low (privacy) | An SMTP failure logged the invitee's address, which put minors' emails in server logs. | `src/lib/invitations.ts`. The log now carries `invitationId`, which both callers in `src/app/api/spectra/administration/route.ts` pass. Any address inside the provider's error reason is redacted to `[address]`. | `src/lib/__tests__/invitation-email-log.test.ts`. |

### Reported, not fixed

| # | Sev | Where | Finding / why not fixed here |
|---|-----|-------|------------------------------|
| L1 | Medium (minors' data) | `convex/accountErasure.ts` | **Erasure deliberately keeps some data.** These are the decisions a DPO should confirm: `meterEvents` and `usageMeters` (billing, keyed by account id with no PII); `auditEvents` (legal record); the versions and collaboration rows of *kept* shared works; lease-bound `regionClaims`; `syncOperations` and cloud replicas; `artifactCommentPreferences`, `secretBridgeNonces`, `spectraArtifactLinks` and `agentFeedback`; `schoolOnboardingSagas.initialAdminEmail`; *pending* `membershipInvitations` to the same email (accepted, revoked and expired ones are deleted); quarantined payload bytes; and class or school `externalRecords`, which are unmapped rather than deleted. AI comments the account made on kept works are renamed "Former member's AI". |
| L2 | Low | `convex/payloadObjects` release path | The `storage_bytes` meter is not decremented when erasure releases a payload, because the payload row has no `schoolId`. Storage usage over-reports slightly after an erasure. |
| L3 | Low | kept planner and timetable artifacts | A *kept* (shared) planner or timetable artifact could re-derive calendar read models or reminders for its other members. Nothing is re-created for the erased account, because its memberships are ended, but this was not exhaustively traced. |
| L4 | Low | `convex/identity.ts` `registerSelf` | The email stays on the account until finalize, which is seconds to minutes. During that window, a new Clerk identity with the same email gets `IDENTITY_EMAIL_IN_USE`. |
| L5 | Low (ops) | `resumeStalled` | A job that fails permanently, for example a schema drift in a drained table, is retried every 10 minutes indefinitely. There is no alerting. It should feed the ops dashboard. |
| L6 | Product | — | No admin-initiated erasure path exists, and there is no "delete my account" route in the product. The only trigger is IdP deletion. A school admin removing a student ends the membership but does not erase. This is intentional pending a product decision. The stage machine can take a second trigger literal. |
| L7 | Medium (cost) | `convex/spectraRuns.ts` | The ceiling is checked in `beginRun` only. I did not verify that every model-work entry point goes through `beginRun`. Memory jobs, embeddings, agent runs and background summaries may meter tokens without being gated. Those tokens are still counted toward the rollup. Also, a run that was admitted just under the maximum may overshoot it by one run's tokens. |
| L8 | Low (cost) | `schoolUsageTotals` | There is no backfill. The month and total rollups start at zero at deploy, so a mid-month deploy under-counts that month. |
| L9 | Merge | `convex/_generated/api.d.ts` | `accountErasure` is added directly before `accountPreferences`, in both the import list and the `fullApi` map. Main's file was regenerated by ops-performance, so the merge conflicts there and the entry must be added the same way. Main's `module-graph` guard was run against this branch: `accountErasure` registers cleanly. The only failures were the base's own pre-existing gaps, which main has already fixed. |

### Reviewed and rejected

- **R7** (`issueUpload` returns `clerkId`, `convex/artifactContent.ts:31`): this is required. `src/lib/durable-content-server.ts:52` puts it into the trusted intake attestation as `actorClerkId: upload.clerkId`. It is the caller's own id, returned to a server route, so it is not exposed to other users.
- The webhook `user.created` and `user.updated` path never writes product identity. Provisioning is session-bound, so an out-of-order `user.updated` after `user.deleted` cannot restore the account.

## Needs live verification

1. **A2:** Delete a test user in the Clerk dashboard. Confirm that the webhook returns 200 with `erasure: "running"`. This needs `SPECTRA_SECRET_BRIDGE_KEY` set identically on the Next.js host and the Convex deployment, and `CLERK_WEBHOOK_SECRET` set. Confirm that a redelivery from the svix dashboard returns the same job.
2. **A1:** On staging, erase a student who has chats, memory, a calendar, a Bridge-synced DOCX, a private workspace and one shared work. In the Convex dashboard, confirm that the job reaches `completed`, that `_storage` has no blob for the student's attachments or payloads, that the shared work is intact for its other members, and that the account row reads "Former member" with an empty email. Pause the deployment mid-job to confirm the cron resumes it.
3. **A3:** With the deleted user's browser still open, reload the page. The session must fail with the erased message and must not restore the name.
4. **A4:** Set an enforced school policy with a small daily `model_tokens` maximum, then run chats past it. The chat UI must show "Your school has reached its AI usage limit for today…" cleanly, not as a raw error. Check the superadmin limit dialog copy.
5. **A6:** With SMTP misconfigured, send an invitation. The server log must show `invitationId` and no address.

## Gates

- `npx tsc --noEmit -p tsconfig.json` passes.
- ESLint `--max-warnings=0` passes on all touched files.
- `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities` and `check:secrets` all pass.
- The focused suites pass: erasure 4/4, webhook 4/4, ceiling 2/2 plus admission, invitation log plus session 5/5. The related durable, org-tree, metering and identity suites also pass (22 files).
- Full `vitest run`: 421 files passed and 1 skipped; 3923 tests passed and 1 skipped.

## Shared files touched

- `convex/schema.ts`: two additive tables, `accountErasureJobs` and `schoolUsageTotals`, with nothing else changed.
- `convex/spectraRuns.ts`: one import and one line in `beginRun`.
- `convex/_generated/api.d.ts`: see L9.
- `convex/orgTreeShared.ts`: `purgeNode` extracted, with no change to existing purge behaviour.
- `convex/metering.ts`, `convex/identity.ts`, `convex/secretBridge.ts` and `convex/crons.ts`.
- `src/lib/server-secrets.ts`, `src/lib/invitations.ts`, `src/app/api/spectra/administration/route.ts` (the two invite callers) and `src/features/spectra/pages/superadmin-shell.tsx` (limit dialog copy).
- `convex/administration.ts` was **not** touched.
