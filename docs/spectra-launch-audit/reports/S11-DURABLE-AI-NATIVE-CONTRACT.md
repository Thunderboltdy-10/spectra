# Atomic AI/native commit contract

Status: architecture approved on 2026-09-26; validators/digest `6860df18` and internal effect `ceb840e7` are implemented. September 27 recovery in checkout `222b` preserves the predecessor's source and original failure evidence. The bounded closeout has **34 distinct passing cases** and six-file scoped ESLint. D1 is already integrated and was not repeated. Integrated type checking and real signed/native acceptance remain deferred.

Recovery worker `01a0e28b-63da-7d00-8823-ee039a76b748` independently read its actual session `turn_context`: `gpt-6-astra`, `xhigh`, `danger-full-access`, approval `never`. Source branch `codex/s11-durable-review` started at `bd829689` with only the inherited `nativeAiCommit.ts` correction dirty. No primary checkout edits, installations, services, database publication or native-file mutation occurred.

The correction returns the persisted run prompt from the authenticated head and separately fences a local Bridge destination against verified cloud source bytes. Source and target are not interchangeable: the source remains exact account/artifact/ref/hash/revision/format/byte-count provenance; the local target must independently match account/artifact/base revision/hash before the existing queue helper rechecks its active mount/device and native write policy. Regressions cover that admission, stale local targets, rollback after queue writes, truthful pending receipts and original receipt lookup with a retired room. The emitted exact delta is replayed from the original Yjs base in the transaction fixture.

Source/target correction is committed as `1262358b`. Coordinator's final contract review also required SECURITY `bceaf6df`: the authenticated head now resolves both `artifact.create` and `artifact.update` through `artifactOperationTarget(...,"effect")`. A create uses its exclusive pending artifact; an `@created` update requires the original batch's exact creator receipt. The sink's shared admission/replay guards already consume that same resolver. Direct sink fixtures exercise creating admission/replay after Stop and alias refusal before its producer receipt, followed by successful receipt-bound admission. No current room, canonical version, physical identity or native-source fence was removed.

Presentation route follow-up `45461446` replaces its two duplicate slide serializers with the shared `pptxProjectionSemanticDigest`. The requested digest uses the actual base to normalize only proven readback-derived mirrors. The unchanged branch uses the actual base projection. This depends on OFFICE-MODELS `650bcd51` (local dependency `847759e3`); complete object-list authority is already in D1 `a3efca8a`. The Office owner supplies real-package route validation, including later transition support.

## Preparation and ownership

BRIDGE owns `act.ts` beforeCommit / `native-ai-promotion.ts` Node orchestration (ENGINE released these hunks), queue/cloud transaction helpers, and materializer preparation. ENGINE retains semantic operation ownership. COLLAB owns `admitted-ai-update.ts`, the fresh scratch builder, `yjs-artifact-operation.ts` exact-byte consumption, and prompt catch-up. SECURITY owns current actor/run/execution/operation admission. DURABLE owns `nativeAiCommit` effect/history/shared head and the validator/digest contract. PRESERVATION reviews readback and byte binding.

Concrete modules: `convex/nativeAiCommitContract.ts` exports `nativeAiCommitArgs`, `nativeAiSourceValidator`, `nativeAiCandidateValidator` and types. It composes existing `appendRoomUpdateArgs`, BRIDGE `queueMaterializationArgs` / `commitCloudMaterializationArgs` (`58f6b262`), and the existing native save receipt validator. `shared/native-ai-commit.ts` normalizes inline binary/base64 transport into exact SHA256 digest+length and hashes the complete immutable request with deterministic property ordering. COLLAB `1c5ba609` provides `PreparedCanonicalAiUpdate` and `AdmittedAiCommit`.

