# Spectra definitive goal checklist

This is the source of truth for remaining work. An item is checked only when the implementation and its code-only verification are complete. Section references point to `SPECTRA_DEFINITIVE_TRANSFORMATION_PLAN.md`; all nested bullets and contracts in the referenced section are part of the checkbox.

## Programme controls

- [x] Read the canonical plan in full before implementation.
- [x] Activate and read the frontend-design skill in full.
- [x] Create `docs/spectra-definitive/00_CANONICAL_PLAN.md` through `07_GOAL_CHECKLIST.md`.
- [x] Mark conflicting historical plans with a canonical-plan header.
- [x] Assign stable requirement IDs and map each completed grouping to code and verification evidence.
- [x] Keep implementation, migration, defect, traceability, and engine ledgers current.
- [x] Preserve working behavior behind compatibility adapters until replacements pass gates.
- [ ] Follow Phase 0 → 16 dependency order; do not begin visual elevation before Phase 12.
- [ ] Use code-only verification; never use Chrome, Playwright, screenshots, or video as proof.

## Phase 0 — Canonical programme and migration safety

### Build and migrations

- [x] §0.1 Canonical planning directory is complete, concise, operational, and historical plans point here.
- [x] §0.2 Stable COLLAB/AI/RUN/WORK/SURFACE/REF/SOURCE/SETTINGS/SCHOOL/AGENT/ADMIN/POLISH/LANDING IDs are assigned and ledger-linked.
- [x] §0.3 `LegacyArtifactTransportAdapter` exists with Phase 12/16 removal target.
- [x] §0.3 `LegacyArtifactModelAdapter` exists with Phase 12/16 removal target.
- [x] §0.3 `/artifacts`, `/timetable`, and `/memory` compatibility redirect mapping exists.
- [x] §0.3 old/new run-event adapter exists with removal target.
- [x] §0.3 old/new tool-definition adapter exists with removal target.
- [x] §0.3 old/new reference-preview adapter exists with removal target.
- [x] §0.3 old/new preference-schema adapter exists with removal target.
- [x] §0.3 old/new school-source normalization adapter exists with removal target.
- [x] §0.4 Typed migration flags cover Cloudflare realtime, native Yjs variants, Action Protocol V2, Tool Registry V2, Workbench V2, References/Rich Content V2, Agent Foundry V2, and School Source V2.
- [x] §0.4 Collaboration tokens, run items, and reference nodes carry protocol versions.
- [x] §0.5 Deterministic machine-readable inventory covers routes, API actions, Convex tables/indexes, work types, tools/permissions, custom events, preferences, user-facing legacy copy, rich-text renderers, whole-content sync/flush calls, silent fallbacks, admin metrics/data sources, and ManageBac routes/capabilities.

### Verification and exit

- [x] Existing lint, type check, build, and tests pass or pre-existing failures are recorded.
- [x] Inventory generation is deterministic.
- [x] Feature flags are typed and verified.
- [x] Legacy routes/data work with flags off.
- [x] Phase 0 introduces no product behavior change beyond compatibility scaffolding.
- [x] One canonical plan exists.
- [x] Every major migration has compatibility and removal strategy.
- [x] Baseline is green or every existing failure is in the defect ledger.

## Phase 1 — Architectural kernels

### Build

- [x] §1.1 Establish clear Work, Realtime, Actions, Tools, Runs, Context, Sources, References, Workbench, Settings, Integrations, and Compute domain boundaries.
- [x] §1.2 Work Registry V2 exhaustively declares terminology, surfaces, modes, responsive minimums, permissions, anchors, references, collaboration, sources, AI actions, and command priority.
- [x] §1.3 Typed command/event/query bus exists with a temporary legacy window-event bridge.
- [x] §1.4 Shared capability-truth vocabulary exists and is used by new integration/tool/admin code.
- [x] §1.5 Run route delegates provider, context, streaming, persistence, work operations, agent runtime, and active attachment preprocessing through typed modules; embedded legacy definitions are frozen against growth.
- [x] §1.6 Central work studio delegates session projection and exposes collaboration, save/projection, history, sharing, inspector, AI activity, and responsive controllers.
- [x] §1.7 Versioned account/device/workspace/work-type preference schema and migrations exist.

### Verification and exit

- [x] Registry exhaustiveness, command/event schemas, and work-type type contracts pass.
- [x] Existing route/UI behavior remains compatible.
- [x] Static checks prohibit new direct global string events and run-route embedded tools.
- [x] New tools/actions/surfaces have one registration path.
- [x] Monoliths delegate meaningful testable responsibilities with no user regression.

## Phase 2 — Cloudflare realtime platform

### Build

