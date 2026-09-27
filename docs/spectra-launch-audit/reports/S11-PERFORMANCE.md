# S11 PERFORMANCE — client loading and artifact lifetime

Task: `01a0d847-5a21-7572-af3a-eaed42607295`. Coordinator: `01a0d83f-92fb-7b80-9ea4-99fcecef20aa`.
Baseline: `d9aabfb5735bdcd8a620af8a7bdaa85aba08d150`. Checkout: `<local-workspace>`, branch `codex/s11-client-loading`.
Effective first-turn metadata and coordinator verification: `gpt-6-astra`, `xhigh`, `danger-full-access`, approval `never`.

## Unit 1: defer the common studio and DOCX importer

Library/Workspace imported `ArtifactStudio` eagerly. The ostensibly lightweight Library import utilities also imported that complete UI module for `documentContentFromJson`, and imported the native DOCX parser at module evaluation. Consequently simply applying Next dynamic loading to the shell would not remove the editor from startup.

The shell now uses the existing `next/dynamic` and `StudioSplitPlaceholder` pattern already used by Chat and tiled work. The exact document conversion function moved to a pure module, with its old studio export retained for compatibility. DOCX conversion/parser imports are loaded together only inside the existing async DOCX import operation. Conversion order, durable image handling, errors, editor props/keys, and provider lifetime remain unchanged. No resolved artifact cache, prefetch, server read, provider or schema was introduced.

Owned paths in this unit: `pages/spectra-shell.tsx` import/dynamic declaration; `components/artifact-studio.tsx` converter import/export only; new `components/document-content.ts`; `organization/library-import.ts` lazy DOCX dependency seam; two focused tests; this report. Coordinator approved each shared seam. The coordinator's notice rendering edits near the end of artifact-studio are independent.

### Evidence and decision ledger

| Source | Original finding / implementation | Current call-path finding | Verdict and consequence | Proof / remaining risk |
| --- | --- | --- | --- | --- |
| S10 OPEN original task `01a0d338-369b-7c91-a43c-b0518abc691a`, turns `01a0d36e-5cd9-7730-bc74-11539866754c`, `01a0d36a-3930-7002-ae2f-bf502025bfc8`; integrated `eac1567b` | Individual editors, rich text and chart rendering were made lazy; unused prefetch removed | Type studios remain dynamic, but spectra-shell and library-import bypass the common studio boundary | Keep selected-editor loading; complete its missing shell/import boundary | Real emitted esbuild graph regression ensures studio, DOCX parser and live-model hook are outside eager chunks and still exist in lazy output |
| `eac1567b`, S10 OPEN readiness discussion and report | Readiness previously preceded lazy editor commit; introduced child commit/frame readiness | `withStudioViewportReady` and document editor readiness remain inside selected studio | Keep: fallback is never editor readiness | Existing delayed lazy fallback and canceled-frame tests pass |
| `9aa76b15`, `eac1567b`, current Library import caller | Full committed document must be hydrated before collaborative mount, preserving durable images/native intent | Library import uses converter from UI module despite pure conversion | Replace import dependency only; retain exact conversion and compatibility export | Rich node/extensions, native deletion and empty-document tests; 13 existing native projection tests pass |
| S10 OPEN turn `01a0d378-c518-7452-b08e-56577a128509` and report | Unconsumed local save/restore JSON echo keys can remain; proposed operation-scoped tracking | This involves editor save/restore reconciliation, separate from startup boundary | Needs further COLLAB/HISTORY evidence; no blind eviction | No claim of bounded editor echo memory from this change |
| S10 LIBRARY `01a0d338-2e1a-7203-a01c-59881821cd64`, `01a0d37f-59d4-7aa0-8e8c-d5df06fa06fe`; OPEN report | Library was assigned summary/detail separation and retained bodies | Baseline shell still accumulates hydratedArtifacts; later detail can be masked by earlier cached copy; click requests lack shared latest-selection fence | Repair next as a separately tested unit (coordinator explicitly assigned continuation) | Source reproduced; not fixed by unit 1 |

The full current charter/USER-BRIEF and actual coordinator request were read. Historical OPEN replacement task `01a0d384-7cf9-7201-ae9a-65ba6289f1fe` was largely interrupted; the original task above contains the substantive design discussion. Reports were cross-checked against actual imports, callers and commit history.

