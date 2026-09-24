# S10-COLLAB — tested source checkpoint

2026-09-24, primary checkout `<local-workspace>`, `main`, baseline HEAD `898229c8`.
Status: **132 focused checkpoint tests passed; two material launch blockers now reproduced; shared-runtime acceptance NOT RUN**. No staging, commit, reset, branch change, stack restart, local deployment, browser/Office mutation, or original school-file edit.

## Context and ownership

Read S10-ORCHESTRATION, S9-DURABLE and W9-GATEWAY-STARTUP. The substantial inherited dirty baseline, including shared retry work, remains intact. Initial session was workspace-write/restricted network; a subsequent user continuation supplied danger-full-access/approval-never, then the latest permission update reverted to workspace-write/restricted network/approval-never.

Coordinator received the initial path claim and proposed fixes while messaging worked. The later DURABLE-review request and latest coordinator checkpoint were rejected by the messaging tool: `MCP tool call requires approval, but approval policy is never`. They were **not delivered**. Neighbor findings/responses are recorded below so the coordinator can relay them. No permission workaround was attempted.

Coordinator continuation: all five core implementation file SHA-256 values still match the 132-test checkpoint; no product-source edits since that run. At the first continuation permissions remained workspace-write/restricted network/approval-never, and that handoff was blocked. Astra/xhigh was requested and COLLAB has made no model override/substitution. The acceptance-only probe has been extended below; the shared runtime remains untouched by COLLAB.

Latest context after coordinator's UI update: **danger-full-access / network enabled / approval never** confirmed. The concise coordinator checkpoint and previously blocked DURABLE, SECURITY, OPEN, S10-AI and PLATFORM boundary messages were successfully delivered. Production source is frozen for the next integrated build. No runtime slot has been granted.

S10 modifications in existing paths:

- `scripts/collaboration-gateway.mjs`: bounded persistence, backpressure, recovery confirmation, native projection batching, read-only no-op handshake.
- `scripts/collaboration-persist.mjs`: append-window limits and delay calculation; existing retry settings unchanged.
- `scripts/collaboration-update-envelope.mjs`: incremental canonical delta extraction and precise delete coverage.
- `src/features/spectra/collaboration/hocuspocus-transport.ts`: recovery confirmation identity/version lifecycle. This file also contains inherited S9/W9 edits.
- `src/features/spectra/realtime/persistence/local-yjs-persistence.ts`: same-page close/reopen write barrier. Its other large changes are inherited.
- `src/features/spectra/__tests__/hocuspocus-transport-lifecycle.test.ts`: two confirmation lifecycle regressions, retaining inherited cases.

New paths: `scripts/collaboration-delta.test.mjs`, `scripts/collaboration-persistence-window.test.mjs`, `src/features/spectra/__tests__/local-yjs-reopen.test.ts`, `scripts/s10-collaboration-probe.ts`, and this report. No Convex schema, authority, content-retention or durable-storage helper was modified by COLLAB. `collaborationDurablePayload.ts` and ownership helpers remain REVIEW-DURABLE-owned; `artifact-studio.tsx` remains OPEN-owned.

## Findings and changes

1. **Continuous input could defer the durable append indefinitely.** Each event reset the gateway's 180 ms timer. A batch now flushes after 180 ms idle or at one second since its first entry, 128 entries, or 760 KiB of incoming deltas. A single accepted large delta still uses the existing spill policy; it is never truncated. Slow storage retains at most one active and one pending captured room snapshot. A full pending batch blocks further apply until the durable barrier drains, avoiding a new unbounded full-snapshot queue. This bounds the gateway's persistence snapshots, not all Hocuspocus/socket buffering or total process memory.