- [x] §2.1 Dedicated Worker/Durable Object package with shared protocol types exists.
- [x] §2.2 Room identity uses `work:{workId}` with future partition support and telemetry before partitioning.
- [x] §2.3 Signed connection tokens include actor/access/capabilities/permission epoch/protocol/expiry and revocation enforcement.
- [x] §2.4 Cold load, update replay, immediate peer broadcast, SQLite append, compaction accounting, and async projection lifecycle exists.
- [x] §2.5 SQLite tables cover update log, snapshots, room metadata, structural claims, and projection outbox; ephemeral pointers are not persisted.
- [x] §2.6 Hibernation-safe socket attachments and wake reconstruction exist.
- [x] §2.7 Bounded ephemeral awareness carries semantic target, relative selection, interaction, viewport/follow, run, and presentation state.
- [x] §2.8 Narrow interaction lease acquire/renew/release/expiry/conflict semantics exist.
- [x] §2.9 Durable queueable structural claims cover rewrite, structural mutation, schema, migration, and bulk operations.
- [x] §2.10 Idempotent retrying Convex projection outbox stores projection ranges for downstream semantic/history/source/activity materialization without blocking editing.
- [x] §2.11 Cloudflare provider and Hocuspocus provider share the existing transport interface and switch through a migration-gated factory.

### Verification and exit

- [x] Multi-client sync, cold replay, compaction boundaries, and hibernation wake pass.
- [x] Read-only, permission-revocation, protocol, size, and rate enforcement pass.
- [x] Awareness, leases, structural claim queue/resume, and outbox retry/idempotency pass.
- [x] No ordinary update waits for synchronous Convex projection.
- [x] Cloudflare matches the transport contract and durable failures do not erase local/peer accepted state.
- [x] Cloudflare is not default before Phase 3 document readiness.

## Phase 3 — Fine-grained Yjs and uninterrupted editing

### Build and migrations

- [x] §3.1 Common `WorkYjsAdapter` supports create/bind/project/regions/validate/migrate/undo and actor-aware origins.
- [x] §3.2 Documents use Tiptap + `Y.XmlFragment`, stable blocks, relative anchors, native reference/citation nodes, IME-safe transactions, and idempotent rollback-capable migration.
- [x] §3.3 Code uses a file map, per-file `Y.Text`, shared order/metadata, structural claims for file operations, and external runtime state.
- [x] §3.4 Sheets use sparse shared sheets/cells/charts/named ranges with separate formula/value/format/validation/provenance/comments and field leases.
- [x] §3.5 Presentations use native slide/element/text/geometry/notes/citation structures with gesture leases and structural claims.
- [x] §3.6 Boards use native stable objects/z-order/groups/text/geometry, personal camera, and complete-gesture object leases.
- [x] §3.7 Quiz/deck authored source is separated from attempt/study state and supports read-only interaction policies.
- [x] §3.8 Plans use stable shared tasks/milestones/fields/order with lease/claim policy and Calendar ID projections.
- [x] §3.9 Agent mission/evidence/skill/release draft structures are collaborative.
- [x] §3.10 Direct editor bindings replace React/full-snapshot hot-path sync; focused content is never overwritten; flush is explicit-boundary only.
- [x] §3.11 Bounded local Yjs durability, eviction, pending/durable truth, and safe reconnect merge exist.
- [x] §3.12 Central concurrency policy registry maps every AI action and control to mergeable, lease, or claim policy.
- [x] §3.13 AI waits through release subscription, idle threshold, re-resolution, relevance verification, and resume/replan without false failure.

### Verification and exit

- [x] Every model passes simultaneous text, independent field, lease, drag, claim, offline merge, undo-origin, anchor, migration, projection, IME, durability-delay, and serialization-budget cases.
- [x] Ordinary remote updates never call focused-editor `setContent`.
- [x] Documents/code run on native models over Cloudflare; every remaining model has passing migration contracts.
- [x] Typing is independent of save/projection latency.
- [x] Legacy JSON regions remain only for explicitly scheduled unmigrated work.

## Phase 4 — AI Action Protocol, tools, models, and research

### Build and migrations

