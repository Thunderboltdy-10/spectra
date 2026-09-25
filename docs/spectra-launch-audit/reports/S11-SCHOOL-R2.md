# S11 SCHOOL R2 — planner source facts survive normalization and refresh

Date: 2026-09-25. Worker: `01a0d847-532e-7061-9f90-ea0fc9e52ab3`.

## Status and scope

**Locally validated helper/model/refresh candidate; complete enforcement and live acceptance remain open.** Coordinator released a guarded SCHOOL slot on September 25. All 30 R2 tests pass (12 shared helper, 14 model, 4 signed-import), within a 124/124 run across 15 files. Scoped lint and diff checks pass. Commands used RUNTIME's inherited filesystem guard and one worker; the slot was explicitly released afterward. No full typecheck, build or live acceptance is claimed. Helper commit: `3b8f9e0565e45d723b91d9022232470a482d6d73`; normalization/provider refresh and tests: `aa8c79a1bc9b29d0e32242ea97db2800931d3872`. R1 is independent candidate `115ad267fa0e5505561b3ce60f2f728e0aba413a`.

Coordinator approved the shared pure helper, legacy/array root binding, fieldwise provider refresh, and enforcement through the existing AI and collaboration write paths. This worker changes the helper, planner data normalization, and the narrow existing `safelyRefreshProjection` branch/calls. SECURITY owns AI preview/commit and first-effect hooks; COLLAB owns gateway before/result validation and the backend projection hooks with other shared-store owners. No general Calendar or ManageBac access expansion, frontend redesign, shared-service mutation or deployment is part of this candidate.

## Source findings

`normalizePlanContent` historically copied a ManageBac root into `tasks[0]` without transferring its source boundary or `officialDeadlineRef`. PlanStudio's existing inline and expanded date controls and rescheduling helpers use that reference to identify official dates. Consequently an imported official due date appeared editable.

PlanStudio's current `commit` merges the original raw content with normalized content, so it usually preserves the outer `source` object. The more specific persistence defect is that `safelyRefreshProjection` updated only legacy root `taskTitle`, `description` and `dueAt`. Once a `tasks` array existed, the editor read the old values from that array. A standalone consumer saving only the normalized result could also lose the outer metadata.

## Representation and refresh

`shared/planner-source.mjs` is the single pure implementation, usable from the Node gateway, Convex and client. `planner-source.d.mts` supplies TypeScript types; it is not another implementation.

- The existing imported root identity is `task-1`. It receives the school's date/reference regardless of its position in the array; additional personal tasks receive neither automatically.
- The official reference comes from the stored root reference, period-aware ManageBac source refs, or the existing provider external ID fallback. No new source identity is invented.
- Normalization preserves the source envelope, source refs and root date. An explicit null root date means withdrawal, so repeated normalization cannot recover an old task date.
- An existing array stays an array, including an empty array after the user removes the personal root. Refresh does not recreate that root.
- Legacy `completed` status normalizes to `done`, matching the existing planner candidate reader.
- Provider refresh receives the actual previous `externalRecords.normalized` baseline, already available in the signed ingestion mutation. Conflict rebase receives its recorded `oldSource`; a mismatched source hash prevents treating it as a trusted text baseline.
- Copied title/description advance only when still equal to that previous provider field. Customized values and explicit empty notes survive. Artifact title and summary follow the same conservative rule. Source metadata and official date advance independently.
- The imported root's array fields are updated in place; unrelated tasks, ordering, status, checklist and other personal fields are retained. Existing triggers then maintain compact planner rows.

No new DB fields, tables, indexes, query scans or source-baseline reads are introduced by R2. Refresh uses data already loaded by ingestion. The helper walks task arrays and reference sets; it does not inspect canonical bodies from other artifacts.

## Enforcement contract and owner handoff

```ts
assertPlannerSourceEdit(currentContent: unknown, proposedContent: unknown): void
```

