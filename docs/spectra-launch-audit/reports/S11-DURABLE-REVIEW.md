# S11 DURABLE independent review

2026-09-25. Reviewed product: `d9aabfb5735bdcd8a620af8a7bdaa85aba08d150`. Candidate branch: `codex/s11-durable-review`. This first unit contains a decision ledger and independent regressions, not a production repair or launch approval.

## Result and evidence boundary

Keep the immutable durable-body, indexed alias-retention, attested adoption, delete-aware acknowledgement and atomic cross-tab storage foundations. Replace the native reconciliation commit boundary and the full-room offline recovery strategy. Neither another storage provider nor a second sync/history engine is justified by the evidence.

Two launch-critical units are independently reproduced:

- **D1 — native reconciliation is not a canonical/history transaction.** `replicas.recordExternalReconciliation` overwrites an intervening disjoint canonical edit, returns `applied` without a saved version, and reports an absent operation as applied without effect. A completed reconciliation replay preserving a later edit is the positive control. The repair must include the Yjs room: a route-side checkpoint or canonical CAS alone leaves the older live room able to overwrite the native result.
- **D2 — small offline edits inherit full-room capacity and retry failures.** Actual transport recovery sends 1,250,049 payload bytes for a sub-1-KiB edit, exceeding the gateway's 1,048,576-byte message limit even before framing. A remotely known base above the default 8-MiB local snapshot cap prevents saving the small pending edit at all. Local-store failures produced 1,447 commit attempts after one simulated day and 2,887 after two; clamping the counter is not exhaustion.

`convex/s11-native-history-boundaries.test.ts` and `src/features/spectra/__tests__/s11-durable-recovery-boundaries.test.ts` exercise actual Convex handlers and the actual transport/persistence classes. The transport provider is a spy; this establishes bytes passed into the provider, not live packet transmission. The tests deliberately assert required behavior: **7 tests, 6 failures, 1 pass** at the reviewed revision. No expected-failure annotation or weakened threshold hides these defects. The native fixture directly commits the intervening canonical head, modeling the route's asynchronous read/merge/commit gap; it is not a live simultaneous-editor test. The capacity fixture uses a large Y.Text with a small cell-map change, not an imported workbook rendering benchmark.

Existing focused controls: **9 files, 84 tests, 69 passes, 15 failures**. Four files passed: durable storage bindings, durable recovery, incremental delta, and atomic local persistence. Nine failures in inline-native-retention, pinned-native-authority and collaboration-durable-payload stop at obsolete `phase: complete` assertions when the new lifecycle correctly says `retained`. Those runs do not establish the subsequent native security/retention assertions. Four Hocuspocus lifecycle failures expect either ID-only acknowledgements or stale cached modify authority; two persistence-window cases omit the `documentFrontierHash` dependency from their extracted-function harness and fail before their persistence promise exists (`finish is not a function`). Keep the stronger protocol and repair the fixtures in the owning implementation unit.

Commands (RUNTIME restored exact-lock dependencies; focused worker limit authorized):

```text
node node_modules/vitest/vitest.mjs run convex/s11-native-history-boundaries.test.ts src/features/spectra/__tests__/s11-durable-recovery-boundaries.test.ts --maxWorkers=1
node node_modules/vitest/vitest.mjs run convex/durable-storage-bindings.test.ts convex/inline-native-retention.test.ts convex/pinned-native-authority.test.ts convex/durable-recovery.test.ts convex/collaboration-durable-payload.test.ts scripts/collaboration-delta.test.mjs scripts/collaboration-persistence-window.test.mjs src/features/spectra/__tests__/local-yjs-atomic.test.ts src/features/spectra/__tests__/hocuspocus-transport-lifecycle.test.ts --maxWorkers=1
```

