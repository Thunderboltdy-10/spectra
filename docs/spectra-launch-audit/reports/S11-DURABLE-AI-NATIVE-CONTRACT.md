# Atomic AI/native commit contract

Status: architecture approved by S11 coordinator on 2026-09-26; validators/digest `6860df18` and the internal effect source are prepared for owner integration. AI/native tests have not run yet; RUNTIME owns the next available guarded lane. D1 is separate (`0e34c3f6` + `a3efca8a`), with 31 focused passing cases.

## Preparation and ownership

BRIDGE owns `act.ts` beforeCommit / `native-ai-promotion.ts` Node orchestration (ENGINE released these hunks), queue/cloud transaction helpers, and materializer preparation. ENGINE retains semantic operation ownership. COLLAB owns `admitted-ai-update.ts`, the fresh scratch builder, `yjs-artifact-operation.ts` exact-byte consumption, and prompt catch-up. SECURITY owns current actor/run/execution/operation admission. DURABLE owns `nativeAiCommit` effect/history/shared head and the validator/digest contract. PRESERVATION reviews readback and byte binding.

Concrete modules: `convex/nativeAiCommitContract.ts` exports `nativeAiCommitArgs`, `nativeAiSourceValidator`, `nativeAiCandidateValidator` and types. It composes existing `appendRoomUpdateArgs`, BRIDGE `queueMaterializationArgs` / `commitCloudMaterializationArgs` (`58f6b262`), and the existing native save receipt validator. `shared/native-ai-commit.ts` normalizes inline binary/base64 transport into exact SHA256 digest+length and hashes the complete immutable request with deterministic property ordering. COLLAB `1c5ba609` provides `PreparedCanonicalAiUpdate` and `AdmittedAiCommit`.

`convex/nativeAiCommit.ts` implements authenticated `head` and internal `commit`, reached only through the existing signed bridge's `commitAiNative` branch. `head` reads the artifact/room, original operation input/writeScope/digest, physical source identity and original committed result together. `commit` uses SECURITY's current guard and receipt replay helpers from `d67df501`, `72b14244`, `74a2d1cf` (prerequisites `43be16b3`, `dce9bf0d`). The ordinary operation finalizer preserves artifactWriteReceipt.

The shared appender receives a helper-only `deferAiHistory` option, never a wire argument, so this transaction can add native sources before committing the AI version. It then explicitly attests the verified prepared result as a version native owner before cloud advancement; the old source is still replica-bound at history creation. PRESERVATION reviewed this retention handoff. Result descriptors remain small in operation.output: replay reads the original retained log row or requests a covering snapshot/tail, avoiding a second inline update body in the receipt document. Eleven transaction tests and four digest tests are prepared, including failures after history and after cloud mutation, Stop/current-authority/CAS refusal, original-receipt replay, compaction fallback, and false unchanged claims.

1. Read the authenticated operation and complete durable artifact head using the existing Node bridge client and snapshot/tail helpers. Capture room ID, exact next sequence, artifact updatedAt/contentHash/currentVersionId, policy version, and current native source bindings. No websocket connection is needed. Reuse a warm canonical replica only after its tail and generation are checked.
2. Apply ENGINE's semantic operation to that actual head. Prepare and read back the native package using the existing Office lens. Preparation may upload immutable payloads; it must not create a claimable write request, advance cloud/local replicas, supersede another native request, patch canonical content, or report saved.
3. Build the final Yjs plan from the **readback-normalized** complete content. Do not retain a sheet cell plan or apply closure captured before native readback. Capture the exact authored Yjs delta and before/after projection from that plan. Bound or spill bodies through the existing immutable content/payload mechanism.
4. Send the signed envelope below. A stale result requires a new actual-head read, semantic preparation, and native readback. Revalidate SECURITY's approval scope; never relabel a stale result or silently broaden an approved effect. Bound explicit stale attempts separately from transport retries of the same envelope.

## Proposed signed operation: `commitAiNative`

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

Proposed `nativeAiCommit.commit` calls ordinary TypeScript helpers in the same mutation context; it must not call a separate mutation for append or queue.

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

Test rollback at append, history and outbox/cloud failures; refusal after revoked authority or changed canonical/native base; byte/projection binding; normalized sheet readback; duplicate/lost acknowledgment after later edits and after compaction; origin/peer consumption without a second append; no live gateway; local Office lock/retry with a truthful queued state; and partial-step choreography compatibility. Measure cold snapshot/tail bytes, warm tail bytes, Office conversion time, database reads/writes, and end-to-end latency separately. No tests or performance result is claimed by this proposal.