2. **Every tiny delta cloned and serialized the full Y.Doc.** `canonicalDurableUpdate` now uses `Y.diffUpdate` on the incoming update and the room vector. New/unresolved causal structs remain intact. A delete-only update is discarded only when every referenced range is already deleted in the room's struct store. Unknown ranges and a live middle between deleted endpoints are retained. A 2,000,000-character handshake yields a new delta below 100 bytes in the deterministic test, and a stub that throws on full-room encoding proves that extraction does not serialize the room. Same-batch native edits now capture the pre-edit projection once per actor group instead of once per event. No-op sync avoids projection work altogether.

3. **A genuinely new restored branch could remain pending after its durable append.** The inherited recovery code sent the full restored state and required a whole-document hash to clear recovery, but a normal append only acknowledged update IDs. The client now follows the recovery update with a small ordered `spectra.durable_confirm` request. The gateway captures the append barrier under the document gate, releases the gate, and acknowledges its `confirmationId` only after durability succeeds. No document body/hash is needed for this confirmation. Later local edits and stale confirmations across reconnect cannot clear pending work. Existing full-hash reconciliation remains supported. Deploy the gateway and client together before live acceptance; mixed old-gateway/new-client recovery has not been certified.

4. **Unmount/reopen could read before the final IndexedDB write.** React cleanup calls `destroy()` without awaiting it. The next persistence instance now waits on the previous close promise for that key before loading. The regression blocks an in-flight write, makes one more edit, destroys the original Y.Doc, immediately initializes its replacement, then verifies the final edit and pending status after writes complete. This is a same-page lifecycle barrier, not a claim of atomic cross-tab cache merging.

5. **Read-only no-op handshake was rejected as an edit.** The gateway checked modify permission before checking whether a sync update changed anything. Authorized readers may now complete an empty/duplicate handshake. A nonempty authored delta is still refused before apply, and append authority checks remain unchanged.

## Current verification

Final command (one worker):

```text
node node_modules/vitest/vitest.mjs run scripts/collaboration-delta.test.mjs scripts/collaboration-persistence-window.test.mjs scripts/collaboration-durable-replay.test.mjs scripts/collaboration-durable-capacity.test.mjs scripts/collaboration-gateway-package.test.mjs src/features/spectra/__tests__/collaboration-gateway.test.ts src/features/spectra/__tests__/hocuspocus-transport-lifecycle.test.ts src/features/spectra/__tests__/local-yjs-reopen.test.ts src/features/spectra/__tests__/native-yjs-models.test.ts src/features/spectra/__tests__/render-architecture.test.ts convex/collaboration-checkpoint.test.ts convex/durable-recovery.test.ts --maxWorkers=1
```

**12 files / 132 tests passed**, 16.77 seconds, starting 14:13:53 local tool time. Earlier scoped runs were 45, 72 and 26 tests; those counts overlap and are not additional unique tests.

New evidence covers 40 seeded randomized delivery histories across three peers, duplicate deliveries, replacements and clears; delete-before-struct and out-of-order replay with GC enabled/disabled; partial-range deletion; sustained typing and short-burst coalescing; entry/byte limits; a blocked append and backpressure; successful/failed recovery confirmation barriers; read-only handshake versus rejected authored update; stale confirmations across reconnect; a new edit arriving before recovery confirmation; immediate unmount/reopen while storage is blocked. Existing Convex recovery suite also passed deactivated-actor rejection and the quiet-sweep 4403 close.

Targeted ESLint on the ten changed/new implementation and test paths passed with zero warnings. Scoped `git diff --check` passed; only Git's existing LF-to-CRLF advisory appeared. The browser probe bundled successfully using local esbuild. Full typecheck, global lint/build, shared deployment and native/browser acceptance remain coordinator-scheduled.

Independent PERF corroboration, reported after this checkpoint (not rerun by COLLAB): `scripts/s9-measure.ts --synthetic` and `scripts/s9-measure.test.ts` exercised the current helper against the real native sheet model. Results:

| Cells | Bootstrap bytes | Distant durable delta bytes | Reconnect catch-up bytes | Duplicate durable bytes |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 25,214 | 38 | 38 | 0 |
| 10,000 | 268,215 | 38 | 38 | 0 |
| 200,000 | 5,978,217 | 40 | 40 | 0 |

