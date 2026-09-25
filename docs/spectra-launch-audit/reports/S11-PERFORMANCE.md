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

## Next bounded unit

Repair shell retained bodies and stale selected-open requests, while preserving mounted tabs/tiles, exact content (including empty/shorter revisions), current authority and live collaboration. Measure retained serialized fixture bytes and request counts deterministically; obtain cold/warm live browser evidence when RUNTIME allocates a slot. Remaining broader work: module-level overview/workspace TTL caches and account boundaries, expensive live-model hydration, retained echo hints, real subscriptions/worker/blob lifecycle measurements. This report is not a launch-readiness verdict.
