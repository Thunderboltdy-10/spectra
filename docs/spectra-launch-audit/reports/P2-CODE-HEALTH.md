# P2-CODE-HEALTH: dead code, duplication, docs, test health, consistency

- **Branch:** `p2/code-health`, from main `897c824e`. Worktree `<local-workspace>`.
- **Goal:** reduce chaos without changing behaviour. Every change is mechanically verified with tsc, eslint, focused tests, the `check:*` gates and one full Vitest run.
- **Size:** 58 source, test and script files were deleted. Six superseded doc campaigns were archived, not deleted.

## Method

- **Dead code.** A scratch analyzer used the TypeScript compiler API and resolved the `@/*` alias. It walked reachability from the production entries separately from the tests. The production entries were:
  - Next app conventions (`page`, `layout`, `route`, `error`, `middleware`, config files);
  - every Convex module with a registered function, plus `crons`, `http` and `schema`;
  - the `package.json`, CI, Dockerfile and Fly/Railway script targets;
  - the Cloudflare worker.
- **Convex references.** Convex functions count as used when some file refers to them as `api.module.fn`, `internal.module.fn` or the string `"module:fn"`. The search covered `.ts`, `.tsx`, `.mjs`, `.rs` and `.html` files.
- **Before each deletion:**
  - searched for dynamic imports, string paths and doc runbooks;
  - ran tsc and the tests in that area;
  - for Convex, checked `module-graph.test.ts` and `_generated/api.d.ts`.
- **Source-text tests.** A second scratch script parsed every `it` block that reads a source file and asserts on its text with `toContain` or `toMatch`. It matched those assertions against behavioural (render or call) tests and against each other.

## Findings ledger

### Fixed