Private evidence: `.spectra-local/launch-s11/durable-review/independent-regressions-original-tool-output.log` and `existing-controls.log`. The first independent run had an incorrect fixture index; it was corrected to `by_artifact_created` before the seven-test result above. The initial shell printed the log and returned zero; the tool output itself reports six failures. The existing-control command preserves Vitest's exit code and returned 1. A final two-file rerun failed during startup because the shared dependency tree could no longer resolve `@jridgewell/sourcemap-codec` from magic-string. That run overwrote `independent-regressions.log`; the original 110-line output tail was recovered verbatim from this task's tool transcript and explicitly labeled. The startup failure is separate from test outcomes; RUNTIME was notified, and no independent install was attempted. No shared runtime, browser, Office, database, publication or original local file was changed. The local node_modules junction points to the centrally managed dependencies.

## Historical evidence used

Actual task conversations were read, alongside reports and commit diffs: S9 original `01a0be88-d3ae-77f3-877f-802928ba00a7`, recovery `01a0c3c7-cb80-7781-96f6-18fcb8d7d4c8`, integration `01a0ca2d-f84b-7d71-af6f-82acb272d4bc`, acceptance `01a0cb5e-daed-7563-915d-a746b6da993d`; S10 durable review `01a0d338-50c8-78b1-83d1-8af54ef58625`, collaboration `01a0d338-4814-7d52-87c1-d7f697e900ac`, and Bridge `01a0d338-3f69-7b40-92ee-424f0466978a`. Some long historical tool outputs were truncated; no unobserved live result is promoted to current proof. Recovery task startup failures do not count as implementation evidence. The original coordinator was identified through the campaign registry; its complete historical conversation was not independently read in this unit.

Source anchors below are commits, so decisions remain reviewable without trusting a report's verdict. `eac1567b` is a combined integration of many lanes, not solely DURABLE's work. Office semantic fidelity, AI prompting and unrelated EDGE UI changes have other named reviewers.

## Decision ledger

