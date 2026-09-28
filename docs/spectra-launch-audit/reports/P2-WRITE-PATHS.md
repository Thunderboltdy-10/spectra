# P2 WRITE-PATHS: findings ledger

Branch `p2/write-paths`, cut from main `0bb65e90`. The binding contract is S11-INTEGRATION.md, "Cross-system decisions". Every behaviour fix below has a test that fails on the old code and passes on the new code.

## Commits

| Commit | Subject |
| --- | --- |
| `6d5be57b` | fix(spectra): admit live AI artifact writes through the single signed sink |
| `ca51ef1d` | fix(spectra): splice AI paragraph edits into the existing text node |
| `5b3378d4` | fix(spectra): display a large restore only from state that covers its receipt |
| `1bbe51ca` | fix(managebac): degrade the connection when staged planner work fails late |
| `eafcce1b` | fix(catalog): restore the shared indicator on your own shared workspaces |
| `082c4a93` | fix(spectra): keep valid restored clarification work before an unparsable position |
| `4668ace8` | fix(spectra): keep an indexed edit verified after a later append to its list |

## Fixed

### 1. Live AI writes had no admission or receipt (high)

**Files:** `src/features/spectra/ai/yjs-artifact-operation.ts:1740`, `convex/nativeAiCommit.ts:161` and `:224`.

**Problem.** An AI create or update on a live artifact without a native binding was written on the worker's socket. The gateway appended it like a human edit. At that sink:
- there was no approval-scope check;
- there was no `artifactWriteReceipt`;
- a retry after an acknowledged save could apply the change a second time.

**Fix.** The native half of `nativeAiCommit.commit` is now optional: both halves are present, or neither is. The same signed admission appends the exact delta, the AI history version (`liveAiHistoryVersion`) and a receipt that can be replayed, all in one transaction.
- The worker prepares the delta from the fenced durable base through a resolver, so non-overlapping human edits are kept.
- A retry replays `committedResult` and does not write again.

**Related fix (`reference-command.ts`).** Live reference insertion had been broken since `1f496bb5`: it queried the artifact-write head, which refuses app.command operations. It now declares `receipt: "placement"`.

### 2. AI paragraph edits replaced the whole paragraph (medium)

**File:** `src/features/spectra/work/models/yjs/document-adapter.ts:201`.

**Problem.** An AI edit to a paragraph deleted the whole paragraph and inserted it again. As a result:
- the admitted bytes grew with the paragraph's length (about 100 KB to append one word to a 100,000-character paragraph);
- collaborators lost the Y.XmlText that their caret was anchored to.

**Fix.** `applyDocumentParagraphTextSplice` now has a real caller. It moved into the adapter, and its separate module was deleted because keeping it would have created an import cycle. Same-block, unformatted paragraph edits are applied as a minimal splice that never splits a surrogate pair. The admitted update is now that splice, and the editor applies it in place.

### 3. A large or compacted restore could show stale content as restored (medium)

**File:** `src/features/spectra/collaboration/hocuspocus-transport.ts:1322`.

**Problem.** For a payload or replay receipt, the client only sent a refresh hint and forced a resync. The gateway skips that merge while other edits are persisting, so History could close over the old content.

**Fix.** The client now reads the verified canonical state through `spectra.recovery_current`. It applies that state only if it is in the receipt's room and past the receipt's sequence. Otherwise it raises `COLLABORATION_ADMITTED_UPDATE_BEHIND`, which the studio already reports as "restored, reconnect".

**Test contract changed:** the old test expected a replay receipt to resolve after only a refresh hint. That expectation was the bug.

### 4. ManageBac connection stayed "connected" after a late failure (medium)

**File:** `convex/managebacProjectionJobs.ts:192`.

**Problem.** A staged planner update that fails after sync completion drained the run to "partial", but the integration kept reporting "connected".

**Fix.** The settle path now degrades a "connected" integration in that case. The ops-owned `syncRunOutcome` and `resolveConflict` hunks are untouched.

### 5. Owned shared workspaces lost the shared indicator (low)

**File:** `convex/catalogGraph.ts:185`.

**Problem.** Workspaces you own and have shared lost their "shared" indicator in the actor-graph catalog.

**Fix.** `isShared` is restored for them. The check reads, on the exact `by_resource_inviter_status` prefix, the newest accepted and the newest pending invitation the owner sent. That is two single-row reads per emitted owned workspace, both within the budget; invitation history is never scanned. `workspaceMetadata` uses the same check.

### 6a. One bad clarification candidate dropped every restored candidate (medium)

**File:** `src/app/api/spectra/run/loop/plan.ts:3536`.

