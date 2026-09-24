# S10-OPEN — artifact loading and editor lifetime

Date: 2026-09-24. Owner: `01a0d338-369b-7c91-a43c-b0518abc691a`.
Status: **source checkpoint ready for coordinator typecheck/build and scheduled live acceptance**. No browser, Office, shared runtime, or deployment mutation was performed by OPEN. No commit/stage/reset/stash/branch change. The inherited dirty baseline is preserved.

The initial session was workspace-write with restricted network. After the coordinator's permission changes and Continue, the effective session explicitly became danger-full-access / approval never. Earlier internal messages rejected while restricted were resent successfully. This report does not retroactively describe the initial session as Full Access.

## Findings and changes

- The individual type studios were already dynamic and selected by blueprint. The common studio nevertheless eagerly imported TipTap React, StarterKit, extensions and the equation node. `ArtifactRichTextEditor` now loads its implementation dynamically; its existing public export and props remain compatible. The duplicate fire-and-forget type-module prefetch effect was removed. Selected imports remain cached by the module loader; no content-wide prefetch was added.
- `sheets-studio.tsx` eagerly imported Recharts even for workbooks without charts. Chart data functions moved intact into `sheets/chart-dataset.ts`; `SheetsChartView` and Recharts now load only when an actual chart renders. The existing `chartDataset` export remains available to callers/tests. No cell data or chart source range is truncated.
- The studio previously acknowledged viewport readiness in a parent rAF before the lazy editor existed. A context-bound hook now acknowledges after the selected child commits and a frame runs. Documents wait for the TipTap instance. Closing/unmounting cancels the pending frame. Opening comments no longer proves editor readiness. The DOM contract is `[data-spectra-studio="<artifactId>"][data-spectra-editor-ready="true"]`. This is initial editor viewport readiness, distinct from full media loading, transport sync, canonical persistence and native verification.
- Route side-panel requests could reopen an older selection after a newer request or close. `createLatestStudioLoad` owns one in-flight selection, shares concurrent requests for the same ID, aborts superseded detail fetches, suppresses late success/failure, and revalidates after completion. There is no resolved body cache. Route cleanup, close and fullscreen transfer cancel the work request; conversation requests use the same result fence. LIBRARY transferred the exact `getSpectraArtifact` optional `options.signal` API hunk to OPEN.
- Reconciliation repeatedly serialized the same large immutable React snapshots. COLLAB reviewed the snapshot contract and approved a per-mounted-editor WeakMap that preserves the exact JSON comparison key. Incoming reconciliation also reuses its already-computed key. It is not used for mutable Yjs objects. Weak keys do not retain old snapshots; no acknowledgment or authoritative update is dropped.
- Document PDF imports retained pdf.js document/worker resources. `readPdfTextPages` preserves blank-page positions, cleans each page and destroys the loading task on success, page failure and initial parse failure. LIBRARY owns the analogous import cleanup in `organization/library-import.ts`. ResourceSurface receives a stable artifact identity key to avoid sharing its transient state across different files.

## Current evidence

Raw evidence: `.spectra-local/launch-audit/evidence/S10-OPEN-20260924/`.
Reproduction scripts: `.spectra-local/launch-audit/s10-open-measure.ts` and `s10-open-import-graph.cjs`.

The CPU fixture is the retained disposable S9 workbook request body, read locally without changing any workbook or server state. Node v24.11.1, measured 2026-09-24 12:37 UTC:

| Measurement | Result |
| --- | ---: |
| Input UTF-8 bytes | 43,680,379 |
| Complete snapshot key UTF-8 bytes | 43,680,467 |
| Parse body once | 286.485 ms |
| First key, old uncached function | 228.125 ms |
| First key, new cache | 206.203 ms |
| Eight repeated keys, old function | 1,977.391 ms |
| Eight repeated keys, new cache | 0.0171 ms |
| Cached key equals original JSON exactly | true |

This is a local CPU microbenchmark, not browser open latency or a heap measurement. First serialization remains proportional to body size. It does not establish Yjs hydration cost or network savings.

Static runtime-import traversal at 12:41 UTC confirms that shared `artifact-studio` no longer reaches `@tiptap/react` or `editor/equation-node` eagerly, and `sheets-studio` no longer reaches Recharts eagerly. The historical entry imports used for comparison match the inherited eager edges inspected before editing. The traversal excludes type imports, dynamic imports and package internals. It is not a production bundle measurement. Shared comments/chat still bring `rehype-katex`; the application still needs that formatting dependency.

Focused verification, one Vitest worker:

- `studio-viewport-ready.test.tsx` + `document-native-projection.test.ts`: 15 tests passed in the first run. Delayed lazy fallback remains pending, actual mount/frame completes, and unmount prevents stale readiness.
- `latest-studio-load.test.ts`: 3 passed. Covers in-flight deduplication, abort, late results/errors, close, retry, A → B → A, fresh shorter and empty results.
- `sheets-chart.test.ts` + viewport + request filters: 7 passed. Existing calculated chart-dataset behavior survives extraction.
- `studio-snapshot-cache.test.ts` + `remote-studio-incoming.test.ts` + `artifact-reconciliation.test.ts` filters: 62 tests across 5 matching files passed. Covers exact serialization, shorter/empty replacement, changed metadata and authority provenance alongside existing reconciliation controls.
- `pdf-text-pages.test.ts` + `document-native-projection.test.ts` filters: 28 tests across 3 matching files passed in the final run. PDF lifecycle covers success, blank pages, failed page text and failed initial parse. The larger matching-file counts include neighboring tests selected by Vitest's filename filters.
- Scoped ESLint on 15 changed component/helper/test files with `--max-warnings=0`: passed. An unused extraction type and three new hook dependencies were corrected before this pass.
- Scoped `git diff --check`: passed. Impeccable detector on the changed UI targets: `[]`.

