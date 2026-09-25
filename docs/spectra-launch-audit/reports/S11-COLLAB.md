# S11 collaboration recovery

Worker: `01a0d86a-8b16-77b1-b29e-8f2980fdb8b8`, `codex/s11-collab-recovery`, starting `d9aabfb5`.
Actual startup turn context verified GPT-6 Astra, xhigh, danger-full-access, approval never.

## D1: canonical durable rebase

Source review confirms `collaborationGatewayStore.append` only labelled hash mismatches `rebased`; it did not reject them. `appendWithRetry` could replace the expected hash without incorporating the newer durable update. A stale immediate projection could therefore overwrite a disjoint native edit. A state vector alone also cannot fence delete-only changes.

The append transaction now requires `expectedRoomId` and `expectedNextSequence`, plus the expected base vector hash. The exported `appendRoomUpdateArgs` and `appendRoomUpdate` are the shared transaction seam requested by DURABLE. `parseGatewayProjection` is exported without changing its validation. Native reconciliation can call this same handler and commit versions/replicas/receipt in its transaction. AI released-claim matching retains the captured authored base separately from the refreshed CAS base.

The gateway keeps a separate canonical Y.Doc for each open room. It loads the snapshot once and then the contiguous durable tail; a compaction gap triggers a full replay. Before accepting incoming Yjs frames it catches up direct native updates. The existing policy sweep returns compact room ID/sequence metadata and catches up idle rooms; compaction also catches up first. The live document receives canonical deltas without losing later speculative edits.

Each durable batch applies only its captured accepted deltas to that canonical replica, computes actual resulting vector, delete-aware frontier, projection and changed regions, and appends under the exact sequence. Explicit CAS failure reloads and repeats this computation. Ambiguous network failure retries the identical prepared envelope. Stable receipts bind actor, client, update digest and byte length; derived resulting vectors can legitimately differ when the same delta is replayed after later edits. Receipt lookup remains authorized and precedes sequence rejection, so lost acknowledgements after compaction still recover. Complete frontier acknowledgements never include later speculative edits.

This removes the full snapshot serialization previously captured for every pending batch and the hash-only rebase helpers/tests. It adds an authorized compact tail read before incoming update admission and retains one canonical replica per active room. Runtime latency/memory/read cost needs measurement after the hold clears; no live performance claim is made.

Prepared regressions cover native/browser disjoint edits, delete-only catch-up with equal vectors, exclusion of later pending state from durable frontier, tail pagination from nonzero sequence, stable retry envelope after lost acknowledgement, exact backend sequence fencing and digest-bound replay after later state. Existing append/checkpoint fixtures now pass explicit sequence contracts. Tests that endorsed hash-only stale append acceptance were replaced with rejection expectations.

Validation status: source review and `git diff --check` only. All test/build/install commands remain held by RUNTIME because the shared dependency tree was damaged. No services, dependencies, junctions, backend publication or real data were changed. Security's new AI first-effect permit is a separately owned integration seam, not supplied by this change. D2 offline recovery follows as a separate commit.