| ID / source | Original finding and implementation | Current caller / invariant | Verdict and cross-system consequence | Current evidence and residual |
| --- | --- | --- | --- | --- |
| L01 · `0ff1f359` | Large projections exceeded inline row/request limits; moved bodies to immutable digest-checked durable blobs with hot references. | Content route → durable-content-server → artifactContent adoption; native model and data hydration consume refs. | **Keep.** Large bodies need bounded materialization; rows and subscriptions should carry metadata. Do not substitute another storage engine. | Passing durable-recovery controls. Upload still holds chunks, concatenated bytes, decoded JSON and parsed body; bounded size does not imply low peak RAM. |
| L02 · `0ff1f359`, S9 integration | Hollow/shorter-content veto and repair writes could resurrect legitimate deletion; removed destructive size-based heuristics. | use-artifact-live-model, native-artifact-model, artifact-studio value reconciliation. | **Keep removal.** Authoritative smaller/empty content must propagate; authorization and revision evidence decide validity. | Historical shorter/empty live transitions; current durable-recovery controls. Full live editor matrix not rerun. |
| L03 · `0ff1f359` | Forged upload metadata/adoption could introduce unauthenticated durable bytes; added internal attestation and immutable hash/byte checks. | intakeAttestation, artifactIntakeActions, content route, artifactContent, shared intake-attestation. | **Keep.** Adoption authority and body integrity are separate from mere possession of a ref. | Current source and existing recovery suite. Memory/cost of full decode/validation remains. |
| L04 · `0ff1f359`, `eac1567b` | GC could delete a blob aliased by durable/native/asset rows; initial first-two-then-filter guard missed later active aliases. S10 indexed live states before bounded probes. | durableStorageBindings used by artifactAssets, payloadLifecycle, intake/runtime deletion and run attachments. | **Keep S10 replacement.** Release each owner without deleting another artifact's bytes. | Current binding suite passes. Nine indexed ranges return at most 18 rows: structural bound, not measured DB bytes. |
| L05 · `eac1567b` | Native upload accepted false same-size SHA-256 or corrupt dedup slot; verifies storage metadata digest for upload and existing target. | payloads.put → native payload adoption / Bridge upload. | **Keep.** Hash identity must mean verified bytes; caller's redundant uploaded storage is not opportunistically destroyed. | Binding/recovery controls pass; native test inventory reviewed. Real storage-metadata service behavior not remeasured. |
| L06 · `0ff1f359`, `eac1567b` | Generic durable ownership did not cover inline native history. S10 resolves native bases from source replicas / established trusted owners. | orgNodeMutation triggers → durablePayloadOwnership; snapshot/version creation and deletion. | **Keep with provenance discriminator.** Both inline and external snapshots need original native package retention. | Current inline tests stop early on obsolete retained lifecycle. Do not claim their downstream read/release assertions currently pass. Hash-only version mutation with unchanged generic ref set deserves a targeted trigger test. |
| L07 · `eac1567b` | Initial inline fix let authored `nativePayloadRefs` / nested `payloadRef` manufacture foreign native read access. Added `spectraArtifactVersions:native` trusted owners. | retainedContentAccess and payloads.get permit pinned reads from verified source-bound owners or actual durable dependencies. | **Keep replacement; remove authored-ref authority.** Retention is not permission. Same-account source ownership alone cannot authorize an unrelated shared native file. | Current attack tests reach retained deletion, then stop at stale assertion; historical public-handler exploit/fix read. Must rerun full negative and positive controls with correct lifecycle. |
| L08 · `2532be1e`, `eac1567b` | Deletion used Node Buffer in Convex and inferred no references from truncated/unreadable traversal. Runtime-safe cursor, exact pinned version reads, completeness flag now retain unresolved evidence. | artifactIntakeLifecycle.retainedReferences and intake release pages. | **Keep.** Unknown evidence retains bytes with a repairable reason instead of guessing absence. | Current durable-recovery controls pass. Limits (12k nodes/depth 10 in traversal) bound work; they can intentionally postpone GC. |
| L09 · `a86edfeb` | Source removal with live pins misleadingly reported physical completion. Added retained terminal phase and resume on unpin/retry; legacy thread cleanup releases snapshot refs. | spectraArtifactDeletion, artifactDeletionScheduling, spectraThreads, schema. | **Keep.** Retained source/history is distinct from completed deletion. | Source diff confirms no continued scheduling while retained. Nine old tests need lifecycle maintenance. Actual final-pin cleanup plus elapsed physical GC remains acceptance work. |
| L10 · `0ff1f359` | Retry after lost ack/compaction could require a GC'd update body. Receipt lookup now precedes payload validation, while immutable identity is checked. | collaborationGatewayStore append and collaborationDurablePayload. | **Keep.** A matching durable receipt proves effect; missing row does not. | Passing durable-recovery suite; D1 exposes the opposite mistake in a separate native mutation. Receipt retention/identity across all native paths remains incomplete. |
| L11 · `0ff1f359`, `eac1567b` | Semantically invisible structs and delete sets were dropped or acknowledged from a state vector alone. Durable envelope retains causal bytes; recovery uses vector plus delete set. | canonicalDurableUpdate, collaboration-durable-frontier, transport confirmation and gateway stateless handler. | **Keep.** Empty visible diff can still be required CRDT history. Do not weaken confirmation to satisfy ID-only tests. | Incremental-delta suite passes. Lifecycle mocks omit the frontier in responses; the persistence-window extracted-function harness omits the frontier-hash helper. Browser lost-ack/reconnect needs fresh proof. |
| L12 · `eac1567b` | Per-tab read/modify/write and eviction lost the other tab's pending branch. Added atomic merge/admission/eviction transaction in existing IDB store. | BoundedYjsLocalPersistence → store.commit. | **Keep atomicity; replace full-snapshot-only recovery (D2).** A journal/delta admission strategy must preserve this cross-tab boundary and pending-draft protection. | Atomic suite passes; independent >8-MiB-base regression fails. Full-room snapshots remain legitimate baseline/compaction artifacts. |
| L13 · `eac1567b` | Offline recovery retransmitted the whole room and only backed off forever on local-store errors. | HocuspocusArtifactTransport.sendLocalRecoveryUpdate; BoundedYjsLocalPersistence retry scheduler. | **Replace D2.** Causal recovery/delta storage, finite scheduled retries, explicit resume, and durable pending state belong together. | 1,250,049 bytes exceeds 1-MiB frame; default cache refuses large base + tiny edit; 1,447→2,887 attempts. COLLAB assigned production repair; these are deterministic probes. |
| L14 · `0ff1f359`, `eac1567b`, `22198903` | Cached grants survived definite actor denial or transient outages indefinitely. Added definite revocation, 15-sec last-success lease, 5-sec refresh timeout and before/after append checks. | collaborationDurablePayload, bootstrapNative, authorizationGuard, gateway append, transport level null, initialization restore barrier. | **Keep authorization semantics; measure duplicated checks.** Late responses must not resurrect expired authority; inability to check is not proven revocation. Restore failure must not connect an empty replacement room. | Durable-recovery revocation control passes. Generic permission lifecycle test wrongly expects cached modify. Per-batch duplicate authorize calls add DB/latency cost; post-commit denial must not claim the already committed write never happened. |
| L15 · `eac1567b`, `22198903`, `5f0bc8a8` | Cross-school ownership and same-client overlapping claims bypassed intended checks. Added explicit school match; same client renew/acquire checks overlap. | authorityShared, requireDurablePayloadAuthority, bootstrapNative, regionClaims.acquire; thread workspace school validation. | **Keep with concurrency review.** Account equality alone is not tenant scope; same-user tabs/AI actors still need distinct ordering. | Relevant diffs reviewed; no broad security claim. Native reconciliation bypasses this region/room commit protocol entirely (D1). |
| L16 · `eac1567b` | Gateway persistence retries/queues could grow; finite 12-attempt budget, bounded batch bytes/entries and 180-ms/1-sec flush window added. | schedulePersistence / persistence chain / appendWithRetry. | **Keep finite policy; needs rebase correction before external append reuse.** Current rebase updates the expected hash without loading/applying the new durable state; it is not a semantic merge. | Persistence-window basic batching cases pass; confirmation harness omits a required dependency. One full-room snapshot is still captured per batch; scratch doc and full projection/checkpoint cost persist. |
| L17 · `2532be1e` | Large AI preview staged the entire workbook. Preview omission threshold and compact region deltas avoid repeated request bodies. | artifact-live-preview, yjs-artifact-operation, artifact-yjs-model and convex-server checkpoint/spill paths. | **Keep narrow omission.** Persist real content in the canonical log, while preview UI uses compact plans. | Historical 200k-cell HTTP edit requests 72–77 bytes. This is not proof of cheap projection/checkpoint/DB work; current live cost not rerun. Omitted before/after group reconstruction from global head needs HISTORY attribution review. |
| L18 · `2532be1e` | Generated sheet IDs/extent expansion made distant cell edits claim structure. Structured adapters and Office content distinguish cell changes from real row/column reordering. | sheet decomposition, projection contracts, native live mutation plans. | **Keep semantic distinction.** Disjoint cell edits should converge; actual structure changes still need overlap ordering. | Current source and diff inspected; historical workbook acceptance. OFFICE/COLLAB own exhaustive structure/deletion/reorder matrices. |
| L19 · `2532be1e` | DOCX no-op materialization rewrote unrelated package data / prefixes. Carries unchanged native parts and no-op binding. | document-projection, docx route, office-content, native-live-promotion. | **Keep preservation; needs feature-matrix proof.** Untouched parts and relationships must survive; unsupported semantics need honest limitation. | Historical Word readback: 695 equations, 7 tables, media and 17 unchanged package parts. Not proof of every Office capability. OFFICE owns lens correctness. |
| L20 · current replicas seam, `2532be1e`, `eac1567b` | Lens reads a head, awaits native parsing/merge, then recordExternalReconciliation installs the whole result; browser later synchronizes Yjs. No base CAS, version or true receipt requirement. | docx/office routes → replicas.recordExternalReconciliation → artifact-native-sync.applyExternalProjection → live.synchronize. | **Replace D1 as one transaction boundary.** Persist native delta, canonical head, native provenance/version and receipt before applied. Preserve disjoint changes and surface overlaps. Missing operation must never mean success. | Three failing native invariants plus passing replay control. Native key currently only inspects document blocks; sheet/slide promotion and document metadata changes need OFFICE follow-up. |
| L21 · `952ef8dc` | Office materialization could continue after a failed queue result. Route now accepts only `pending`. | Office route → replicas materialization queue and native write status. | **Keep refusal of failed/stale; refine receipt semantics if verified replay is reachable.** A matching verified receipt may be a valid retry; do not conflate it with failure. | Two-line guard inspected; successful replay contract needs route/queue test. Native save state must distinguish canonical save, queued write and readback-verified write. |
| L22 · `eac1567b`, current Bridge/shared policy | SafeWriter stages temp, syncs, hashes, rechecks target identity/base/Office locks and atomically replaces; journal records pre/post hashes and verified retry. Structure defaults independent with explicit mirror policies. | shared/sync-policy, bridge fs/journal/sync, bridgeStructure, Bridge queue. | **Keep independent organization and atomic staging. Needs retained-base design/proof.** `.spectra-*.tmp` is temporary write staging, not a persistent mirror/history store. Extend current journal/replica ownership instead of adding another engine. | Source review only here. No OS atomic CAS spans recheck→replace against an external Office process; BRIDGE owns crash/lock/race tests. Whole changed Office packages still upload; identical-hash dedup is not zip-part delta transport. |
| L23 · current dependency / history readers | Native dependency resolution caps 512 IDs, reads 51 replicas then rejects >50; pinned access and snapshot ref recount use collect. Convex-server eagerly hydrates nested refs. | durableContentDependencies, retainedContentAccess, artifactSnapshots, convex-server. | **Needs measured scaling repair, preserve explicit refusal.** Bounds prevent silent omission but may reject legitimate many-device histories. Avoid expanding authority while optimizing reads. | Source bounds only; no returned-row-byte or billed-cost measurement here. A small HTTP response is not a read-cost measurement. DATA/HISTORY/PERFORMANCE own wider changes. |

