# P2 residuals: findings ledger

Branch `p2/residuals` from main `897c824e`. There are eight residual items from the earlier Phase 2 reports. Each one was verified against the code, then fixed with a failing-then-passing test or reported with the reason it was not fixed.

## Commits

| Commit | Subject |
| --- | --- |
| 4a7a1229 | fix(spectra): remove the calendar's dead "Ask Spectra about this time" button |
| e0b1921b | fix(spectra): announce the plan bulk confirmation as a labelled modal alert |
| 86139224 | fix(spectra): record acknowledged append positions on resumed runs too |
| a0b628fa | fix(convex): park a permanently failing account erasure for an operator |
| fefe3323 | fix(convex): meter and gate every user-triggered model call against the school ceiling |
| d1e05832 | test(convex): pin that account erasure returns exactly the storage it metered |
| d969cd3c | fix(convex): settle a run whose local-file write a newer edit replaced |
| 02d07ab9 | fix(convex): add an operator backfill for school usage totals that predate the rollup |

## Fixed

1. **Calendar dead button (low).** The "Ask Spectra about this time" button in `src/features/spectra/calendar/ui/calendar-application.tsx` had no handler. No composer prefill API exists: the CommandBar keeps its draft in local state, and `spectraBus` has no prefill command. The button was removed. Guard: `ux-debt-closure.test.ts` fails on any calendar `<button>` with no handler, submit type or spread props.

2. **Plan bulk confirm semantics (low).** At `plan-studio.tsx:1491` the `role="alertdialog"` now has `aria-modal`, `aria-labelledby` and `aria-describedby`, and it already used `useModalFocus`. Guard: `use-modal-focus.test.tsx` fails when a file calls `useModalFocus(` more often than it declares `aria-modal=`.

3. **Resumed runs lost append positions (medium).** The per-operation readback that records `appendedAt` now lives in the shared `verifyAcknowledgedUpdate` in `run/loop/verify.ts`.
   - Both run paths use it: the primary path at `runtime.ts:2097` and `resumeOperationsAttempt` at `runtime.ts:3111`.
   - The runtime hunk is minimal and stays clear of SCALE's stop handling.
   - Test: `s11-ai-full-content-verification.test.ts`.

4. **Account erasure alerting (high).** A failing page mutation rolls back, so a failure shows up only as a job that makes no progress.
   - `resumeStalled` (`accountErasure.ts:758`) now backs off exponentially: `STALLED_AFTER_MS * 2**restarts`, about 10.5 hours in total.
   - After `MAX_STALLED_RESTARTS = 5` it parks the job as `failed_needs_attention`.
   - Parking writes a legal-retention audit event, `account.erasure.needs_attention`, which the superadmin platform security log shows. It also logs `console.error` with ids only.
   - Neither the cron nor a webhook redelivery restarts a parked job.
   - An operator resumes it from the stage where it stopped with `accountErasure:resumeNeedsAttention` (`:803`), which writes an `account.erasure.resumed` audit event.
   - Schema change (additive): the stage literal plus `stalledRestarts`, `resumeStage` and `needsAttentionAt`.
   - Tests: `account-erasure-lifecycle.test.ts`.

5. **School AI cost ceiling coverage (high).** I enumerated every model-token entry point and changed the following:
   - `recordModelTokenUsage` (`metering.ts:134`) is the one metering helper. Everything it records reaches `schoolUsageTotals`.
   - **Runs** keep the same idempotency keys.
   - **Retry** (`resetForRetry`, `spectraRuns.ts:3036`) previously bypassed admission and the ceiling, and would have metered the earlier attempt's usage twice. It now passes through both, and the earlier attempt's usage is cleared.
   - **Agent evaluation:** `beginEvalRun` is gated, and `settleEvalRun` meters the summed per-case tokens.
   - **Agent Foundry and eval generation:** these call the model directly from Next routes. They are now gated before the call (`agents:admitModelWork`). After the call they are metered through `agents:recordModelWork`, which takes a server-signed report. It uses HMAC over the canonical form with the existing bridge key plus nonce replay protection, so a browser cannot invent or alter token counts.
   - System maintenance is not gated.
   - Tests: `school-ai-ceiling.test.ts`. The `honest-execution.test.ts` contract moved to the shared helper's key construction; the commit says why.

6. **Erasure storage meter: rejected as not real for erasure, with a guard added.**
   - Private works are erased through their artifact deletion jobs, which carry `schoolId`. Those jobs release the metered asset, import-original, runtime-build and snapshot bytes (for example `artifactIntakeLifecycle.ts` `releaseOnce`, and `spectraArtifactDeletion.ts:197`).
   - The blobs erasure deletes itself were never added to `storage_bytes` on upload:
     - run attachments (`accountErasure.ts:270`, created at `spectraRuns.ts:3597`);
     - device payloads (`accountErasure.ts:283`, created at `payloads.ts:128` and `bridgeSync.ts:833`).
   - Decrementing those would push the meter below real usage.
   - Guard test `d1e05832` pins both halves.

