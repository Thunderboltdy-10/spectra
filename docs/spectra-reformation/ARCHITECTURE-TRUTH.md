# ARCHITECTURE-TRUTH — replicas, the Bridge engine, and the status system

Owner phases: P1 (primary), P0/P2/P8 (consumers). Binding under CANON R1–R4, R14–R15.

## 1. The truth hierarchy (R1, decided 2026-08-25)

For **linked work** (an artifact backed by a native file):

1. **Bytes at a revision** (SHA-256, content-addressed in `payloadObjects` / on disk) are the synchronization truth.
2. **The stored base** — the (payload revision, projection snapshot) pair captured at the last successful open/materialize — is the merge ancestor. It is a first-class persisted object, not an implicit assumption.
3. **The semantic view** (Yjs doc ↔ `artifact.content`) is derived. It becomes truth only through **promotion**: materialize → byte write → read-back verify → base advance. External bytes enter the semantic view only through **reconciliation**: 3-way diff against the stored base (ARCHITECTURE-FIDELITY §3).

For **Spectra-native work** (no linked file): the Yjs document is truth; Convex `artifact.content` is its durable projection; `payloadObjects` unused.

Nothing may stamp agreement between layers it did not verify. The current codebase violates this in three places that P1 removes: cloud `current` at enqueue (`convex/replicas.ts:508-521`), local `current` on unreconciled external report (`convex/bridgeSync.ts:927`), discovery `current`-without-hash (`bridgeSync.ts:318`).

## 2. The replica state machine (rebuilt)

States keep the Nova vocabulary (`current / ahead / behind / pending / diverged / error / unavailable`) — the vocabulary was right; the transitions lied. Rebuild rules:

- **Compensation table is part of the spec.** Every transition entry lists: entry condition, verified exit(s), failure exit(s), and the **sweeper** that re-drives or expires it if the actor dies mid-flight. A PR that adds a state or transition without its table row fails review (R2).
- **Idempotency keys are derived, not random**: `hash(workId, deviceId|cloud, baseRevision, targetRevision, direction)`. Cloud-side dedupe becomes real; the Rust journal's keyed-intent pattern (`bridge-core/src/fs.rs:201-234` — already correct) extends to every cloud caller. `crypto.randomUUID()` per call is banned in sync paths.
- **Sweepers exist** (Convex crons, indexed queries only): stranded `pending` (claim died), abandoned claims, stuck strategy transitions, conflict rows whose work vanished, payload refcount GC. Every sweeper logs what it repaired — a sweeper firing often is itself a defect signal.
- **Storage-strategy transitions (F6)** complete on verified evidence with an explicit failure path; the single-payload-condition completion (`bridgeSync.ts:575`) and its permanent stranding are replaced.
- **Conflicts**: resolution performs the actual byte/semantic swap it names, per-region where the diff supports it; wholesale auto-resolve of unrelated conflicts (`replicas.ts:878-883`) is removed. "Keep both / fork" exists as an outcome.
- **Server-side policy enforcement**: metadata-only/cloud-content restrictions enforced in `payloads.put`/`commit`, not only in reads (CS-8).

## 3. The Bridge engine (journal-first, incremental)

The Rust micro-layer is kept as-is: SafeWriter (intent → temp → atomic rename → read-back hash verify), WAL+FULL journal, lock detection, keyring credentials, pairing. The macro layer is rebuilt around the local journal:

- **Watch → stabilize → delta.** Watcher events feed a per-path StabilityTracker (quiescence + fingerprint — the tested-but-dead `watcher.rs:163-226` design, now wired); only stabilized *changed* paths are hashed. No full-tree rescan per event; a full reconcile walk is a rare, explicitly-scheduled repair action, not a rhythm.
- **Identity persists.** OS file-id + adoption ladder (`identity.rs`) backed by the `resources` table, wired: renames and moves are identity-preserving events, not delete+create tombstone storms. A file missing from a scan is `unavailable`, never auto-trash (decided 2026-08-25; the mirror-policy trash decision requires *verified deletion*, not absence).
- **Batched cloud API.** One mutation per *batch* of changes (`reportChanges[{resourceId, hash, op, journalId}]`), not per file. Discovery of a 10k-file mount is a paged bulk operation with server-side diffing.
- **Outbound queue is real**: detected changes enqueue in the journal and drain with backoff + HTTP timeouts (the dead `sync.rs` Backoff class, wired); one hung request never stalls the engine; one unreadable file never aborts a pass.
- **Preconditions at claim**: existence, lock state, and revision are checked when a write is claimed, not only when it was minted; externally-deleted files are not silently resurrected (BR-9).
- **Steady-state budget**: a quiet mount generates **zero** cloud mutations and near-zero CPU (L4 budget). Polling remains (5s claim poll is acceptable at pilot scale) but polls that find nothing must cost nothing.

## 4. Invariants (the L2 property-test contract)

1. No replica shows `current` unless both sides' revisions were verified equal at label time.
2. Every non-terminal state reaches a terminal or truthful resting state within bounded time under actor death (R2).
3. Replay of any journal prefix is idempotent (bytes and cloud state converge to the same result).
4. No sequence of external saves + Spectra edits + crashes produces byte loss without a conflict record naming it.
5. The UI label derives from replica truth through exactly one selector (§5); no surface computes its own vocabulary.

## 5. The status system (one presenter)

`selectSyncTruth` (`src/features/spectra/bridge/status.ts`) was sound and starved of consumers (ST-1). P1 extracts a single **sync presenter** — `useSyncPresentation(replicaTruth, transportState, dirty, nativeActivity) → { state, label, detail, action? }` — consumed by the studio header, the Library rows, the dock, and anything else that speaks about sync. The three competing vocabularies (legacy string ladder, transport states, ReplicaTruth) collapse into it. Plain-words mapping lives here and only here (R13). Offline is computed once, product-wide, from transport + `navigator.onLine`, surfaced globally (UX-3).

## 6. Sync toggles → engine mapping (R14, fixed table)

| User toggle | Engine strategy | Consequence line shown |
|---|---|---|
| Keep on this computer | local replica, metadata-only cloud | "Lives on this PC. Other devices see it listed but need this PC on to open it." |
| Keep in Spectra | cloud replica only | "Stored in Spectra. Works everywhere; no file on this PC." |
| Both (recommended) | local + cloud, bidirectional | "Edits anywhere update both. The file on your PC stays a normal file." |
| (mount switch) Read, don't change | linked/protected original | "Spectra can read these files but will never change them." |

Timing/mirroring subtleties keep engine defaults; they are not user choices at launch.

## 7. Preserved as-is (do not disturb)

SafeWriter + journal intents; `shared/sync-policy.ts` pure kernels; content-addressed payloads; `bridgeIdentity.ts` continuity helpers; pairing HTTP flow (with P0's token hole fixes); keyring usage; `selectSyncTruth` priority ladder (as the presenter core).
