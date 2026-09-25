# S11 SCHOOL R1 — canonical imported-task discovery and scheduling

Date: 2026-09-25. Worker: `01a0d847-532e-7061-9f90-ea0fc9e52ab3`. Coordinator: `01a0d83f-92fb-7b80-9ea4-99fcecef20aa`.

## Status

**Locally validated repair candidate**, production source commit `115ad267fa0e5505561b3ce60f2f728e0aba413a`. Coordinator explicitly released a guarded slot on September 25; all commands used RUNTIME's inherited filesystem guard, one Vitest worker and no file parallelism. No commands ran during the earlier hold, and the dependency junction/target was never altered. Final validation passed **124/124 tests across 15 files**, including all 24 R1 cases, plus scoped lint. The slot was released immediately afterward. Integration review, full TypeScript and live acceptance remain coordinator gates. The prior task-refresh repair is `a423dffca7ca1510007f410a71e17bcc6e9d0638`.

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

SECURITY independently reviewed the initial candidate and identified stale compact source association and invalid compact owner/school fallthrough. Both fixes pass targeted adversarial cases. Its final source review also prompted rejection of ambiguous multiple authoritative record associations; the regression passes. Multiple projections to the same record are not treated as ambiguity.

Historical plan-only receipts without a task ID remain recoverable only for callers that also omit a task ID and still match current validated planner, root, time, timezone and school. New plan-only imported schedules resolve and persist the canonical task ID. Current authorization/lifecycle checks run before either replay path.

## Bounded reads and compatibility

Two coordinator-approved additive indexes on the existing `calendarItemReadModels` table:

```text
by_account_source_kind: ownerAccountId, sourceRecordId, kind
by_account_task_status: ownerAccountId, taskItemId, status
```

There are no new fields, new tables, backfill migration or version switch. Schema publication belongs to the coordinator. Discovery reads compact rows through these indexes and stops resolving planner groups once the output limit is reached. Existing keyset continuation is retained, including tied timestamps and skipped terminal roots. Discovery never opens canonical artifact/task bodies. Scheduling performs exact authoritative reads because it is a write boundary.

The passing cost fixture contains 40 unrelated canonical task rows with 20,000-character notes and measures actual returned rows/serialized bytes using `scripts/perf-read-ledger.ts`. It observes one source-index row below 5,000 serialized bytes, one task/status index query, **zero canonical task/artifact body reads and zero writes** during discovery. This is not production latency, engine scan, memory or billing evidence; no production cost reduction is inferred from it.

## Fixtures and validation

The disposable signed-import fixture was extracted from the 16-case refresh suite into `scripts/test-fixtures/managebac-calendar.ts`. It retains real schema, aggregate registration, signed `commitNormalizedPage` and test-only mutation wrappers for trigger maintenance. No provider/server is contacted.

The discovery suite covers feed identity and client mapping; schedule/replay/removal; source-only and plan-only schedules; terminal roots; extra personal tasks; tied pagination; compact read cost; foreign/unrelated planners; nested-task mismatch and genuine legacy aliases; current-state validation before replay; cross-school/stale ownership; stale source-ID substitution; missing/invalid compact provenance; ordinary personal task/plan positive controls; and another account's discovery.

The four previously reproduced isolation/retention failures had no selected class after S9 made following opt-in. Their setup now creates an accessible mapped class and calls the public selection mutation, retaining original lifecycle assertions. A new no-selection → selected → deselected control checks the opt-in boundary. The retention fixture patches the existing Alice selection rather than inserting contradictory duplicates. The first run exposed one remaining fixture mismatch: the overlay test's leased sync still hardcoded selection revision zero. It now uses the revision returned by the actual public selection call. **All 12 isolation and 2 retention tests pass**, with lease fencing intact.

Baseline TypeScript fixture defects were handled independently: `7ff46b6536ad9c869c2a2228f1ce8821bc17f1f0` types two audit fixture ID arrays, and `9348dee2c44f2878a77ee5cc1ed6b488a67f9cac` types the reflected query boundary in the refresh fixture. Runtime behavior and assertions are unchanged. Diagnostics came from RUNTIME/coordinator; no local full typecheck is claimed.

| Check | Result |
| --- | --- |
| Discovery suite against original `a423dffc` Calendar source | 21 failed / 3 passed; missing imported feed, revived terminal roots, unvalidated task/plan pairs and stale provenance reproduced. |
| Discovery suite against repaired source | 24 passed. |
| Extracted task-refresh suite | 16 passed. |
| Complete bounded SCHOOL selection including R2 and neighbors | 124 passed / 15 files, 18.89 s. |
| Scoped ESLint, including both typing corrections | Passed. |
| Final diff check | Passed. |

The baseline run temporarily replaced only this worker's `calendar.ts`, `managebac.ts` and planner `model.ts` with exact `a423dffc` source. A `finally` block restored saved byte arrays; additive indexes and new tests stayed available. The final run then tested restored repaired sources. Private logs/JSON are in `.spectra-local/launch-s11/school/`: `r1-r2-baseline`, `r1-r2-final`, `r1-r2-lint`, `r1-route-neighbors`, `provider-route-final`, and `fixture-final-lint`.

Coordinator also assigned the pre-existing provider-route failure. The local provider's deadlines are fixed at September 18–20, 2026, while the real query defaults to current time minus two days. By September 25 the expected updated task was correctly outside that window. The original route failed identically under baseline and repaired production source. The fixture now pins `Date.now` to September 15 and restores the spy afterward; the real route, query, authority checks and assertions are unchanged. The entire route passes, including selected/unselected class requests, stale selection rejection, updated tasks and archive retention. This changes only test setup, not provider or authorization behavior.

## Remaining boundaries

R2 remains a separate implementation/report for the previously missing normalized official reference and stale array fields after provider refresh. Its helper/model/refresh tests now pass, but actual AI/gateway enforcement and stale-room recovery remain with their owners; see `S11-SCHOOL-R2.md`.

Source tombstone/restore semantics, retained personal work, academic-period visibility, civil-time precision and full live acceptance remain separate units. This candidate does not claim those behaviors are repaired.
