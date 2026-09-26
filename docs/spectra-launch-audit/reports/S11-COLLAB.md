# S11 collaboration recovery

Worker: `01a0d86a-8b16-77b1-b29e-8f2980fdb8b8`, `codex/s11-collab-recovery`, starting `d9aabfb5`.
Actual startup turn context verified GPT-6 Astra, xhigh, danger-full-access, approval never.

## D1: canonical durable rebase

Source review confirms `collaborationGatewayStore.append` only labelled hash mismatches `rebased`; it did not reject them. `appendWithRetry` could replace the expected hash without incorporating the newer durable update. A stale immediate projection could therefore overwrite a disjoint native edit. A state vector alone also cannot fence delete-only changes.

The append transaction now requires `expectedRoomId` and `expectedNextSequence`, plus the expected base vector hash. The exported `appendRoomUpdateArgs` and `appendRoomUpdate` are the shared transaction seam requested by DURABLE. `parseGatewayProjection` is exported without changing its validation. Native reconciliation can call this same handler and commit versions/replicas/receipt in its transaction. AI released-claim matching retains the captured authored base separately from the refreshed CAS base.

The gateway keeps a separate canonical Y.Doc for each open room. It loads the snapshot once and then the contiguous durable tail; a compaction gap triggers a full replay. A review correction moves tail reads from individual frames to durable batch admission. The existing policy sweep returns compact room ID/sequence metadata and catches up idle rooms; actual compaction also catches up first. The live document receives canonical deltas without losing later speculative edits.

Each durable batch applies only its captured accepted deltas to that canonical replica, computes actual resulting vector, delete-aware frontier, projection and changed regions, and appends under the exact sequence. Explicit CAS failure reloads and repeats this computation. Ambiguous network failure retries the identical prepared envelope. Stable receipts bind actor, client, update digest and byte length; derived resulting vectors can legitimately differ when the same delta is replayed after later edits. Receipt lookup remains authorized and precedes sequence rejection, so lost acknowledgements after compaction still recover. Complete frontier acknowledgements never include later speculative edits.

This removes the full snapshot serialization previously captured for every pending batch and the hash-only rebase helpers/tests. It adds one authorized tail load per persistence batch, not per keystroke, and retains one canonical replica per active room. Idle detection adds room sequence metadata to the existing policy query rather than another poll. Runtime latency/memory/read cost needs measurement after the hold clears; no live performance claim is made.

Prepared regressions cover native/browser disjoint edits, delete-only catch-up with equal vectors, exclusion of later pending state from durable frontier, tail pagination from nonzero sequence, stable retry envelope after lost acknowledgement, exact backend sequence fencing and digest-bound replay after later state. Existing append/checkpoint fixtures now pass explicit sequence contracts. Tests that endorsed hash-only stale append acceptance were replaced with rejection expectations.

Validation status: source review and `git diff --check` only. All test/build/install commands remain held by RUNTIME because the shared dependency tree was damaged. No services, dependencies, junctions, backend publication or real data were changed. Security's new AI first-effect permit is a separately owned integration seam, not supplied by this change. D2 offline recovery follows as a separate commit.

### D1 review correction: native overlap

The tail carries existing `regionIds` and DURABLE's optional `nativeReconciliationOperationId` without per-row lookups. The gateway records semantic before/after projections once per actor batch boundary/flush. Before applying pending bytes, it compares authored regions with native changes since the captured room sequence. Disjoint updates merge; overlap fails admission without an acknowledgement or Y.Map last-writer resolution. The failure carries region and native operation identity. The local recovery record retains this identity and draft, including across reload, and automatic replay stops. Conflict resolution is a separate finite unit; no false claim that a preserved conflict is resolved. If a snapshot has erased unobserved provenance newer than the authored base, admission conservatively preserves the branch for review.

Rebased canonical state is published to the live document only after all captured groups pass admission and no newer batch is pending. A regression source covers a first disjoint group committing while a later group conflicts: the latter's live draft remains intact and receives no durable acknowledgement. Idle refresh likewise defers publication if another batch arrived during its read.

The captured interval between Hocuspocus's awaited `beforeHandleMessage` and `afterHandleMessage` is also protected. An update in that interval is not yet in the persistence queue, so queue emptiness alone cannot authorize native publication. A per-document marker prevents batch, idle and recovery-vector publication until apply completes; release/disconnect clears it. Prepared regressions cover deferred idle publication and a compaction fallback containing a delete-only change whose state vector did not change. These additional tests remain unrun.

## D2: causal recovery and retained local bases

The independent `c705dbce` fixtures were consumed. The large-state transport fixture now supplies a real durable server vector and still requires the tiny offline edit to send less than 1 KiB. Existing negotiated fragmentation already supports assembled messages up to 256 MiB; the old 1 MiB observation referred to raw frame size. Recovery now requests the committed vector, sends the causal delta including deletes/unresolved dependencies, and waits for a matching complete frontier. Genuinely large new content retains the negotiated framing path. Duplicate and truncated frame regressions supplement the existing real Hocuspocus two-way framing test.

Local recovery uses the existing IndexedDB database, upgraded to version 3 with a `work-bases` object store. Large local checkpoints are split into immutable 512 KiB chunks. The work header references the actual base bytes and stores the causal journal; an 8 MiB journal budget replaces the old whole-document limit, while the total cache budget still counts base plus journal. Large unsynchronized initial content is admitted only when the total budget permits it. A checkpoint may contain pending state: its durable flag cannot clear without actual full-frontier coverage.

