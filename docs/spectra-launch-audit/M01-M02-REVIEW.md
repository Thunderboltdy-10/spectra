# M01/M02 parent review and continuation decision

2026-09-10. Both full reports and product diffs were read together. **Neither candidate implementation is integrated.** Main retains the W4 product baseline through dc1261d9 and the newer local:start:all launcher. This review adds documentation and portable counterexamples only.

## Candidate provenance

| Package | Reviewed commit | Original checkout | Disposition |
| --- | --- | --- | --- |
| M01 | 1dc1be2d94f9d82336e67807b367748367311ad9 | <local-workspace> | Hold product changes; complete the read and lifecycle contracts |
| M02 | 95a5d6b64258088a3984061cd9423237a2b0a35a | <local-workspace> | Hold product changes; complete actual media persistence, receipts and evidence |

reports/M01.md and reports/M02.md preserve the submitted reports. Their completion claims are not parent acceptance. The original commits remain available. Useful directions include bounded initial history, committed quarantine results, request byte limits and honest snippet provenance; the implementations are not yet safe to consume.

## Reproduced counterexamples

These call the candidate functions using convex-test, or controlled DNS/fetch fixtures. They do not touch real accounts, files, network destinations or the running backend.

| ID | Candidate and scenario | Observed result |
| --- | --- | --- |
| R01 | M01, 40 messages sharing a createdAt value, initial plus older page | Only 32 are retrievable; timestamp-only before excludes the other eight |
| R02 | M01, 21 legacy threads, four backfill calls with limit 10 | Eleven never migrate; every call takes the same newest rows |
| R03 | M01, ordinary student queries another student's deletion job | Returns owner/job/error details instead of denying access |
| R04 | M01, cleanup with one already-failed Bridge request, four worker invocations | Remains in children, repeatedly patches the same row and schedules another invocation |
| R05 | M02, complete a small valid imported-content job through artifactImports.complete | ReferenceError: MAX_CONTENT_BYTES is not defined |
| R06 | M02, unauthenticated finalize of an active asset with an incorrect receipt | Returns committed active status before any receipt/authority check |
| R07 | M02, commit import then replay the identical commit | First commit succeeds; replay throws ARTIFACT_IMPORT_REVISION_STALE |
| R08 | M02, cancelled research request with controlled AbortError | Returns fallback snippet evidence instead of propagating cancellation |
| R09 | M02, DNS fixture resolves to ::ffff:7f00:1 | Calls the mocked fetch and creates verified evidence instead of rejecting private loopback |

Nine distinct counterexamples fail against the submitted candidates. This is intentionally failing regression evidence, not a passing suite. Reproduction sources are in review-cases/ as .test.ts.txt files so they do not enter the main test suite before implementation. Copy each to the path documented there in the matching checkout; run the listed focused commands. Convert them into normal passing behavioral tests with the fixes; adapt obsolete API names when the contract is deliberately replaced.

The submitted M01 tests exercised unique message timestamps and an empty backfill database. Existing embed deletion tests checked immediate absence/tombstones, not scheduled completion. M02's reported 45 tests did not execute the new completion/receipt paths. Its statement that changed files had no TypeScript diagnostics cannot establish a valid build: the actual backend references an undeclared constant. The new intake fixture test is also tied to an absolute private Windows path and measures the input rather than invoking the media persistence path.

## Additional findings from source review

### M01: bounded reads must retain access and retrieval

- spectraThreads.list still hydrates full artifact/workspace rows for context labels, without a current per-context capability check. Cache membership is not authority. Preserve revoked/inherited/agent/deleted cases while using existing summaries.
- spectraThreads.get still fans out operations/cards/events for every run referenced in the initial 32 messages and returns full affected artifacts. Adding activeExecution to that same response does not create an independently observed active run.
- getRunTrace only advances an events cursor. Operations and cards always return their latest limited rows; older ones have no retrieval path. Its new client helper has no completed UI consumer. Older message pages consequently lack their results/trace history.
- ConversationSurface.loadOlder has no request generation/thread guard or readable catch/retry. A late page can enter a different thread. Its displayed-length scroll effect can jump back to the bottom when history is prepended; the live-window merge can develop gaps as the initial page moves.
- Read cache maintenance is partial: beginRun and one createPending branch do not cover every creation, relation, move and title/preview change. Bounded context previews must not remove the only path to older related work.
- No actual before/after workload measurements were delivered. A root landing-page snapshot from the unchanged runtime does not verify these paths. The cost worksheet contains placeholders, not a validated cost estimate.

### M01: deletion and placement are state transitions, not just scheduled loops

