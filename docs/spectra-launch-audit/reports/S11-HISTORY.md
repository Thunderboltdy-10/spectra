# S11 history recovery

Recovery task: `01a0d86a-925d-7ce0-9535-91ccc06570a4`. Coordinator: `01a0d83f-92fb-7b80-9ea4-99fcecef20aa`.

Baseline: `d9aabfb5735bdcd8a620af8a7bdaa85aba08d150`. Isolated checkout: `<local-workspace>`; branch: `codex/launch-history-recovery`.

Actual startup rollout `turn_context` confirms `gpt-6-astra`, `xhigh`, `danger-full-access`, approval `never`. Previous HISTORY task is superseded and contributed no source edits. Charter, fleet, private user brief, and coordinator conversation were read. No subagents or new tasks started.

## Runtime boundary

All test/build/install starts remain held pending RUNTIME clearance after loss of the shared dependencies. This worker has not started tests, a build, an install, services, backend publication, or native/file/school mutations. Source inspection is evidence of a call path, not a passed behavior test.

## First finite unit

Implemented version listing by cursor and one retained detail per selected version. Existing version rows, snapshot objects, native/spill ownership, history authorization and quiz/timetable privacy projections are unchanged. Coordinator approved the exact shared-file hunks before edits, then approved the workbench history pagination hunk. No schema or parallel history store changes.

`spectraArtifacts:listVersions` now returns `{ versions, continueCursor, isDone }`, with 20 requested rows by default, a maximum of 50 rows, and a 2,000,000-byte pagination read budget. That budget applies to the version query, not the complete request: source authorization still reads the current artifact and creator display names still require account rows. Legacy inline snapshots are still read as part of a version row. No snapshot objects or AI run rows are loaded by the listing. The new `getVersion(artifactId, versionId)` checks current source authority and version ownership before hydrating exactly one retained version.

The comparison overlay fetches the first metadata page and selects its first entry; that selection triggers one detail request. Later selections cancel the previous detail request, clear the previous body, and verify returned artifact/version identity. Closing or switching artifacts cancels pending requests and releases the selected snapshot. Both studio history views and the workbench history list offer manual pagination and truthful failure/retry states. Version names/source labels and dates replace ordinals formerly computed by scanning all history. EXPERIENCE owns the remaining embed pin-picker pagination and received the exact helper contract.

| Decision | Source and current call path | Verdict | Cross-system implications | Evidence / remaining proof |
| --- | --- | --- | --- | --- |
| List all history to number newest versions | Baseline `convex/spectraArtifacts.ts:listVersions` collects ascending `by_artifact_created`, slices newest 100, and uses `findIndex` for ordinal | Replace | Cursor pagination must not present a loaded-page count as a durable version number | Static source verified; pagination with equal timestamps, new inserts and more than 100 rows needs focused coverage |
| Hydrate both snapshots in the list | `listVersions` calls `hydrateVersionSafely`, fetches creators and whole AI run for every selected row | Replace list hydration with authorized exact-version detail | Preserve exact retained snapshot references, integrity errors, native provenance and source privacy in detail; list metadata is not proof of low database bytes | List can bound version-row reads and avoid snapshot-object reads; inline legacy version bodies and artifact authorization still cost database reads |
| Existing content-addressed snapshot hydration | `artifactSnapshots.ts:loadVersionAfter/loadVersionBefore/hydrateVersionSafely` | Keep | Damaged/missing snapshots must remain visibly unavailable; do not reconstruct or silently switch to another version | Direct source inspection; regression cases for valid/missing/corrupt snapshot objects and durable body refs planned |
| Restore revision guard after optimistic write | `artifact-studio.tsx:restoreVersion` closes prior human group, calls `live.synchronize/restoreRegions`, then `changeGroups:commitRestore` labels open groups | Replace architecture before claiming safe restore | `region-controller.ts:editMany` authors Yjs optimistically before durable acknowledgement. A new guard only in `commitRestore` cannot prevent a stale restore effect. Admission must check restore capability and expected room/canonical base before effect; version/receipt and delta commit atomically | Sent to coordinator, DURABLE and SECURITY; no shared admission changes made |
| Pinned source deletion retention | `spectraArtifactDeletion.ts:processVersionPage/processRuntimePage`, `artifactSnapshots.ts:releaseVersionIfUnpinned`, `artifactEmbedOwnership.ts` | Keep retention; lifecycle access needs decision | Pin retains exact version/build and spill/native dependencies; generic history/detail stays source-authorized. Runtime exception must be host/exact-pin scoped and consistent with retained source grant semantics | `artifactEmbeds.ts:runtimeBuildAccess` rejects deleted source while pin rows survive. EXPERIENCE/SECURITY asked to own access decision; this worker will not remove source guard |