- [x] §4.1 Versioned structured run items cover title/progress/text/tool/action/patch/wait/question/approval/steer/checkpoint/final/degraded/error without chain-of-thought.
- [x] §4.2 Explicit recoverable run state machine exists.
- [x] §4.3 Tool Registry V2 owns schema, permission, approval, concurrency, duration, retry, cancellation, resume, cost, summaries, telemetry, and execution.
- [x] §4.4 Bounded standard tool-result envelope uses handles/summaries rather than unrestricted raw context.
- [x] §4.5 Independent reads batch concurrently with bounded deterministic results; mutation domains serialize.
- [x] §4.6 Universal timeout is removed in favor of per-tool progress/retry/degradation policy.
- [x] §4.7 Protocol-native choice, multiple-choice, short-answer, file, context, confirmation, permission, and comparison requests exist.
- [x] §4.8 Recoverable semantic actions have intent, anchors, policies, choreography, postconditions, retry/fallback/checkpoints.
- [x] §4.9 Steering applies refine/redirect/replace/cancel at safe boundaries.
- [x] §4.10 Luna route/reasoning profile and native image/PDF/Office attachment bundle are capability-configured; legacy prepass is dormant.
- [x] §4.11 Parallel search adapter supports purposeful Quick/Verified/Deep policy, full included results, early stop, and five-call maximum.
- [x] §4.12 Full-source canonicalization, authority selection, fetch, parse, evidence spans, synthesis, citation verification, and work provenance exist.
- [x] §4.13 Internal durable jobs share run infrastructure without normal Live Dock tabs.
- [x] Existing run history and tools migrate through compatibility adapters.

### Verification and exit

- [x] Registry schema validation, transcripts, batching/serialization, duration/retry/cancel, steering, input resume, action retry, Luna modality, visual fallback, research depth, citation integrity, and history compatibility pass.
- [x] All application tools use Tool Registry V2.
- [x] New protocol drives UI; Luna and Parallel are defaults; embedded legacy route logic is not source of truth.

## Phase 5 — Quick Chat, Live Dock, and conversations

- [x] §5.1 `/chat` and right panel share renderer, composer, stream, citations, steering, questions, retry, stop, and sources.
- [x] §5.2 Continue defaults on; panel auto-open off; progress/auto-route/retention defaults on; explicit New thread exists; durable tabs do not auto-open panel.
- [x] §5.3 Compact state shows title/status/semantic step; hover is bounded; required input expands only necessary controls.
- [x] §5.4 Multiple independent runs scroll/compress correctly; one input expansion at a time; focus is stable; close/cancel semantics are truthful.
- [x] §5.5 No provisional local title; distinct checkpoint-derived title/current/expanded/final summaries exist.
- [x] §5.6 Steering works from Quick Chat/right panel/chat with safe-boundary feedback and timeline continuity.
- [x] §5.7 Attachments appear contextually without permanently enlarging tabs.
- [x] §5.8 Working/waiting/input/completing/completed-limited/paused/reconnecting/cancelled/terminal states are truthful.
- [x] §5.9 Desktop/tablet/mobile/touch/keyboard behavior follows the responsive contract.
- [x] State, send default, open, input/resume, multi-run, summaries, touch, shared renderer, and route persistence checks pass.
- [x] Live Dock V2 owns current tabs; compact stays simple; full detail is one click; required input is panel-independent.

## Phase 6 — Shared Workbench, routes, sidebar, inspector

- [x] §6.1 Canonical routes and legacy redirects exist with user-facing terminology migrated first.
- [x] §6.2 Library provides global/unplaced/shared/recent/favorite/collection/import organization and receiving.
- [x] §6.3 Workspace shows only placed work plus workspace-specific members/context/sources/pins/activity/layout/settings.
- [x] §6.4 Shared workbench preserves panes/tabs/layout/thread/inspector/Live Dock/local state across Library ↔ Workspace; other routes retain local sessions.
- [x] §6.5 Split tree supports automatic 2–4 layouts, resize, minimums/tab fallback, rebalance, focus, auxiliary thread, persistence, and keyboard actions.
- [x] §6.6 Every work type declares responsive minimum/preferred sizes, panel/tile/compact support, and toolbar priorities.
- [x] §6.7 Other routes support one work/optional thread side panel and identity-preserving fullscreen transfer.
- [x] §6.8 One stable sidebar DOM handles collapse with preserved order/hierarchy/account/focus and one global command.
- [x] §6.9 Library/Workspace share selection, organization, share, bulk-delete, view, filter, and state grammar without identical layouts.
- [x] §6.10 Inspector Overview/Comments/History meets every content, navigation, orphan, filtering, and history requirement.
- [x] §6.11 Copy dictionary/static checks remove user-facing Artifact/Timetable legacy language.
- [x] Split invariants, persistence, redirects, local sessions, transfer, sidebar structure, inspector, copy, and responsive calculations pass.
- [x] Library/Workspace are distinct with one workbench; redirects work; sidebar is singular; renderers never crush below minimum.

## Phase 7 — Anchors, references, context, sources, and comments

