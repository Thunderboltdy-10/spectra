# S11 SCHOOL follow-up: durable provider updates, receipt recovery and task details

Date: 2026-09-26. Source review at `363e027a5f42e4a571f6ea437b6c9fa583df5d88`.

This is a proposal, not an implemented or tested repair. Existing R1/R2 validation remains 124 passing tests in 15 files; it does not establish the durable enforcement and recovery described below. No executable checks or test slot were used for this review. Production source and the dependency junction were left unchanged.

## 1. Provider refresh must join the canonical transaction

`convex/managebac.ts:safelyRefreshProjection` currently computes a careful personal/source merge but patches `spectraArtifacts.content` directly. A stored Yjs snapshot/tail and an open editor can therefore retain the preceding provider generation. Rejecting an old editor's subsequent source rollback protects the artifact but does not itself recover that editor or its personal draft.

The same direct-write problem exists in `completeSync` -> `markProjectionSourceRemoved` and `resolveConflict(rebase)` -> `safelyRefreshProjection(force)`. The `keep_overlay` branch also marks a projection's source hash current without advancing the artifact's source envelope. These entry points require an explicit common contract; accepting only the normal-refresh path would leave the source boundary incomplete.

### Existing contracts to reuse

- COLLAB `b3a951d2`: `scripts/collaboration-room-state.mjs:applyStoredRoomUpdates`, `scripts/collaboration-canonical-room.mjs:prepareCanonicalAppend`, and `convex/collaborationGatewayStore.ts:appendRoomUpdate` with exact room/next-sequence/base-state checks.
- `src/features/spectra/collaboration/artifact-yjs-model.ts:readArtifactYjsDocument` and `planArtifactYjsMutation` support the generic planner representation. The native Work adapter is for document, sheets and presentation.
- `shared/planner-source.mjs:refreshPlannerSourceContent` is the provider merge; `assertPlannerSourceEdit` remains the ordinary human/AI guard.
- DURABLE `0e34c3f6:src/lib/native-reconciliation-server.ts` demonstrates verified hydration, complete replay, preparation, immutable payload spilling, exact transport retries and explicit CAS remerge. Its native operation, human attribution and external-file transaction are not provider APIs.
- The existing `changeGroups` and `spectraArtifactVersions` schema already admits `source: "import"`. The current appender validator accepts only human/AI actors, so provider attribution needs an owner-approved internal seam rather than mislabeling an import as a human edit.

### Proposed call sequence

1. The existing Node ManageBac route prepares before its signed `commitNormalizedPage` call. Add a backend head query scoped to the authenticated integration, sync run, capability, lease, selection revision and actual projection association. Derive each target account in the backend. Return personal planner content only to the trusted server preparation path, never as a browser response or because a caller supplied an account ID.
2. For a changed planner with an existing canonical room, use the existing signed bridge load and complete snapshot/tail replay. Read its actual planner projection; hydrate verified content references through the existing payload reader. A content-reference wrapper is not planner content.
3. Extract the existing planner refresh computation, including copied artifact title/summary handling, into a shared pure helper. Merge into actual replayed content using the persisted previous provider normalized value. Preserve personal fields, empty descriptions, ordering and root deletion. Never infer the old provider baseline from edited text.
4. Plan the semantic change with `planArtifactYjsMutation`. Capture the exact update on a candidate document, then call `prepareCanonicalAppend` on the unchanged canonical base. Bind the before/result hashes, room generation, next sequence, base vector, artifact head/version, source/projection identity, old/new source hash, capability, lease and selection to the signed envelope. Do not apply a captured update twice. Reuse existing immutable payload storage when a body/update exceeds inline limits.
5. In the same Convex transaction that accepts the provider page, repeat current authorization and all source/projection/room/artifact checks, verify that the proposed result is exactly the permitted semantic provider merge, and call `appendRoomUpdate`. Source records, projection state, Calendar source facts, canonical planner content, sequence, receipt and import history must agree at transaction completion. A missing envelope for an existing room must reject instead of falling back to a direct patch.
6. A provider exception to the ordinary source lock belongs in an internal function context/validator, supplied only after backend provider authorization. It must not be an accepted client JSON flag. Ordinary browser/AI append and checkpoint paths keep their source guard. Close the import change group through the existing history machinery; do not invent a native reconciliation operation ID.
7. Explicit CAS failure reloads and recomputes from the same authenticated provider generation, with a bounded attempt count. Ambiguous transport retries use the exact prepared envelope and existing receipt mechanism. Sync page counters also need review for duplicate submission; merely making the collaboration append idempotent does not prove the whole page is idempotent.
8. Gateway catch-up consumes the accepted provider update. An offline personal draft either merges while preserving current provider facts, or remains recoverable until it can be rebased. A generic source-lock error without recovery is insufficient. Native-overlap markers cannot be assumed to cover provider changes.

### Decisions requiring the shared owners

**No-room behavior.** A cheap path for a planner with no canonical room is possible only if the effect transaction rechecks room absence and the exact artifact head. Concurrent `ensureRoom` must force retry into the canonical path. Closed/retired rooms do not count as absence. DURABLE must decide whether the history contract instead requires a room at the first refresh. No performance improvement is claimed for either choice yet.