| # | Sev | Where | Finding / change |
| --- | --- | --- | --- |
| F1 | Med | `convex/spectraOperations.ts` `resumeAfterRegionConflict`, `convex/regionClaims.ts`, `src/app/api/spectra/route.ts`, `data/api.ts`, `collaboration/region-controller.ts` | **The artifact "merge" resolution is retired end to end** (a799b7d6). No UI offered it any more (P2-OUTCOMES). Only a JSON caller could still submit a model-written `mergedInput` that overwrote the operation input. <br>Removed: `merge`, `mergedInput`, the `regionClaims.resolveConflict` mutation, the `resolveRegionConflict` route action and `ArtifactRegionController.resolve`. <br>`schema.ts` keeps `v.literal("merge")` with a comment so existing rows still validate. <br>New test: `api-route.test.ts` "resolves an AI edit conflict only as apply, keep_current or cancel". |
| F2 | Low | `src/components/**`, `src/hooks/**`, `src/stores/editor-store.ts` | **Unrendered legacy UI deleted** (c9753a63). This includes GuidedTour, which is never rendered (lead confirmed), contextual-tip, notification-bell, study-timer, theme-toggle, loading-states, right-side-panel, and seven unused `ui/*` primitives. Also deleted: 3 hooks and the editor store. |
| F3 | Low | `src/lib/**`, `shared/resource-*.ts` | **Pre-Spectra library modules that nothing imports were deleted** (4bf17990). There were 17 files, among them document-generator, document-export, the pdf export, `editor/*`, error-handling and stream-markdown. |
| F4 | Low | `src/features/spectra/**` | **Unreferenced feature modules deleted** (238ff925): sync-status-chip, presence-interaction, floating-menu (and its CSS), isolated-worker-task, the old managebac-adapter, and humanize-native-error. |
| F5 | Low | `convex/memoryEmbedding.ts`, `src/lib/{spaced-repetition,timezone}.ts`, `shared/spending.ts` | **Modules kept alive only by their own unit tests were deleted,** together with those tests (ce7216fe). The generated api entry was removed too (10becdaa). |
| F6 | Low | `scripts/` | **Superseded one-off scripts deleted** (ce77a1ac): codemod-tiny-text, dev-collaboration-gateway (replaced by `serve-collaboration-gateway --supervise`), n3-hash-manifest and spectra-package-harness. |
| F7 | Low | `convex/{regionClaims,changeGroups,spectraOperations,spectraRuns,spectraRuntimeBuilds,authority}.ts` | **Public Convex functions that no client, route, script, cron or Bridge calls were deleted** (2a95de0f): `getOwned`, `commitBeforeAi`, `listForRun`, `unhideResultCard`, `getForVersion` and `listGrants`. Each was public attack surface with no caller. |
| F8 | Low | code, presentation, sheets, timetable and whiteboard studios | **Five copies of the SHA-256 upload hash now use `artifactBlobSha256`** (15c357a3). |
| F9 | Med | 13 files (16 calls), for example `hocuspocus-transport.ts`, `durable-content.ts`, `library-import`, `public-share-shell`, `school-data-shell` | **Raw same-origin `fetch` calls now go through `requestSpectra`** (868796aa). An offline failure now surfaces as `SPECTRA_REQUEST_UNREACHABLE`, the plain-language network message. Before, it surfaced as the browser's "Failed to fetch". `public-share-return.test.tsx` changed its contract to match, with the reason given in the commit. |
| F10 | Low | code, presentation and whiteboard studios | **Three hand-rolled `downloadBlob` copies now call `downloadDocumentBlob`** (7511f43f). The copies revoked the object URL after 1 s, or 0 ms in the whiteboard, without attaching the anchor. The canonical helper keeps the URL for 60 s, so large exports are no longer revoked mid-download. |
| F11 | Low | `docs/spectra-reformation/final-verification/scripts` moved to `scripts/final-verification` | **Executable code no longer lives under `docs/`** (103e97fa). `package.json`, the eslint ignore, `.gitignore` and the relative paths were updated. `test:p8-foundation` passes. |
| F12 | Low | `docs/` | **Six superseded campaign directories were moved to `docs/archive/`** with `git mv` (e15de1a2): hq, nova, reformation, rebuild, definitive and landing. The compendium and three root audit YAML snapshots went with them. `reports/W9-01.md` joined the launch-audit reports. `check-spectra-architecture.mjs` no longer reads the archived baseline inventory. It keeps both live guards, window events and run-route tool growth. |
| F13 | Low | `docs/README.md`, `README.md` | **There is now one canonical engineering overview** (29300fb5). It covers the architecture map, run and test, the binding S11 contracts, where the audit reports live, the open launch risks from all P2 reports, and history. There is also a root README, since none existed. |
| F14 | Low | `field-signals.test.tsx` | **A strictly duplicated source-text test was removed** (82ad7cfe). Every assertion it made survives in the case that follows it. |

### Reported, not fixed

**Dead chains too large or too cross-cutting to delete here:**

- **R1 (Med): the human region-claim chain is dead.**
  - `region-controller.ts:43-47`: `editMany` always returns `applied: true`, so `liveConflict.claimId` is never set.
  - As a result, all of these are unreachable:
    - the claim renew/release effect and branch in `artifact-studio.tsx`, around lines 3613, 5090-5124 and 5263;
    - `ArtifactRegionController.acquire`;
    - the route actions `acquireRegionClaim`, `renewRegionClaim` and `releaseRegionClaim` (`route.ts:1227-1257`).
  - Removing them touches `artifact-studio.tsx` and route.ts, which are shared hot files. It needs one owner.
- **R2 (Low): the `"cancel"` resolution duplicates `keep_current`.** See `convex/regionClaims.ts:162-169` and `spectraOperations.ts:519`. The UI no longer sends it.
- **R3 (Med, silent product gap): the embed context policy is stored but never read.** `convex/artifactEmbeds.ts:1241` `contextContribution` has no caller. The user's embed context policy therefore has no effect on AI context. Either wire it or remove the setting. Reverted here because deleting it strands `visibleRegionExcerpt`.
- **R4 (Low): public Convex functions with no caller, which need an owner decision.**
  - **Probably unfinished flows, and they matter:**
    - `artifactAssets.storeAuthorized` and `artifactAssets.failUpload`: without `failUpload`, an upload can stay "uploading".
    - `bridgeSync.pendingDiscovery` and `bridgeSync.resolveDiscovery`: there is no discovery UI.
  - **Plausibly dead:**
    - `artifactImports.storeOriginalAuthorized`;
    - `audit.listForSchool`;
    - `operatorSessions.listSchools` and `operatorSessions.touch`;
    - `schools.getOperational` and `schools.updateOperational`;
    - `metering.schoolSummary`, `metering.effectivePolicy` and `operationalCounters.schoolSummary`;
    - `agents.cancelCompilerJob`;
    - `memberships.listMine`, `memory.preferences` and `payloads.head`.
  - **Owned by scale:** `administration.createGroup`, `administration.updateGroup` and `managebac.setOverlay`.
  - **Keep:** the ops, backfill, migration and verify functions (operator tools), and `changeGroups.commitRestore` (an intentional throwing tombstone).