- [x] §7.1 Versioned semantic anchor and per-work exists/describe/reveal/geometry/selection/migration adapters serve all semantic consumers.
- [x] §7.2 One collapsed/expanded live-or-pinned Reference identity is accessible, resizable, permission-aware, and status-truthful.
- [x] §7.3 Document, Sheets, Presentation, Board, Code, Quiz, Flashcards, Plan, and Agent have useful work-specific targets/views.
- [x] §7.4 References insert as native host nodes/objects/blocks via commands, paste, drag, context, AI, and suggestions.
- [x] §7.5 Board capture stores semantic objects and camera bounds and handles moved/deleted objects truthfully.
- [x] §7.6 High-confidence suggestions are restrained and dismissible.
- [x] §7.7 Viewport picker uses registered semantic targets, nesting, touch/keyboard cancellation, and permission filtering—not DOM scraping.
- [x] §7.8 Permission-aware semantic index covers all listed work, school, thread, source, and agent entities and serves search/context/routing/retrieval.
- [x] §7.9 Verified SourceRecord/EvidenceSpan/provenance models exist.
- [x] §7.10 Incremental unified rich-content AST and adapters cover every listed surface and incomplete streams without full rebuild flicker.
- [x] §7.11 Every work type implements its specified citation/source experience and preserves sources through conversion/export.
- [x] §7.12 Comments use shared anchors, root/selection targets, reveal, inspector selection, orphan/re-anchor, relative positions, rich sources, mentions, and no balloons.
- [x] Anchor, reference, insertion, capture, picker, index permissions, citation integrity, rich streams, export, and comment navigation checks pass.
- [x] Work-specific reference contracts, anchors/views, unified citations, and shared comment/AI/follow navigation are active.

## Phase 8 — Settings, compute, files, and autocomplete

- [x] §8.1 Full responsive `/settings` and small quick-settings drawer use tested product/account/workspace/work-type/device resolution.
- [x] §8.2 General, AI/runs, Writing/autocomplete, Collaboration, Appearance, Local compute/files, Notifications, Privacy/data, Integrations, and Accessibility settings include every specified default and disclosure rule.
- [x] §8.3 Compute Broker selects worker/server/provider/degraded paths from task, device, pressure, platform, battery/data, privacy, size, preference, and cancellation; local work never runs on main thread.
- [x] §8.4 PDF Inspector is scored and only adopted as replaceable local classifier/extractor with native-PDF and PDF.js/server fallbacks and no OCR claim.
- [x] §8.5 Central attachment pipeline preserves original, visual PDF, structure, text, source map, warnings, and provenance across all consumers.
- [x] §8.6 Local tiered autocomplete covers appropriate prose surfaces with ghost text, accept-word/all, dismiss, IME/remote suppression, no pre-accept Yjs update, no cloud fallback, and constrained-device degradation.
- [x] §8.7 Pyodide and worker JS/TS/React builds implement reuse, cancellation, limits, approved packages/dependencies, diagnostics, sandboxing, telemetry, and cloud fallback.
- [x] §8.8 Optional local analysis is adopted only for a scored concrete workflow.
- [x] §8.9 Every open-source engine is scored across all plan criteria; no foreign product shell bypasses Spectra kernels.
- [x] Preference, accessibility, broker matrix, isolation/cancel, file fixtures, autocomplete, runtime, fallback, and registry checks pass.
- [x] Settings is real, Memory navigation is gone, autocomplete degrades cleanly, and heavy intelligence stays off weak browsers.

## Phase 9 — Calendar, Plans, school, administration, analytics

- [x] §9.1 Timetable work creation stops; data/links/menus/references/routes migrate to canonical Calendar with semantic actions retained.
- [x] §9.2 Official event/deadline, task, work block, personal event, milestone, and reminder remain distinct; scheduling never mutates official deadlines.
- [x] §9.3 Plan supports flexible tasks/milestones/sections/dependencies/estimates/blocks/status/assignees/references/views without education hard-coding.
- [x] §9.4 Calendar layers, unscheduled lane, drag/resize, AI leases/actions, side panel/thread/fullscreen/source/Plan integration work without duplication.
- [x] §9.5 Provider-neutral SchoolSourceAdapter and normalized school entities/freshness contract exist.
- [x] §9.6 Every authorized ManageBac capability/route is audited with pagination, rate controls, normalization, and quarantine; no blind crawling.
- [x] §9.7 Timetable uses real timestamps or verified period map/timezone; missing precision is partial, never invented.
- [x] §9.8 User School page exposes all supported sections, manual refresh, freshness/count/error/source truth, and no false emptiness.
- [x] §9.9 Separate admin integration page owns credentials/mapping/capabilities/policy/access/schema/quarantine/status/audit and canonical endpoint rules.
- [x] §9.10 Class workspace materialization is stable, idempotent, rename-safe, freshness-aware, and partial-capability truthful.
- [x] §9.11 Every analytics/admin metric has exact query, privacy, efficient aggregation, filters, empty meaning, freshness, and instrumentation-before-display.
- [x] §9.12 Capability-truth UI is shared throughout Calendar, School, admin, and analytics.
- [x] Migration, temporal, drag/lease, Plan projection, adapter, pagination/drift, period, no-empty, materialization, metric/permission, and static-source checks pass.
- [x] Calendar/Plan separation, useful current ManageBac, user/admin separation, future adapters, and truthful metrics meet exits.