PERF reported exact edited-cell readback and unchanged first-cell checks passing at all three sizes. The 200k fixture's approximately 374 MB process heap delta includes three Y.Docs, projection and GC effects; it is not a browser-memory measurement. These synthetic measurements do not establish live append/checkpoint costs, editor readiness or native fidelity. Backend restoration still held the runtime slot at the time of the report.

## Prepared two-session live slot — NOT RUN

Source-only probe: `scripts/s10-collaboration-probe.ts`. Bundle is ignored local evidence at `.spectra-local/launch-audit/evidence/S10-COLLAB/probe.js` (1.3 MB). Build command:

```text
node node_modules/esbuild/bin/esbuild scripts/s10-collaboration-probe.ts --bundle --platform=browser --format=iife --global-name=S10CollabProbe --outfile=.spectra-local/launch-audit/evidence/S10-COLLAB/probe.js
```

Importing the bundle does not connect. In each scheduled authenticated browser session, load it through the authorized browser workflow, then call `S10CollabProbe.start(disposableArtifactId, actualSchemaVersion)`. `snapshot()` returns sync/local durability and sheet IDs without the entire artifact. `editCell(sheetId,address,value)` refuses writes unless the live artifact title starts `S10-COLLAB-`; null explicitly clears the cell. `cell`, `flush`, `saveLocal`, `disconnect`, `reconnect` and `close` expose bounded operations. This exercises the actual transport and native cell map, **not** the editor UI or native Office write/readback. Use separate fixture browser profiles and blank reserved cells.

`fingerprint()` captures SHA-256 and byte lengths for the complete Yjs update and its state vector. Require `changedDuringCapture=false` and matching full-document hashes on quiescent A/B sessions after each recovery; vector equality alone cannot prove a clear survived. Then reopen a third observer and compare again, with a coordinator-owned durable replay/version readback to distinguish shared in-memory agreement from persistence. `heapEstimate()` records Chromium's whole-page estimate when available; sample before join, after settled join, after 20 close/reopen cycles, and after an idle period. Never report the estimate as isolated editor memory or GC-normalized retained heap. `snapshot().yjsEvents` counts Yjs event bytes, **not WebSocket wire bytes**; collect actual wire bytes separately through the scheduled browser network instrumentation.

| Case | Scheduled action | Required evidence |
| --- | --- | --- |
| Large cold/warm open | New disposable 200k-cell workbook copy; A/B join; reopen A | Readiness timings separately from transport sync, WS/HTTP bytes, canonical baseline identity |
| Sustained disjoint edits | A and B edit separate reserved distant cells at intervals below 180 ms for 5–10 seconds | Both markers converge; append acknowledgments occur during the stream; no full body posts for small edits |
| Shorter and clear | Long marker → short marker → null clear in A | B observes each transition without reload; durable replay/version preserves the clear |
| Offline close/reopen | Disconnect A; author a reserved-cell marker; `saveLocal`; close and immediately start A again while B makes a disjoint edit | Local cache actually committed (check quota state); recovered update confirmation clears only after durable append; both markers survive reopen |
| Lost receipt / gateway failure | Coordinator-controlled receipt loss and restart after append, on disposable fixture only | Pending state remains truthful, reconnect converges, semantic effect once, durable receipt/log inspection |
| Read-only/revocation | Only a coordinator-provided disposable authenticated actor | Empty handshake works; authoring denied; deactivation/revocation closes and no canonical append succeeds |

Coordinator owns gateway restart/deployment/fault injection and exact slot. No slot was granted during this checkpoint. S9-DURABLE's historical two-session, shorter/empty and fault results are historical evidence at their revision, not current S10 passes.

### Execution order and decisive oracles