`convex/nativeAiCommit.ts` implements authenticated `head` and internal `commit`, reached only through the existing signed bridge's `commitAiNative` branch. `head` reads the artifact/room, original operation input/writeScope/digest, physical source identity and original committed result together. `commit` uses SECURITY's current guard and receipt replay helpers from `d67df501`, `72b14244`, `74a2d1cf` (prerequisites `43be16b3`, `dce9bf0d`). The ordinary operation finalizer preserves artifactWriteReceipt.

The shared appender receives a helper-only `deferAiHistory` option, never a wire argument, so this transaction can add native sources before committing the AI version. It then explicitly attests the verified prepared result as a version native owner before cloud advancement; the old source is still replica-bound at history creation. PRESERVATION reviewed this retention handoff. Result descriptors remain small in operation.output: replay reads the original retained log row or requests a covering snapshot/tail, avoiding a second inline update body in the receipt document. Eighteen transaction tests and four digest tests passed, including failures after history and after cloud/queue mutation, Stop/current-authority/CAS refusal, original-receipt replay, compaction fallback, creation/alias admission and false unchanged claims.

1. Read the authenticated operation and complete durable artifact head using the existing Node bridge client and snapshot/tail helpers. Capture room ID, exact next sequence, artifact updatedAt/contentHash/currentVersionId, policy version, and current native source bindings. No websocket connection is needed. Reuse a warm canonical replica only after its tail and generation are checked.
2. Apply ENGINE's semantic operation to that actual head. Prepare and read back the native package using the existing Office lens. Preparation may upload immutable payloads; it must not create a claimable write request, advance cloud/local replicas, supersede another native request, patch canonical content, or report saved.
3. Build the final Yjs plan from the **readback-normalized** complete content. Do not retain a sheet cell plan or apply closure captured before native readback. Capture the exact authored Yjs delta and before/after projection from that plan. Bound or spill bodies through the existing immutable content/payload mechanism.
4. Send the signed envelope below. A stale result requires a new actual-head read, semantic preparation, and native readback. Revalidate SECURITY's approval scope; never relabel a stale result or silently broaden an approved effect. Bound explicit stale attempts separately from transport retries of the same envelope.

## Signed operation: `commitAiNative`

The existing `collaborationGatewayBridge.exchange` verifies its ordinary signature/timestamp/nonce and matches outer artifact/account/partition/policy identity to nested arguments. It decodes the Yjs bytes and calls one internal mutation. The browser and model do not supply this trusted envelope directly.

```ts
{
  artifactId, accountId, partitionKey: "root", policyVersion,
  aiOperation: { runId, executionId, operationId },
  requestDigest, // digest of this immutable operation/base/result/native candidate
  expected: {
    roomId, nextSequence,
    artifactUpdatedAt, contentHash, currentVersionId,
    nativeSource: {replicaId, payloadRef, hash, revision, bytes, nativeFormat}
  },
  beforeProjectionJson, beforeProjectionHash,
  append: {
    // Existing appendRoomUpdateArgs; actorKind MUST be ai.
    // Same exact room/sequence, account, artifact, policy and operation scope.
    // Inline update or existing payloadRef/digest/manifest, never both.
    // projectionJson/hash reflect native readback, not the original request.
    // claimBaseStateVectorHash retains the original authored claim base.
  },
  evidence: {version: 1, operationDigest, sourceContentIdentity,
             baseContentDigest, resultContentDigest, fullContentDeletion},
  nativeCandidate:
    {destination: "bridge", queue: QueueMaterializationArgs} |
    {destination: "cloud", cloud: CloudMaterializationArgs} |
    {destination: "none", unchanged: {
      sourcePayloadRef, sourceHash, resultPayloadRef, resultHash,
      readbackProjectionHash, preservationEvidence: NativeSaveReceipt
    }}
}
```

The source validators define exact wire names. `requestDigest` binds actor/run/execution/operation, canonical before/after, exact authored update digest/length, source and result payload refs/hashes, destination, and readback/preservation evidence. It is an idempotency binding, not authorization. Signed trusted Node code constructs the evidence after actual lens readback; the transaction checks source binding, ownership and current admission.