## Phase 10 — Agent Foundry and safe improvement

- [x] §10.1 Agent work surface replaces fixed wizard with persistent identity/composer/foundation/evidence/skills/evaluations/releases/sharing/compiler status.
- [x] §10.2 Initial objective and interaction-expectation questions produce an adaptive foundation.
- [x] §10.3 Generated removable/restorable/history-backed text/choice/file/reference/example/permission/evidence/evaluation/skill sections are contextual, not scripted filler.
- [x] §10.4 Persistent creator composer and Continue building add highest-value sections and stop when sufficient.
- [x] §10.5 Structured mission is mandatory; evidence/calibration are conditional.
- [x] §10.6 Evidence extraction captures criteria/vocabulary/procedures/examples/edges/contradictions/questions/security and isolates untrusted instructions.
- [x] §10.7 Versioned first-class skills declare triggers/contracts/procedure/evidence/examples/failures/evaluations/status and load selectively.
- [x] §10.8 Hidden background compiler jobs interpret, extract, propose, evaluate, route, diagnose, compile, and show in-Foundry status.
- [x] §10.9 Mission-adaptive creation works across educational, research, company, personal, creative, and technical cases.
- [x] §10.10 Layered deterministic/held-out/truth/tool/adversarial/regression/independent evaluation reports uncertainty honestly.
- [x] §10.11 Competence routing uses structure, semantics, context, evidence, tools, history, and confidence-specific behavior.
- [x] §10.12 Verified signals produce evaluated shadowed immutable releases with provenance, rollback, injection resistance, thresholds, and no active self-mutation.
- [x] §10.13 Agents page provides Discover/Installed/Yours/Shared and simple sharing/install semantics.
- [x] §10.14 Compiled runtime package references mission, skills, evidence, tools, contracts, verification, routing, safety, model, and evaluation; loads only relevant material.
- [x] Dynamic sections/history, mission fixtures, evidence security, skills, compiler, evaluation, routing, improvement, immutability, rollback, and sharing checks pass.
- [x] Foundry, first-class competence, competence routing, and release-based improvement meet exits.

## Phase 11 — Dedicated functional work-type passes

- [ ] §11.0 Every work type passes common surface, sharing/capability, native Yjs, anchors, references, sources, comments/history, responsive, AI action, import/export, truth, accessibility, terminology, and empty-state conformance.
- [ ] §11A Documents meet every mode, rich-content, collaboration, import, formatting, outline, find/review, source, reference, AI, side-panel, and verification requirement.
- [ ] §11B Flashcards meet authoring/study/progress separation, rich card, keyboard study, filtering, source/reference, AI batching, update, side-panel, and verification requirements.
- [ ] §11C Quizzes meet experience contract, question, preview/attempt/timing/response/result, source, permission, AI secrecy, side-panel, and verification requirements.
- [ ] §11D Code meets source/preview/split/run, files, diagnostics, execution/build, permissions/secrets, provenance/reference, AI verification, side-panel, sandbox, and verification requirements.
- [ ] §11E Presentations meet native editing/present/notes/follow, selection/layout, media/chart/reference, notes/citations/comments, import/export, AI gesture, responsive, and verification requirements.
- [ ] §11F Sheets meet sparse collaboration, range/formula/value/format/validation, filtering, inline charts, provenance/comments/references, import/export, AI bounded actions, side-panel, and verification requirements.
- [ ] §11G Boards meet native spatial editing, frames/groups/connectors/media/references, comments/capture/follow, viewport, accessibility, AI gestures, side-panel, and verification requirements.
- [ ] §11H Plans meet List/Board/Timeline, full task domain, Calendar/source links, comments/history, bulk safety, import/export, AI scheduling, side-panel, and verification requirements.
- [ ] §11I Agent work meets every Work Kernel obligation and contains no fixed form remnants.
- [ ] §11.10 Cross-type terminology, control grammar, modes, toolbars, empty/read-only/panel experiences, citations/references/comments, AI targets, and disclosure are consistent.
- [ ] Common conformance, type suites, static inventory, permission fixtures, import/export/migrations pass and no Calendar work is creatable.
- [ ] Every type has a serious dedicated interface without erasing type-specific capability.