**Problem.** When a run resumed after a clarification, one candidate that failed to parse dropped all restored candidates, including accepted work.

**Fix.** The parseable prefix is kept. Positions, `@created:N` identities and carried evidence are all positional, so a middle position is never dropped. The first bad position and everything after it are marked omitted.

### 6c. A later append superseded an earlier indexed edit (low)

**File:** `src/app/api/spectra/run/loop/verify.ts:290`.

**Problem.** A later append (`/list/-`) superseded an earlier indexed edit (`/list/0/...`) in final verification, so an edit that was lost or reverted passed.

**Fix.** Overlap is now asymmetric: a later append never supersedes an earlier indexed or selected path.

## Reported, not fixed

### Cloudflare realtime AI writes (residual)

**File:** `yjs-artifact-operation.ts:1740`.

AI writes over the opt-in Cloudflare realtime provider (`NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME`) still rely on transport acknowledgement. They get no admission receipt: that provider has no `applyCommittedUpdate`, and its rooms are not in the Convex store. It stays off by default. Before it is enabled, it needs the same sink.

### Choreography readiness and observation fence (not built)

S11-CHOREO lists these as the next step. They were not built, because nothing would call them yet:
- no client consumes artifact readiness;
- the artifact path has no readiness wait, so no deadlock is possible today;
- viewport reveal happens only on user-initiated comment anchors (`artifact-studio.tsx` `work.revealAnchor`).

Speculative preview frames are cleared on failure, and the settle frame is emitted only after durable admission. Per-chunk visible typing needs the parent/step receipt contract described in S11-CHOREO.

### Concurrent human append confuses append verification

**File:** `verify.ts:523`.

Final verification assumes that the AI's appended element is last, apart from later AI appends. A human append that lands in the seconds before verification makes an honest run fail, but never duplicates a write. Fixing it needs the acknowledged element position to be threaded into the outcomes.

### 50-replica cap on the restore head hash (assessed, no change)

**File:** `convex/artifactRestore.ts:92`.

More than 50 replicas fails closed with `ARTIFACT_RESTORE_NATIVE_BASE_LIMIT`; it never truncates silently. This matches `durableContentDependencies.ts` and the 50 per work in `spectraApplicationWriteScope.ts`. It is reachable only by a work that more than 50 accounts have mounted locally. The route does not map this error to a friendly message (copy is out of scope).

### ManageBac checkpoint-then-retry (rejected)

**File:** `convex/managebacProjectionAction.ts:170` and `:37`.

Checkpoint-then-retry is the wrong fix:
- `MAX_REPLAY_BYTES` is 512 MB, so the realistic trigger is the 45-second replay limit or a sequence gap;
- the gateway already compacts rooms while they are edited (`shouldCompactRoom`);
- a Convex-side checkpoint would be a second compactor, which is a parallel mechanism.

Exhausted retries and `TOO_LARGE` (which bounded provider fields cannot realistically reach) still become a reviewable conflict. With fix 4, they now also degrade the connection.

## Rejected as not real

### 6b. Carried candidate evidence

**File:** `convex/spectraRunContinuations.ts:169`.

A carried candidate is matched by its exact position and its `applicationOperationScope`, which is the sorted type plus input. It keeps the sources recorded when it was first validated. That is the acknowledged snapshot. Taking fresh sources at re-park would silently absorb a source change that happened after acceptance, so the current behaviour is the conservative one.

## Incident

To prove the tests failed on the old code, I ran `git stash push` and then `git stash pop`. The stash is shared across worktrees, so this popped the experience agent's stash `a540fcac` (5 UI files) into this worktree.

- Those files were restored with `git checkout`; the experience worktree already had byte-identical content.
- My own stash `bf975aa8` was re-applied from its dangling commit.
- The security-privacy stash (`stash@{0}`) was not touched.

No git stash was used after that.

## Needs live verification

1. **Live AI edit on a hocuspocus document.**
   - One `nativeAiCommit` receipt is written, and a retry after a lost response replays it.
   - A human editing another paragraph at the same time is kept.
   - A new create's base digest equals its allocation digest (`pendingCreate` now plans a diff from the stored room).
2. **Human caret during an AI paragraph edit.** The caret stays in place in a second browser, and admitted bytes stay small on a long paragraph.
3. **Restore of a document over 760 KB while another tab is typing.** The content shows only after the restore is covered, or the "reconnect" notice appears.
4. **ManageBac staged planner failure.** A real room with a staged provider update that fails shows the connection as degraded.
5. **Sidebar and header.** The shared icon appears for an owned workspace with a pending or accepted invitation.
6. **Clarification resume after a schema change.** It keeps the earlier accepted staged work.