`destination:none` means verified unchanged only: same actual source/result reference and hash, active source binding, `NativeSaveReceipt.state=unchanged`, and `readbackProjectionHash` equal to its actual semantic readback digest. This native semantic hash is separate from canonical projection digests. A deferred save requires a real durable job receipt; it cannot be disguised as unchanged or report a canonical-only success. The selected callback is `beforeCommit({desired,changedRegionIds,prepareAdmittedUpdate(normalizedDesired)}) -> AdmittedAiCommit | void`; void is allowed only for a non-native ordinary path.

## One internal effect transaction

`nativeAiCommit.commit` calls ordinary TypeScript helpers in the same mutation context, without separate mutations for append or queue.

1. Resolve current actor and artifact capability; validate current run/execution/operation and SECURITY scope for a new effect. A stopping run cannot authorize an unstarted effect. Look up a completed operation receipt bound to the original operation identity and scope. Replay returns the original admitted result, never retry-produced native/Yjs candidates, without another effect. Changed scope under that operation is rejected. Original requestDigest remains on its receipt even when recovery prepared a new candidate after later edits.
2. Validate all exact canonical/room/native expectations and the prepared source. Refuse a changed source, active incompatible native claim, or unsupported/protected outcome before effects.
3. Materialize the fenced before projection when acknowledged human deltas are ahead of the canonical row; close preceding human history, as D1 does.
4. Invoke `appendRoomUpdate(ctx, append)` with explicit AI identity and SECURITY's before/result checks. Finalize the appropriate AI history boundary using the actual reconstructed snapshots and native source retention. Do not use D1's `external-edit`, human, or import provenance or its native-overlap log tag.
5. Invoke BRIDGE's queue or cloud helper with the verified candidate. For local saves, create the existing pending outbox request only now. For cloud-only saves, advance the cloud native replica only now. These helpers do not write an independent canonical projection. Any failure rolls back append, history, receipt, outbox, supersession and replica changes together.
6. Record the completed operation receipt binding canonical sequence/update digest/version and native request or cloud result in existing `spectraOperations.output`. Preserve it through later ordinary operation finalization. A durable queue receipt truthfully means queued; it does not mean Office has already verified its local write.

## Origin and live rooms

The response is `{state:'committed',duplicate,receipt:{roomId,sequence,updateDigest,versionId?,nativeResult},admitted}`. Admitted is `{encoding:'inline',updateBase64}`, `{encoding:'payload',payloadRef,digest,byteLength}`, or `{encoding:'replay',roomId,throughSequence}`. COLLAB consumes original exact bytes with a remote origin and requests prompt catch-up; a compacted replay must cover the original same-room receipt sequence and may include later edits. The original receipt/native outcome stays unchanged. No new receipt or replay store.

A five-second sweep remains a fallback, not the only dissemination path for visible AI work. No new per-frame database reads or gateway liveness requirement. Exact per-step choreography admission remains a separate required contract: a final native package cannot authorize arbitrary partial canonical steps.

## Required evidence

Test rollback at append, history and outbox/cloud failures; refusal after revoked authority or changed canonical/native base; byte/projection binding; normalized sheet readback; duplicate/lost acknowledgment after later edits and after compaction; origin/peer consumption without a second append; no live gateway; local Office lock/retry with a truthful queued state; and partial-step choreography compatibility. Measure cold snapshot/tail bytes, warm tail bytes, Office conversion time, database reads/writes, and end-to-end latency separately.

## Dependencies and remaining integration boundary