## Phase 12 — Functional hardening and acceptance

- [ ] §12.1 Static/type gates: strict TS, lint, Next build, Convex validation/codegen, Worker build, registry/copy/legacy checks, and dependency cycles.
- [ ] §12.1 Unit gates cover models/state, policy, anchors, references, citations, tools/actions, preferences, migrations, and sources.
- [ ] §12.1 Integration gates cover Durable Objects, Yjs clients, components, provider transcripts, school fixtures, Convex, files, workbench, runs, and agent systems.
- [ ] §12.1 Performance budgets cover Yjs/projection/large work/index/rich stream/workers/bundles/imports/tool context/admin queries without claiming frame rate.
- [ ] §12.2 Every collaboration acceptance scenario passes.
- [ ] §12.3 Every AI/run acceptance scenario passes.
- [ ] §12.4 Every workbench acceptance scenario passes.
- [ ] §12.5 Every Phase 11 work-type acceptance item is recorded; no type is accepted merely because it opens.
- [ ] §12.6 Every integration/admin acceptance scenario passes.
- [ ] §12.7 Remove or formally retain every legacy gateway/model/tool/event/sidebar/timetable/Memory/reference/Agent/flag/migration path as specified.
- [ ] All functional requirements have evidence; no critical path uses compatibility; no blocker remains; visual phases are unlocked.

## Phase 13 — Visual system and responsive refinement

- [ ] §13.1 Consolidated typography/line/spacing/radius/border/surface/shadow/focus/identity/status/selection/motion tokens replace arbitrary values by component ownership.
- [ ] §13.2 Comfortable approved type scales and overflow-safe layouts apply to every surface.
- [ ] §13.3 Primary/navigation/editing/secondary/destructive/mode/advanced control hierarchy is clear with duplicate rails removed.
- [ ] §13.4 Workbench/panels/mobile resolve crushed borders, narrow columns, overlap, thread layouts, padding, density, surface distinction, compact renderers, and state truth.
- [ ] §13.5 Every work type receives dedicated visual pass for hierarchy, modes, canvas, selection, creation, empty/read-only/panel/reference/comments/sources/responsiveness/accessibility.
- [ ] §13.6 Settings, Foundry, School, admin tables/charts/status/search/filter/selection match the system without enterprise clutter.
- [ ] Structural/token/state/accessibility/responsive/text-size/command-row/fixed-dimension code checks pass.
- [ ] Shared system, readable hierarchy, and intentional compact/panel layouts meet exits; external visual review remains explicitly unclaimed.

## Phase 14 — Premium motion and collaboration interactions

- [ ] §14.1 Shared Reveal/Morph/Focus/Ownership/Completion/Recovery/Presence grammar and reduced-motion variants exist.
- [ ] §14.2 Canonical state is independent from adaptive per-surface reveal; only unresolved tail shimmers; large/import streams remain efficient.
- [ ] §14.3 Live Dock geometry, hover/input expansion, one-time title, semantic transitions, completion/recovery, and multi-tab motion are stable.
- [ ] §14.4 Presence interpolates bounded updates with stable identity, label decay, reconnect dedupe, remote selection settling, and plausible cross-surface transitions.
- [ ] §14.5 Ownership keeps cursor/control identity, declines conflict without collateral blocking, and renders wait/resume without false failure.
- [ ] §14.6 AI choreography improves path, velocity, menus, gestures, focus, re-resolution, completion, and safe cancellation without theatrical delay.
- [ ] §14.7 Reference expansion, source reveal, resize, panel transfer, target focus, and workbench transitions preserve semantic identity.
- [ ] §14.8 Follow focus/view/peek/disengage/return/late-join/cross-work behavior never steals focus.
- [ ] §14.9 Reduced motion, transform/opacity, cancel/reverse, adaptive room/mobile effects, and state/accessibility independence meet performance rules.
- [ ] Motion/reveal/interpolation/ownership/morph/state/performance checks pass.
- [ ] Motion is coherent, communicative, accessible, and shared with type-specific application.

## Phase 15 — Landing page and WebGL prism

