# S11 BRIDGE: shared native mutation helpers

Status on 2026-09-26: finite source candidate; **tests and typecheck not run** pending the assigned guarded lane. This refactor does not close the unsigned public admission path or implement the atomic AI commit. No runtime, original native file, dependency link, installation, or service was changed.

## Recovery and evidence

Recovered original task `01a0d846-3e48-7993-9665-1385cee87925` by reading its actual earlier turns, not only its report. Continued its owned checkout `34de/ai-school`, branch `codex/s11-bridge`, at lost-ack candidate `a68e9c48`. The separate route/executor identity changes were preserved. Follow-up `e4730030` corrects the actual-handler fixture to use the SHA-256 of the canonical projection for semantic receipt/projection ancestry; native package hashes remain distinct.

The previous task traced `act.ts beforeCommit -> promoteNativeAiContent -> materialize{Docx,Office}Artifact -> queueMaterialization -> document.transact(plan.apply)`. Queueing could patch canonical content and expose a claimable native request before durable Yjs admission. Merely removing the canonical patch leaves the native-first partial-effect gap. Coordinator approved one signed internal transaction for append/history/native intent/receipt. DURABLE's proposed contract is `S11-DURABLE-AI-NATIVE-CONTRACT.md` in worktree `222b`; it requires actual native readback before the final Yjs plan.

## This change

`convex/replicaMaterialization.ts` exports:

- `queueMaterializationArgs` and `QueueMaterializationArgs`.
- `commitCloudMaterializationArgs` and `CloudMaterializationArgs`.
- `queueMaterializationInTransaction(ctx, actor, args, effects)`.
- `commitCloudMaterializationInTransaction(ctx, actor, args, effects)`.
- `NativeMaterializationEffects`: human legacy projection, or AI durable projection with its actual run ID.

The caller resolves the current authenticated actor in the same mutation. Each helper retains artifact capability and content-adoption checks, payload account/hash/active-state binding, live local target selection, native ancestry and receipt checks, retry identity, existing-request replay, claimed-write fences, supersession behavior, and cloud CAS. The supersession helper moved with its only caller; there is no import cycle through `replicas.ts`.

For AI, the queue helper never patches canonical content independently, records `syncOperations.actorKind = ai` and the supplied real run ID, and rejects a protected original before superseding requests or recording protected pending content. Cloud materialization retains its native-replica-only behavior and records the same provenance. SECURITY's current run/attempt/operation admission remains the atomic caller's responsibility; this type is not an authorization token.

Existing public mutations in `replicas.ts` delegate with explicit human legacy behavior. Their validator fields and return shapes remain unchanged. They will be replaced by verified signed Node/internal wrappers in a subsequent coherent unit after all callers move.

## Caller inventory

Repository-wide source search for both mutation names and materializer entry points found:

| Production caller | Behavior |
| --- | --- |
| DOCX materialize helper | Queues a verified whole package, or saves the cloud package |
| Office materialize helper | Queues a verified whole package, or saves the cloud package |
| DOCX granular mutate POST branch | Queues its verified native edit |
| Office granular mutate POST branch | Queues its verified native edit |
| AI promotion | Calls the same materialize helpers through `act.ts beforeCommit` |
| Human materialize POST branches | Call the same helpers without AI identity |

All remaining direct mutation-name references found under `convex`, `src`, and `shared` were tests or mocks. Human callers must retain their real authenticated actor; no fabricated AI identity is appropriate.

## Verification boundary

`git diff --check` passed. New `replicaMaterialization.test.ts` contains eight protocol cases: AI queue with canonical/cloud unchanged and AI provenance; rollback of queue and cloud plus preceding canonical writes; protected-original refusal without changing existing requests; payload/mount/native-base rejection; and exact cloud replay after a later canonical edit. These are real helper/database calls but use synthetic protocol bytes, not Office packages. They deliberately do not claim AI admission, Yjs/history integration, or native acceptance.

The existing `replicas.test.ts`, `bridgeSync.test.ts`, and Bridge neighbors remain the human behavior and lost-ack regression surface. No green result is claimed until guarded execution. Shared trigger/retention behavior must also be verified through the eventual internal mutation, not inferred solely from direct helper fixtures.

## Remaining dependencies and measurements

DURABLE owns the atomic internal transaction and reconstructed-head/history fences. BRIDGE owns native preparation, signed Node orchestration, exact `act.ts beforeCommit` handoff, and closing unsigned public sinks. COLLAB owns a fresh final Yjs plan from native readback, exact admitted-byte consumption without a second append, and prompt gateway catch-up. SECURITY supplies the admission hook. Native `none` means verified unchanged bytes with exact source/result binding; an unsupported/deferred result cannot imply a durable save or sync promise.

The current route still materializes complete ZIP packages for changed native output. This helper extraction adds no conversion, upload, payload read, or polling loop. No runtime cost or byte-saving measurement is claimed. Next measurement unit traces native materialization cadence, actual full package upload/dedup behavior, watcher hashing/retries, and unchanged feedback suppression; PERFORMANCE owns browser cadence/network/memory instrumentation after RUNTIME freezes disposable native fixtures.

OS final-check/replace races, lease overruns, bounded acknowledgement retry/expiry, durable hidden Office mirrors, structural crash/recovery, and live concurrency remain open as recorded in `S11-BRIDGE.md`. Candidate source is not launch acceptance.