## Repair contracts and acceptance still required

D1 production ownership was assigned to DURABLE by the coordinator, pending exact shared-file boundary. HISTORY is the independent reviewer; Office and collaboration seams require arbitration. A safe implementation must reuse the existing Yjs log, change groups/snapshots and ownership ledger. It needs an authenticated native operation identity, exact native ancestry, a canonical/room revision fence, retained before/after native provenance, a real version/receipt committed atomically, and idempotent replay after client/server termination. A stale result must be recomputed against the current head; merely relabeling a stale base hash is unsafe. Concurrent same-region edits must remain recoverable; a long global editing lock is not the answer.

D2 belongs to COLLAB. Independent regressions must remain unchanged in purpose while its candidate adds delete-aware recovery of pending causal bytes, capacity-safe framing/admission and a finite automatic retry budget. Recovery after expiry/exhaustion needs explicit resumption; memory-only retention is not a browser-crash durability claim.

Required acceptance beyond this finite review: loss/duplication/reordering across native/Yjs/version/ack boundaries; actual tab termination; disjoint and overlapping native/human/AI changes; revoked actor and restored access; native locks and rename/move/delete; pending draft above capacity; final-pin unpin/physical release; cold/warm opening and bytes/RAM/DB work. Historical observations are useful fixture targets, not current passes. Windows readback does not establish macOS or production behavior. No full suite, typecheck, build or live stack changes were run in this unit.