- [ ] §15.1 Prism narrative connects fragmented context to connected editable work without forcing every section into comparison.
- [ ] §15.2 Hero uses the real prism, concise request/fragments/headline, restrained type/chrome, and no fake model carousel.
- [ ] §15.3 Strongest real scenes demonstrate fragmentation, transformation, live work, AI/human collaboration, evidence, references, school time, specialist agents, and convergence with disciplined pacing.
- [ ] §15.4 Prism movement is spatially coherent, sparing in color/rays, readable, performant, and intentionally simplified on mobile.
- [ ] §15.5 Calm editorial architecture/privacy/school/pilot/CTA sections avoid generic glowing-card grids and fake browser windows.
- [ ] §15.6 Demos reuse real Spectra components/contracts with deterministic isolated adapters and no invented capabilities.
- [ ] §15.7 WebGL/scenes lazy-load; semantic copy/CTA, deterministic state, reduced/static fallback, and first-content independence are accessible.
- [ ] Scene timeline, adapters, fallback, bundle, accessibility, marketing-copy, and no-invented-component checks pass.
- [ ] Landing communicates real differentiation with a central but restrained prism and real product demonstrations.

## Phase 16 — Cleanup and release readiness

- [ ] §16.1 Remove obsolete flags/adapters/routes/components/terminology/timetable handling/Memory page/Agent Studio/reference fallback/sidebar/event bridge/dead CSS and safely retire unused Convex schema.
- [ ] §16.2 Every migration is idempotent, resumable, observable, partial-failure aware, concurrency-safe, fixture-tested, and reversible where practical; legacy data remains until validation/retention gates.
- [ ] §16.3 Update only required architecture, development, deployment, registration, source, school, Foundry, settings, and migration-operation documentation.
- [ ] §16.4 Lint, strict types, Next build, Convex validation/codegen, Worker build/tests, all suites, migrations, architecture checks, performance budgets, dependency/license checks, and requirement completeness pass.
- [ ] Concise completion ledger maps every requirement to implementation, verification, and any limitation.
- [ ] No core requirement relies on temporary paths.
- [ ] Every traceability requirement is implemented or carries explicit product disposition—nothing silently omitted.
- [ ] Repository builds and all code-only gates pass.

## Architecture acceptance invariants

- [ ] INV-01 No normal edit waits for Convex persistence.
- [ ] INV-02 No focused editor is reset from a full remote snapshot.
- [ ] INV-03 No ordinary text edit requires a structural claim.
- [ ] INV-04 A valid lease prevents conflicting dropdown/drag/resize disruption.
- [ ] INV-05 No AI action completes without semantic postcondition verification.
- [ ] INV-06 No recoverable wait is terminal failure.
- [ ] INV-07 Adding a tool does not edit unrelated monoliths.
- [ ] INV-08 No application tool receives a universal default timeout.
- [x] INV-09 No user-facing citation lacks a verified source record.
- [x] INV-10 No integration failure appears as empty data.
- [x] INV-11 Every work type has side-panel/read-only/anchor/reference/responsive contracts.
- [x] INV-12 No work renderer is compressed below its minimum.
- [x] INV-13 No Calendar/timetable work item is creatable.
- [x] INV-14 Normal navigation has no Memory page.
- [x] INV-15 Normal product copy does not use Artifact generically.
- [x] INV-16 No local compute task runs on the main thread.
- [x] INV-17 No large local model downloads without capability/user-policy approval.
- [x] INV-18 No Agent release self-mutates from untrusted usage content.
- [x] INV-19 Library/Workspace transition preserves workbench session.
- [x] INV-20 Sidebar collapse keeps the same navigation tree.
- [x] INV-21 Reference layout changes preserve semantic identity.
- [ ] INV-22 Animation never controls semantic completion/data correctness.
- [x] INV-23 Every admin metric has a data source and status.
- [x] INV-24 Every adopted open-source shell/engine passes the scorecard.
- [ ] INV-25 Rendering alone never completes a functional phase.

## Requirement traceability IDs

### Collaboration

- [x] COLLAB-001 Cloudflare Durable Object realtime provider.
- [x] COLLAB-002 Hibernation-safe room lifecycle.
- [x] COLLAB-003 DO SQLite Yjs log and snapshots.
- [x] COLLAB-004 Async idempotent Convex projection outbox.
- [x] COLLAB-005 Native Yjs document.
- [x] COLLAB-006 Native Yjs code.
- [x] COLLAB-007 Native Yjs sheets.
- [x] COLLAB-008 Native Yjs presentation.
- [x] COLLAB-009 Native Yjs board.
- [x] COLLAB-010 Native Yjs quiz/deck/Plan/Agent.
- [x] COLLAB-011 Derived semantic regions.
- [x] COLLAB-012 Mergeable/lease/claim registry.
- [x] COLLAB-013 Complete-sequence control lease.
- [x] COLLAB-014 Canvas/object gesture lease.
- [x] COLLAB-015 Structural claim queue/resume.
- [x] COLLAB-016 AI human-wait/idle/re-resolve/resume.
- [x] COLLAB-017 Local reconnect durability.
- [x] COLLAB-018 Relative cursor/comment positions.
- [x] COLLAB-019 Actor-aware undo.
- [x] COLLAB-020 Save/projection never blocks typing.
- [x] COLLAB-021 No focused full-content reset.
- [x] COLLAB-022 IME safety.
- [x] COLLAB-023 Rich adaptive presence.
- [ ] COLLAB-024 Follow collaborator/AI/presenter.
- [ ] COLLAB-025 Late join/return to presenter.
- [ ] COLLAB-026 Ownership/wait/recovery interactions.