### Measurements

Node v24.11.1, 2026-09-25. Same entry points and minified esbuild ESM options for baseline and change; baseline source is read from `d9aabfb5` in an in-memory build plugin. All emitted static chunk dependencies are counted. Third-party packages are external, so their bytes are excluded.

| Initial static closure | Before bytes | After bytes | Before gzip bytes | After gzip bytes | Deferred source modules |
| --- | ---: | ---: | ---: | ---: | ---: |
| Library/Workspace shell | 1,605,852 | 970,714 | 468,551 | 284,169 | 100 |
| Library import utility | 1,340,038 | 26,962 | 390,294 | 9,278 | 240 |

The shell's emitted local JavaScript decreases 39.6%. Its eager package edges also no longer include Office DOCX/XML/preservation, Hocuspocus, y-prosemirror or Yjs. These are **synthetic bundle measurements**, not Next production chunks, actual transfer bytes, cold/warm browser timings, subscriptions, or retained heap. Warm module reuse is provided by the standard module loader; no measured warm browser claim is made.

Private reproducible evidence: `.spectra-local/launch-s11/performance/measure-loading.cjs` and `loading-measurements.json`. The first script invocation had a syntax error, corrected before measurement. No benchmark data was discarded. Runtime setup/dependency restoration belongs to RUNTIME; this checkout uses an authorized junction to primary node_modules and never modifies its target.

### Verification

- 16 tests passed: client-loading, document-content, library-resource-import, studio-viewport-ready (one Vitest worker).
- 13 existing document-native-projection tests passed (one worker).
- Scoped ESLint on the six changed source/test files: passed with zero warnings.
- `git diff --check`: passed.
- No full suite, full typecheck, Next build, browser mutation, backend publication, native Office or production proof in this unit. Profile A slot requested through coordinator; no competing browser or service started.

## Unit 2: release closed bodies and fence selected opens

Status: implementation prepared; final validation pending the coordinator's shared dependency hold. Unit 1 is committed as `03e4d429`.

The baseline has two independent lifetime failures. `hydratedArtifacts` only grows, and detail reads also insert complete bodies into overview and workspace rows. Returning to a closed artifact can therefore reuse an old body and old permissions indefinitely. Separately, selected opens use independent promises; a late response can open A after B or after closing the studio. The old `hydrated ?? listed` merge also masks freshly read canonical content.

The shell now retains complete bodies only for explicit open work and the pending selected-open handoff. Closed overview/workspace rows keep their metadata; settled AI preview bodies are released too. Active previews retain their existing behavior. The helpers preserve object references for open content and unchanged state, and never mutate the original cached response. Explicitly denied/deleted details are released.

Selected opens use the existing `createLatestStudioLoad` cancellation and in-flight coalescing contract through a small hook. Every completed reopen revalidates through the artifact endpoint; no completed-body cache is added. Closing, switching hubs, navigating history, or unmounting fences pending responses. Follow intent is captured before asynchronous loading. Imports still hydrate the committed artifact before mounting, and an editor-open error after a saved import is reported as an opening failure. Restored work and tiles are not mounted from summary-only rows; missing restored reads receive AbortSignals. The selected/deep-linked request is excluded from the separate restored-work fetch batch to avoid duplicate detail hydration.

Fresh detail remains an indivisible body/version/permission snapshot. A metadata-only list cannot overwrite its role. Focused canonical refresh, lens activation and AI preview/clear updates also refresh retained open data so the initial hydration cannot hide later saved content. Existing editor keys and provider code are unchanged.

Additional exact files: `components/shell-artifact-content.ts`, `components/use-shell-artifact-content.ts`, `components/use-shell-artifact-open.ts`, their two focused test files, and the already reserved shell. No data/api.ts, server/schema, editor/provider, embed or native writer edits.

### Deterministic retention measurement

The dependency-free private `measure-retention.cjs` uses 24 generated documents, 400 paragraphs each. It compares the baseline shell's append-only record with the production release helpers. Unique content objects are counted once across representations; byte counts are their serialized UTF-8 content, **not V8/browser heap measurements**.