1. **Preflight, during the allocated slot only.** Coordinator confirms deployed gateway/client checkpoint, healthy backend and fixture ownership. Import a new disposable 200k-cell sheet named `S10-COLLAB-<run>`, record artifact/schema/sheet IDs and reserve blank distant cells. A/B use separate authenticated profiles. C is a fresh observer. Record baseline full-document fingerprints plus canonical saved-version/replay evidence before editing. A separately controlled disposable actor is required for revoke/deactivation; Profile A is not deactivated.
2. **Whole-document convergence.** A/B make alternating disjoint edits, then a concurrent burst below the idle threshold. Pause editing, await real durable completion, and require equal complete-document hashes, byte lengths and vectors with `changedDuringCapture=false`. A's long→short→clear sequence must appear in B and C; a delete may preserve the vector while changing the full-state hash. Compare canonical durable replay as well: A/B agreement alone may reflect an in-memory room ahead of storage. Reopen C after a coordinator-controlled gateway restart and repeat the complete-state comparison and distant/untouched-cell checks.
3. **Lost acknowledgment and offline recovery.** Coordinator drops a receipt only after a confirmed durable append, then separately restarts the gateway after append and before acknowledgment. Record pending→reconnecting→durable transitions and canonical sequence/receipt evidence. Require each operation's semantic effect once, not merely matching visible strings. Next disconnect A, edit a reserved cell, verify actual IndexedDB completion and its pending marker, close without waiting for remote durability and immediately reopen; B makes a disjoint edit while A is offline. After recovery, compare A/B/C full state and durable replay. If local quota or write failure occurs, record failure and do not claim offline protection.
4. **Offline authority and live revoke.** Use the disposable actor only. Disconnect it after a valid grant, author a local marker, then downgrade or revoke it through the supported coordinator control before reconnect. Reconnect must not append the marker to canonical state; the local draft must remain pending/available under the applicable access UI. A fresh read-only session must complete its no-op handshake and reject authored updates. Under a healthy backend, test quiet and active deactivation separately and record elapsed rejection/close time plus no post-revocation successful append. An operation committed before revocation linearized is legitimate; receipt ordering must distinguish it from a later unauthorized attempt. Prolonged authorization-outage behavior remains the SECURITY blocker below and cannot be presented as fixed by this test.
5. **Shared-cache and memory boundary.** Repeat offline disjoint edits with A1/A2 tabs in the same browser profile/cache key, then close in both orders and reopen. This specifically examines the unresolved cross-tab cache race; the separate-profile case does not cover it. In the ordinary recovery case, record heap estimates before join, after settle, across 20 close/reopen cycles, and after idle, alongside active socket/subscription counts and local persistence states. During coordinator-controlled slow persistence, observe batch backlog, process/page memory and continued eventual convergence. A plateau in raw heap is suggestive only; retained-memory claims require a comparable GC/heap protocol. The implemented one-active/one-pending snapshot bound does not bound all socket queues.

Each result must identify served source, profile/actor, fixture IDs, timestamps, expected versus observed state, and evidence file path. A blocked actor setup, absent canonical replay/readback, unavailable heap instrumentation or incomplete restart is **NOT RUN/PARTIAL**, not a pass. No runtime mutation, revoke or fault has been executed while preparing this plan.

## Confirmed blockers and proposed repair scope — awaiting agreement

Coordinator requested independent reproduction and smallest repair scope while preserving product source for the first build. New offline script `scripts/s10-collaboration-blockers-repro.ts` imports the actual local persistence implementation and evaluates the actual gateway authorization/sweep handlers against controlled failures. It runs no server/browser/database and changes no product code.

```text
node node_modules/tsx/dist/cli.mjs scripts/s10-collaboration-blockers-repro.ts
```

Evidence: `.spectra-local/launch-audit/evidence/S10-COLLAB/blockers-repro.json`, observed `2026-09-24T12:45:13.881Z`. Successful script exit means the defect was reproduced; every `desiredSafeOutcomeSatisfied` is **false**. The deterministic shared `MemoryYjsStore` interleavings exercise real `BoundedYjsLocalPersistence`; they do not substitute for later browser IndexedDB transaction verification.