**Bounded orchestration.** Personal sync and the scheduled worker already enter the Node route. Administrative reconciliation deliberately has `syncRun.accountId === undefined`, and a shared source can fan out across every following account. A bound of 500 provider records does not bound planner targets, replay bytes, mutation arguments or writes. `completeSync` similarly prepares removals across a reconciliation set. Assign bounded fanout/completion orchestration using existing sync machinery before implementation. Do not truncate projections, silently omit canonical appends, or introduce an independent queue/store. Define an atomic size/failure policy where splitting is unavailable.

**Provider provenance and authority.** The backend must distinguish the authorized sync principal from a target planner's owner. Generic signed bridge account fields are not sufficient proof of a provider write. SECURITY/COLLAB own the trusted admission contract; SCHOOL can own the merge, school heads/envelopes and school fixtures after that contract is fixed.

### Required evidence

Use real generic planner Yjs state and the effect handler to cover pending personal edits/root deletion, stale-source append denial before effect, reconnect recovery, CAS loss after preparation, revoked selection/membership, exact lost-response replay, room-creation races, removal/restoration/rebase, explicit overlay behavior and oversized/fanout limits. Assert one sequence/history effect and preservation of personal content, not just that a guard throws.

Measure cold snapshot/tail bytes, head/target query rows and writes per changed planner; unchanged sources should avoid room replay. Count immutable upload waste on CAS retries and bound concurrency. These are proposed measurements, not production cost or latency claims.

## 2. Scheduling receipt recovery after lifecycle changes

`calendar.scheduleTask` currently applies task active-status, planner active-status and incomplete-root discovery before looking up an existing idempotency key. Archiving a planner also deletes its compact planner rows through the real trigger. Exact recovery of a previously accepted active work block can therefore fail even though it creates no new work.

SECURITY agreed that current identity/authority/scope must remain separate from new-effect eligibility. Proposed narrow behavior:

- Look up the owner-scoped scheduling receipt before fresh eligibility. Check its owner, school, kind, active status, exact requested times/timezone and canonical plan/task identity.
- Load the canonical task/root IDs persisted on that block. Independently recheck current ownership, school, type and actual source association; reject ambiguity or relinking. The root must still exist. Archived replay cannot require an active discovery read model.
- Allow a completed/cancelled source task or archived planner to return the stored active block. Keep removed/missing tasks, missing roots, removed blocks, revoked school/account and transferred ownership denied. A new key must still pass the existing fresh-scheduling checks.
- Return only the stored block through `itemWire`, with zero writes. Do not expose fresh archived/provider content or reopen any object.
- Historical legacy subtask request aliases were not persisted. Accept the canonical root or an extant legacy alias proven to belong to that same stored root; never resolve an alias to a different root. A removed alias cannot be recovered by guessing.

The block persists task/plan/root/official-deadline IDs but not original source-record identity. Current task/deadline/projection equality detects normal association changes; coordinated reassignment of all referenced source metadata cannot be compared with historical source identity. An existing optional `calendarItems.sourceRecordId` field may bind new receipts without a schema change, but its use and legacy policy require review before extending this unit.

Bounded regressions: schedule once, complete/cancel/archive through the real mutation wrapper, replay the exact request, assert identical block and zero writes, then assert a new key is denied. Cover deleted root, removed block/task, current account/school revocation, ownership/link changes, plan-only and standalone task receipts, and legacy aliases. Refine the existing archive-denial assertion explicitly; do not silently weaken authority tests.

## 3. Expanded task-detail source findings

Only source inspection was performed. No browser measurements, accessibility score or visual acceptance is claimed. Keep the existing design system and layout.

| Finding | Source evidence | Bounded proposed fix |
| --- | --- | --- |
| Added checklist steps cannot be named | `plan-studio.tsx` renders a checkbox plus plain title span; Add step creates `Step N` without an editing control. | Add an inline title input with an accessible name, preserving checkbox behavior, read-only mode and existing `patchTask` persistence. Do not add a new workflow or panel. |
| Adjacent detail controls have different heights | `.spectra-plan-detail-grid :is(select, input)` sets 28px; the actual `SelectField` renders a Radix button with shared `size="sm"` height `h-8` (32px). | Match local inputs to the existing small-control density. Keep the shared Select component unchanged. |
| Small close/remove targets merit visual checking | Detail close uses a 16px icon plus 3px padding; dependency remove icons are similarly compact. | Inspect at normal/narrow widths and keyboard focus, then apply only local spacing/focus corrections if confirmed. |

The official-date explanatory note already exists. No additional source panel, broad redesign or new design-document setup is proposed.

## Handoff state

The coordinator received the exact durable call proposal and the bounded receipt policy. DURABLE/COLLAB received their shared seam questions; SECURITY received the receipt provenance limitation. No production edits have been authorized by this proposal, and no new tests have run. Shared persistence implementation and executable validation remain separately allocated work.