| State after visiting 24 documents | Retained bodies | Serialized body bytes | Metadata rows |
| --- | ---: | ---: | ---: |
| Baseline, all closed | 24 | 3,975,008 | 24 |
| Change, two explicit tabs remain open | 2 | 330,784 | 24 |
| Change, all closed | 0 | 0 | 24 |

One release traversal measured 0.1571 ms; an unchanged warm traversal measured 0.0080 ms and returned the same overview object. These tiny synthetic timings are not artifact-open latency. Private evidence is `retention-measurements.json`. Warm reopen now intentionally performs a fresh authorized read; no network reduction is claimed for that operation. An immutable, versioned body cache would need fresh authorization and a separate cost comparison before introduction.

### Candidate verification and remaining acceptance

- The initial eight new hook/content tests passed, alongside the emitted loading graph test (nine tests total).
- Coverage subsequently extended to explicit denied/deleted data, canceled unstarted reads and the final same-timestamp permission case. Final rerun awaits the dependency hold being lifted.
- The subsequent validation attempt failed before test collection: shared `@jridgewell/sourcemap-codec` disappeared; ESLint also could not resolve `@eslint-community/eslint-utils`. The same tools had passed earlier. Coordinator/RUNTIME confirmed a shared dependency deletion incident and ordered all tests stopped. This is infrastructure contamination, not a claimed product-test failure or pass. No dependency install, removal or link recreation was attempted here.
- New helper tests exercise actual React hooks and pure retention functions, not a live full shell. Current live browser, heap/subscription and production Next acceptance remain unrun. Typecheck and Profile A slots are requested from the coordinator.

### Additional source review and residual units

- S9 DURABLE acceptance task `01a0cb5e-daed-7563-915d-a746b6da993d`, turn `01a0cb5f-951a-7fc0-9b43-051d18da2904`, records the actual 43.68 MB repeated-upload failure, rejected browser digest approach, and switch to the authenticated durable-checkpoint barrier. Keep that server-authoritative save boundary; the current changes do not hash or re-upload artifact bodies.
- Module-level overview/workspace TTL caches still lack eviction/account-scoped keys; this unit does not alter data/api.ts. Their authority and real payload cost need DATA/SECURITY coordination.
- Restored tabs still use the existing batched detail-loading strategy. Prioritizing the visible tab and measuring very large simultaneous tile sets is a separate latency unit; arbitrary row/body truncation is not a substitute.
- Library's `seenRef` retains visited **tree metadata** for drag ancestry. Measure row volume before changing that correctness contract.
- Python runtime source has explicit termination and blob revocation on timeout, cancel and run-limit paths; retained reusable-worker lifetime and exceptional constructor/callback paths are not live-verified here. EMBEDS owns interactive runtime rendering and lifecycle.
- S10's full-JSON echo aliases involve save/restore ordering, not this shell store; COLLAB/HISTORY must review them. Real subscription counts and transport memory remain runtime evidence gaps.

## Coordinator review follow-up: missing results, revocation and mounted opens

Source repairs are prepared after review of `6ce896a5`. Validation is still held by the shared dependency incident; the added assertions below are **unexecuted**, not passing evidence.

- A current null selected-open result now clears loading and reports unavailability. A superseded null cannot clear the newer request's loading state. Canonical HTTP 404 and `AUTH_RESOURCE_FORBIDDEN` responses use the existing null-aware artifact reader; other HTTP/network failures still throw. The coordinator explicitly approved only the optional AbortSignal signature/fetch change in `data/api.ts`.
- The shell applies canonical null, explicit denied/deleted detail, and explicit denied/deleted rows from a **forced network** overview/workspace refresh as revocation. It releases hydrated, overview and nested workspace bodies, closes the affected open object, and cancels only a selected open of that same work. An unavailable toast appears only for affected open/opening work. Cached metadata, omitted rows and transient failures do not establish revocation. In particular, a failed restored read no longer closes its tab as if permission had been denied.
- `shell-artifact-access.ts` orders overlapping detail and forced-list reads by local request generation; artifact `updatedAt` is not a permission clock. A later authorized detail defeats an earlier delayed list denial. A later explicit revocation defeats an older allowed response. When a newer detail wins an overlapping selected open, that open receives the complete newer response so its navigation handoff still completes. Only concurrently outstanding reads retain these decisions; the map releases all results when they settle. This adds no completed-reopen cache, server subscription or provider.
- Split, tab and Follow opens use one path. A work already in the current open-object store with valid mounted detail reuses that detail. A closed/reopened work always fetches again. Revocation consults the current store, so a delayed callback cannot reuse an artifact that has just been removed from the open set.

