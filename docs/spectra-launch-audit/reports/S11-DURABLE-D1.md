# S11 D1 native reconciliation candidate

Source candidate, 2026-09-25, worktree 222b. **Not validated or launch-ready.** RUNTIME has restored the shared dependencies and proved its filesystem guard; this lane's guarded focused-test slot is queued after SECURITY. No implementation tests have run yet. This unit depends on COLLAB's shared appender extraction and sequence fence in `b3a951d2`, followed by native tail/overlap handling in `1c4ec6ff`. The coordinator authorized incorporating those exact dependencies in this worktree only after this finite owned source commit. Integration uses the original COLLAB commits independently.

## Implemented boundary

`native-reconciliation-server.ts` reads the authenticated native-operation head and complete stored Yjs snapshot/tail without connecting to the running gateway. It reconstructs actual state and calls the lens's three-way merge from its captured native ancestor. Explicit stale results cause at most four attempts with fresh state and a fresh semantic merge; ambiguous transport retries retain the same signed payload through the existing bridge client. A user conflict choice is not replayed onto subsequently changed content. Native ancestor metadata and the actual captured package hash must still agree with source-bound native references.

`nativeReconciliation.commit` uses the existing appender in the same Convex transaction. It validates current actor/owner/school/modify authority, the actual external-edit operation, exact native replica identity and ancestry, room generation/sequence, and canonical updatedAt/hash/version. An absent operation is rejected. Matching completed receipts succeed without reinstalling an old candidate, including after later canonical edits.

The transaction materializes the reconstructed before projection and closes preceding human history, appends the native delta and after projection, creates an import version with explicit before/after snapshots and native source hashes, advances replica bases, records the native receipt, and resolves only matching native conflicts. Oversized snapshot bodies must be spilled through the existing immutable content system before entry; omitted snapshots cannot fall back to a later global head. The version ownership trigger resolves old/base/new native hashes while their replica bindings still exist. `nativeReconciliationOperationId` on the appended log entry lets the gateway recognize native overlap without per-row group lookups.

The public `replicas.recordExternalReconciliation` is now conflict/verified-replay only. Its former projection-only success path is closed. DOCX and Office open/reconcile routes use the server merge action; a completed import no longer goes through a second activateLens write. Native hash equality alone no longer justifies overwriting canonical content with a native snapshot. The client recognizes `durableNative` and waits for the shared log update instead of sending the response back as a new whole-projection edit.

The signed bridge adds one isolated `nativeReconcile` operation, separate from COLLAB's append parsing changes. Schema additions are the approved `syncOperations.reconciliationReceipt` and optional `collaborationUpdates.nativeReconciliationOperationId`. No new table, storage provider, gateway requirement, or native sync engine was introduced.

Completed receipts return before room reconstruction, even after the original room retires. The action avoids creating a room or contacting the bridge for that replay. Large native updates use existing durable payload manifests; projection bodies also account for JSON envelope escaping and are stored through the same immutable payload machinery when their combined envelope would be too large. Large semantic region sets use the established whole-artifact claim domain. The client suppresses its legacy initial projection hydration once the durable native response arrives.

## Cross-review and remaining gates

HISTORY reviewed the source hash retention path and requested correct preceding-human provenance and exact reconstructed state-vector metadata; both were incorporated. Snapshot-only nativeSources is excluded when deciding whether a preceding human semantic checkpoint changed content. These references retain the native package, but the separate restore unit must use them to restore native-only data: this candidate does not claim the existing history UI already does so.

COLLAB owns actual durable rebase/catch-up of an open room, with compact head checks in the existing policy sweep and refresh at persistence flush. Its gateway must merge disjoint pending changes and explicitly reject native overlap while preserving the existing IndexedDB draft. It must not compact from a stale room or acknowledge an overlap dropped by Y.Map conflict resolution. No new syncConflicts projection fields were authorized. Integration requires the tail to carry native operation identity and existing semantic region IDs.

SECURITY confirmed externally authored user Office edits carry no AI approval permit, including an intentional user clear. The external native path rejects AI/run provenance. AI promotion remains a separate sink: explicit server-owned run/execution/operation scope must be checked before queue/materialization first effect, not inferred from artifact ownership. That sink is outside this D1 unit.

## Prepared verification

The original four independent native invariants from `c705dbce` now target the new internal commit surface. Nine additional backend cases cover retained native ownership, actual replay of a delete-only Yjs update, exact sequence refusal, overlap preserving both native references without effect, the closed legacy bypass, transaction rollback on append refusal, changed ancestry, revoked actor, and receipt replay after room retirement. Five server tests use actual native Yjs documents to verify reload/remerge after a concurrent disjoint edit, rejection of a stale explicit conflict choice, completed receipt without room I/O, duplicate receipt on the final retry, and large delta/projection spills. These 18 cases are prepared, not yet passed.

Prepared focused command, **not run until the guarded lane slot is released** (use RUNTIME's prescribed `NODE_OPTIONS` filesystem guard):

```text
node node_modules/vitest/vitest.mjs run convex/s11-native-history-boundaries.test.ts src/lib/native-reconciliation-server.test.ts --maxWorkers=1 --no-file-parallelism
```

After shared integration: run those tests, affected route/native promotion tests, native retention/authority controls with corrected retained-state fixtures, and relevant collaboration tests; typecheck the integration and review the generated API. Then use disposable live native/canonical fixtures for lost ack, browser termination, no live gateway, delete-only changes, disjoint/overlap pending drafts, retained before/after package readback, and bounded retries. No current browser/Office proof, memory/cost measurement, typecheck result or test pass is claimed. `git diff --check` is the only completed source validation for this implementation candidate.