Call only after resolving the authoritative artifact type as `planner_task`, with verified hydrated current content and the proposed full semantic content, before admitting a preview, durable write, receipt, checkpoint or first effect. The pure helper performs no authentication or content hydration; those remain the caller's responsibility. Passing a durable-ref wrapper as though it were canonical content is invalid integration.

It throws `PLANNER_SOURCE_METADATA_LOCKED` for changed/stripped source metadata, source refs, moved/duplicated source-root references, or stripped existing task references; `PLANNER_OFFICIAL_DEADLINE_LOCKED` for a changed official date. It permits personal title, notes, status, checklist and added tasks. Removing a personal root is permitted only while its outer source envelope remains; the separate official Calendar deadline is unaffected. It also protects existing nonlegacy tasks carrying an official reference.

SECURITY accepted ownership of `stageAiPatch` and prepare/first-effect admission hooks. A stage-only check is too late if native/AI effects have already happened.

COLLAB identified `prepareCanonicalAppend` as the first gateway location with the reconstructed actual before/result semantic projections. Human append normally defers the projection until checkpoint. They recommend forcing immediate projection specifically for `planner_task`, validating it in the backend parser under the exact sequence CAS, and retaining gateway validation before append. That prevents invalid source changes from becoming durable Yjs updates before a later checkpoint rejects them. Shared-store changes must remain coordinated among COLLAB, SECURITY and DURABLE.

**Open integration issue:** provider refresh can advance canonical artifact content while an already-open Yjs room still contains older source facts. A later edit must not roll those facts back. Rejecting a stale source payload is safer than accepting it, but live behavior also needs a correct rebase/recovery path; permanent stale-room rejection is not complete functionality. No stale-room recovery is implemented or claimed in this worker's candidate.

## Validation and remaining evidence

`shared/planner-source.test.ts` specifies migration, source/hash/ref stripping, duplicate/moved root references, legacy/root/task date modification, valid personal editing/removal, copied/custom text, date withdrawal and independent personal/nonlegacy official task controls.

`src/features/spectra/__tests__/planner-source.test.ts` exercises actual model normalization and rescheduling, repeated saves, reordered roots, completed state, source guards and conservative provider refresh.

`convex/managebac-planner-source.test.ts` uses the signed disposable ingestion fixture and real triggers to check legacy/array refresh, official Calendar/compact planner convergence, customized title/summary/empty notes/completion/checklist, extra personal tasks, unchanged replay, and a removed root. Its fixture edit models persistence through the real mutation wrapper; it does not stand in for AI/gateway authorization tests, which belong to their hook owners.

All three suites pass against the repaired source. The combined original-source comparison used `a423dffc` versions of `calendar.ts`, `managebac.ts` and planner `model.ts`, with the newly introduced pure helper still available to the tests. Model suite: **11 failed / 3 passed**; signed-import suite: **4 failed / 0 passed**. These failures expose lost normalized source/ref fields and the inability of that normalized result to satisfy the new preservation contract. Several stop at the normalization boundary before executing refresh, so this comparison is not an isolated reproduction of every refresh defect and the failure count is not a defect count. The repaired signed-import cases exercise refresh end to end and pass, including customized text and root deletion.

Sources were restored byte-for-byte in `finally` before the final passing run. Private evidence is `.spectra-local/launch-s11/school/r1-r2-baseline.{json,log}`, `r1-r2-final.{json,log}` and `r1-r2-lint.log`. The final 124-case run also includes R1, task refresh, isolation/retention, Calendar paging/bounded/idempotency, scheduling, reminders, client time handling and the real route against a local disposable provider. The two corrected older test setups and route's fixed-date clock are documented in the R1 report.

Actual AI/gateway handler tests, verified-content hydration at their hooks, and stale-room/provider-refresh recovery tests must pass before marking R2 complete. Full TypeScript remains an integration gate; no further executable checks ran after releasing the slot to ENGINE.