Additional regressions cover current/superseded null, targeted cancellation, mounted refocus aborting another selected request, canonical status discrimination with AbortSignal forwarding, same-timestamp fresh metadata denial, cached restriction versus fresh grant, absence/transient errors, both directions of delayed permission responses, deletion, and response-after-abort. The repeated-open fixture expects **one** initial read across ten mounted split/tab/Follow opens and a **second** read after close/reopen; those counts are expectations until RUNTIME clears the test hold.

Authority limitation: current `useLiveOrgIdentities`/`orgTree.liveIdentities` exposes neither access decisions nor a distinction between loading, missing placement and unavailable source. It is therefore not a trustworthy instant revocation signal. This unit makes the shell's existing fresh refresh/read boundaries authoritative; it does not claim immediate global revocation delivery. Collaborative studios retain their existing live `permission_lost` write protection. DATA/SECURITY/COLLAB own any future explicit server event or subscription contract.

Required final verification after release: focused client loading, document conversion/import/projection, selected-load, shell content/access/open, and studio-readiness suites; scoped lint; coordinated typecheck and Profile A cold/warm/heap/network measurements. No tests, build, install or dependency-link mutation was started during the hold.

This report is not a launch-readiness verdict.

## September 27 recovery and bounded closeout

Recovery owner: `01a0e28b-5539-7541-b95b-bc2ca0410ca0`; coordinator: `01a0e289-3aa8-7ed1-bc1a-e9ede38f2dc9`. Reused the clean existing `61a5` checkout at `2c5f5075`. Own actual rollout `turn_context` independently verifies `gpt-6-astra`, `xhigh`, `danger-full-access`, approval `never`. No dependency installation, worktree creation, shared service changes or primary edits occurred. The user's September 27 direction prioritizes completed implementation and integration; exhaustive final validation is deferred.

### Recovered evidence, superseding the stale hold status above

Read the predecessor's actual interrupted turn `01a0dd8d-af98-73a2-b2c2-a7008561d291`, its command results and saved JSON. RUNTIME had explicitly released its guarded lane. At unchanged `2c5f5075`, the nine listed focused suites completed on September 26 with **56/56 tests passing**, exit 0, 13.91 seconds reported by Vitest. The saved `.spectra-local/launch-s11/performance/guarded-focused-results.json` agrees with the transcript. The next scoped ESLint command completed with exit 0 and `--max-warnings=0`; its output/log is not present, so no additional lint detail is claimed. No typecheck completion was found. The earlier missing-dependency failures remain historical evidence; this recovery does not erase them or repeat the already completed baseline.

The recovered source includes the lazy boundary `03e4d429`, body retention `6ce896a5`, and authority/mounted-open follow-up `2c5f5075`; `afd354eb` only recorded the then-current validation hold. These candidates do not depend on a new data/API contract beyond the existing optional AbortSignal. DATA-R2 owns workspace traversal/cache changes. BRIDGE-R2 confirmed no health-poll or client serialization edits in its current unit; native admission and authenticated payload reuse remain its scope. Read-only reauthorization cadence is unchanged.

### Remaining access-coordinator body lifetime

Review found that `createShellArtifactAccess` kept every completed detail in its decision map until **all** requests settled. A slow unrelated restored detail or forced list could therefore retain many closed bodies after the shell released them. Follow-up `f3c8052656eb5c2ecd8f290eca1bbffe0981c75a` tracks pending detail identities and list sequences separately. It keeps a newer complete result only for an older pending detail of that same work. Older forced lists retain sequence metadata to reject stale denials. Aborted detail reads release their retention claim immediately, including when the underlying reader resolves late or ignores cancellation. Finishing a detail examines only that work's decision; it does not rescan unrelated retained metadata. A fresh reopen still reads again; grants, denial/deletion and the newer-result navigation handoff keep their existing semantics.

