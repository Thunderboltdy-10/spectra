# S11 D1 native reconciliation candidate

Updated 2026-09-26, worktree 222b. **Focused tests passed; live and integration gates remain.** D1 source `0e34c3f6` is followed by the reviewed ancestor/activation repairs below. Local dependency-only integration includes COLLAB `b3a951d2`, `1c4ec6ff`, `db476139`, `228ee02c`, and OFFICE-MODELS `a9ef82ea` (local `8cf006c8`). The latter's modify/delete conflict kept the absent `s11-office-review.test.ts` absent. The coordinator integrates original dependency commits separately.

## Implemented boundary

`native-reconciliation-server.ts` reads the authenticated native-operation head and complete stored Yjs snapshot/tail without connecting to the running gateway. It reconstructs actual state and calls the lens's three-way merge from its captured native ancestor. Explicit stale results cause at most four attempts with fresh state and a fresh semantic merge; ambiguous transport retries retain the same signed payload through the existing bridge client. A user conflict choice is not replayed onto subsequently changed content. Native ancestor metadata and the actual captured package hash must still agree with source-bound native references.

`nativeReconciliation.commit` uses the existing appender in the same Convex transaction. It validates current actor/owner/school/modify authority, the actual external-edit operation, exact native replica identity and ancestry, room generation/sequence, and canonical updatedAt/hash/version. An absent operation is rejected. Matching completed receipts succeed without reinstalling an old candidate, including after later canonical edits.

The transaction materializes the reconstructed before projection and closes preceding human history, appends the native delta and after projection, creates an import version with explicit before/after snapshots and native source hashes, advances replica bases, records the native receipt, and resolves only matching native conflicts. Oversized snapshot bodies must be spilled through the existing immutable content system before entry; omitted snapshots cannot fall back to a later global head. The version ownership trigger resolves old/base/new native hashes while their replica bindings still exist. `nativeReconciliationOperationId` on the appended log entry lets the gateway recognize native overlap without per-row group lookups.

The public `replicas.recordExternalReconciliation` is now conflict/verified-replay only. Its former projection-only success path is closed. DOCX and Office open/reconcile routes use the server merge action; a completed import no longer goes through a second activateLens write. Native hash equality alone no longer justifies overwriting canonical content with a native snapshot. The client recognizes `durableNative` and waits for the shared log update instead of sending the response back as a new whole-projection edit.

The signed bridge adds one isolated `nativeReconcile` operation, separate from COLLAB's append parsing changes. Schema additions are the approved `syncOperations.reconciliationReceipt` and optional `collaborationUpdates.nativeReconciliationOperationId`. No new table, storage provider, gateway requirement, or native sync engine was introduced.

Completed receipts return before room reconstruction, even after the original room retires. The action avoids creating a room or contacting the bridge for that replay. Large native updates use existing durable payload manifests; projection bodies also account for JSON envelope escaping and are stored through the same immutable payload machinery when their combined envelope would be too large. Large semantic region sets use the established whole-artifact claim domain. The client suppresses its legacy initial projection hydration once the durable native response arrives.

## Cross-review and remaining gates

PRESERVATION found and independently re-reviewed two repaired defects. The exact native ancestor is `projectionBaseRevision ?? baseRevision`; fallback bytes are hashed before reuse. The commit requires the prepared ancestor hash to equal that recorded revision and remain source-bound. Current cloud payload reference/hash/revision are fenced separately, and history retains A, C, and B when these differ.

An external save before the first lens open now activates only an empty resource with no semantic content/version and no room updates/snapshots. The same transaction retires the resource room, creates the typed room (document2/sheets4/presentation1), updates resourceClass to artifact, and commits the complete first Yjs update, projection, history and receipt. The first update replays independently on an empty document. Format/type mismatch and nonempty/concurrently edited resources are refused; append failure rolls back retirement and activation. Resource-to-typed Hocuspocus names differ by type. Room CAS rejects old durable writes; this is not immediate revocation of old-channel tokens, and COLLAB owns the authorization-refresh generation check.

HISTORY reviewed the source hash retention path and requested correct preceding-human provenance and exact reconstructed state-vector metadata; both were incorporated. Snapshot-only nativeSources is excluded when deciding whether a preceding human semantic checkpoint changed content. These references retain the native package, but the separate restore unit must use them to restore native-only data: this candidate does not claim the existing history UI already does so.

COLLAB owns actual durable rebase/catch-up of an open room, with compact head checks in the existing policy sweep and refresh at persistence flush. Its gateway must merge disjoint pending changes and explicitly reject native overlap while preserving the existing IndexedDB draft. It must not compact from a stale room or acknowledge an overlap dropped by Y.Map conflict resolution. No new syncConflicts projection fields were authorized. Integration requires the tail to carry native operation identity and existing semantic region IDs.

SECURITY confirmed externally authored user Office edits carry no AI approval permit, including an intentional user clear. The external native path rejects AI/run provenance. AI promotion remains a separate sink: explicit server-owned run/execution/operation scope must be checked before queue/materialization first effect, not inferred from artifact ownership. That sink is outside this D1 unit.

## Executed verification

All commands used RUNTIME's fs-guard with shared/private dependency paths and Vitest `--maxWorkers=1 --no-file-parallelism`. Slot2 was released explicitly to the coordinator after the finite run.

- D1: 22 backend, six server, three exact-ancestor helper cases passed. Final run also includes four W7 cleanup cases: **35/35**, `.spectra-local/launch-s11/durable-review/d1-final.log`.
- Affected native retention/property cases: **24/24**, `retention-final.log`.
- DOCX lens and Office route neighbors: **63/63** in `d1-neighbors.log`. That original run had one separate W7 final-unpin failure (90/91 total); its production repair and final pass are documented in `S11-DURABLE-RETENTION.md`. Total distinct passing cases across these runs: **122**.
- Scoped ESLint passed before and after the last fixes (`d1-lint.log`, `d1-final-lint.log`). `git diff --check` passed.
- Full guarded `tsc --noEmit --incremental false` reported **17 errors** (`d1-typecheck.log`): 15 in unrelated existing files, plus an untyped version ID in a new test and a missing durable-manifest mediaType. The two owned issues were corrected and final tests/lint passed; the expensive full typecheck was not rerun. Integration type verification remains required.

Preserved red logs document fixture repairs (Convex ArrayBuffer transport and original contentHash identity) separately from genuine A/C/B and resource-activation failures: `d1-first-run.log`, `d1-review-regressions.log`, `d1-valid-fixtures-red.log`. No failure evidence was overwritten.

Still required: integration type/API verification and disposable live lost-ack/browser-close/Office readback proof, native-only restore, actual cold/warm byte and latency measurement, and COLLAB's real offline-provider admission fix. The first reconnect can otherwise sync an offline draft before its native conflict admission; mocked onSynced tests do not close D2. No launch-ready claim.