| Reproduction | Observed current behavior | Consequence |
| --- | --- | --- |
| Failed authorization with grant aged 3,600,001 ms | `canModify=true` retained | No maximum stale-grant age |
| Hanging refresh with stale grant | `allowStale` returns modify access immediately | Request timeout alone cannot bound existing access |
| Policy lookup fails for already-expired quiet connection | Zero actor refreshes; connection remains open | Quiet read/broadcast access is not bounded by the cache TTL or expiry sweep |
| Two same-key caches initialized before disjoint edits | B's later write loses A's pending marker | Whole-record replacement loses the offline branch |
| B's own edit acknowledged while A remains offline | A's marker lost and stored pending flag becomes false | Another tab's acknowledgment can falsely make the shared recovery copy evictable |
| Eviction metadata read races A's pending write | B deletes newly pending victim; A still reports `local_only` | Read-then-delete can destroy the only acknowledged local recovery copy |

### A. Bounded authorization proposal

Smallest intended product scope: `scripts/collaboration-gateway.mjs`, authorization helpers/constants in existing `scripts/collaboration-persist.mjs`, and focused actual-handler tests. Keep Convex append authority, JWT policy and shared reconnect delays unchanged.

- Reuse the existing **15-second cache TTL as a hard age since the last successful authoritative result**, rather than add another unreviewed grace period. Failure must never advance that timestamp. SECURITY has been asked to review this budget.
- Enforce the deadline with an independent per-connection timer, including quiet sockets. Inbound-message checks alone cannot stop a stale subscriber receiving other peers' broadcasts, and a sweep blocked on policy I/O cannot be the sole expiry mechanism.
- Coalesce each context's authorization refresh; bound its RPC wait to **5 seconds** and ignore late results after timeout/connection termination. Successful renewal moves the deadline. A policy-call failure must not skip the independent expiry check.
- Confirmed revocation retains immediate 4403 handling. Unverifiable/expired authorization closes only the affected connection with a retryable unavailable reason (proposed 1013), preserving local drafts and avoiding a false permanent-revocation claim. A fresh authoritative grant is required on reconnect.

Tradeoff: a legitimate collaborator loses the live socket after a 15-second authorization outage and works locally until reconnect succeeds. This is more disruptive than indefinite stale access, but it is bounded and does not weaken canonical write checks. No promise of offline durability is acceptable until the cache repair below and quota behavior are verified.

Required tests: healthy renewals and one brief transient; expiry exactly at the last-success boundary; hanging RPC; late successful reply after expiry; policy outage with no inbound traffic; active traffic after the deadline; definitive actor/policy revocation; an unaffected authorized peer remains connected; local pending edits survive 1013/reconnect. Deadline tests must use actual hooks/timers, not only a helper predicate.

### B. Atomic shared-cache proposal

Smallest intended product scope: `src/features/spectra/realtime/persistence/local-yjs-persistence.ts` (store contract, IndexedDB and memory implementations, persistence/eviction calls), plus focused tests. The existing key, schema, quota limits and server permission boundary remain unchanged unless a demonstrated identity mismatch requires a separately agreed extension.

- Replace separate get/put with an atomic read-modify-write transaction over the update and metadata stores. Merge compatible same-key Yjs bytes, including delete sets, inside that transaction. A pre-read plus later write, or an in-memory mutex in one tab, cannot protect another tab.
- A clean incoming snapshot may clear aggregate pending state only when it **covers the currently stored pending branch**, including deletions and unresolved causal updates. Preserve pending state when coverage cannot be proved; another tab's unrelated acknowledgment is insufficient. Return the committed bytes/pending status to the caller so local durability does not report false success.
- Replace metadata-driven unconditional eviction with an atomic conditional delete that rereads the current record and refuses to delete pending work. Recompute admission/remaining quota using actual deletion outcomes.
- Enforce the existing per-work bound on the merged result before committing. On mismatch, corruption or insufficient space, preserve the prior pending bytes and report a storage/error state for the new write. Never silently drop the union or mark it remotely durable.