## Relevant commit/file inventory

The appendix below is generated from Git paths at each reviewed commit. Groups enumerate all paths for the two DURABLE commits, plus relevant durable/Bridge/collaboration paths in the combined commit and exact reviewed EDGE paths. Ledger rows supply the invariant-level verdict; presence here is not a claim that unrelated AI/Office implementation is approved.

### 0ff1f359 — Initial durable implementation

- .gitattributes
- convex/artifactAssets.ts
- convex/artifactContent.ts
- convex/artifactIntakeActions.ts
- convex/artifactIntakeLifecycle.ts
- convex/bridgeSync.ts
- convex/collaboration-checkpoint.test.ts
- convex/collaboration-durable-payload.test.ts
- convex/collaborationDurablePayload.ts
- convex/collaborationGatewayStore.ts
- convex/durable-recovery.test.ts
- convex/durablePayloadOwnership.ts
- convex/durableStorageBindings.ts
- convex/intakeAttestation.ts
- convex/payloadLifecycle.ts
- convex/payloads.ts
- convex/replicas.ts
- convex/schema.ts
- scripts/collaboration-durable-capacity.mjs
- scripts/collaboration-durable-capacity.test.mjs
- scripts/collaboration-durable-replay.test.mjs
- scripts/collaboration-gateway.mjs
- shared/intake-attestation.ts
- src/app/api/spectra/content/route.ts
- src/features/spectra/__tests__/durable-office-model.test.ts
- src/features/spectra/__tests__/office-activation-budget.test.ts
- src/features/spectra/__tests__/remote-studio-incoming.test.ts
- src/features/spectra/collaboration/use-artifact-live-model.ts
- src/features/spectra/components/artifact-studio-value-utils.ts
- src/features/spectra/components/artifact-studio.tsx
- src/features/spectra/data/durable-content.ts
- src/features/spectra/work/models/yjs/native-artifact-model.ts
- src/lib/durable-content-server.ts

