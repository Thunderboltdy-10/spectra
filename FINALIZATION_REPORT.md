# Finalisation Report (2026-03-13)

## Scope completed in this pass
This pass focused on unresolved high-impact items from `CODEX.md` that were still open after earlier waves:
- orchestration quality and dynamic routing behavior
- memory/compaction robustness
- skills runtime integration
- document/web artifact generation quality and consistency
- super-admin member-management UX invariants
- phase/state fidelity in live response UI

## What changed

### 1) Orchestration and routing upgrades
- Added low-signal routing guardrails in [`src/lib/routing/heuristic.ts`](/home/thunderboltdy/ai-school/src/lib/routing/heuristic.ts):
  - short/simple turns now strongly prefer lightweight models
  - expensive/heavy-reasoning models are avoided for trivial prompts
  - diversity guard applies cleanly for simple independent turns
- Added runtime phase events in [`src/lib/orchestrator/pipeline.ts`](/home/thunderboltdy/ai-school/src/lib/orchestrator/pipeline.ts) and client handling in [`src/hooks/use-chat-state.ts`](/home/thunderboltdy/ai-school/src/hooks/use-chat-state.ts):
  - routing/searching/compacting phases are now explicitly surfaced
  - phase animation/state transitions are no longer dependent only on thinking/delta tokens
- Added dynamic synthesis-model reselection for multi-agent runs:
  - pipeline now picks a dedicated synthesis model when appropriate
  - collaborative streaming now accepts synthesis model/fallbacks
  - files: [`src/lib/orchestrator/pipeline.ts`](/home/thunderboltdy/ai-school/src/lib/orchestrator/pipeline.ts), [`src/lib/orchestrator/streaming.ts`](/home/thunderboltdy/ai-school/src/lib/orchestrator/streaming.ts)

### 2) Memory and compaction robustness
- Replaced static compaction trigger with adaptive scheduling in [`src/lib/orchestrator/history.ts`](/home/thunderboltdy/ai-school/src/lib/orchestrator/history.ts):
  - uses turn count + accumulated context density + mode-sensitive thresholds
- Pipeline now calls adaptive scheduling instead of fixed `>20` rule:
  - file: [`src/lib/orchestrator/pipeline.ts`](/home/thunderboltdy/ai-school/src/lib/orchestrator/pipeline.ts)

### 3) Skills as runtime orchestration layer
- Implemented runtime skill library + selector in [`src/lib/orchestrator/skills.ts`](/home/thunderboltdy/ai-school/src/lib/orchestrator/skills.ts):
  - 10+ practical skills (research, citations, concise-chat, document polish, presentation storyline, web artifact, quiz/flashcards, tutoring, code review, planning)
- Integrated skill selection into pipeline:
  - skills injected into system prompt only when route allows `skills`
  - route trace now records skill selection/use
  - files: [`src/lib/orchestrator/pipeline.ts`](/home/thunderboltdy/ai-school/src/lib/orchestrator/pipeline.ts), [`src/lib/orchestrator/trace-labels.ts`](/home/thunderboltdy/ai-school/src/lib/orchestrator/trace-labels.ts)

### 4) Document/web artifact pipeline quality
- Added first-class shared export module to remove drift between backend artifact generation and chat preview export paths:
  - new file: [`src/lib/document-export.ts`](/home/thunderboltdy/ai-school/src/lib/document-export.ts)
- Refactored backend artifact generation to use shared export builders:
  - file: [`src/lib/artifacts.ts`](/home/thunderboltdy/ai-school/src/lib/artifacts.ts)
- Added HTML artifact output support (`.html`) and webpage-capable output path:
  - `webpage` document type parsing added in [`src/lib/document-generator.ts`](/home/thunderboltdy/ai-school/src/lib/document-generator.ts)
  - document mode policy now explicitly supports `webpage` in [`src/lib/prompts/policy.ts`](/home/thunderboltdy/ai-school/src/lib/prompts/policy.ts)
- Upgraded chat document panel to reuse shared export logic and include HTML export + live webpage preview:
  - file: [`src/components/chat/document-panel.tsx`](/home/thunderboltdy/ai-school/src/components/chat/document-panel.tsx)

### 5) Admin/super-admin UX hardening
- Added proactive last-admin constraints in super-admin members UI:
  - disable role downgrades/removal for final remaining admin
  - show explicit inline guard hint to avoid avoidable failing requests
  - file: [`src/app/super-admin/schools/[id]/page.tsx`](/home/thunderboltdy/ai-school/src/app/super-admin/schools/[id]/page.tsx)