- scheduleDeletion physically deletes the owner row before deferred cleanup; the supposed tombstone is removed in the same mutation. It synchronously calls tombstoneArtifactEmbeds and purgeSourceNodes, preserving an unbounded front door.
- Job generation/cursor fields are not enforced; failure is terminal with no authorized resume path. Deleting the owner row also prevents the existing request path from authorizing a retry. The Trash path duplicates scheduling logic.
- Repeated Bridge request patching does not advance the indexed query (R04). The worker also deletes replica rows without consuming their retained payload reference lifecycle. It can stall before collaboration cleanup.
- Removed old cleanup responsibilities include artifactUserStates, runtime builds/storage metering, memory evidence redaction, scoped-memory expiry and capsule invalidation. Claims are nested under rooms and can remain when there is no room. Newer conflicts, payloads and run descendants require an explicit ownership/retention disposition, not an assumption that the replacement covers the old work.
- Assets/import originals are deleted by storageId without reference proof. Shared/pinned retained content must not be reclaimed accidentally. Thread history and results concerning other work must not be destroyed merely because a run also targeted the deleted artifact.
- releasedBytes never advances and row counters include repeated patches. A scheduled cleanup cannot be represented as fully released storage.
- The new embed operation key is not wired through actual insertion callers; records are marked confirmed before the editor insertion commits. A process death still leaves an orphan. Replayed keys are not bound to the full insertion identity.
- Bridge backoff adds jitter after capping the base: it can sleep 27 seconds and settles at 18 seconds, not the reported 15-second cap. It has no new-work wake mechanism, all clients at the same cycle share the same delay, and startup configuration/credential/migration failures can keep the new loop at 250 ms rather than the old five seconds. cargo check does not validate latency or idle cost.

### M02: a reference must resolve to owned bytes

- imports/route.ts removeInlineMedia replaces data URLs with asset:inline-media:<hash> but never decodes/stores their bytes or creates assets. This is a data-loss regression, not asset materialization. There is no resolver for the invented identity. It also rewrites data href/url values indiscriminately, after content validation.
- The valid PNG integrity mismatch was not diagnosed. The route still depends on the same metadata comparison; changing failure transaction semantics alone cannot establish working upload.
- Pending upload reuse is not scoped to the uploader. Another authorized collaborator can receive a receipt they cannot finalize.
- Receipt possession plus an arbitrary storageId does not prove that the candidate object originated from that upload. Recording a caller-supplied candidateStorageId does not make it safe for later cleanup. Terminal replay must still enforce owner/target authority.
- The original import upload path remains separate: PUT buffers request.arrayBuffer, finalize compares only size and its failure deletion/throw rolls back. Lost-response retry, actual digest/type validation and trusted ownership are still open there.
- targetVersionId is absent for a blank target, and version identity alone does not detect every live Yjs edit. Moving a stale check ahead of a committed receipt breaks replay (R07); moving it back alone does not solve late-write causality.
- No materialized-media -> canonical-save -> reload proof, abandoned reference release hook, complete durable AI attachment contract or shared actual-inflation limits was supplied.
- Source DNS validation is separate from the fetch connection, so rebinding remains open. Mapped private addresses and abort handling fail the controlled tests. Sequential fetches, missing independent deadlines/cache, offset/hash consistency and cross-source evidence allocation remain owned work.
- An explicit unverified source type is a useful direction. Removing the verified-only span guard requires following every consumer so a diagnostic span cannot become a trusted citation by another path.
- PDF/XML/shared rendering compatibility and reachable parser fixes were explicitly assigned to M02, then deferred in its report. They remain M02 work; broad Office writer/editor and AI SDK upgrades still belong to M03/M04.

## Parent design decisions

1. Preserve cheap, authorized metadata and a lossless paginated history separately from live execution. A numerical cap is not an optimization when the user cannot retrieve the remaining work. Stable cursors and causal UI request identity belong in the same slice.
2. Keep distinct receipts for uploaded bytes, parsed content, canonical commit, native write and cleanup. They can refer to each other through existing IDs; they are not one optimistic success flag. This is also the foundation for reliable AI recovery and honest K-bar/action acknowledgement.
3. Keep a durable deletion tombstone while writers are fenced and descendants are processed. Page each family with a real progress measure. Reuse existing snapshot/payload retention and authorization mechanics; do not build a second generic storage or job framework.
4. M02 owns intake bytes and reference release; M01 owns deletion coordination. See M01-M02-HANDOFF.md. Retaining bytes does not grant permission to reveal them.
5. Complete intake first, then run the M01 continuation against its finished candidate contract in a private checkout. This replaces the earlier unrestricted parallel foundation plan. No primary merge occurs until parent review.
6. Keep the next wave to these two existing manual tasks. No new Luna observer batch, no broad verification campaign and no automatic monitoring. The failures are concrete completion work, not a reason to repeat W1-W4.

## Progress and remaining work

W4's collaboration recovery, basic Sheets persistence/font/cache fixes, chat/navigation reliability, invitation recovery and share authority remain integrated. This pair adds useful candidate work and stronger evidence, but no new foundation feature is counted as accepted yet.

Next are the two manual completion prompts. After their results, reassess Office/ManageBac parallelism using the actual asset, deletion and query contracts. Broad document/workbook/presentation editing, reliable AI/steering/actions/K-bar/follow behavior, selected-class sync/personal planning, Bridge trust/filesystem transitions and Windows/Mac launch readiness remain substantive work. Existing short W4 browser gaps remain assigned to their relevant implementation slices. No percentage or guaranteed number of remaining tasks is asserted.

The running environment was left alone. These checks used private dependencies and fixtures, not live Convex. Before acceptance, changed backend functions still need a small real-local-Convex journey; neither old served code nor convex-test substitutes for that proof. No launch, hosting, signing, Mac, original-file or production claim is made.
