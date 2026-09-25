# S11 SCHOOL R1 — canonical imported-task discovery and scheduling

Date: 2026-09-25. Worker: `01a0d847-532e-7061-9f90-ea0fc9e52ab3`. Coordinator: `01a0d83f-92fb-7b80-9ea4-99fcecef20aa`.

## Status

Source candidate, **not yet validated or accepted**. RUNTIME/coordinator paused all tests, builds, installs, lint and typecheck after shared dependencies disappeared during a broad baseline. This worker has not run any of those commands during the hold or altered the dependency junction/target. The previous task-refresh repair is commit `a423dffca7ca1510007f410a71e17bcc6e9d0638`; its passing evidence remains in `S11-SCHOOL.md`. This separate R1 candidate must receive baseline/fixed and neighboring-suite validation before integration.

## Reproduced problem and representation decision

The previous unit's actual signed ManageBac import fixture reproduced an active imported Calendar task missing from `overview.unscheduledTasks`, with both discovery cursors exhausted. `readUnscheduledTasks` excluded all provider-backed tasks; `readPlannerTasks` also suppressed the planner fallback whenever an active source task existed. The Calendar Plans rail requires `planArtifactId`, so merely returning the original task wire would still leave it undiscoverable there.

Keep the existing canonical Calendar task and its personal lifecycle. Decorate its compact wire representation with the existing planner ID, root task ID and work link; do not create or migrate another task identity. The existing Calendar drag/open path already passes a canonical `taskItemId` together with planner identifiers. Ordinary personal planners retain their previous grouped wire representation.

Only the imported `task-1` root represents the canonical source task. Completed, cancelled, removed, directly scheduled or actively blocked roots are omitted. Additional personal tasks in the same planner remain eligible. A missing or cross-school source read model does not turn that root into a fallback task.

## Scheduling authority

All requested identities are validated before idempotency replay or insertion:

- Explicit canonical tasks must belong to the current actor and school, have task kind and remain active.
- An explicitly supplied planner is independently validated for owner, school compatibility, active status and planner type, including when a canonical task is supplied.
- The nested task must exist and be incomplete. The historical single-root subtask alias remains accepted only if the supplied ID actually exists in the legacy `subtasks` array.
- Imported linkage is re-resolved through the existing `externalProjections` lookup, exported as `sourceRecordForPlanner`. A compact planner row cannot authorize a source association by itself. Its owner, school and source record must agree with the authoritative planner/link.
- An imported root must resolve a compact task and then its canonical row. Scope, active status, source ID and any explicit task ID are rechecked. Missing projections fail unavailable rather than creating an unlinked block.
- A supplied task/plan pair must share persisted direct linkage or the verified imported-root association. An owned but unrelated planner is insufficient.
- The linked official deadline must match owner, school, kind, source lock and source record. Scheduling stores the resolved canonical task ID and keeps the official deadline identity.

SECURITY independently reviewed the initial source candidate and identified stale compact source association and invalid compact owner/school fallthrough. Both are addressed in the current source, with targeted adversarial fixture cases. The updated candidate still needs executable validation and any follow-up review.

Historical plan-only receipts without a task ID remain recoverable only for callers that also omit a task ID and still match current validated planner, root, time, timezone and school. New plan-only imported schedules resolve and persist the canonical task ID. Current authorization/lifecycle checks run before either replay path.

## Bounded reads and compatibility

Two coordinator-approved additive indexes on the existing `calendarItemReadModels` table:

```text
by_account_source_kind: ownerAccountId, sourceRecordId, kind
by_account_task_status: ownerAccountId, taskItemId, status
```

There are no new fields, new tables, backfill migration or version switch. Schema publication belongs to the coordinator. Discovery reads compact rows through these indexes and stops resolving planner groups once the output limit is reached. Existing keyset continuation is retained, including tied timestamps and skipped terminal roots. Discovery never opens canonical artifact/task bodies. Scheduling performs exact authoritative reads because it is a write boundary.

The proposed cost fixture contains 40 unrelated canonical task rows with 20,000-character notes and measures actual returned rows/serialized bytes using `scripts/perf-read-ledger.ts`. **Measurements are pending**. This is not production latency, engine scan, memory or billing evidence.

## Fixtures and pending validation

The disposable signed-import fixture was extracted from the 16-case refresh suite into `scripts/test-fixtures/managebac-calendar.ts`. It retains real schema, aggregate registration, signed `commitNormalizedPage` and test-only mutation wrappers for trigger maintenance. No provider/server is contacted.

The discovery suite covers feed identity and client mapping; schedule/replay/removal; source-only and plan-only schedules; terminal roots; extra personal tasks; tied pagination; compact read cost; foreign/unrelated planners; nested-task mismatch and genuine legacy aliases; current-state validation before replay; cross-school/stale ownership; stale source-ID substitution; missing/invalid compact provenance; ordinary personal task/plan positive controls; and another account's discovery.

The four previously reproduced isolation/retention failures had no selected class after S9 made following opt-in. Their setup now creates an accessible mapped class and calls the public selection mutation, retaining original lifecycle assertions. A new no-selection → selected → deselected control checks the opt-in boundary. The retention fixture patches the existing Alice selection rather than inserting contradictory duplicates. These corrections are **also untested under the hold**.

The baseline TypeScript fixture defect was handled independently in commit `7ff46b6536ad9c869c2a2228f1ce8821bc17f1f0`: `scripts/s10-platform-school-regression.test.ts` now types its two cross-callback ID arrays. Its known-failure assertions are unchanged. The exact diagnostics came from RUNTIME's `typecheck-restored.log`; no typecheck rerun is claimed.

Required after hold clearance:

1. New discovery and extracted refresh suites, one worker.
2. The same discovery suite against original `calendar.ts`, with safe worker-local restoration and additive indexes retained.
3. Corrected isolation/retention plus existing Calendar idempotency, bounded-read and paging suites.
4. Scoped lint, diff check, and any authorized TypeScript slot.
5. Replace this pending status with exact evidence and commit the bounded R1 unit.

## Remaining boundaries

R2 remains separate: the normalized planner root lacks its official reference, and provider refresh updates legacy fields without updating an existing `tasks` array. PlanStudio's current merge usually preserves outer source metadata; the failure is not simply loss of that outer object. Server enforcement must cover the actual collaboration/AI persistence seams and be coordinated with those owners.

Source tombstone/restore semantics, retained personal work, academic-period visibility, civil-time precision and full live acceptance remain separate units. This candidate does not claim those behaviors are repaired.