### 6) Manual-model wording corrections
- Removed misleading “best model” phrasing from model selector auto option copy/tooltips
- file: [`src/components/chat/chat-composer.tsx`](/home/thunderboltdy/ai-school/src/components/chat/chat-composer.tsx)

## Why this is better than previous approach
- Routing is now less likely to overuse heavyweight models on trivial prompts.
- Orchestration time is now surfaced with clearer, meaningful phase transitions.
- Multi-agent synthesis is no longer hard-tied to the same primary model.
- Compaction is adaptive instead of a brittle fixed-turn threshold.
- Skills are now explicit runtime orchestration primitives, not only static intent.
- Artifact exports are consistent across backend generation and UI export path.
- Webpage/HTML output closes a major gap for visual/interactive deliverables.
- Super-admin UX now prevents known invalid operations before backend rejection.

## Verification performed

### Static checks
- TypeScript compile check passed:
  - `node ./node_modules/typescript/bin/tsc --noEmit`

### Functional checks to run locally
1. Routing sanity
- Send `hi`, `thanks`, and other very short prompts in auto mode.
- Confirm route trace favors lightweight models and concise outputs.

2. Phase fidelity
- Send a search-heavy prompt and confirm phase transitions include routing/searching before generation.
- Send long-thread prompt and confirm compaction phase appears when triggered.

3. Multi-agent synthesis model
- Run a complex research prompt that triggers collaboration.
- Inspect route trace toolchain for `Synthesis model adjusted`.

4. Skills runtime
- Run document/research prompts and inspect route trace toolchain for runtime skills.
- Confirm response behavior aligns with selected skill guidance.

5. Document/web artifacts
- Ask for a document with `html` or “interactive web page” explicitly.
- Confirm `.html` artifact appears in downloads and preview renders webpage content.
- Confirm docx/pdf/pptx exports still work.

6. Super-admin member safeguards
- In a school with one admin, verify UI prevents downgrading/removing that admin.
- Verify backend still blocks any direct invalid API attempt.

## Ledger updates
- `CODEX.md` was updated to mark resolved items fixed only after implementation + compile verification for this pass.

## Additional closure updates in this pass
- Unified strict paid-model pricing policy behavior around explicit 30/M in+out cap and unknown-priced paid model exclusion in runtime eligibility:
  - [`src/lib/model-selection.ts`](/home/thunderboltdy/ai-school/src/lib/model-selection.ts)
  - [`src/app/api/models/live/route.ts`](/home/thunderboltdy/ai-school/src/app/api/models/live/route.ts)
  - [`src/app/api/models/route.ts`](/home/thunderboltdy/ai-school/src/app/api/models/route.ts)
- Improved manual-model restriction conflict guidance by returning concrete alternatives when lock is invalid:
  - [`src/lib/orchestrator/pipeline.ts`](/home/thunderboltdy/ai-school/src/lib/orchestrator/pipeline.ts)
- Reduced false-positive live-search auto-triggering in heuristics:
  - [`src/lib/auto-settings.ts`](/home/thunderboltdy/ai-school/src/lib/auto-settings.ts)
- Added graceful timeout fallback for collaborative task-graph execution (timeout now degrades to skipped nodes instead of hard error):
  - [`src/lib/orchestrator/task-graph.ts`](/home/thunderboltdy/ai-school/src/lib/orchestrator/task-graph.ts)
- Standardized school allocation naming toward member-based semantics (`maxMembers` alias) in super-admin API/UI while keeping backend compatibility:
  - [`src/app/api/super-admin/schools/route.ts`](/home/thunderboltdy/ai-school/src/app/api/super-admin/schools/route.ts)
  - [`src/app/api/super-admin/schools/[id]/route.ts`](/home/thunderboltdy/ai-school/src/app/api/super-admin/schools/[id]/route.ts)
  - [`src/app/super-admin/schools/new/page.tsx`](/home/thunderboltdy/ai-school/src/app/super-admin/schools/new/page.tsx)
  - [`src/app/super-admin/schools/[id]/page.tsx`](/home/thunderboltdy/ai-school/src/app/super-admin/schools/[id]/page.tsx)
- Added explicit allocation-state guard on super-admin role updates to avoid mutating memberships while org allocation is already exceeded:
  - [`convex/superAdmin.ts`](/home/thunderboltdy/ai-school/convex/superAdmin.ts)