### AI and runs

- [x] AI-001..AI-022: Action Protocol; run state; Tool Registry/schema/permissions/result envelope/batching/domains/policies/recovery/input tools/actions/steering/multi-run; native modality/fallback/file bundle/search/research/full sources/citations/summaries/background jobs—all individually evidenced in traceability.
- [ ] RUN-001..RUN-013: no auto-open; Continue/New thread; compact/hover/click/input/multi-run; checkpoint summaries/reveal; shared renderer; steering; state truth—all individually evidenced in traceability.

### Surfaces, references, sources, settings, compute

- [x] SURFACE-001..SURFACE-017: Library/Workspace/routes/session/splits/minimums/thread/side sessions/fullscreen/sidebar/search/inspector/terminology/selection/typography—all individually evidenced.
- [x] REF-001..REF-009: anchors/adapters/reference/views/insertion/capture/resize/backlinks/suggestions—all individually evidenced.
- [x] CTX-001..CTX-004: viewport picking/registered targets/index/reuse—all individually evidenced.
- [x] SOURCE-001..SOURCE-012: source/evidence/rich AST/streaming and every work-specific citation/provenance contract—all individually evidenced.
- [x] COMMENT-001..COMMENT-005: inspector placement/general+anchored/reveal/orphan/no balloons—all individually evidenced.
- [x] SETTINGS-001..SETTINGS-011: full settings/scopes/defaults/disclosure/all sections/quick drawer—all individually evidenced.
- [x] COMPUTE-001..COMPUTE-010: broker/isolation/autocomplete/constrained/Pyodide/build/PDF/bundle/no local title/scorecard—all individually evidenced.

### Calendar, school, administration, agents, memory

- [x] CAL-001..CAL-008: Calendar registry removal/page/domain/Plan/lane/drag/AI/panel-transfer—all individually evidenced.
- [x] SCHOOL-001..SCHOOL-011: adapter/audit/all supported domains/time/user/admin/sync/truth/materialization/future providers—all individually evidenced.
- [x] ADMIN-001..ADMIN-004: user/school/superadmin real sources plus privacy/freshness—all individually evidenced.
- [x] AGENT-001..AGENT-018: Foundry/questions/dynamic history/composer/sufficiency/mission/evidence/skills/compiler/adaptation/evaluation/routing/reason/improvement/security/releases/catalog—all individually evidenced.
- [ ] MEM-001..MEM-005: hidden navigation/conservative capture/scoped retrieval-correction-deletion/internal tests/no review workflow—all individually evidenced.

### Work types, polish, landing

- [ ] WORK-DOC, WORK-DECK, WORK-QUIZ, WORK-CODE, WORK-PRES, WORK-SHEET, WORK-BOARD, WORK-PLAN, WORK-AGENT, WORK-COMMON, and WORK-PERM each pass dedicated requirements and conformance.
- [ ] POLISH-001..POLISH-010: tokens/hierarchy/per-type UI/stream scheduler/tail shimmer/Live Dock/presence/ownership/morphs/reduced-mobile—all individually evidenced.
- [ ] LANDING-001..LANDING-008: prism narrative/transformation/movement/real collaboration/real product proofs/editorial/no generic patterns/fallback—all individually evidenced.

## Final completion standard

- [ ] New architecture is the active source of truth.
- [ ] Every major work type is functionally strong and shares the common kernels.
- [ ] Collaboration is fine-grained, smooth by construction, and intelligently coordinated.
- [ ] AI action logic matches the quality of human-like visual behavior.
- [ ] Library, Workspace, Calendar, Agents, School, and Settings have distinct useful roles.
- [ ] Citations, references, rich text, and semantic anchors work consistently throughout.
- [ ] School/admin/analytics show truthful real-data states.
- [ ] Advanced power is present without confusing normal interfaces.
- [ ] Functional gates passed before motion and landing work.
- [ ] Final motion is coherent, realtime, and accessibility-aware.
- [ ] Landing demonstrates actual product differentiation.
- [ ] No requirement, migration, acceptance criterion, invariant, or final gate is silently omitted.