### 2532be1e — Durable acceptance follow-through

- convex/artifactIntakeLifecycle.ts
- convex/durable-recovery.test.ts
- next.config.ts
- src/app/api/spectra/__tests__/content-route.test.ts
- src/app/api/spectra/lenses/docx/route.test.ts
- src/app/api/spectra/lenses/docx/route.ts
- src/app/api/spectra/lenses/office/route.ts
- src/app/api/spectra/run/loop/plan.ts
- src/features/spectra/__tests__/artifact-live-preview.test.ts
- src/features/spectra/__tests__/artifact-yjs-decompose.test.ts
- src/features/spectra/__tests__/docx-lens.test.ts
- src/features/spectra/__tests__/durable-upload-config.test.ts
- src/features/spectra/__tests__/native-live-promotion.test.ts
- src/features/spectra/__tests__/run-route.test.ts
- src/features/spectra/__tests__/xlsx-w6-04.test.ts
- src/features/spectra/ai/yjs-artifact-operation.ts
- src/features/spectra/collaboration/artifact-live-preview.ts
- src/features/spectra/collaboration/artifact-yjs-model.ts
- src/features/spectra/components/artifact-native-sync.ts
- src/features/spectra/lenses/document-projection.ts
- src/features/spectra/lenses/native-live-promotion.ts
- src/features/spectra/lenses/office-content.ts
- src/features/spectra/lenses/projection-contracts.ts
- src/features/spectra/lenses/xlsx-lens.ts
- src/features/spectra/work/models/yjs/structured-adapters.ts
- src/lib/convex-server.ts

### eac1567b — Combined integration: durability and adjacent protocol paths