Reads hydrate the actual baseline plus journal offline. Repeated writes against the same base read/write only the work journal and metadata, with no repeated base-body transfer. A changed checkpoint merges the previous base and journal in the same atomic transaction. Quota admission and eviction include base chunks and cannot evict pending work. Missing or incomplete bases fail restoration; they cannot be mistaken for an empty document.

Local write failures stop automatically after eight attempts, with an explicit error state. The in-memory failure budget survives transport generations. Explicit retry is distinct from timer retries. The hook also bounds generation retries, resets only after genuine synchronization, and refuses to destroy an in-memory draft until its local recovery copy is committed. Native overlap stops automatic replay and retains its operation/region metadata.

Prepared tests cover two-tab journals against one large immutable base, zero repeated base chunk writes, offline reconstruction, delete-only recovery, missing chunks, retry exhaustion across instances, causal recovery traffic and duplicate/truncated framing. These remain unrun until RUNTIME gives this worker an execution slot. Manual native/Office and browser acceptance, latency/Convex row-byte measurements, conflict resolution UI, SECURITY's pre-broadcast AI guard/canonical digest adapter, and SCHOOL's official source refresh versus an open room remain explicit integration work.

## Baseline failure triage

RUNTIME's guarded baseline reports two `collaboration-persistence-window` failures because its source-extracted confirmation harness omitted `documentFrontierHash`, so the durable callback never started. The missing dependency is supplied. Three lifecycle failures used ID-only/no-frontier acknowledgements as proof of complete durability; fixtures now send actual complete frontiers and assert IDs alone stay pending. A fourth expected a previous modify grant after authentication failed; it now expects unknown access until a fresh authorization succeeds. These changes preserve the production receipt and authorization rules.

The pinned body/native retention test's drain helper accepts only `complete`, while the deletion coordinator explicitly treats `retained` as terminal while a live pin exists. This was referred to DURABLE for fixture/retention confirmation; no deletion or retention behavior was changed here.

## Runtime preparation after dependency hold

Coordinator explicitly authorized creating the missing local `node_modules` junction. The exact primary target was verified to exist and the local entry verified absent before creation; no existing entry or dependency was deleted or replaced. Executable checks still await this lane's explicit guarded slot after DURABLE. The original no-dependency-change statement above describes the earlier source-only phase.

## Newly discovered offline/native handshake gap

DURABLE's independent source review identified a gap beyond the existing conflict-header tests. An offline draft without an already recorded conflict is restored directly into the provider's document. The normal Hocuspocus handshake can send that draft and merge the newer native state before `spectra.recovery_request` runs. Gateway capture then records the current open room sequence rather than the draft's authored sequence; this can make the overlap comparison miss the native change. The existing mocked `onSynced` tests do not exercise that ordering.

`s11-offline-native-handshake.test.ts` uses the real artifact transport, Hocuspocus provider and ephemeral server. It withholds the recovery admission response and requires no draft upload and no native replacement of the offline title before admission. This is a prepared discovery regression, not yet executed or evidence of a completed fix. Proposed follow-up: persist an actual durable room/sequence anchor, quarantine a restored branch during handshake, and check native changes against that anchor before replay/publication. Unknown legacy ancestry must preserve the draft instead of inventing the current room sequence. Broader protocol work is awaiting coordinator allocation.

### Authored ancestry foundation (2026-09-26, source only)

Coordinator approved the narrow D2 protocol. The first source unit carries the actual room ID, next durable sequence and delete-aware frontier hash on complete frontier acknowledgements. Lost-ack duplicate recovery uses the refreshed canonical head's sequence. Confirmation includes an anchor only when it names that same captured frontier, without an extra database read. The transport accepts an anchor only after its frontier matches the unchanged local document generation.

Local persistence stores this anchor, its encoded frontier, authored region set and generation in the same transaction as base/journal bytes. The hook captures acknowledgements synchronously; a later React effect cannot attach an old acknowledgement to a newer draft. Cross-tab merges retain the oldest compatible known anchor and its corresponding frontier, combine authored regions and keep unknown/different-room ancestry unknown until the full previous branch is actually covered by an acknowledged state. Delete-only changes remain pending despite equal vectors. Prepared tests cover failed-save boundaries, offline restore and cross-tab merges. Normal remote Yjs application does not count as locally authored region intent.

This is ancestry storage only: provider quarantine and pre-apply recovery admission are still being implemented, and the real handshake discovery test is not yet expected to pass. No test/build/lint command has run in COLLAB; guarded slot remains after DURABLE. The local cost probe is prepared under ignored `.spectra-local/launch-s11/collab/recovery-cost.mjs` and has not executed. It explicitly excludes actual Convex row-byte, billing and network-latency claims.

## Atomic AI/native contract foundation

DURABLE and BRIDGE-R agreed on `beforeCommit({desired, changedRegionIds, prepareAdmittedUpdate(normalizedDesired)}) -> AdmittedAiCommit | void`. COLLAB owns the new `admitted-ai-update.ts` types, final scratch-plan builder, exact accepted-byte consumer and prompt room catch-up. BRIDGE owns native preparation and orchestration; DURABLE owns the one append/history/native-outbox effect transaction. `void` is reserved for the non-native path using ordinary guarded AI admission.

The first contract unit defines the agreed inline/payload/covering-replay response and its reader. Inline and retained payload bytes must match the original receipt's SHA-256 digest and length. Compacted recovery must load a verified replay from the same room at or beyond the receipt, and may contain later admitted edits. It cannot use a newly prepared retry candidate. Four prepared tests cover these boundaries. Actual operation-builder/callback wiring and pre-broadcast sink enforcement remain pending; these source types and reader are not proof of end-to-end atomic acceptance.