- **R5 (Low): unused npm dependencies.** No source imports them. Removing them needs `npm install`, which this lane may not run.
  - The four packages orphaned by F2: `@radix-ui/react-avatar`, `react-scroll-area`, `react-separator` and `react-tabs`.
  - Also: `@ai-sdk/react`, `@openrouter/ai-sdk-provider`, `@tavily/core`, the tiptap `character-count`, `color` and `typography` extensions, `@xyflow/react`, `axios`, `html2canvas`, `simple-icons`, `@types/d3` and `@types/sql.js`.
  - Check `html2canvas` first: it may be an unlisted peer of jspdf.
- **R6 (Low): orphan CSS.** `.right-panel-*` in `src/styles/spectra-app.css:4713` and nearby lines has had no user since F2. A CSS sweep needs visual verification.
- **R7 (Low): scripts nothing references, kept on purpose** as manual or evidence tools that reports and runbooks cite: `benchmark-artifact-preparation.ts`, `fidelity-harness/s8-office.ts`, `local/{preflight,release-word-download,seed}.mjs`, `s10-collaboration-{blockers-repro,probe}.ts`, `shoot-landing.mjs` and `spectra-package-reader.mjs`.
- **R8 (Info): test-only modules, kept on purpose** as conformance harnesses or test barrels: `lenses/seam-contract.ts`, `lenses/corpus-*`, `work/conformance/*`, the capability matrix, and the `index.ts` barrels in `ai/`, `comments/`, `compute/engines/` and `migrations/`.

**Duplication (canonical choice not mechanical, or it would change output):**

- **R9 (Low): relative-time formatters.**
  - Four exist: `administration/shared.tsx:400 formatRelative`, `components/spectra-view-model.ts:47 formatRelativeTime`, `organization/node-identity.ts:87 relativeTime` and `shared/human-format.ts:15 formatElapsedSince`.
  - Their wording differs ("min ago" vs "m ago"), so merging them changes visible copy. Pick `shared/human-format.ts` and migrate one surface at a time.
- **R10 (Low): byte formatters.**
  - Three exist: `administration/shared.tsx:389` (base 1024), `code-studio.tsx:253` (base 1000) and `shared/human-format.ts:1 formatByteCount`.
  - They use different bases and precision.
- **R11 (Low): error-to-message helpers.**
  - Eight per-domain helpers exist: `truthful-state.tsx:229 identityFailureMessage`, `bridge/client.ts:211 pairingFailureMessage`, `artifact-studio.tsx:2557 collaborationFailureMessage`, `conversation-surface.tsx:307 conflictFailureText`, `universal-kbar.tsx:53 commandFailureMessage`, `tree-client.ts:441 treeFailureMessage`, `live-dock-model.ts:135 publicSpectraFailureText` and `invitation-session.ts:78 invitationFailureText`.
  - There are also nine inline `error instanceof Error ? error.message : String(error)`.
  - `describeFailure` (`truthful-state.tsx:254`) is the natural base. Each helper adds domain wording, so consolidation is a copy-review task.
- **R12 (Low): SHA-256 helpers in several layers.** `code/runtime-assets-client`, `code/published-runtime-loader`, `shared/native-ai-commit`, `shared/intake-integrity` (`bytesToHex`), `lenses/docx-lens` (`sha256Payload`), `compute/files` (node crypto) and `convex/managebac`. They run in different runtimes (browser subtle crypto vs node), so one module needs a runtime-neutral API.
- **R13 (Low): raw `fetch` calls left in `use-spectra-run.ts`.** Six raw `fetch` calls remain there. The file is scale-owned, and P2-EXPERIENCE R4 covers the same toasts.