7. **A superseded AI native write stayed `native_pending` forever (medium).** No superseded run outcome existed. A newer edit can retire a queued write before readback:
   - the file was saved in Word underneath it;
   - a newer cloud revision replaced it;
   - a newer write already owned the revision.

   In each case the write becomes `failed` with a superseded code and can never be verified. The run was only settled on a verified write, so the dock kept saying "waiting for your file to confirm" and kept polling. The fix:
   - A new additive outcome, `native_superseded` (`bridgeWriteOperations.ts:114`).
   - Every supersede site re-evaluates the run: `bridgeSync.ts:1054`, `bridgeSync.ts:1572` and `replicaMaterialization.ts:416`.
   - The dock and receipt copy reads: "A newer edit replaced this change before the file on your computer confirmed it."
   - Conflicted writes deliberately stay pending, because the conflict view resolves them.
   - Tests: `nativeAiCommit.test.ts` (fails before, passes after), `live-dock.test.ts` and `s11-review-ai-receipt-report.test.ts`.

8. **Stale per-school usage totals (high).** Yes, a bounded backfill can do this. `metering:backfillSchoolUsageTotals` (`metering.ts:323`) rebuilds the totals rather than adding to them:
   - day rows are set from `usageMeters`, which holds the full history and has no retention purge;
   - month and total rows are then set from the day rows.

   Each mutation handles one page and chains through the scheduler. Progress is stored in `spectraReadModelMigrations`, key `school-usage-totals`. Reads and writes share a transaction, so live usage is never double counted, and the backfill is safe to re-run. It was not run here.

   **Operator step**, once, after deploy: `npx convex run metering:backfillSchoolUsageTotals '{}'`. To re-run after it completes, pass `'{"restart":true}'`.

## Reported, not fixed

- **Tokens of stopped, failed or reconciled runs are not metered.** `stopRun` (`spectraRuns.ts:2756`), `reconcileStaleRuns` (`:2032`) and failure `updateStatus` calls from `runtime.ts` pass no usage. The model work they did never counts toward the ceiling. The fix touches runtime stop handling, which SCALE owns.
- **Parallel research calls are not added to run usage.** The calls are in `src/features/spectra/sources/research/parallel-search.ts`, used from `run/loop/plan.ts`, which AI-QUALITY owns.
- **The legacy vision prepass is not counted.** `enrichImageAttachments` and `addDerivedVisualAttachments` (`runtime.ts:959-973`) are unmetered model calls. They only run under the dormant `legacy_visual_prepass` strategy.
- **Memory embeddings are deliberately not metered or gated.** In `convex/memoryEmbeddings.ts` they are system work inside a run: capped at 2048 tokens, cached, and tiny.
- **An agent evaluation that throws before `settleEvalRun` does not meter its tokens.**
- **The ceiling is checked at admission, not per call.** A run admitted just under the limit can overshoot it by one run's usage.
- **Earlier appends on a resumed run still fall back to arithmetic positions.** Operations executed before a pause, in the earlier process, have no recorded `appendedAt` (positions are held in memory only). Only operations executed after the resume record them.
- **Artifact deletion decrements storage that was never metered in.** Run attachments are decremented at `spectraArtifactDeletion.ts:352`, and payload releases at `:265`, `:278` and `:285` through `payloadLifecycle.ts:52`. No upload path adds either to `storage_bytes`, so a school's storage meter can drift below real usage. Fixing it means either metering those uploads or dropping the decrements. That is a product decision on what counts as school storage.

## Needs live verification

- **Erasure parking:** on a deployment, force a stuck erasure page and confirm three things after about 10.5 hours of cron ticks: the `account.erasure.needs_attention` event appears in the platform security log, `resumeNeedsAttention` resumes the job, and it completes.
- **Foundry and evaluation metering:** with the bridge key set, run Agent Foundry and an eval generate against a school with an enforced ceiling. Confirm the tokens reach `schoolUsageTotals` and the next call is refused at the limit.
- **Superseded writes:** with a Bridge device, let an AI run queue a write to a `.docx`, save the file in Word before the Bridge applies it, and confirm the dock settles to "replaced by a newer edit" and stops polling.
- **Backfill:** run `metering:backfillSchoolUsageTotals` on staging first. Compare a school's `total` row with the sum of its `usageMeters` token rows, then run it on production.

## Gates

- `tsc` (root and convex) is clean.
- `eslint` on every changed file is clean.
- `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities` and `check:secrets` pass.
- Full vitest: 437 files passed, 1 skipped; 4022 tests passed, 1 skipped.