## Prepared focused verification (not executed)

`convex/history-pagination.test.ts` contains query-level fixtures for 125 versions with equal timestamps/newer concurrent inserts, row/byte observation before and after 200 older entries, snapshot/provenance/ref preservation, missing/corrupt snapshot state, current/expired/deleted authorization, cross-artifact version rejection and quiz/timetable privacy. The observer measures returned database rows and serialized JSON bytes, not physical storage I/O, billing or cache behavior. Its assertions are not measurements until executed.

The history cases in `src/features/spectra/__tests__/api-route.test.ts` cover cursor forwarding, selected-detail routing, and invalid page-size rejection. `workbench-history-pagination.test.tsx` covers manual page loading, failed-page retry without losing metadata, and stale artifact responses even when the mocked reader ignores abort.

Coordinator review of `15fe9531` identified that the workbench still fetched comments and history together. The follow-up separates their requests, loaded-source markers and error/loading states: opening Comments never fetches history, opening History never fetches comments, and comment create/resolve/reanchor refreshes only comments. Already loaded or pending data is reused when switching tabs. The selected tab is scoped to its artifact so switching artifacts cannot trigger the previous artifact's tab before the reset effect runs. Added unexecuted regression cases verify demand separation, comment-mutation refresh, and completion/pending requests across tab switches. This correction is confined to the workbench, its focused tests and this report.

- Paginate newest-to-oldest with finite count/byte budget, equal timestamps, inserted newer versions and no overlap; include more than 100 versions.
- List responses omit before/after, full provenance, run bodies and spill/native payloads; hydration only on exact selection.
- Detail rejects a version belonging to another artifact and unauthorized, revoked or deleted sources; read-only quiz history stays hidden; timetable snapshots remain projected.
- Existing snapshots retain valid content, native binding, provenance and durable references; missing or corrupt snapshot objects return truthful unavailable state.
- Client pagination/detail requests cannot repopulate closed or switched artifacts; selection races cannot display or restore an earlier response; errors distinguish network failure from damaged retained data.
- Restore admission must cover stale canonical version, intervening room append, projection lag, policy revocation, duplicate receipt, and lost acknowledgement before it can be called safe.

## Separate restore admission unit

Coordinator accepted the first-effect defect and reserved its implementation for after the shared D1 appender contract settles. No claim is made that this pagination unit fixes restore concurrency. The additional client source/selected-version identity check prevents a stale preview from being used for another artifact; it is not the server revision guard.

Proposed contract: a restore-head read requires current `restore` capability and an exact source version. A server action reconstructs the current fenced room and computes the chosen whole/partial restore. Its internal commit reauthorizes, compares current canonical version/content hash and room ID/next sequence/policy, closes preceding human history, appends the delta, and records the new version plus a stable request receipt in one transaction. Receipt identity binds actor, artifact, source version, selected regions and base. The client synchronizes from the admitted server delta. Human restore is not an AI approval permit.

First-effect regression fixture to implement against that admission API: delay the admission response after source selection, inspect the local Y.Doc, append log, canonical artifact and version rows, and assert all remain unchanged until commit; then test (a) revoked restore grant, (b) one intervening room append, (c) changed canonical version with the same room ID, and (d) a stale source selection. Every rejected attempt must preserve both local and server state. For successful admission, drop the acknowledgement and replay the same request identity: one delta, one version, one receipt; changed source/regions under that identity must fail. These cases are prepared as a contract, not skipped or falsely passing tests.

## Native/pinned cross-review

Read DURABLE's uncommitted `222b/convex/nativeReconciliation.ts` and `changeGroups.ts` helper. Retaining native source hashes in the before/after snapshots before replica advancement correctly feeds the existing recursive ownership scanner. Sent two provenance issues back: the shared human checkpoint hardcodes `pre_ai_checkpoint`, and patching the exact before projection without its matching live state-vector hash can record stale checkpoint ancestry. Also flagged that snapshot-only `nativeSources` must not create false semantic human checkpoints or be discarded when implementing native-only restore. No edits were made to DURABLE's files.

Coordinator's pinned-source verdict preserves independent source authority. Deleted-source access may use retained grants only for an exact retained pin/version/build, with a live authorized host and surviving confirmed placement. A host-only reader must not gain source rights. SECURITY owns the evaluator decision; EXPERIENCE owns pin UI. Generic history/list/detail remains denied for a deleted source.

## Acceptance status

Pagination/detail implementation and focused regression sources are complete. `git diff --check` passed. Test execution, type checking and live verification remain explicitly held by RUNTIME; no dependencies were installed or linked. Restore first-effect admission is a separate unimplemented unit. This is a source candidate for coordinator review, not launch acceptance.