## Completion Update (2026-03-14)

### Additional finalisation changes completed
- Added staged orchestration planning to the task-graph so collaborative runs are dependency-aware instead of flat fan-out:
  - new `workflow_planner` node and planner-gated dependencies in [src/lib/orchestrator/task-graph.ts](/home/thunderboltdy/ai-school/src/lib/orchestrator/task-graph.ts)
  - specialist support for planner role in [src/lib/orchestrator/specialists.ts](/home/thunderboltdy/ai-school/src/lib/orchestrator/specialists.ts)
  - deeper collaboration wall-time/subcall budgets in [src/lib/orchestrator/pipeline.ts](/home/thunderboltdy/ai-school/src/lib/orchestrator/pipeline.ts)
- Upgraded custom color semantics so primary/secondary propagate through accents, gradients, mode colors, and surface hierarchy:
  - [src/app/globals.css](/home/thunderboltdy/ai-school/src/app/globals.css)
  - [src/app/layout.tsx](/home/thunderboltdy/ai-school/src/app/layout.tsx)
  - [src/components/chat/unified-panel.tsx](/home/thunderboltdy/ai-school/src/components/chat/unified-panel.tsx)
- Removed settings drift risk by making the side drawer render the same shared settings view as unified panel:
  - exported shared view from [src/components/chat/unified-panel.tsx](/home/thunderboltdy/ai-school/src/components/chat/unified-panel.tsx)
  - rewired drawer in [src/components/chat/chat-settings-drawer.tsx](/home/thunderboltdy/ai-school/src/components/chat/chat-settings-drawer.tsx)
- Consolidated admin/super-admin control navigation to reduce fragmented sub-pane flows:
  - section jump navigation in [src/app/admin/page.tsx](/home/thunderboltdy/ai-school/src/app/admin/page.tsx)
  - "All Sections" integrated control tab in [src/app/super-admin/schools/[id]/page.tsx](/home/thunderboltdy/ai-school/src/app/super-admin/schools/[id]/page.tsx)
- Standardized max-resource-file-size control path across admin and super-admin with backend enforcement:
  - admin API + mutation path now supports `maxResourceFileSizeBytes`
  - [src/app/api/admin/settings/route.ts](/home/thunderboltdy/ai-school/src/app/api/admin/settings/route.ts)
  - [convex/admin.ts](/home/thunderboltdy/ai-school/convex/admin.ts)
  - admin UI control in [src/app/admin/page.tsx](/home/thunderboltdy/ai-school/src/app/admin/page.tsx)
- Implemented a template-based export system for DOCX/PDF/PPTX/HTML (single style system, better typography and structure):
  - [src/lib/document-export.ts](/home/thunderboltdy/ai-school/src/lib/document-export.ts)
- Improved source surfacing and trust UX by showing live source pills whenever search citations exist (not research-mode only):
  - [src/components/chat/chat-message.tsx](/home/thunderboltdy/ai-school/src/components/chat/chat-message.tsx)
- Added model diversity balancing in ranking to reduce repeated heavy-model reuse when equivalent alternatives exist:
  - [src/lib/model-selection.ts](/home/thunderboltdy/ai-school/src/lib/model-selection.ts)

### Why this is better
- Multi-agent orchestration now supports staged reasoning with explicit dependency flow, reducing brittle one-shot fan-out behavior.
- UI theming behaves like a true primary/secondary color system instead of mostly accent-only overrides.
- Settings behavior is now driven by one shared rendering path, preventing future drift between panel implementations.
- Admin and super-admin control journeys are easier to navigate end-to-end on a single page.
- File-size policy management is consistent between role surfaces and actually enforced in backend mutation logic.
- Exported artifacts now follow a coherent design template layer and produce materially better document quality.
- Search-backed responses now surface sources more consistently for user trust and verification.

### Verification run in this update
- TypeScript compile: `node .\\node_modules\\typescript\\bin\\tsc --noEmit` -> pass
- Targeted ESLint on touched files:
  - `node .\\node_modules\\eslint\\bin\\eslint.js ...` -> pass
- Attempted targeted Vitest:
  - `node .\\node_modules\\vitest\\vitest.mjs run src/lib/__tests__/routing.test.ts`
  - blocked by optional dependency resolution in this environment (`@rollup/rollup-win32-x64-msvc` missing under UNC/Windows node runtime)