New direct cases cover a newer granted handoff while two earlier lists and unrelated reads complete in different orders, an aborted overlap with a later reopen, and a signal aborted before the reader starts. No remaining source blocker was identified in this bounded unit. The finite checks were initially queued. The current coordinator then explicitly granted temporary lane 2 after verifying no live test processes; the following checks completed serially on September 27 with the inherited filesystem guard, a 4096 MiB heap limit and local cache/temp. Tested checkout HEAD was documentation-only `1b759921`, with production/test source unchanged from `f3c80526`.

- **27/27 tests passed**, three files: `shell-artifact-access`, `shell-artifact-content` and `shell-artifact-open`; Vitest reported 5.16 seconds, one worker, no file parallelism. Logs: `.spectra-local/launch-s11/performance/focused-f3c80526.{json,log}`.
- **Scoped ESLint passed**, exit 0 with `--max-warnings=0`, on the changed helper and test file. Log: `.spectra-local/launch-s11/performance/eslint-f3c80526.log`.
- **Node reachability probe passed**, exit 0, Node v24.11.1 with `--expose-gc`. The private `measure-access-retention.cjs` bundles the actual prior/current helpers with an explicit fixture reader and uses WeakRefs after five GC/event-loop turns. Results: `access-retention-measurements.json` and `access-retention-f3c80526.log` in the same private directory.
- `git diff --check` passed. No full suite/typecheck/build, service change, dependency mutation, browser or native test was run. The prior 56-test run and this overlapping 27-test group are separate evidence and must not be added into a unique passing-test total.

| Synthetic retained body reachability | Before (`2c5f5075`) | After (`f3c80526`) |
| --- | ---: | ---: |
| 24 visited/closed bodies while an unrelated detail remains pending | 24 | 0 |
| 24 visited/closed bodies while an earlier forced list remains pending | 24 | 0 |
| Newer body needed by an older same-work detail | 1 | 1 |
| That body after the old read is aborted, before its transport settles | 1 | 0 |
| Bodies after every read settles, in each scenario | 0 | 0 |

The late canceled read still returned `AbortError` in both versions. These are synthetic Node/V8 object-reachability results, **not browser heap sizes, transfer bytes or artifact-open latency**. Live efficiency validation remains deferred as directed.

### Deferred final validation prompt

> Validate the integrated Spectra client performance changes at a frozen, recorded revision. Coordinate with RUNTIME before any executable/browser/native lane; inherit its filesystem guard, one Vitest worker, worktree-local caches, saved `local-pablo_md-ai_school-2` database and isolated S9-OFFICE journal/safe mount. Use the assigned Profile A session. Preserve original files and school records. Do not reinstall dependencies, start a competing stack or use the default OneDrive Bridge. Record frontend/backend/gateway/Bridge revisions separately. Begin with the affected shell access/content/open, latest-load, loading graph and editor-readiness checks on the integrated code, then inspect actual browser behavior and measurements rather than treating helper tests as launch evidence.
>
> With disposable large documents/sheets/slides, measure Library startup and cold/warm editor-ready latency, actual transfer bytes, provider/socket/subscription counts and consistent browser heap/DOM/listener samples before and after repeated visits. Distinguish installed module reuse from body/authorization reuse. Ten split/tab/Follow opens of mounted work should use one initial detail read; closing then reopening must perform a fresh authorized read. Exercise A→B, close/unmount during an open, transient restored-read failure, an older allowed response behind a newer denial, an older denial behind a newer grant, and a stalled unrelated read/list while visiting and closing 24 works. Observe real heap after consistent GC/idle conditions; the private synthetic bundle, serialized-body and Node WeakRef probes are separate evidence. Verify ordinary navigation/focus and Follow handoff remain correct and permission loss cannot revive a closed body.
>
> Coordinate the native part with BRIDGE/COLLAB: on disposable copies of representative large native files, make one paragraph/cell edit and record conversion/materialization count and duration, full-package versus delta bytes, upload deduplication timing, retries/cancellation, native write latency and peak memory. Measure idle costs with one and several mounted artifacts, including Bridge health polling and read-only authorization. Preserve authorization, sync/history/receipt boundaries and same-account synchronization. Report exact pass/failure evidence, regressions, measurements and unresolved limits; do not infer live heap, Convex physical read cost, billing or launch readiness from fixture numbers.
