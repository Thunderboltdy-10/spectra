# S11 BRIDGE: native preparation before admission

2026-09-26. Source candidate, **unrun pending guarded executable lane**. This adds the callable preparation boundary; it does not yet activate the signed AI commit or close public unsigned sinks.

## Source behavior

Both `materializeDocxArtifact` and `materializeOfficeArtifact` accept `{prepareOnly:true, aiOperation:{runId,executionId,operationId}}`. Missing executor identity is refused before fetching bytes. Identity is transport context, not approval; the final atomic transaction still needs current SECURITY admission.

Preparation uses the existing native parser, mutation, preservation checks, package comparison and readback. Changed bytes may be uploaded into the existing immutable payload lifecycle. It then returns a transient `prepared` result containing the actual readback projection, captured native source identity, and one exact candidate:

- `bridge.queue`: existing queue arguments including local selection, original native base, retained result and receipt.
- `cloud.cloud`: existing cloud materialization arguments.
- `none.unchanged`: only the verified source=result payload/hash, actual native semantic readback digest, and existing native-save receipt in the unchanged state.

There is no durable prepared state, claimable request, replica advancement, canonical mutation, supersession, or saved-status promise in that branch. The branch returns before the legacy queue/catch retry path. Missing native bytes throw instead of returning the human deferred/saved message. Existing human calls omit prepareOnly and keep their queue/cloud behavior.

`native-materialization-options.ts` owns the transient transport shape. It picks only the required native source fields; actual canonical before/after/room digests remain separate. Native semantic hashes are hexadecimal package/readback hashes, not Yjs projection envelope digests.

## Dependencies and shared ownership

Local dependency-only picks of OFFICE-MODELS `a9ef82ea -> 8ab65f63` and `650bcd51 -> b2a5ae24` provide the complete object-list and proven PPTX readback mirror contract. The absent prior S11 Office review fixture was taken from the incoming owner commit; no local test work was discarded. Coordinator should integrate the original owner commits separately, not cherry-pick these local dependency copies.

Three agreed materialization calls now declare PPTX object lists complete: initial projection update, retry ancestor projection, and merged retry update. Native readback remains final storage content. Transition digest serializer changes are coordinated with DURABLE/OFFICE-MODELS, not duplicated here.

Existing old preservation-call lines were not edited. Integration must retain PRESERVATION's newer `assertNativePreservationKept` before/after/intent hunks. PRESERVATION is independently reviewing this preparation branch. DURABLE owns `nativeAiCommit` and its exact validator/digest; COLLAB owns fresh post-readback Yjs planning and exact admitted-byte consumption; BRIDGE's next change activates signed Node orchestration and act.ts handoff.

## Evidence prepared

`native-materialization-preparation.test.ts` adds ten cases using actual in-memory DOCX/XLSX packages and real lens readback, with backend I/O mocked: changed local/cloud candidates for both formats; verified unchanged without upload; missing payload without saved/deferred response; and missing identity before fetching. Changed result bytes and receipt semantic digests are compared with actual native readback. This is not live Office, backend admission, history, or signed transport evidence.

`git diff --check` passed. No tests/typecheck/lint were executed for this candidate. Original `native-ai-promotion.ts`, its test, and act.ts identity WIP remain separate for the atomic orchestration change. Preparation alone must not be reported as atomic save or launch acceptance.