- bridge/bridge-app/src/main.rs
- bridge/bridge-core/src/fs.rs
- bridge/bridge-core/src/identity.rs
- bridge/bridge-core/src/journal.rs
- bridge/bridge-core/src/lib.rs
- bridge/bridge-core/src/retry.rs
- bridge/bridge-core/src/sync.rs
- bridge/bridge-core/src/watcher.rs
- bridge/bridge-core/tests/chaos.rs
- bridge/bridge-core/tests/granted_tree.rs
- convex/artifactIntakeLifecycle.ts
- convex/bridge-chaos.test.ts
- convex/bridge-payload-integrity.test.ts
- convex/bridge.ts
- convex/bridgeStructure.ts
- convex/bridgeSync.test.ts
- convex/bridgeSync.ts
- convex/bridgeWriteOperations.ts
- convex/durable-recovery.test.ts
- convex/durable-storage-bindings.test.ts
- convex/durableContentDependencies.ts
- convex/durablePayloadOwnership.ts
- convex/durableStorageBindings.ts
- convex/inline-native-retention.test.ts
- convex/payloads.ts
- convex/pinned-native-authority.test.ts
- convex/replica-truth.property.test.ts
- convex/replicas.test.ts
- convex/replicas.ts
- convex/retainedContentAccess.ts
- deploy/collaboration-gateway/Dockerfile
- docs/spectra-launch-audit/reports/S10-BRIDGE.md
- docs/spectra-launch-audit/reports/S10-COLLAB.md
- docs/spectra-launch-audit/reports/S10-REVIEW-DURABLE.md
- scripts/collaboration-delta.test.mjs
- scripts/collaboration-gateway.mjs
- scripts/collaboration-persist.mjs
- scripts/collaboration-persistence-window.test.mjs
- scripts/collaboration-reconnect.mjs
- scripts/collaboration-update-envelope.mjs
- scripts/s10-collaboration-blockers-repro.ts
- scripts/s10-collaboration-probe.ts
- shared/collaboration-durable-frontier.mjs
- shared/replica-truth.ts
- src/app/api/spectra/native/route.ts
- src/features/spectra/__tests__/bridge-contract.test.ts
- src/features/spectra/__tests__/bridge-mount-selection.test.ts
- src/features/spectra/__tests__/collaboration-gateway.test.ts
- src/features/spectra/__tests__/local-yjs-atomic.test.ts
- src/features/spectra/__tests__/local-yjs-reopen.test.ts
- src/features/spectra/__tests__/native-ai-promotion.test.ts
- src/features/spectra/__tests__/native-write-status.test.ts
- src/features/spectra/__tests__/native-yjs-models.test.ts
- src/features/spectra/__tests__/replica-truth.test.ts
- src/features/spectra/__tests__/studio-snapshot-cache.test.ts
- src/features/spectra/ai/native-ai-promotion.ts
- src/features/spectra/ai/native-write-status.ts
- src/features/spectra/bridge/bridge-settings.tsx
- src/features/spectra/bridge/client.ts
- src/features/spectra/bridge/file-storage-controls.tsx
- src/features/spectra/bridge/humanize.ts
- src/features/spectra/bridge/mount-selection.ts
- src/features/spectra/bridge/status.ts
- src/features/spectra/collaboration/ai-ui-events.ts
- src/features/spectra/collaboration/hocuspocus-transport.ts
- src/features/spectra/collaboration/reconnect-backoff.ts
- src/features/spectra/collaboration/types.ts
- src/features/spectra/collaboration/use-artifact-collaboration.ts
- src/features/spectra/components/artifact-native-sync.ts
- src/features/spectra/realtime/persistence/local-yjs-persistence.ts

### 22198903 — EDGE authority and restore/append checks

- convex/collaborationDurablePayload.ts
- convex/collaborationGatewayStore.ts
- scripts/collaboration-gateway.mjs
- src/features/spectra/collaboration/hocuspocus-transport.ts
- src/features/spectra/collaboration/use-artifact-collaboration.ts
- src/features/spectra/collaboration/use-artifact-live-model.ts

### 5f0bc8a8 — EDGE tenant and region ordering

- convex/authorityShared.ts
- convex/regionClaims.ts
- convex/spectraShared.ts

### a86edfeb — EDGE retained deletion

- convex/artifactDeletionScheduling.ts
- convex/schema.ts
- convex/spectraArtifactDeletion.ts
- convex/spectraThreads.ts
- docs/spectra-launch-audit/reports/S9-EDGE.md

### 952ef8dc — EDGE materialization queue state

- docs/spectra-launch-audit/reports/S9-EDGE.md
- src/app/api/spectra/lenses/office/route.ts

## Consolidation status (September 27, `consolidate/native-office`)

The seven independent regressions are no longer red. Their files were already carried on integration in strengthened form (D1 by `e85d8e21`/`2497c96d`, which moved native reconciliation onto the durable Yjs/history/receipt commit; D2 by `8f6283fd`, which recovers from the gateway's state vector instead of resending the full room and bounds local-store retries). No assertion was relaxed and no case is marked expected-failure: `convex/s11-native-history-boundaries.test.ts` and `src/features/spectra/__tests__/s11-durable-recovery-boundaries.test.ts` pass 25/25 (the original 7 plus later durable cases). Human history restore now uses the same atomic admission (`convex/artifactRestore.ts`, see S11-HISTORY).