### Test health

- **Source-text tests.**
  - 91 `it` blocks in 41 files assert on source text. 73 of them do nothing else.
  - Only one was a strict duplicate (F14). Literal matching against the behavioural suites found no other real duplicates. The rest are wiring guards: they check that a behaviour-tested helper is actually used by a component.
  - **Keep, as architectural invariants:** `p6-structural-debt`, `agent-loop-extraction` (route stays transport-only), `motion-integrity`, `field-signals` "no continuous JS loop", `replica-truth` probe budget, `calendar-school-administration` indexed reads, `bridge-contract` no raw-path field, `capability-dispatch` same gate, and `render-architecture`.
  - **Brittle mirror tests, to convert to render or behaviour tests when those files are next touched (reported):**
    - `live-dock.test.ts`: 10 blocks, about 110 literals, for example `:271` and `:296`;
    - `honest-execution.test.ts:148`: 16 literals across runtime.ts and spectraRuns.ts, sliced by `indexOf`;
    - `ux-debt-closure.test.ts:61` and `:103`;
    - `managebac-sync-honesty.test.ts:12`;
    - `organizer-interactions.test.ts:128`;
    - `tree-failure-message.test.ts:78`.
  - These tests fail on harmless refactors (renames, line wraps) and pass on real regressions whenever the string survives.
- **Skipped tests.** There is one: `xlsx-run3-materialize-diagnosis.test.ts:15`, `it.skipIf` with no `SPECTRA_XLSX_RUN3_FIXTURE`. It is a manual diagnosis against the private RC `xlsx-run3` file from the reformation P8 matrix. Recorded, not resolved: the fixture is private and cannot be committed. There are no `.todo`, `describe.skip` or `xit` tests.
- **Full run.** 435 files and 4001 tests: 4000 passed, 1 skipped (the one above). Wall time 325 s, with `--maxWorkers=3`.
- **Slowest files:**

  | Time | File |
  | --- | --- |
  | 30.2 s | `run-route.test.ts` (two cases at 7.7 and 8.2 s, with a 60 s budget) |
  | 16.4 s | `durable-office-model.test.ts` (one 200k-cell case at 16.2 s, with a 60 s budget) |
  | 13.0 s | `docx-lens.test.ts` (47 cases) |
  | 12.6 s | `convex/analytics-bounded.test.ts` (12.5 s, with a 60 s budget) |
  | 10.4 s | `convex/s11-catalog-discovery.test.ts` (120 s budget) |
  | 7.3 s | `convex/s11-catalog-graph.test.ts` |
  | 6.6 s | `clarification-staged-continuation.test.ts` |
  | 5.5 s | `convex/module-graph.test.ts` |

- **Flaky-under-load candidates.** These cases run on the default 15 s `testTimeout` with less than 3× headroom at `maxWorkers=3`:
  - `clarification-staged-continuation.test.ts:86`, 6.5 s, no explicit budget: the likeliest to time out on a slower CI runner;
  - `ai-live-write-admission.test.ts`, 3.4 s;
  - `scripts/collaboration-delta.test.mjs`, 4.2 s;
  - `scripts/check-deploy-env.test.mjs`, 3.6 s (spawns processes);
  - `managebac/__tests__/provider-fixture-route.test.ts`, 3.1 s.

  The heavy convex-test fixtures (`analytics-bounded`, `s11-catalog-*`, `s10-catalog`, `module-graph`, account-erasure lifecycle) already carry 60–120 s budgets.

### Consistency (reported, no mass rename)

- **C1: error codes.** Convex and the routes use three conventions side by side:
  - a bare code, `new Error("CODE")`, about 1,190 sites;
  - a code plus a message, `"CODE: Plain sentence."`, about 320 sites;
  - a plain sentence with no code, about 450 sites, 178 of them in Convex, for example `spectraRuns.ts:513-534` and `orgTree*.ts`.

  There is no `ConvexError` anywhere. Client mappers therefore parse message prefixes, and a plain-sentence error cannot be mapped or localized. The recommended convention is `CODE: sentence` everywhere. Enforce it with a lint rule on new code rather than a mass rename.