No global typecheck, production build or current live cold/warm matrix was run by this lane; coordinator owns those slots. The coordinator subsequently reported the integrated root TypeScript check passed; this is coordinator evidence, not an OPEN command.

## Historical evidence and current live requirements

S9-DURABLE reports workbook open-to-grid-plus-settle of 13,142 ms cold and 12,859 ms repeated, a 43,680,686-byte final canonical body and a 200,000-cell input. Those are historical measurements at the S9 revision, not S10 results. S9 Word/native fidelity and durability evidence remains separate as well.

| Case | Current source support | Current S10 live result |
| --- | --- | --- |
| Native DOCX / ordinary document | Selected lazy studio; readiness waits for TipTap | Not run |
| Large sheet without charts | Recharts deferred; repeated immutable keys cached | Not run |
| Deck / presentation | Selected lazy studio; initial committed viewport predicate | Not run |
| PDF imported as document | Editable extracted text; pdf.js resources disposed | Not run |
| Retained native PDF resource | Existing ResourceSurface shows file identity; there is no PDF page renderer | No page-ready claim possible |

PERF has the readiness predicate and the distinction between imported PDF text and a retained native PDF. Requested live measurements remain unassigned. Record fresh/warm module transfer, content bytes, query calls, long tasks, repeated-open retained memory and separate canonical/native readiness on disposable fixtures. First viewport does not imply all DOCX images or every deck asset finished loading.

## Ownership and remaining limits

OPEN's full files: `components/artifact-rich-text-editor.tsx`, `components/studio-viewport-ready.tsx`, `components/latest-studio-load.ts`, `components/route-side-panel-host.tsx`, `components/sheets-studio.tsx`, `components/sheets-chart-view.tsx`, `components/artifact-studio-value-utils.ts`, `sheets/chart-dataset.ts`, `editor/pdf-text-pages.ts`, four new test files, and this report.

Shared files require hunk-aware integration: `artifact-studio.tsx` retains inherited native-copy/save changes; OPEN owns loading/readiness/snapshot-key hunks. `document-studio.tsx` has OPEN's readiness import/hook and PDF helper call plus REVIEW-OFFICE's separate review-rail accessibility hunks. `data/api.ts` has OPEN's exact `getSpectraArtifact` signal hunk plus LIBRARY work.

- LIBRARY owns the previously unbounded `spectra-shell` hydrated artifact cache, stale metadata merge and summary/detail separation. OPEN did not edit those shell sections.
- COLLAB owns model/transport hydration, save paths and local Yjs cache. Its tested same-key close barrier is separate from OPEN's changes.
- The existing `localSyncKeysRef` set can retain full JSON keys for unconsumed acknowledgments. It remains uncapped: COLLAB explicitly declined dropping such keys without a certified acknowledgment strategy. The WeakMap does not solve this retention boundary.
- DATA/REVIEW-DURABLE retain content endpoint authorization, digest/byte validation and native/pinned ownership. No server hydration/authentication contract changed here.
- No current S10 evidence establishes macOS, production, multi-session editing, native write/readback or crash recovery. The live matrix and retained-memory check remain launch evidence gaps.

## Follow-up: scoped acknowledgment identity proposal — product source held for build

Coordinator requested immediate repair scoping for `localSyncKeysRef`, and COLLAB is reviewing this proposal. Exact leak causes: successful `synchronizeDraft` retains its pre-normalized key indefinitely if no identical echo is observed; its normalized key can remain even though completion already installs that same acknowledgment as the baseline. Full restore inserts a speculative key and does not remove it on queued/failure paths. Current model snapshots expose no revision/update ID, and transport `unsynchronizedChanges` is not a causal identity.

The proposed smallest repair is an operation-scoped echo tracker: serialize save/restore ownership, permit exact snapshot matching only during that operation, explicitly consume the normalized `model.flushSnapshot()` result into the baseline at successful completion while preserving newer input, and retire all operation aliases on completion/failure. A failed operation retains its real local/Yjs draft; a speculative UI echo hint is not durability. A captured stale React projection must also be rejected if it is no longer the model's current snapshot before aliases are retired. Restore needs the same explicit acknowledgment-consumption path. This gives a bound tied to active operations, rather than dropping old unseen acknowledgments on a timer or capacity limit. A digest alone would leave the unbounded entry-count bug.

Required proof before changing the held product files: normalized local echo versus remote changes, intentional shorter/empty restore, newer local keystrokes during an acknowledgment, late captured projection effects, queued/failing restore cleanup, reconnect/retry and repeated completed saves with zero retained hints. No implementation of this proposal is claimed yet.