Tradeoff: merging costs CPU and a tab may continue to display local-only recovery state while the shared record contains another tab's not-yet-covered branch. Quota exhaustion must refuse a new recovery write instead of erasing old pending work. The current record key does not encode actor/room generation; the repair must not broaden merging across keys or model versions, and reset/migration identity compatibility needs an explicit regression. Automatic replay remains subject to a fresh server grant.

Required tests: both concurrent write/close orders, ACK of only one branch, full-coverage ACK, partial/unknown delete sets, clear without resurrection, metadata-read/pending-write/evict interleaving, transaction abort, merged quota overflow, model mismatch, and two independent IndexedDB connections. Browser two-tab acceptance remains mandatory after deterministic transaction tests; no new dependency or browser session has been started for this proposal.

Independent DURABLE review additionally reported **64 nested XML histories** with GC on/off, out-of-order parent/text formatting/clear, concurrent paragraph attributes, duplicates and exact durable replay against direct Yjs state. Known duplicates returned null and a spy forbade full-room serialization; no delta-helper defect found. Probe: `.spectra-local/launch-audit/evidence/S10-REVIEW-DURABLE/canonical-delta-review.mjs`. This was reported by REVIEW-DURABLE, not rerun by COLLAB, and does not resolve either blocker above.

## Neighbor responses and remaining limits

- **REVIEW-DURABLE:** requested independent review of the input-sized delta and randomized replay cases. Delivery was blocked as noted above. No retention/owner changes were made here. The helper uses exported Yjs `diffUpdate`, `decodeUpdate` and `findIndexSS` plus `Doc.store.clients`; an upstream Yjs storage change needs regression review.
- **OPEN:** the same-key close barrier is verified. Reusing a computed incoming reconciliation key is safe. OPEN subsequently confirmed current/incoming snapshots are memoized projections and baseline uses immutable replacement; a per-mounted-editor WeakMap preserving the exact JSON key is reasonable for those snapshot objects under that immutability contract. Do not extend it to mutable Yjs objects or drop unconsumed local acknowledgment keys merely to reduce memory. Actual viewport readiness remains separate from canonical/native durability.
- **S10-AI boundary (explicit release, reconfirmed):** `src/features/spectra/collaboration/ai-ui-events.ts` is released to S10-AI for the narrowed explicit `navigate_spectra` dispatch through `navigation.show` / `work.open`. COLLAB has no edits or pending edits there. Preserve ordinary background Follow-off semantics and distinguish a requested command/observed command result from viewport readiness. No `app-choreography-host.ts` change is needed for this handoff. The direct release reply was attempted again after S10-AI's follow-up and was blocked by approval-never; this written release is authoritative for the lane boundary.
- **SECURITY:** the existing `refreshAuthorization` accepts transient failures after a prior grant without an explicit maximum stale age; the policy sweep can also skip actor refresh when its policy call fails. Current Convex append still rechecks actor/policy, and deactivation tests pass, but that does not prove bounded stale read/broadcast access during prolonged authorization unavailability. This is an unresolved security review item; no fresh live revocation/outage claim is made.
- **PERF:** supplied the new delta helper and append-window contract before messaging was blocked. Native projection checkpoints remain 30 seconds idle with no maximum interval; continuous editing can delay the materialized projection while the durable log advances. No live Convex read/write-cost reduction or latency SLA is claimed from the mock append counts.
- Existing local cache quotas remain 8 MiB per work / 64 MiB total. A larger Yjs document can report `quota_exceeded`; the probe must record this rather than claim offline protection. Concurrent browser tabs sharing one IndexedDB key still need separate atomic cache-merge review; the close barrier only serializes replacement instances in one JavaScript realm.
- Shared retry policy, durable spill integrity, authoritative append and receipt rules, clear semantics, and retention policy were preserved. Final integration and launch decisions remain with the coordinator.