- **C2: logging.**
  - `src/lib/logging.ts`, the structured logger with request id, is used only by `src/lib/route-handler.ts`.
  - 21 src files (60 calls) and 3 Convex files (13 calls) use raw `console.*`, including the whole run loop (`run/loop/*.ts`, `runtime.ts`), `webhooks/clerk`, `invitations.ts` and `lenses/office/route.ts`.
  - Run-loop logs therefore carry no request id. Routing them through the logger belongs to the scale and ai-quality owners.
- **C3: Convex module naming.**
  - Every function module is camelCase, which is consistent.
  - Only 9 of 86 Convex test files follow `<module>.test.ts`. The rest use kebab-case topics (`managebac-*`, `ai-*`) or campaign prefixes (`p9-*`, `s10-*`, `s11-*`, `s7-*`, `w7-02-*`, `w9-02-*`).
  - 34 of 344 src and scripts test files also carry campaign prefixes. A campaign prefix says when a test was written, not what it guards.
  - Rename them only when the file is next edited.
- **C4: package.json scripts.** All script targets exist after the moves (checked mechanically). `inventory:spectra` now writes into `docs/archive/spectra-definitive/generated/`.

### Reviewed and rejected

- **Delete `changeGroups.commitRestore`:** rejected. It is an intentional tombstone that throws with a pointer to the new restore path.
- **Delete the ops, backfill and verify Convex functions:** rejected. They are operator tools run from the dashboard.
- **Delete `schema.ts` `v.literal("merge")`:** rejected. Existing rows must still validate.
- **Rewrite archived markdown links:** rejected. They are historical text. Only code and config references were updated. `docs/README.md` says archive links are relative to `docs/archive/`.

## Gates and tests

- `tsc --noEmit -p tsconfig.json`: clean, after every code group and at the end.
- `eslint --max-warnings=0` on every touched source and test file: clean.
- `check:architecture`, `check:copy`, `check:design-tokens` (1034 files, 0 warnings), `check:capabilities` and `check:secrets` (3208 files): all pass.
- **Focused tests:** api-route, conflict-resolution, regionClaims, module-graph, ai-run-lifecycle, 21 fetch-related suites, public-share-return, native-download-handoff, render-architecture, settings-compute-files, field-signals, foundation and reformation-evidence. All pass.
- **Full Vitest** (`--maxWorkers=3`): 434 files passed, 1 skipped; 4000 tests passed, 1 skipped.

## Needs live verification

1. **Offline toasts from the switched fetch callers (F9):** library import, the class shelf, public share, school data and code-studio export. With DevTools offline, each should show the plain "could not reach the server" message.
2. **Large exports after F10:** a presentation slide zip, a code WebM recording and a whiteboard PNG. Each should download completely in Chrome, Safari and Firefox.
3. **Resuming after a region conflict (F1):** "Apply" and "Keep current" both still resolve in the browser. There is no longer any way to submit a merge.
4. **`npx convex codegen` against the deployment:** confirm that `_generated/api.d.ts` matches the hand edit (memoryEmbedding removed).
5. **`next build` in the primary checkout:** a junctioned worktree cannot run it. Confirm that no deleted component was reached only through a build-time path.

## Shared files touched

- `src/app/api/spectra/route.ts` (the merge action and region-conflict branch removed)
- `src/features/spectra/data/api.ts`
- `artifact-studio.tsx`
- the code, presentation, sheets, timetable and whiteboard studios
- `document-studio.tsx`
- `convex/{schema,spectraOperations,spectraRuns,regionClaims,changeGroups,authority,spectraRuntimeBuilds}.ts`
- `convex/_generated/api.d.ts`
- `package.json`
- `eslint.config.mjs`
- `.gitignore`
- `scripts/check-spectra-architecture.mjs`
- `scripts/generate-spectra-inventory.mjs`
- `src/styles/spectra-app.css`
- the tests `live-dock.test.ts`, `api-route.test.ts`, `public-share-return.test.tsx` and `field-signals.test.tsx`