- Original atomic candidates: `6860df18` then `ceb840e7`. The latter contains the sink/head/signed branch, deferred AI history option and transaction tests.
- SECURITY originals: `43be16b3`, `dce9bf0d`, `d67df501`, `72b14244`, `74a2d1cf`; local equivalents in this branch include `cfcfa091`, `8fe92fe7`, `3d98ce9c`, `02bf9280`, `f7051939`.
- Creation/alias target resolution additionally requires SECURITY `bceaf6df`, applied locally as `65900397`. The dependency-only cherry-pick resolved the source import conflict by adding only the three imports introduced in that original commit; unrelated choreography code absent from this checkout was not transplanted. The report conflict preserves the existing report and adds the original creation section. Integration should consume SECURITY's original candidate.
- BRIDGE helper `58f6b262` is local `286a7cb9`. Preparation `cc3cfd4a` is local `bd829689`. Later signed human wrappers and atomic Node orchestration are BRIDGE-owned.
- COLLAB shared appender `b3a951d2` and exact response type `1c5ba609` are required. SCHOOL appender context `184f8f4b` plus composed options `3df1db84` are local `db79d4db` and `1303f0e8`. Final signature is `appendRoomUpdate(ctx,args,{provider?,deferAiHistory?})`; these are internal helper options, never caller-supplied wire flags.
- COLLAB's current scratch builder stores either projection over 256 KiB through the existing durable payload mechanism. The sink intentionally refuses a combined inline native history snapshot over 850,000 bytes; it never discards history to force success. The builder's bounded projections keep ordinary large-content paths under that guard. Preparation must preserve the full semantic evidence before converting content to references.
- The physical head's exact `updatedAt` remains a CAS fence. UI staging may change that timestamp; a caller may reread the head before admission only while room/sequence, physical content identity, version and authored frontier still match. It must refuse an actual content/frontier change rather than reusing normalized desired content against a newer base.

The transaction fixtures use mock package strings with actual Convex transactions and Yjs updates. They cannot prove Office parser readback, signed Node wiring, live peer consumption, native file replacement or launch readiness. Those remain explicit integration/deferred acceptance work.

## Executed closeout checks — September 27

Coordinator temporarily dispatched lane1 after RUNTIME stopped progressing. All executable commands used the inherited `2b0f` filesystem guard and shared/private dependency paths, a 4 GiB Node heap cap, one Vitest worker, no file parallelism and worktree-local cache/temp. No service or database changes occurred. Each phase took under six seconds.

- Original four-file run: 27 passed, seven failed, in `222b/.spectra-local/launch-s11/durable-review/atomic-first-tests.log`. Three failures exposed a real source defect: `head` destructured nonexistent `artifact` from `requireActorArtifactCapability`. It now uses the helper's already-authorized `loaded.resource`, avoiding another read. Four failures were the new local fixture's invalid receipt state `queued`; corrected to the existing protocol state `pending`, without changing validators.
- After those fixes, the affected `convex/nativeAiCommit.test.ts` passed **18/18**, including creation, dependency receipt, actual Yjs delta replay, source/target fencing and queue/cloud/history rollback. Log `atomic-fixed.log`, 2.03 seconds. The untouched neighbors already passed: replica transaction helper **8**, admitted reader **4**, request digest **4**. Total distinct passing cases: **34**, not the sum of rerun counts.
- Scoped ESLint passed on the sink, contract, atomic test, shared digest/test and Office route, with `--max-warnings=0`; log `atomic-lint.log`. `git diff --check` passed. The coordinator explicitly deferred transitive TypeScript to the single integrated check; no type-clean claim.
- Two startup attempts are retained separately. `atomic-first.log` shows the guard blocking Vite's temporary bundled-config deletion under shared `node_modules/.vite-temp`; the guard was not weakened and no manual cleanup was attempted. `atomic-runner-first.log` shows the root config's `__dirname` incompatibility with Vite's runner loader. The ignored local config now uses the same root environment/setup/aliases/excludes without that CJS global and runs with `--configLoader runner`. Neither startup attempt ran tests.

The concrete later acceptance prompt is `docs/spectra-launch-audit/prompts/S11-DURABLE-AI-NATIVE-VERIFY.md`. It covers signed real-package preparation, lost response/compaction, current authority, source/room races, origin/peer delivery, Office locks/restart, native history ownership and measured cold/warm costs. These were not run during this bounded source closeout.
