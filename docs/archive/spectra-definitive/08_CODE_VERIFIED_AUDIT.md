# Code-Verified Audit — 2026-08-09

**Status:** Reference audit — supersedes no plan; supplements the ledger and goal checklist with verified-on-disk evidence  
**Method:** 30 read-only inspection agents (deep exploration + execution of verification commands), cross-checked per requirement ID against `SPECTRA_DEFINITIVE_TRANSFORMATION_PLAN.md`, `02_IMPLEMENTATION_LEDGER.md`, `03_MIGRATION_LEDGER.md`, `04_DEFECT_LEDGER.md`, `05_REQUIREMENT_TRACEABILITY.md`, `07_GOAL_CHECKLIST.md`  
**Head commit audited:** `42bdb19` (merge PR #94; working tree clean except `package-lock.json`)  
**Scope:** all of `src/`, `workers/`, `convex/`, `shared/`, `scripts/`, `docs/spectra-*`, root config  
**Rule followed:** every verdict below is based on actual code/tests executed or read — not on checkbox claims

---

## 1. Executive summary

The transformative plan (Phases 0–16) is **~85% implemented in code**. Ledger state ("0–11 Complete, 12–16 Pending") broadly reflects work volume, but the ledger overstates completeness in specific places and understates Phase 14 motion. Specific conclusions:

- **Verification gates today:** `tsc --noEmit` = 0 errors; `next build` = green (27/27 pages); `npm run test:run` = **648/650 pass, 2 fail** (both in `src/features/spectra/__tests__/native-yjs-models.test.ts`); `npm run test:realtime` = 11/11; `wrangler deploy --dry-run` = green; `check:architecture`/`check:copy`/`check:design-tokens` = pass; **`npm run lint` = FAIL (9 errors, 7 warnings)**.
- **Phases 0–11 "Complete" contains real functional holes:** steering is never applied server-side; feature flags are scaffolding; 7 of 8 work types edit via whole-work JSON projection (not live-native Yjs); the Agent Foundry publish gate is unreachable via the normal Foundry flow; the Compute Broker gates only autocomplete; most settings fields have zero runtime consumers.
- **Phases 12–16 are largely implemented but ungated:** Phase 12 has no acceptance matrices, no benchmarks, one jsdom test, no Convex function tests, no dependency-cycle check, one defect still Open. Phase 13 tokens exist but ~800 arbitrary text sizes and 786 hardcoded hex remain. Phase 14 motion is substantially built (ledger says "Pending"). Phase 15 prism is real but untested for fallbacks/perf. Phase 16 cleanup inventory is well-defined (~35 verified-dead files).
- **Security blocker:** three live API keys are committed to git history in `opencode.json`, `opencode1.json`, `opencode2.json`. Rotate, delete, and scrub history before release.
- **Operational reality shift:** the AI worker and ManageBac worker scripts referenced by the acceptance campaign no longer exist; background runs now use Convex scheduler + HMAC callbacks back into the Next app.

---

## 2. Verification command results (executed 2026-08-09)

| Gate | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | **PASS** — 0 errors |
| Production build | `npm run build` | **PASS** — Next 16.2.9, 78s, 27/27 static pages |
| Full test suite | `npm run test:run` | **FAIL — 650 tests: 648 pass, 2 fail, 0 skipped** (70 files, 30.65s) |
| Realtime worker tests | `npm run test:realtime` | **PASS** — 11/11 (workers/collaboration/tests/room-core.test.ts) |
| Wrangler dry-run | `npm run build:realtime` | **PASS** — 304.67 KiB upload; DO binding `COLLABORATION_ROOMS` |
| Architecture guard | `npm run check:architecture` | **PASS** — legacy event baseline frozen (24 names); embedded run-route tools ≤ 11 |
| Copy gate | `npm run check:copy` | **PASS** (but too narrow — see §5.6) |
| Design tokens | `npm run check:design-tokens` | **PASS** (23 warnings: hardcoded hex in className) |
| Lint | `npm run lint` | **FAIL — 9 errors, 7 warnings** (see §3.2) |

### 2.1 Failing tests (2)

Both in `src/features/spectra/__tests__/native-yjs-models.test.ts`:

1. **"keeps quiz attempts and flashcard study progress outside authored Yjs source"** (line ~290) — `extractLegacyFlashcardStudyState` no longer returns the card's `review` field (`{ correctStreak: 8, state: "mastered" }` missing; only `confidence: 'strong'` present). The normalization dropped `review`; the test was not updated.
2. **"supports collaborative Agent mission, evidence, dynamic sections, and release drafts"** (line ~375) — `structuredText(document, ["mission","objective"])` returns `undefined`; `normalizeFoundryContent` moved mission under the `foundry.*` root, so agent `workDraft` reads the wrong path.

Root cause pattern: **normalization code changed after the tests were written (deck/agent normalization drift).** These two tests are the single most important "fix me before running the campaign" item.

### 2.2 Lint failures (9 errors)

| File:line | Rule | Detail |
|---|---|---|
| `src/features/spectra/ai/yjs-artifact-operation.ts:258` | prefer-const | `rawProvider` never reassigned |
| `src/features/spectra/calendar/ui/calendar-application.tsx:313` | react-hooks/purity | `Date.now()` during render |
| `src/features/spectra/components/live-dock.tsx:481` | react-hooks/refs | Ref value accessed during render |
| `src/features/spectra/components/spectra-rich-content.tsx:28` (×2) | react-hooks/refs | `parser.current` passed into useMemo |
| `src/features/spectra/pages/artifacts-shell.tsx:868` | react-hooks/purity | `Date.now()` during render |
| `src/features/spectra/pages/artifacts-shell.tsx:1708` | react-hooks/purity | `Date.now()` during render |
| `src/features/spectra/pages/school-data-shell.tsx:327` | react-hooks/purity | `Date.now()` during render |
| `src/features/spectra/runs/streaming/use-streaming-reveal.ts:91` | react-hooks/refs | `schedulerRef.current` during render |

Warnings (7): no-unused-vars (`yjs-artifact-operation.ts:13` `planArtifactYjsMutation`), exhaustive-deps ×3 (artifact-tile-surface, code-studio, route-side-panel-host), `@next/next/no-img-element` (spectra-rich-content), jsx-a11y aria (workbench-split-tree), import/no-anonymous-default-export (worker.ts).

---

## 3. Phase-by-phase findings

### 3.0 Phase 0 — Canonical programme (ledger: Complete)

**Verified:** `docs/spectra-definitive/` (8 ledgers + inventory), superseded-plan headers on all competing plans, 8 compatibility adapters in `src/features/spectra/migrations/compatibility.ts`, typed protocol versions (`migrations/protocol.ts`), deterministic inventory script, `baseline-inventory.json` (2,893 lines).

**Findings:**
- **Feature flags are scaffolding only.** `SPECTRA_MIGRATION_FLAG_KEYS` (12 keys, default-off) exist and are tested, but `resolveSpectraMigrationFlags` is read **only by tests** — no production path reads a flag. `MigrationFlagScope` is unused. Nothing is actually switchable.
- `installLegacyWindowCommandBridge` (`events/legacy-window-bridge.ts`) is never installed/imported in production — the required "temporary bridge" is dead code.
- Inventory derivation is regex-based (heuristics, 600-char caps) — silently misses patterns; no test runs the generator.
- "449 tests green" is a claim; the current suite is 650 tests with 2 failures.
- Duplicate canonical-path disagreement: `compatibility.ts:12` maps `/memory` → `/settings/privacy-data` while `workbench/engineering/routes.ts:1–6` and the page redirect to `/settings?section=privacy`.

### 3.1 Phase 1 — Architectural kernels (ledger: Complete)

**Verified:** work registry V2 (433 lines, full `WorkDefinition` contract), typed event/command bus with 13+ production consumers, capability-truth result type, run-route decomposition (12,870-line orchestration shell delegating to `ai/model-config`, `ai/context-builder`, `ai/agent-loop`, `tools/`, `runs/streaming/`, `compute/files/`, `agents/foundry`), session controllers.

**Findings:**
- 7 of 8 studio controllers in `work/session/controllers.ts` are exercised **only by tests**; `artifact-studio.tsx` imports just `projectLegacyWorkSession`. The "monoliths delegate meaningful responsibilities" exit gate is partial for the studio.
- Planned boundaries that do not exist as dirs (adaptations undocumented in the ledger): `runs/summaries`, `references/renderers`, `settings/scopes` (editors), `actions/choreography`, `actions/recovery`, `tools/permissions`, `tools/telemetry`, `realtime/protocol`, `realtime/awareness`.
- `run/route.ts:9608–9610` still emits the legacy run-event envelope (temporary rendering/history adapter until Phase 12 gate).

### 3.2 Phase 2 — Cloudflare realtime (ledger: Complete)

**Verified:** full DO implementation (`worker.ts` routing, `room.ts` 200-line DO class with JWT upgrade gate + alarm drain, `room-core.ts` 255-line RealtimeRoomCore with applyUpdate pipeline, `ydoc-store.ts` SQLite store, leases/claims/awareness registries, `projection-outbox.ts`), 11 substantive room tests, provider tests (5), provider-factory, wrangler config.

**Findings (the "Complete" claim overstates):**
1. **No shared transport conformance suite** — exit criterion C1 (plan §2.11) requires a suite running against both providers; only provider-specific tests exist; `HocuspocusArtifactTransport` has no test file at all.
2. **No local Cloudflare dev path.** `npm run dev` = Next + Hocuspocus gateway on 1234 only. Document/code default to `cloudflare` provider → `ws://localhost:8787` → nothing listening → doc/code sessions sit "reconnecting/unsynchronized" in local dev. No `wrangler dev` script anywhere.
3. **Cross-room authorization hole.** `room.ts` verifies JWT signature/expiry but never binds `claims.workId`/`claims.roomId` to the DO's own `roomName` — a token signed for artifact A opens any `/rooms/B`.
4. **Permission-epoch revocation is inert.** `setPermissionEpoch` exists and is tested, but `CollaborationRoom` never exposes it; production builds rooms with no epoch → epoch check in `applyUpdate` is a no-op. Revocation effectively happens only at token expiry.
5. `migrations/0001_initial.sql` is never executed — schema is hand-duplicated in `room.ts` SCHEMA; no migration runner/versioning.
6. **Hibernation wake restores claims but not interaction leases** (plan §2.6 requires both; lease registry starts empty after wake; `acquiredAt: 0` breaks restored-claim expiry math).
7. **Projection outbox lacks the plan's payload** (`WorkProjectionEvent` with projectionHash/changeGroups/sourceActors is never built); no near-Convex endpoint configured, so `PROJECTION_ENDPOINT_UNAVAILABLE` causes infinite backoff retries.
8. Tests run in plain Node — no workerd/Miniflare usage despite plan §2.12 calling for it; wake-from-hibernation tested only with mocked sockets; worker fetch/routing and upgrade/auth flows never exercised; `canMutate` is dead code.
9. No recorded dry-run evidence despite the ledger claim (script exists; no CI, no logs).
10. Env: `.env.example` lacks `NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME` and `SPECTRA_CLOUDFLARE_COLLAB_URL`; `wrangler.toml` `[vars]` declares `SPECTRA_COLLAB_PROTOCOL_VERSION` which no code reads; DO requires `SPECTRA_COLLAB_TOKEN_SECRET`, `CONVEX_PROJECTION_URL`, `CONVEX_PROJECTION_TOKEN` with no `.dev.vars`/secrets docs.

### 3.3 Phase 3 — Native Yjs models (ledger: Complete)

**Verified:** native doc/code bindings (Tiptap `Y.XmlFragment("spectra:document-v2")`, CodeMirror `yCollab` per-file `Y.Text`), adapters for all 10 work types with migration round-trips, local durability (IndexedDB, quotas, `pendingRemoteSync`), offline merge by state-vector, AI wait/resume (`waitForHumanRegions`, `rebaseAfterHumanWait`), no focused `setContent` reset, IME guards.

**Findings:**
1. **Only document and code are live-native in the studios.** Sheets, presentation, whiteboard, quiz, flashcard, plan, agent, timetable edit via React JSON state → debounced whole-work `applyProjection` into Yjs. The ledger's own traceability note ("Structured-work studios retain their projection adapters until dedicated Phase 11 UI passes") is still accurate while Phase 11 is marked Complete. Concurrent-edit quality for those types is coarser (synchronization granularity = whole-document).
2. **`CollaborationCoordinationController` is dead code** — the three concurrency policies are fully implemented in the transport/worker layer and enforced for the AI path, but **no human/human control path (dropdowns, canvas gestures, fields) acquires a lease or claim through it**. COLLAB-012/013/014 are runtime-gapped for humans.
3. **Actor-aware undo is not wired into the editors.** Origin-filtered `Y.UndoManager` built per adapter is created but never handed to Tiptap/CodeMirror; the running editors use the default (all-origin) undo — remote/AI steps can enter the local undo stack. COLLAB-019 partial.
4. No dedicated IME composition test exists.
5. Persistence caps at 8 MB/work (`quota_exceeded` stops persisting; no growth/repair path).
6. "108 focused tests" is not reproducible from any manifest (several plausible sums exist; repo-wide suite is 650).
7. Plan checkboxes COLLAB-005..022 are still `- [ ]` in the plan while checklist + ledger claim Complete — documentation contradiction.

### 3.4 Phase 4 — AI Action Protocol (ledger: Complete)

**Verified:** RunItem V2 discriminated union (17 kinds), 14-state run state machine, Tool Registry V2 (full shapes + Zod-generated provider schemas + approval/risk), bounded ToolResult (24 KB), parallel-safe read batching (concurrency 4), serialized mutation domains, retry/cancel policies, recoverable-error continuation, 8 user-input tools, semantic action with pre/postconditions, streaming reveal, Luna model profile (`openai/gpt-5.6`, separate reasoning profile, `allow_fallbacks:false`), dormant legacy visual prepass, Parallel search (20 results, max_uses 1, high context), adaptive depth 1/2/5 with early stop, full-source fetch with SSRF guard + PDF segmentation + evidence spans. **The "64 focused tests" claim reproduces exactly** (13+5+14+3+29).

**Findings:**
1. **Steering never applied (AI-012).** `runs/steering/steering-queue.ts` has no production importer; `steer_queued` events are persisted and echoed ("Will apply after the current step") but **no server path flushes the queue at a safe boundary**; resumed runs do not replay steer events from Convex either. The client emulates steering by starting a new run after the current ends (see §3.5).
2. **`verifyCitation` has no run-route call-site.** web_search returns verified handles; nothing binds `submit_plan` final text citations to them. Verified-inline-citation enforcement is exercised only in unit tests.
3. `checkpoint` RunItem is schema-only — the operation never emits a checkpoint protocol event (Convex changeGroups snapshots exist but no RunItem).
4. Approval UI: `requireApproval` enforced in executor, but the 8 input tools register `inputSchema: jsonObject` — rich per-kind shapes never reach provider schemas.
5. Office-to-PDF is text-layout only (jsPDF heading lines) — NOT a faithful slide/element render (AI-016 partial).
6. `resumable` flag is metadata-only; resume is run-level, not per-tool.
7. Dual state sources of truth: protocol RunStateMachine (in-flight) vs `spectraRuns` statuses (durable) — adapters exist, acknowledged as Phase 12/16 projection.
8. 6 env vars read but undocumented in `.env.example`: `SPECTRA_JUDGE_MODEL_ID`, `SPECTRA_AGENT_MANIFEST_SIGNING_KEY`, `NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME`, `SPECTRA_CLOUDFLARE_COLLAB_URL`, `RESEND_API_KEY`, `INVITE_FROM_EMAIL`, plus `CLERK_PUBLISHABLE_KEY` (non-prefixed).

### 3.5 Phase 5 — Live Dock / conversations (ledger: Complete)

**Verified:** same renderer for `/chat` + right panel (`ConversationSurface`/`ThreadConversation` genuinely shared by chat-shell, live-thread-panel, run-detail-panel, artifact-studio), send does not auto-open panel (test-asserted), compact tab model with exact title/status/semantic-step, hover info bounded, required-input auto-expands (choice/approval/short-answer; `file` branch unreachable — no producer), multi-run with per-thread tabs and close-preserves-job, 10 truth states, `stop` as the only cancellation, responsive mobile sheet, 60 runnable tests (ledger "59" substantively accurate).

**Findings:**
1. **Steering (RUN-012) is PARTIAL at runtime.** Confirmed: endpoint persists `steer_queued` + NDJSON ack only; `SteeringQueue` unused; `use-spectra-run.ts:1009–1056` steers by polling until the run ends, then starts a **new run** with the steer text. The mid-run "Will apply after the current step" copy is aspirational. Steer events also never render in the conversation timeline (RUN-012/5.6 "show in timeline once accepted" missing).
2. **Settings preferences without consumers:** `openConversationAfterSend`, `continueCurrentConversation`, `autoRouteSpecialists` are schema+UI only — no runtime code reads them; the defaults happen to match the spec by accident.
3. No confirmation dialog when closing a running tab — closing just hides (tooltip claims "keeps working"); no cancel-continuation option.
4. `requiredInput` kinds: `permission`/`context-target` unmodeled; `file` unreachable; only `choice` is server-synthesized.
5. Removed auto-open effect verified; but `skipAutoContinueThreadIdRef` in workspace-shell auto-selects the composer thread when a panel opens (partial conflict with explicit-control principle).
6. Session split between `/chat` selection state and dock duplication risk: LiveThreadPanel instantiates its own `useSpectraRun` unless `parentLiveExchange` guard is passed (2234–2241); no test asserts single-stream ownership.
7. No server tests for abort/suspend, concurrent runs, mid-stream retry, or required-input resume end-to-end.

### 3.6 Phase 6 — Workbench/routes (ledger: Complete)

**Verified:** `/library` + `/workspace/:id` distinct with shared persisted session (`spectra:shared-workbench:v2`), legacy redirects (`/artifacts`, `/timetable`, `/memory`) with query preservation, single sidebar DOM, split-tree layout manager with min-sizes + tab fallback + keyboard ops, route-local side sessions for /calendar,/agents,/school,/analytics, fullscreen→Library transfer, one global search, Inspector V2 (Overview/Comments/History) in Workspace, SelectionActionBar for consistent selection, container-query responsive contracts, conformance floor 320px. All 9 workbench-v2 tests verified.

**Findings:**
1. **Inspector V2 absent from Library.** Overview/Comments/History tabs wired only in workspace-shell (line 2825); the Library workbench (ArtifactStudio) has no inspector. SURFACE-013/014 partial.
2. Session persistence partial: only `surface` + `openPanes` are written from UI; `inspector {tab,width}` and `auxiliaryThread` are model-only (SURFACE-005/008 partial).
3. Overview gaps vs §6.10: no source freshness, no embedded/embedding relationships, no artifact-level recent activity, no work settings; hint only for unplaced work.
4. Fullscreen transfer restores identity/thread but not persisted split layout.
5. **8 live user-facing legacy strings** escape the copy gate: "Open artifact" (object-library.tsx:453; conversation-surface.tsx:1554), "Timetable" type badge (artifact-card.tsx:114), "Timetables" filter (object-library.tsx:71), ICS "Spectra timetable" (timetable-studio.tsx:1582), meta/description strings in `src/app/page.tsx:9`, `src/app/public/page.tsx:6`, `src/app/join/page.tsx:64`. Gate checks only 5 files with narrow patterns.
6. Dead legacy surfaces remain in source: duplicate collapsed `<aside>` (app-shell.tsx:734–1004 behind `{false && …}`), `memory-shell.tsx`, `timetable-page-shell.tsx`, `ArtifactBlueprintSheet` ("Create artifact" strings).

### 3.7 Phase 7 — References/context/sources/comments (ledger: Complete)

**Verified:** semantic anchor protocol + per-type adapters, ReferenceNode model with collapsed/expanded state, work-specific contracts, document insertion (Tiptap node, slash command, paste, context picker, embeds panel), permission-aware semantic index, SourceRecord/EvidenceSpan with `verified: true` invariant + `verifyCitation`, unified rich-content AST (v1) with 13 surfaces + `SpectraRichContent` and incremental streaming parser, comment model with general + anchored comments (Convex `regionId` required), click-to-reveal via `work.revealAnchor` + single restrained pulse, orphan re-anchor flow, no floating bubbles. 12 tests in `references-context-sources-v2.test.ts` verified (the "35 focused regression tests" is not attributable to a file list).

**Findings:**
1. **In-document reference preview missing** — `SpectraReferenceNode` has no NodeView; expanded state is attribute-only; full preview only in the References panel (REF-003 partial).
2. **Insertion is documents-only** — `reference.insert` handler registered only by the document editor; no slide/board/sheet insertion UI; board-capture flow exists but is test-only (REF-005/006 partial).
3. **No user-facing citation-insertion UI** — citations come only from the AI; no UI attaches a verified SourceRecord at insert time (SOURCE-005 partial).
4. Semantic index wired to nothing: `PermissionAwareSemanticIndex` is in-memory, test-only (CTX-004 MISSING in runtime; CTX-002 has a single ROOT context source registered).
5. SOURCE-007/008/009/010 (sheets/board/quiz/code provenance) are contract-level only — no studio UI.
6. Code studio has comments via shared panels but no anchored reference/context affordances of its own.

### 3.8 Phase 8 — Settings/compute/files (ledger: Complete)

**Verified:** full `/settings` app (10 sections, quick drawer 400px), versioned scoped preferences (`migratePreferences`, scope order account→workspace→work_type→device), live autocomplete (Tiptap + textarea, IME-suppressed, no Yjs pre-accept), Pyodide runtime genuinely live (network-disabled blob worker, cancellation, 12s timeout, 120-file/1.5MB limits, approved packages, asset routes; 4 live consumers), attachment pipeline (PDF.js/mammoth/exceljs/fflate + visual PDF), esbuild-wasm local-build worker + asset route, engine scorecards matching `06_ENGINE_ADOPTION_SCORECARD.md` exactly, quick drawer, memory removed from navigation. The "31 tests" claim reproduces exactly but ~16 of them belong to prior-phase suites.

**Findings:**
1. **Compute Broker gates only autocomplete.** `chooseComputePath` is consumed by exactly one production call site (`requestLocalAutocomplete`); PDF/Python/build decisions never consult it; `decision.disclosure` is never surfaced to the model (COMPUTE-001 partial).
2. **~115 of ~130 preference fields have no runtime consumer.** AI, Collaboration, Notifications, Integrations, Accessibility, most Writing, and all `compute.*` toggles are schema+UI only. `compute.local` is written by the drawer but never read (autocomplete hardcodes `"auto"`). `data-spectra-density/editor-text/interface-text/contrast/focus` attributes are emitted with no CSS/component consumers (SETTINGS-008 partial).
3. **`buildLocally` (esbuild-wasm) is dead code** — all live builds POST to `/api/spectra/runtime/build` (COMPUTE-006 partial).
4. **PDF Inspector worker never called** — `inspectPdfInWorker` has no production callers; the only PDF intelligence is server-side pdfjs in `prepareRunAttachments` (COMPUTE-007 partial).
5. Scope persistence: only `device` layer has a writer/reader (SETTINGS-002 partial).
6. Battery/data-saver flags never read from the browser (`memoryPressure`/`batterySaver` hardcoded defaults).
7. Scorecard inconsistency: `pdf-inspector.ts` carries `FIRECRAWL_PDF_INSPECTOR_SCORE = 52` vs canonical 34.
8. Inert UI: "Review"/"Disconnect" integration buttons, "Diagnostics" — no behavior.
9. Worker modules (autocomplete/pdf/build/python workers) are never executed in tests (node env).

### 3.9 Phase 9 — Calendar/school/admin (ledger: Complete)

**Verified:** 23/23 requirement IDs present in code: calendar.ts temporal domain + rev-gated drag/resize, unscheduled lane, flexible plan v4 (milestones→goals, checklist→steps), Calendar AI tools, school adapter contract + capability audit + stale/absent states, user/admin separation, manual sync + freshness, no-false-empty projection, idempotent class workspace materialization, metric registry (25+ metrics, freshness/zeroMeaning), superadmin, provider-neutral future-proofing, ManageBac scheduled sync via Convex.

**Findings:**
1. **No recurrence engine.** RRULE field is schema + legacy passthrough only — recurring ManageBac events sync and display as single occurrences; no expansion/UI (CAL-003 partial).
2. No cron heartbeat for sync — self-perpetuating `runAt` chains; cold boot depends on a first action.
3. "552 tests" not reproducible (623 `it/test` sites across 69 files today — count differs; may be a stale ledger figure, or the ledger counted a subset).
4. Cal→Plan create/edit not surfaced in Calendar UI (link-open + AI tools only).
5. Some admin metrics honestly "Unknown until instrumentation" (thin data).
6. Window `verified` capability status is code-asserted pre-first-sync; quarantine covers mismatch after.

### 3.10 Phase 10 — Agent Foundry (ledger: Complete)

**Verified:** full Foundry pipeline exists: `agents/foundry/` (12 files: adaptive, compiler, evaluation, evidence, foundry-document, improvement, mission, routing, runtime-package, sections, skills), agent-foundry.tsx composer (foundation questions, adaptive sections, summary card, evidence bindings, publish/rollback), background compiler (foundation→next→compile route ops, deterministic checks, circuit-breaker flags, compiler-job status), separate evaluate route (layered evaluation, HMAC settlement), manifest route (`spectra.agent` v1, 5MB, HMAC-signed), competence routing in the run route (`best.confidence >= 0.64` automatic with `competenceReason`+summary, 85/65/45 scale), release immutability (`publishAgent` gate: instructions ≥40 + routing description ≥30 + tool/resource validation + contentHash + eval gate + snapshot), catalog pages, agent feedback/usage/improvement tables.

**Findings:**
1. **Publish gate unreachable via the normal Foundry flow (AGENT-017 PARTIAL, critical).** The Foundry projects mission/skills into legacy `profile`/`behavior`/`skills[].instructions` only (`foundry-document.ts:435–455`), never `content.instructions.text`. The only writer of `content.instructions.text` is `resolveImprovementProposal` (accepted improvement patch). `publishBlockers` UI checks objective/skills/skillIssues/eval/evidence but **not** the instructions gate → a pure-Foundry agent passes the UI check yet is rejected by `publishAgent` with `AGENT_INSTRUCTIONS_INCOMPLETE`.
2. **`public/skills/*.md` (9 files + manifest) is zero-referenced** — the skills library is not wired to the compiler (skills are LLM-drafted `SpectraSkill` objects only). AGENT-009 "first-class versioned skills" partial.
3. **No dedicated Foundry tests exist** despite ledger claim ("focused agent/compiler/evaluation/release tests" has no test-file match); agent code is exercised only via mocks in run-route/other tests.
4. Traceability cites `agent/` (singular) which does not exist — actual dir is `agents/` (plural).
5. Manifest route signs with `SPECTRA_AGENT_MANIFEST_SIGNING_KEY` (undocumented env) falling back to `SPECTRA_SECRET_BRIDGE_KEY`.

### 3.11 Phase 11 — Work-type passes (ledger: Complete)

**Verified:** 20-obligation conformance engine executed over 9 creatable work types (180 live checks; suite provably can fail), cross-type consistency (6 checks, clean), 43 pass-suite tests verified **exactly**, per-type passes: document navigation/outline/find-replace/Sources panel; flashcards Build/Browse/Study/Progress separation + Convex spaced-repetition study state + deck-revision reconciliation; quiz full experience (presets, timing, attempts, reveal policies, idempotent submissions, owner aggregation, AI question redaction); code native Yjs + file tree + runs + diagnostics + sandboxed preview; presentations with live citation footers + bibliography build/apply + speaker notes + present/follow; sheets sparse model + formulas + merge + freeze + sort/filter + **inline charts** (no bottom graph section); boards frames/groups/connectors/pan-zoom/capture-references/follow; plans List/Board/Timeline projections + CSV/ICS export + calendar scheduling.

**Findings:**
1. **8 of 10 work types remain projection-editing** (whole-work JSON→Yjs re-projection; only document and code type directly into Yjs in the editor) — the ledger's "Complete" coexists with its own traceability note that the projection adapters were retained for "dedicated Phase 11 UI passes" that were never executed.
2. **The 2 failing tests live in this phase's flagship suite** (`native-yjs-models.test.ts`) — see §2.1.
3. "82 targeted tests" is not attributable to any file list (about 90–98 candidate tests exist; not verifiable, and two likely members fail).
4. Presentation citations are free-text `label`+`url` — no binding to real `SourceRecord` entries (documents do have a real source navigator).
5. No direct test of the AI `build_bibliography` policy (enforced only indirectly via mocks).
6. Quiz: no instructor "view a student's attempt" surface (owner aggregation is anonymous-only, per design).

### 3.12 Phase 12 — Functional hardening (ledger: Pending; should be "in_progress")

**Partial evidence exists for most criteria; the following are genuinely missing:**

1. **A fresh recorded gate run on HEAD** — last evidence is campaign B-08 (2026-07-26); current suite is 650 tests with 2 failures.
2. **Performance/budget benchmarks — zero** (no bench files, no numbers for Yjs update size, projection cost, large-op costs, semantic-index cost, rich-parse cost, worker startup/memory, module sizes, tool payloads, admin query shape). This is a creation task.
3. **Dependency-cycle checker** — nothing (no madge/knip/tsc-cycle; grep matches only plan text).
4. **Convex function tests** — `convex/__tests__` absent entirely.
5. **Component/jsdom tests** — exactly 1 (`settings-application.component.test.tsx`); the plan's "jsdom/component tests" bullet is barely met.
6. **§12.2–12.6 acceptance matrices** — no documents mapping the 15 collaboration scenarios, 18 AI scenarios, 9 workbench scenarios, integration scenarios to code/tests. Several scenarios are browser-pending per the campaign (offline-merge, permission-revoked-mid-session, compaction survivability, hibernation wake).
7. **§12.5 per-type omissions record** — does not exist (plan explicitly requires recording omissions rather than marking a type complete).
8. **Legacy-removal decisions pending** (12.7): migration flags (dead), compatibility.ts adapters (test-only usage), legacy event envelope in run route (live at 9608–9610), `DurableRunTabs` alias (imported by 2 shells), legacy-window-bridge. NOTE: Hocuspocus transport cannot be removed at 12 unless 8 work types are first moved to Cloudflare — the transport removal is effectively a Phase 16 action.
9. **DEF-005 still Open** ("Library/Workspace and sidebar ownership duplicated" — resolution said Phase 6, which is Complete; needs verification/closure).
10. **Test-infrastructure gaps**: only 1 of 8 verification bullet areas has explicit coverage; `scripts/spectra-ai-worker.mjs` / `managebac-sync-worker.mjs` referenced by the campaign are deleted (see §4.4); evidence dirs missing for graded-pass rows (B-03, B-05); F-03 cites F-02's dir.

### 3.13 Phase 13 — Visual system (ledger: Pending)

**Verified (how much is already consolidated):** single canonical `:root` token block (globals.css ~L4272) + `.dark`, Tailwind v4 `@theme inline` mapping tokens to utilities (`text-micro/caption/ui/body/editor/title/display`, brand/accent/status colors, shadows, radii, ease tokens, motion tokens), `check-design-tokens.mjs` (plural-`:root` ban, 11px floor, brand-primary cap), 0 sub-11px sizes anywhere (codemod already run), real `next/font` (Manrope + IBM_Plex_Mono), dark mode fully CSS-var driven (0 `dark:` variants), reading width applied, chat/settings/calendar/landing polished.

**Findings:**
1. **No spacing tokens** (`--space-*` absent) — spacing is raw Tailwind + arbitrary values.
2. **~800 arbitrary text sizes remain** (`text-[11px]` ×348, `text-[12px]` ×268, `text-[13px]` ×129, etc.) — the semantic tokens are adopted only as `text-micro` (804 uses); `text-ui/body/title/display` have **0** uses.
3. **786 hardcoded hex colors in 66 files** (top offenders: managebac-integration-shell 87, artifact-studio 57, administration/shared 31, presentation-studio 31, superadmin-shell 29, school-admin-shell 28, whiteboard-studio 26).
4. **Dark-mode gaps:** whiteboard studio, `.spectra-wave-y`, document studio forced-light hex.
5. No duplicate-rail static check, no overflow-prone fixed-dimension check, no per-work-type visual-pass record, no className/variant snapshots; only 1 a11y/structure test.
6. Workspace shell is the highest-risk surface for overlapping toolbars (CommandBar + SelectionActionBar + DurableRunTabs + RunDetailPanel + LiveThreadPanel may coexist).
7. Admin tables (school-admin 90 borders, managebac 87 hex) not readable-passed.

### 3.14 Phase 14 — Motion (ledger: Pending; **materially understated**)

**Verified (implemented with 16 test files):** 7-primitive motion grammar (`motion/grammar.ts`, `tokens.ts`, `motion-primitives.tsx` with Reveal/CrossfadeText/MorphShell/FocusPulse), clock-driven `RevealScheduler` (5 profiles: conversation/dock/document/table/imported, adaptive catch-up), `use-streaming-reveal` (canonical state never mutated; honors reduced-motion + `data-spectra-streaming-reveal`), **conversation + dock profiles wired** (`LiveContentReveal` in conversation-surface; `DockTitle` RUN-010 one-time reveal in live-dock), active-tail shimmer (`.spectra-stream-active [data-stream-tail]::after`, gated by `data-spectra-tail-shimmer`, reduced-motion, and OS), Live Dock entrance/exit/width/crossfade-required-input geometry-first, cursor physics (`cursor-motion.ts` CursorTravel retargetable tween + CometTrail), presence layer (flags with 3.6s label decay, stale fade, spark glyph AI chip, `data-spectra-held` frames + completion ring, mobile `useSimplifiedPresence`), follow/presentation (chips, return pill), layered reduced-motion (`motion-level.ts`: preference only decreases; global 60ms cap; 0.01ms for "none"; `@media (prefers-reduced-motion)`), framer-motion in 11 consumers.

**Findings:**
1. **3 of 5 reveal profiles never wired:** `document`, `table`, `imported` profiles exist in the scheduler but no surface calls them — AI content in documents/slides/cards and range batches do not stream-reveal (POLISH-004 partial).
2. **`Reveal`, `MorphShell`, `FocusPulse` primitives unused** — only `CrossfadeText` is consumed; surfaces re-implement per-site transitions.
3. **No collapsed→expanded reference morph** (14.7 partial; panel enter/handoff and embed `layout` morphs exist).
4. `.spectra-title-reveal` class used by dock but **undefined in CSS** (dead decoration).
5. No workbench route-level transition between Library/Workspace (documented as content-continuity only).
6. COLLAB-026 "decline" is implemented as state/frames, not a distinct animation; no large-room automatic label capping.
7. No star-pack/starburst completion animation (plan doesn't mandate it by name; completion grammar is covered).
8. Documented in plan as Pending while goal checklist §14.1–14.6/14.8/14.9 and COLLAB-026/RUN-010 are already `[x]` with real evidence — contradicts ledger.

### 3.15 Phase 15 — Landing (ledger: Pending)

**Verified:** real WebGL prism (`prism3d/Prism.tsx` bevelled asymmetric core, MeshTransmissionMaterial, raymarched internal energy, quality tiers, WebGL1-safe), deterministic 5-scene state machine (`prism-scene.ts` + 10 tests), camera rig aside-motion, hero fragments (4 chips fly into prism), real component reuse in demos (`ArtifactCard`, `ConversationSurface`, `ResultCardStack`, `ThreadCard`, `deriveLiveDockTab`, presence caret, tail shimmer), calm editorial sections, real CTA to `/sign-up`, `/api/contact` form, reduced-motion (fixedTime frozen pose, frameloop demand), no-WebGL SVG fallback always first-painted + crossfaded, dynamic import of WebGL chunk, semantic HTML, no inventory of fake models/carousels anywhere.

**Findings:**
1. **Zero tests for fallback/reduced-motion/demo-adapter/a11y** — only `prism-scene.test.ts` exists; plan's code-only verification list wants all five.
2. No bundle/lazy-load check or perf budget (Lighthouse/budget config absent).
3. Mobile perf risk: `detectQuality` may return "medium" on coarse/small/≤4-core phones and the sticky stage keeps rendering; no FPS-adaptive downgrade, no saveData handling, no `(pointer: coarse) && narrow → fallback` branch.
4. LANDING-005 partial: no references scene, no school-context scene; Calendar appears only as a promise card (4 of 9 candidate scenes used — defensible per 15.3 but checklist demands more).
5. Copy gate doesn't cover landing (no stale-marketing-string automation).
6. Mobile hero fragments hidden (`hidden lg:flex`) — mobile gets copy-only + fullscreen prism.
7. Root `SpectraLikedPrism.tsx` (589 lines) is an orphaned stale duplicate (AdditiveBlending, no reduced-motion pose, stale "Currents" comment) — zero imports; delete or archive.

### 3.16 Phase 16 — Cleanup/release readiness (ledger: Pending)

Verified inventory (every item below was grep-verified as zero-importer unless noted LIVE):

**LIVE by design (do NOT delete blindly):** legacy redirect pages (`/artifacts`, `/timetable`, `/memory` — keep per policy), Hocuspocus transport (default provider for 8/10 types — see §4.3), `DurableRunTabs` alias (imported by workspace-shell:83 + artifacts-shell:77), Tool Registry V2, School adapters, Agency Foundry, events bus, `migrations/protocol.ts`.

**DEAD (verified zero importers):**
- `src/components/ui/`: dialog, card, avatar, input, tabs, textarea, skeleton, separator, scroll-area, breadcrumb, badge, contextual-tip, guided-tour (13 files) + dropdown-menu (transitively dead via notification-bell)
- `src/components/`: notification-bell, study-timer, status-badges, loading-states
- `src/stores/editor-store.ts`; `src/hooks/use-text-to-speech.ts`, `use-right-panel-dock.ts`, `use-compact-sheet.ts`
- `src/lib/editor/*` (5 files), `src/lib/export/pdf-export.ts`, `src/lib/chat/clarification-resume.ts`
- `shared/resource-processing.ts`, `shared/resource-upload-policy.ts` + `src/lib/resource-upload-validation.ts`, `shared/spending.ts` (only its own test imports it)
- `src/components/shared/right-side-panel.tsx`
- `src/features/spectra/pages/memory-shell.tsx`, `timetable-page-shell.tsx`
- `src/features/spectra/events/legacy-window-bridge.ts` (its 5 legacy events are never dispatched)
- `src/features/spectra/migrations/flags.ts` + `migrations/compatibility.ts` (test-only consumers)
- `convex/env.ts`; `src/lib/usage-tracking.ts`
- Root: `SpectraLikedPrism.tsx`, `validation-report.json`
- `docs/spectra-rebuild/DEPRECATED/` (25 files, self-labeled)
- `public/skills/*` (10 md + manifest — referenced by nothing)
- `scripts/codemod-tiny-text.mjs`, `verify-next-generation-migration-baseline.ps1`, `export-next-generation-migration-baseline.ps1` (not in package.json)

**Schema-only Convex tables:** `spectraRunJobs`, `spectraRunAttachments`, `spectraFocusSpaces` (no runtime write path; only administration cleanup listing + test mocks).

**Unused env keys:** `TAVILY_API_KEY`, `GEMINI_API_KEY`, `SENTRY_*`, `SPECTRA_AI_WORKER_BRIDGE_KEY`, `SPECTRA_AI_WORKER_HTTP_KEY`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `OPENROUTER_APP_NAME`, `OPENROUTER_SITE_URL`, `ARTIFICIAL_ANALYSIS_API_KEY` (effectively). **LIVE but undocumented in .env.example:** `ADMIN_EMAILS`, `CLERK_PUBLISHABLE_KEY`, `CONVEX_URL`, `RESEND_API_KEY`, `INVITE_FROM_EMAIL`, `NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME`, `SPECTRA_CLOUDFLARE_COLLAB_URL`, `SPECTRA_TEST_INLINE_RUNS`, `SPECTRA_AGENT_MANIFEST_SIGNING_KEY`, `SPECTRA_JUDGE_MODEL_ID`, `SPECTRA_WEB_PORT`/`SPECTRA_WEB_HOST`, plus Cloudflare DO secrets (`CONVEX_PROJECTION_URL`, `CONVEX_PROJECTION_TOKEN`, `SPECTRA_COLLAB_TOKEN_SECRET`).

**Phase 16.4 gate gaps:** no scripts for strict typecheck, convex validation/codegen, performance budgets, or dependency/license checks; completion ledger format defined but not produced.

---

## 4. Operational/runtime findings

### 4.1 Runtime topology as it actually stands

- **Dev:** `npm run dev` → 2 processes (next + Hocuspocus gateway on 1234). AI runs execute **inline** inside the Next route (`SPECTRA_APP_URL` not set in `.env.local`). Collaboration: 8/10 types → Hocuspocus on 1234; **document/code → Cloudflare DO URL `ws://localhost:8787` by default → dead connection unless `wrangler dev` runs (no script for it)** or `NEXT_PUBLIC_SPECTRA_CLOUDFLARE_REALTIME=false` is set.
- **Prod:** Next on `SPECTRA_APP_URL` + Convex (9 crons — all targets verified to exist — plus `scheduler.runAt/runAfter` HMAC callbacks back into the app) + Clerk + self-hosted Hocuspocus gateway or optional Cloudflare DOs + ManageBac sync via Convex-scheduled HMAC callback to `/api/spectra/managebac`.

### 4.2 Background-run dispatch (replaces the deleted workers)

`scheduleExecution` (convex/spectraRuns.ts) → `scheduler.runAfter(0, dispatchSpectraRun)` → POSTs HMAC-signed `{action:"scheduled_run"}` to `${SPECTRA_APP_URL}/api/spectra/run` → route verifies signature (30s window) → impersonates the owner via Clerk Sessions API → mints Convex token → executes. **Failure mode:** if the run owner has no active Clerk session, the callback errors — there is no offline/relogin recovery. Also, any external auth proxy in front of `SPECTRA_APP_URL` breaks the callback. In dev this path is entirely untested (SPECTRA_APP_URL absent).

### 4.3 Provider default inconsistency

`realtimeProviderForWorkType` (provider-factory.ts) returns doc/code → `"cloudflare"` (only `=== "false"` forces Hocuspocus), and other 8 types → `"hocuspocus"`. Meanwhile `use-artifact-collaboration` uses only the env-flag kind. Two paths can disagree on the same work type; the AI mutation path (`yjs-artifact-operation.ts:486`) follows the type-aware routing, so doc/code AI edits also fail locally without the flag.

### 4.4 Acceptance campaign staleness

- `00_CAMPAIGN_PLAN.md` §1.1 and evidence A-01/E-12/G-F/H-10 reference **four processes** including `scripts/spectra-ai-worker.mjs` and `scripts/managebac-sync-worker.mjs` — **both files deleted** (they ran on 2026-07-24 per evidence notes). Worker-kill scenarios (E-12, G-F, H-10) are unexecutable as written.
- `convex/spectraRunJobs.ts` no longer exists (table remains); B-05 job-queue steps reference it.
- Graded-pass rows B-03 and B-05 have **no evidence directories**; F-03 cites `evidence/F-02/` (typo); `evidence/G-F-session/` and `shell-mb-fixes/` exist but are not cited by the LEDGER.
- 45 rows graded pass/excellent, 3 in_progress, 57 pending, **zero "alarming"** - no failures ever recorded.
- `/api/spectra/run` is whitelisted public in the proxy (needed for scheduled callbacks) — verify this is intended.

---

## 5. Cross-cutting findings

### 5.1 Security

1. **BLOCKER — plaintext API keys committed in git history:** `opencode.json` (TokenRouter `sk-…`), `opencode1.json` (Modal `wk-…`), `opencode2.json` (Modal `wk-…`) — introduced in commits `e435d7e` / `2b5c6f0`. Rotate all three, delete files, add `opencode*.json` to `.gitignore`, scrub history (git filter-repo/BFG) if the remote is shared.
2. No CSP, no HSTS response headers (next.config.ts has X-Frame-Options/nosniff/Referrer-Policy/Permissions-Policy only).
3. `images.remotePatterns: [{ hostname: "**" }]` — unrestricted remote image proxy.
4. `SPECTRA_TEST_INLINE_RUNS` escape hatch is read in the production route (route.ts:12353, 12540) — forces inline execution if set.
5. `.npmrc` `legacy-peer-deps=true` masks dependency conflicts.
6. `/api/spectra/run` public whitelist + `images.remotePatterns` widening deserve a review pass.
7. `@tavily/core` dependency present but unused (TAVILY_API_KEY dead).

### 5.2 Convex data layer

- 93 tables; 90 of 93 have read+write paths (verified cross-reference of 411 `"module:function"` tokens).
- **Two missing Convex functions referenced by live code:** `errorEvents:log` (called by `src/lib/logging.ts:115` on every warn/error — errors are silently swallowed by `.catch`, so error-event persistence quietly never happens; the `errorEvents` table does not exist either) and `models:getModelPricing` / `usage:recordUsageWithCost` / `usage:recordSearchUsage` (inside the dead `src/lib/usage-tracking.ts`).
- 3 orphan schema tables: `spectraRunJobs`, `spectraRunAttachments`, `spectraFocusSpaces`.
- `convex/env.ts` and `src/lib/usage-tracking.ts` are dead modules.
- 9 crons: all 9 targets exist.

### 5.3 App Router surface

- 29 page files, 32 API handlers — **all real, zero placeholders/501/TODO handlers**. Every internal href resolves to a real route. Four legacy redirect pages work query-preserving.
- Auth: `src/proxy.ts` (Next 16 `proxy` file, no middleware.ts) with clerkMiddleware + public-route matcher; everything else protected (server redirect / 401 JSON).
- Landing fully built (see §3.15).

### 5.4 Duplicated implementations (consistency risk)

| Area | A | B | Risk |
|---|---|---|---|
| Upload/extension policy | `shared/resource-upload-policy.ts` (dead) | inline in command-bar.tsx / artifact-studio.tsx | drift |
| Importers | `src/lib/editor/*` (dead) | artifact-studio.tsx, presentation/io.ts, compute/files/attachment-preprocessor.ts | drift |
| Export | `src/lib/export/*` (dead) | inline artifact-studio export | drift |
| Preference-ish state | `spectra:preferences:v2` (appearance) | `ai-school-theme` key + ThemeProvider (consent-gated) | two owners of documentElement |
| Run tabs | `LiveDock` | `DurableRunTabs` alias | naming drift (importers still use alias) |
| Conversation | `ConversationSurface` vs `ThreadConversation` | complementary, genuinely shared | none |

### 5.5 Documentation contradictions

1. **Plan requirement checkboxes (SPECTRA_DEFINITIVE_TRANSFORMATION_PLAN.md ~4810–5044) are 100% unchecked** — including every ID the ledger/checklist report Complete (COLLAB-001..026, AI-001..022, SURFACE-001..017, all invariants).
2. Goal checklist vs ledger on Phase 14: checklist marks §14.1–14.6/14.8/14.9 + COLLAB-026/RUN-010 `[x]` with real evidence while the ledger row stays "Pending (—)" and POLISH-004..010 remain `[ ]`.
3. DEF-005 Open inside a Complete phase.
4. "No Chrome/screenshots" programme-control `[x]` vs the repo's own acceptance-campaign PNG evidence (60+ files).
5. "No visual elevation before Phase 12" `[x]` while Phase 14 motion is implemented.
6. MEM-001..005 unchecked while INV-14 ("no Memory in navigation") is `[x]` and the redirect exists — MEM deserves explicit disposition.
7. Traceability row for AGENT cites `agent/` (doesn't exist; real path `agents/`).

### 5.6 Test inventory summary

- **72 test files, 667 runnable cases** (650 app/feature + 11 realtime + prism 10 → narrative grouping variance).
- **Zero skipped/disabled tests** anywhere (no describe.skip/it.skip/xit/todo/only).
- Feature areas **without tests**: all `src/app/**` pages except landing, all API routes, `src/components/**` shared, hooks/stores, and spectra sub-areas `comments/`, `embed/`, `events/`, `integrations/`, `pages/`, `quiz/`, `tools/`, `hooks/`.
- vitest.congig: node env global with a single `@vitest-environment jsdom` pragma; no setupFiles (jest-dom matchers unavailable); `server-only` shim exists.

---

## 6. Priority recommendations

**Before any further testing campaign:**
1. 🔴 Fix the 2 failing tests (`native-yjs-models.test.ts` — foundry normalization + flashcard review field).
2. 🔴 Fix lint (9 errors + 7 warnings — trivial react-hooks fixes).
3. 🔴 Rotate/remove committed API keys (opencode*.json) + gitignore + history scrub.
4. 🟠 Resolve the dev-provider default for doc/code (local Hocuspocus vs Cloudflare URL) and document the two env vars.
5. 🟠 Repair the Agent Foundry publish gate (write `content.instructions.text` from foundry content or adjust the gate + UI check).
6. 🟠 Update the acceptance campaign doc to the real 2-process + Convex-scheduler topology; set `SPECTRA_APP_URL` locally to exercise scheduled runs.
7. 🟠 Close/re-scope DEF-005; add §12.2–12.6 matrices + §12.5 omissions record; create the fresh gate-run evidence pack (door unlock for 12).
8. 🟡 Decide steering semantics honestly (in-run boundary application vs client-queued-next-run) and update RUN-012/AI-012 evidence; surface steer events in the timeline if applying in-run.
9. 🟡 Add the missing Phase 12 checks (cycle checker, convex tests, component tests, benchmarks) and Phase 14/15 verification gaps (reveal profiles for document/table, fallback/motion tests, bundle budget).
10. 🟡 Execute the Phase 16 deletion list (§3.16) with the retention decisions for Hocuspocus transport, DurableRunTabs alias, and the 3 schema-only tables.

---

## 7. Appendix — Key evidence paths (all verified to exist)

- Plan: `SPECTRA_DEFINITIVE_TRANSFORMATION_PLAN.md` (phases 0–16 at lines 459/564/765/1025/1250/1607/1784/2061/2493/2826/3081/3386/3934/4088/4207/4357/4468; requirements 4810–5044).
- Kernels: `src/features/spectra/{work/registry,events,core,settings/schema,work/session,tools/registry,compute/files,runs/streaming}/`
- Realtime worker: `workers/collaboration/{wrangler.toml,src/room.ts,src/room-core.ts,src/ydoc-store.ts,src/leases.ts,src/claims.ts,src/awareness.ts,src/projection-outbox.ts,migrations/0001_initial.sql,tests/room-core.test.ts}`
- Yjs: `work/models/yjs/`, `realtime/{persistence,policies}/`, `components/artifact-studio.tsx` (bind sites 6476–6484, 6752–6756), `code-studio.tsx` (871–896, 3000–3001)
- AI: `actions/protocol/`, `runs/{state,steering,streaming,background,live-dock}/`, `tools/{registry,execution}/`, `sources/{records,research}/`, `ai/model-config.ts`, `src/app/api/spectra/run/route.ts` (~12,870 lines)
- Chat/LiveDock: `components/{live-dock,conversation-surface,command-bar,live-thread-panel,run-detail-panel}.tsx`, `runs/live-dock/live-dock-model.ts`
- Workbench: `workbench/{session,layout}`, `components/{workbench-split-tree,workbench-inspector-tabs}.tsx`, `src/app/{library,workspace}`
- References/sources: `anchors/`, `references/`, `context/`, `rich-content/`, `sources/`, `convex/artifactComments.ts`
- Settings/compute: `settings/{schema,ui}`, `compute/{broker,pdf,files,autocomplete,build,engines}`, `code/python-runtime.ts`
- School/calendar: `convex/{calendar,managebac,analytics}.ts`, `calendarShared.ts`, `plan/model.ts`, `plan/projections.ts`, `integrations/school/`
- Agents: `agents/foundry/` (12 files), `components/agent-foundry.tsx`, `convex/agents.ts`, `src/app/api/spectra/agents/{foundry,evaluate,manifest}/route.ts`
- Motion: `motion/{grammar,tokens,motion-primitives}.ts(x)`, `runs/streaming/{reveal-scheduler,use-streaming-reveal}.ts`, `collaboration/{cursor-motion,interaction-model}.ts`, 16 motion test files
- Landing: `src/app/page.tsx`, `landing/{landing-client.tsx,prism/**,prism3d/**,sections/**,demo/**}`, `__tests__/prism-scene.test.ts`
- Convex: `convex/schema.ts` (93 tables), `convex/crons.ts` (9 jobs), 53 API modules
- Documents: all 8 files in this directory + `docs/spectra-rebuild/acceptance-campaign/{00_CAMPAIGN_PLAN.md,LEDGER.md,evidence/**}`