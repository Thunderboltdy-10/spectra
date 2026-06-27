# Wave 7.5 - Audit, Shared Chat/Workspace Repair, and Multi-Artifact Foundations

Created: 2026-06-27.

This file is the Wave 7.5 continuation source of truth. After context compaction or agent handoff, reload this file before continuing implementation. It records the requested scope, the audit map found so far, the fixes already started, and the remaining work. Do not treat this as final completion evidence until the verification section is filled with passing checks and the final implementation report is appended.

## Wave Definition

Wave 7.5 is not Wave 8. It is an architecture and product-quality stabilization pass before Wave 8 begins.

The product principle is:

```text
/chat and /workspace must share the same underlying Thread -> Message -> AIRun -> ResultCard -> Artifact/Workspace object system.
```

The visual direction is refined, work-focused Spectra: warm paper cards, clear hierarchy, compact but legible panels, live state cues, and useful motion. Avoid generic placeholder UI and avoid duplicating product logic by surface.

The screenshots referenced in the prompt could not be read from the provided Windows temp paths in this environment. The observed issues in the prompt are still accepted as product evidence and drove the audit.

## Documentation Read

Read before implementation:

- `docs/spectra-rebuild/02_CORE_ARCHITECTURE.md`
- `docs/spectra-rebuild/03_AI_RUNS_THREADS_RESULT_CARDS.md`
- `docs/spectra-rebuild/04_UI_UX_DIRECTION.md`
- `docs/spectra-rebuild/generated/WAVE_5_THREADS_CHAT_CONVERGENCE.md`
- `docs/spectra-rebuild/generated/WAVE_5_5_CONVERSATION_WORKSPACE_STABILIZATION.md`
- `docs/spectra-rebuild/generated/CARD_SYSTEM_LANGUAGE_AND_IMPLEMENTATION_MAP.md`
- `docs/spectra-rebuild/ui-card-patterns/` visual references were noted as required for card work, but the image-level detailed inspection still needs to be done before final card polish.

Skill used:

- `frontend-design` at `<local-workspace>`

## Current Architecture Map

### Active Spectra Routes And Shells

- `/chat` renders `src/features/spectra/pages/chat-shell.tsx`.
- `/workspace` renders `src/features/spectra/pages/workspace-shell.tsx`.
- `/artifacts` renders `src/features/spectra/pages/artifacts-shell.tsx`.
- The active AI run endpoint is `src/app/api/spectra/run/route.ts`.
- The non-stream Spectra API wrapper is `src/app/api/spectra/route.ts`.

### Active Data Model

- Threads: `convex/spectraThreads.ts`, table `spectraThreads`.
- Messages: `convex/spectraThreads.ts`, table `spectraMessages`.
- Runs/result cards: `convex/spectraRuns.ts`, tables `spectraAiRuns`, `spectraResultCards`.
- Operations: `convex/spectraOperations.ts`, table `spectraOperations`.
- Artifacts: `convex/spectraArtifacts.ts`, table `spectraArtifacts`.
- Workspace placement: `convex/spectraWorkspaceItems.ts`, table `spectraWorkspaceItems`.

### Shared UI Layers

- Conversation renderer: `src/features/spectra/components/conversation-surface.tsx`.
- Thread embedded view: `ThreadConversation` in `conversation-surface.tsx`.
- Run/right panel: `src/features/spectra/components/run-detail-panel.tsx`.
- Composer: `src/features/spectra/components/command-bar.tsx`.
- Context/focus controls and search: `src/features/spectra/components/context-controls.tsx`.
- Result card stack: `src/features/spectra/components/result-card.tsx`.
- Artifact card primitives: `src/features/spectra/components/card-system.tsx` and `artifact-card.tsx`.
- Artifact editor/panels: `src/features/spectra/components/artifact-studio.tsx`.
- Global command palette: `src/components/command-palette.tsx`.

## Audit Findings So Far

### 1. Thread Lifecycle Is Mostly Universal, But UI Still Treats Runs As Separate Local Conversations

Observed:

- `src/app/api/spectra/run/route.ts` creates a `spectraThread` before every new run, including workspace quick chat.
- The server appends the user message immediately with client id `user:${runId}`.
- The server appends one assistant message at final/confirmation.
- This is already aligned with the universal thread principle.

Problem:

- Workspace and artifacts shells still use `SpectraSessionProvider` local session threads for run details.
- `RunDetailPanel` fabricated a `temporary:${runId}` thread from run details and then appended local session messages.
- This is a direct source of duplicated user prompts in right-panel threads and divergence between `/chat` and workspace right panels.
- The UI still exposes stale "temporary" concepts in code and local storage even though all new runs now have real threads.

Root fix direction:

- Right-panel run/thread surfaces should open the real `spectraThread` whenever `run.threadId` exists.
- Local/session run conversation paths should be removed or reduced to a fallback only for legacy runs with no thread id.
- Result cards should carry/resolve thread identity directly, not force "keep" conversion for new runs.

### 2. Thread Naming Happens Too Late And Is Too Long

Observed:

- `convex/spectraThreads.create` defaulted to `"New thread"` unless a title was passed.
- `appendMessage` replaced `"New thread"` with up to 8 words from the first prompt.
- `applyGeneratedMetadata` can improve titles after model completion, but this is too late for live tabs/cards.
- Model prompt allowed generated titles up to 7 words, which is too long for narrow right panels.

Root fix direction:

- Generate a short local title immediately when creating the thread.
- Keep model title as optional early refinement after the first response.
- Cap generated/fallback titles to around 2-4 useful words in UI and backend.

### 3. Thinking/Reasoning Traces Leak Provider Reasoning

Observed:

- `readOpenRouterResponse` can emit provider `reasoning`.
- `src/app/api/spectra/run/route.ts` forwarded that as `reasoning_delta`.
- `useSpectraRun` stored it in `liveExchange.reasoning`.
- `ConversationSurface` rendered it through `ProviderThinking`.

Problem:

- This can expose raw private/provider reasoning or planner-like text.
- It can become huge paragraphs with duplicate tokens.
- It creates inconsistent "thinking trace" behavior separate from operation traces and status cards.

Root fix direction:

- Do not expose provider reasoning to the client.
- Convert public progress into structured trace steps derived from safe `status`, `operation_preview`, and `operation_result` events.
- Use the same compact progress trace in `/chat`, right panels, and quick chat.
- Persist completed traces via run/operation/card records, not private reasoning text.

### 4. Markdown And Math Rendering Is Already Centralized But Needs Reuse Guarantees

Observed:

- `src/components/chat/rich-text.tsx` uses React Markdown, GFM, remark-math, KaTeX, and highlight.
- `ConversationSurface` uses `RichText` for assistant messages and live streamed content.
- Legacy `src/components/chat/markdown-renderer.tsx` still exists for non-Spectra chat paths.

Remaining risks:

- Result card summaries and compact tab summaries are plain text.
- Right-panel and full chat share `ConversationSurface`, but fabricated run details bypassed real thread details.
- Need check that artifact-related assistant summaries and action summaries do not show raw markdown/LaTeX in compact surfaces.

### 5. Technical Leakage Is Present In Errors And Tool Contracts

Observed:

- `publicError` returned messages such as `Invalid AI plan at operations.0.input.artifactId`.
- The system prompt includes internal field names because the model must produce a strict plan, but user-facing output must not expose them.
- `src/lib/orchestrator/action-engine.ts` legacy paths still contain errors like `"artifactId is required"`, but this may be inactive for Spectra routes.

Root fix direction:

- Sanitize all user-facing Spectra route errors.
- Ensure assistant `finalResponse` instruction forbids ids, raw JSON, schema names, route names, and planner internals.
- Audit legacy active routes separately if they still surface in current app shell.

### 6. Dirty State Exists But Needs Hardening

Observed:

- `ArtifactEditor` computes dirty state by comparing local editable state against a JSON baseline derived from artifact props.
- Close prompts are shown when `dirty` is true.
- Saving calls `onSave`, then `setDirty(false)`.

Risk:

- The baseline is tied to current props. A save followed by delayed refresh can briefly compare local state against stale props and mark the artifact dirty again.
- AI edits and external artifact refreshes need to update local baseline only when safe.

Root fix direction:

- Store an explicit editable baseline per artifact id.
- Reset baseline after save.
- Reset local editor state on artifact switch.
- If artifact props change and editor is clean, adopt the new baseline.
- If artifact props change while dirty, keep local edits and surface conflict/refresh state rather than silently overwriting.

### 7. Command Palette Has Duplicate Shortcut Owners

Observed:

- Global palette: `src/components/command-palette.tsx` listens to Cmd/Ctrl+K at capture phase.
- Spectra search: `GlobalSearch` in `src/features/spectra/components/context-controls.tsx` also listens to Cmd/Ctrl+K at capture phase and calls `stopImmediatePropagation`.
- KBar provider also has `toggleShortcut: "$mod+shift+k"` while custom listener handles Cmd/Ctrl+K.

Problem:

- Pressing Cmd/Ctrl+K can open more than one palette/search surface depending on listener order and page composition.

Root fix direction:

- Keep one app command palette shortcut.
- Convert Spectra search into command-palette actions/results or trigger it through custom events, not its own global shortcut.
- Use the newer workspace/artifact-aware command registry as the base.

### 8. Focus Model Is Single-Mode, Not True Multi-Focus

Observed:

- `ContextFocusControl` chooses one primary `ComposerFocusMode`: global/workspace/artifact/selection/thread.
- It can display "`thread + artifact`" but the control itself is single-select.
- Workspace shell can send `selectedArtifactIds`, one `artifactId`, one `workspaceId`, and one `threadId`.

Problem:

- User cannot clearly select thread plus multiple artifacts plus workspace as separate visible chips.
- The UI does not make "next input will continue current thread" vs "next input creates new thread with selected context" clear enough in `/chat`.

Root fix direction:

- Introduce shared focus model with visible chips:
  - max one thread
  - optional workspace/global
  - one or more artifacts
  - selected objects
- Keep backend request shape compatible initially by deriving existing fields from the focus model.
- In `/chat`, clearing thread focus must visually enter a clean new chat state before send.

### 9. Multi-Artifact Tiling Is Not Implemented Yet

Observed:

- `useArtifactStudioState` supports multiple artifact tabs, but only one active split panel.
- Workspace can show one artifact split plus one thread split.
- There is no tiled multi-artifact work surface.
- Multi-select exists as context selection only.

Root fix direction:

- Add local UI state for open artifact tiles independent of DB.
- Support adaptive tiling for 2, 3, 4+ artifacts.
- Keep workspace/home visible by default.
- Add local work-set/isolate action, likely label: "Focus this set".
- Persist latest multi-selection in `localStorage`, not DB.

### 10. Multi-Select Exists But Is Incomplete

Observed:

- Workspace and Artifacts support selection mode through `selectedContextIds`.
- Home has `GlobalSearch` selection but no obvious persistent multi-select restoration.
- Ctrl/Cmd-click toggle does not appear implemented consistently on cards.
- The current selection is React state only.

Root fix direction:

- Persist latest selection to `localStorage`.
- Add Ctrl/Cmd-click handling to artifact cards/list rows where safe.
- Add clear all, tile selected, focus this set actions.
- Batch open selected artifacts without visible one-by-one flicker.

### 11. Card System Exists But Needs State Coverage And Bug Audit

Observed:

- Global card state CSS exists for `selected`, `focused`, `context`, `continued`, `edited`, `confirmation`, `failed`, `disabled`, `archived`, `creating`, `updating`.
- Missing explicit CSS states: `active`, `completed`, `multi-selected`, `drag-preview`, `drop-target`.
- Some local components still use custom selected backgrounds and may leave stale selected visuals.
- Icon treatment still sometimes uses bordered boxes.

Root fix direction:

- Extend `SpectraCardState`.
- Add CSS for missing states.
- Audit artifact/workspace/thread/welcome/result cards and convert ad hoc state styles to `data-card-state`.
- Ensure deselection removes state source, not only visual class.

### 12. Workspace Switching Is Partially Optimized But Needs Command/Loading Audit

Observed:

- `getSpectraOverview` and `getSpectraWorkspace` use a 5-minute client cache.
- `loadWorkspace` peeks cache and can update selected workspace immediately.
- Some refreshes still call broad `getSpectraOverview(selectedWorkspaceId, true)` after operations.

Root fix direction:

- Keep cached shell/header visible during transitions.
- Avoid forced full overview refresh for local-only UI operations.
- Split command palette object search from broad page refreshes.
- Add optimistic updates where safe.

### 13. AI Context Is Bounded But Still Broad

Observed:

- `buildContext` fetches:
  - 36 artifacts for every run
  - 30 workspaces
  - workspace items for current workspace
  - focused artifact
  - selected artifacts
  - thread messages
  - 12 recent runs
- `buildBoundedContextPacket` further bounds content.

Risk:

- Simple artifact edits may still include too much catalog context.

Root fix direction:

- For artifact-focused edits, fetch focused + selected + current workspace metadata first.
- Fetch global catalog only when focus is global/search-like or prompt asks for broader context.
- Keep answer-only runs lean.

### 14. Affected Object Cards Exist For Artifacts Only

Observed:

- `ConversationSurface` renders affected artifacts from operation traces.
- `ResultCardStack` can open artifact action target.

Remaining:

- Workspace affected cards are not rendered in assistant response.
- Whole card should be clickable, not only tiny open button.
- `/chat` -> `/workspace` navigation for affected workspace/thread context needs explicit handling.

### 15. K-Bar Is Not Yet The App Command Center

Observed:

- Global `CommandPaletteProvider` still lists legacy app actions and legacy workspace search bridge.
- Spectra-specific `GlobalSearch` is separate and local.

Root fix direction:

- Build shared command registry with:
  - open workspace/artifact/thread
  - create artifact/thread
  - move artifact
  - send to inbox
  - focus/add/remove focus items
  - tile selected
  - clear selection
  - focus this set
  - fallback "Send as Spectra request"
- Ensure one shortcut and strong fuzzy matching.

## Requested Scope Checklist

### A. Critical UX And Correctness

- [x] Unsaved changes prompt: explicit artifact editor baselines now reset on artifact switch/save and adopt incoming AI/server updates when clean.
- [x] Right-panel duplication: run detail now opens the real shared thread when available instead of fabricating a local duplicate conversation.
- [x] Thread naming: new run-created threads receive immediate short fallback titles; backend title cleanup caps long/generated titles.
- [~] Thread creation timing/tabs: server already creates thread before run; UI still needs immediate workspace tab/card visibility audit.
- [x] `/workspace` quick chat and `/chat` universal: active UI now uses durable threads; obsolete client-local Spectra session continuation state has been removed.
- [x] Remove temporary/persistent language and legacy active UI paths: user-facing copy changed and active UI no longer imports `SpectraSessionProvider`/`useSpectraSession`.

### B. Formatting, Rendering, Output Quality

- [~] Markdown/math everywhere: shared `RichText` exists in conversations and result summaries; secondary object-library/card snippets still need a compact-render audit.
- [~] Prevent technical leakage: Spectra route errors now sanitize ids/schema/planner/Convex details; prompt/finalResponse guard still needs broader regression tests.
- [x] Thinking traces: public live progress now uses structured trace steps and Spectra no longer streams provider reasoning to the UI.
- [~] Streaming text animation: existing text deltas stream; need smoothness/autoscroll checks.

### C. Performance And Token Efficiency

- [ ] Workspace switching and commands: audit and optimize broad refresh/query paths.
- [~] AI edits too slow: focused artifact runs now skip the broad artifact catalog unless the prompt/focus requires it; broader route/query profiling remains.

### D. Cards, States, Polish

- [~] Card state bugs: shared card state union/CSS now covers active, completed, multi-selected, drag-preview, and drop-target; full component-by-component state audit remains.
- [ ] Welcome cards: redesign `/chat` and workspace welcome cards using Spectra card language.
- [ ] Document hover controls: inspect Tiptap drag handle/plus positioning and fix drift.
- [ ] Responsive scaling: audit narrow panels, right panels, tiled layouts, `/chat`, multi-select.
- [ ] Micro-interactions: add purposeful state animations, skeletons, panel transitions.
- [ ] Icons/workspace visuals: redesign generic bordered icon treatment and expand workspace icon choices.

### E. Focus And Context Model

- [x] Focus is deceptive: selection now wins as primary context even while a continued thread supplies history; context dropdown names additional selected/thread focus.
- [~] Multi-focus support: visible chip-based focus exists and selected artifacts/thread history are sent together; `/chat` still has no artifact multi-select surface.

### F. Placement And Affected Objects

- [~] Thread placement: server creates thread with `workspaceId` when workspace/artifact context sent; need mixed-artifact rule and UI surfacing.
- [x] Affected objects: artifact/workspace result cards render under AI responses; artifact cards are now whole-card clickable and removal operations record workspace/artifact affected objects.

### G. Multi-Artifact Tiled Workspace

- [x] Multiple artifacts open together.
- [x] Multi-select behavior with Ctrl/Cmd-click and localStorage restoration: workspace/artifacts selections persist locally and Workspace Home now supports multi-select.
- [x] "Keep together" isolated group rail. Implemented as "Focus this set".
- [~] Dragging/moving artifacts between workspaces and Inbox: explicit move-to-workspace and move-to-Inbox actions are implemented; drag-and-drop movement remains open.

### H. K-Bar

- [x] Duplicate K-bars: Spectra `GlobalSearch` no longer owns Cmd/Ctrl+K; the app-level command palette remains the shortcut owner.
- [ ] Powerful context-aware command center.

### I. Workspace Home And Navigation

- [~] Opening workspace from home: exists; skeleton/loading needs polish and duplicate tab prevention audit.
- [x] Selecting multiple artifacts from home.

### J. AI Mutations And Live Updates

- [ ] Aggressive AI mutations with accept/reject and visible affected-object changes.

### K. Implementation Quality

- [x] Shared thread lifecycle.
- [x] Shared thread renderer.
- [~] Shared markdown/math renderer: complete for conversations/result summaries; compact object snippets still need audit.
- [x] Shared thinking/progress trace component.
- [~] Shared focus/context model: shared mode/control exists; full chat-side multi-object selection remains open.
- [~] Shared object card/state system: core state system exists; secondary library/card consolidation remains open.
- [x] Shared K-bar command registry.
- [x] Shared artifact panel/tile primitives.
- [x] Shared AI action result object cards.

## Implementation Completed In This Pass

These changes are implemented and validated in the final working tree:

1. `convex/spectraThreads.ts`
   - Tightened `cleanTitle` to remove filler words and cap titles to 4 words / 48 chars.

2. `src/app/api/spectra/run/route.ts`
   - Added `fallbackThreadTitle(prompt)` and passed it into `spectraThreads:create` so a useful title exists immediately.
   - Sanitized `publicError` so user-facing failures do not expose `artifactId`, `workspaceId`, `threadId`, JSON/schema/planner/Convex details.
   - Stopped forwarding provider reasoning into Spectra stream events.

3. `src/features/spectra/ai/stream-events.ts`
   - Removed `reasoning_delta` from the client-accepted stream schema.

4. `src/features/spectra/ai/use-spectra-run.ts`
   - Replaced `liveExchange.reasoning` with structured live `steps`.
   - Added status-to-step mapping for public progress.
   - Added step updates on status, operation preview, operation result, and final.

5. `src/features/spectra/components/conversation-surface.tsx`
   - Replaced `ProviderThinking` raw reasoning UI with `ProgressTrace`.
   - Live progress trace now uses short status steps rather than raw provider reasoning.

6. `src/features/spectra/components/run-detail-panel.tsx`
   - For runs with `run.threadId`, renders shared `ThreadConversation` instead of the fabricated `temporary:${runId}` thread.
   - Stops appending local session messages to fabricated run detail conversation.
   - Changed visible right-panel subtitle from "Run conversation" to "Thread".

7. `src/app/api/spectra/route.ts`
   - Replaced internal parameter-validation messages with natural product language such as "Choose a workspace first."

8. `src/features/spectra/components/artifact-studio.tsx`
   - Added explicit artifact editor snapshots/baselines.
   - Dirty state now compares editable state against the active baseline instead of transient props.
   - Saving resets the baseline to the saved payload.
   - Incoming artifact/AI updates are adopted when the editor is clean.
   - Child editors are keyed by artifact id so switching artifacts resets editor-local state.

9. `src/features/spectra/components/context-controls.tsx`
   - Removed the duplicate Cmd/Ctrl+K listener from Spectra `GlobalSearch`.
   - `GlobalSearch` now only listens for Escape when already open.

10. `src/features/spectra/components/card-system.tsx`, `src/features/spectra/components/artifact-card.tsx`, `src/app/globals.css`
   - Added card states for `active`, `completed`, `multi-selected`, `drag-preview`, and `drop-target`.
   - Added Ctrl/Cmd-click artifact-card selection toggles where `onToggleContext` is provided.
   - Added corresponding visual state CSS.

11. `src/features/spectra/pages/workspace-shell.tsx` and `src/features/spectra/pages/artifacts-shell.tsx`
   - Persist latest multi-selection locally in `localStorage`, not the database.
   - Restore latest local selection when entering selection mode.
   - Clear-all removes both UI state and persisted local selection.

12. `src/features/spectra/pages/chat-shell.tsx`
   - Removed stale "persistent thread" user-facing language.

13. Lint/typecheck cleanup outside Spectra required to make the repo-wide checks pass:
   - `src/app/flashcards/page.tsx`
   - `src/components/feedback-widget.tsx`
   - `src/components/global-utility-dock.tsx`
   - `src/components/study-timer.tsx`
   - `src/hooks/use-chat-panel.ts`
   - `src/components/workspace-v2/app.tsx`

Final follow-up state:

- New Wave 7.5 run/detail flows no longer depend on fabricated local run conversations. Workspace and Artifacts shells now open run details by active run id, and `RunDetailPanel` renders the real thread when `run.threadId` exists. The remaining local session API is retained as a legacy compatibility layer, not as the primary current-thread path.
- The multi-artifact tiled workspace, focused local work set, multi-select persistence, K-bar Spectra registry, affected workspace cards, real-thread result-card continuation, context visibility, placement inference, and focused-context token reduction are implemented in this pass.
- Browser/E2E interaction testing was not run because the repository validation requirements explicitly prioritized non-browser checks. The code-level checks below passed.

## Deep Active-Stack Audit Addendum - 2026-06-27

This addendum documents the deeper audit requested after the earlier Wave 7.5 work. Where this section conflicts with older checklist wording above, treat this section as the current source of truth. The older phase checklist is stale in several places: it still lists some tasks as open even though the implementation and final report later in this file show them as complete.

Files and areas read during this audit:

- Active routes and providers: `src/app/chat/page.tsx`, `src/app/workspace/page.tsx`, `src/app/artifacts/page.tsx`, `src/app/api/spectra/route.ts`, `src/app/api/spectra/run/route.ts`, `src/components/providers.tsx`.
- Active chat/workspace/artifact shells and shared UI: `src/features/spectra/pages/chat-shell.tsx`, `src/features/spectra/pages/workspace-shell.tsx`, `src/features/spectra/pages/artifacts-shell.tsx`, `src/features/spectra/components/conversation-surface.tsx`, `src/features/spectra/components/run-detail-panel.tsx`, `src/features/spectra/components/result-card.tsx`, `src/features/spectra/components/artifact-studio.tsx`, `src/features/spectra/components/artifact-tile-surface.tsx`, `src/features/spectra/components/context-controls.tsx`, `src/features/spectra/components/command-bar.tsx`, `src/features/spectra/components/artifact-card.tsx`, `src/features/spectra/components/card-system.tsx`, `src/features/spectra/components/object-library.tsx`, `src/features/spectra/components/spectra-view-model.ts`, `src/features/spectra/components/workspace-tab-state.ts`.
- Active AI and operation layers: `src/features/spectra/ai/use-spectra-run.ts`, `src/features/spectra/ai/stream-events.ts`, `src/features/spectra/ai/context-builder.ts`, `src/features/spectra/ai/openrouter-stream.ts`, `src/features/spectra/ai/model-config.ts`, `src/features/spectra/ai/tool-contract.ts`, `src/features/spectra/operations/schema.ts`, `src/features/spectra/operations/policy.ts`, `src/features/spectra/operations/validate-plan.ts`, and the Spectra blueprints.
- Convex persistence layer: `convex/spectraThreads.ts`, `convex/spectraRuns.ts`, `convex/spectraArtifacts.ts`, `convex/spectraWorkspaceItems.ts`, `convex/spectraShared.ts`, `convex/spectraWorkspaces.ts`, `convex/spectraOperations.ts`, `convex/spectraArtifactLinks.ts`, and the Spectra schema region in `convex/schema.ts`.

Confirmed as implemented:

- `/api/spectra/run` creates a durable `spectraThread` before new runs, appends the user message with a deterministic `clientMessageId`, emits `thread_ready`, and persists a single assistant message at final/confirmation time.
- `convex/spectraThreads.appendMessage` deduplicates user messages by `clientMessageId` and upserts assistant messages by run, which protects current run persistence from duplicate streamed completions.
- `RunDetailPanel` renders `ThreadConversation` for runs with `threadId`, so the right panel uses the real thread instead of a fabricated local conversation.
- Provider reasoning is no longer part of the client stream contract. The UI displays safe progress/status via `ProgressTrace` instead of raw provider reasoning.
- `ConversationSurface` uses `RichText` for assistant and live messages, which gives `/chat`, right-panel threads, and shared conversation rendering the same markdown/math renderer.
- `ArtifactStudioEditor` has baseline-based dirty tracking: saving resets the baseline, clean incoming artifact changes are adopted, and dirty incoming changes do not silently overwrite local edits.
- Multi-artifact tiling is present through `ArtifactTileSurface`, `tileArtifactIds`, and the "Focus this set" workflow in workspace/artifacts shells.
- Multi-selection persistence exists locally in workspace/artifacts shells.
- The global command palette includes Spectra object/thread search, move/place actions, send to Inbox, tile selected, focus set, clear selection, start new thread, and Ask Spectra fallback. `GlobalSearch` no longer owns Cmd/Ctrl+K.
- Shared card state coverage includes `active`, `completed`, `multi-selected`, `drag-preview`, and `drop-target`.
- Context building is partially optimized. `buildBoundedContextPacket` only includes the broad catalog for broad/global prompts, but the API route still fetches broad artifact/workspace catalogs for validation and relevance.
- Affected artifact and workspace cards render under assistant messages in `ConversationSurface`. `WorkspaceResult` is whole-card clickable.

Open issues and gaps after this continuation pass:

- `/chat` still has no direct multi-artifact selection surface, although workspace/artifacts can send selected artifacts with continued thread history.
- Secondary object-library/card snippets still need a compact markdown/math rendering audit.
- Live progress steps are not persisted as the exact same trace list shown during streaming. Persisted state comes from run/operation/card traces.
- `ObjectLibrary` and some secondary local views still use ad hoc card layouts/state and have not been fully consolidated with the shared card system.
- Drag-and-drop movement between workspaces and Inbox remains open. Explicit move-to-workspace and move-to-Inbox actions are implemented.
- Browser/manual interaction testing has not been run in this audit pass.

Validation status during the 2026-06-27 audit:

- `node.exe node_modules/typescript/bin/tsc --noEmit` passed before the local-session cleanup edits.
- `node.exe node_modules/eslint/bin/eslint.js . --max-warnings=0` passed before the local-session cleanup edits.
- `node.exe node_modules/convex/bin/main.js codegen` failed with `401 MissingAccessToken`; Convex auth is required.
- `node.exe node_modules/vitest/vitest.mjs run` failed at startup because Windows Node resolved a missing Windows rolldown optional dependency while `node_modules` contains Linux optional dependencies. This appears to be a runtime/dependency-platform mismatch, not a Spectra test failure.

In-progress working-tree changes at this checkpoint:

- `src/features/spectra/ai/use-spectra-run.ts` no longer accepts or sends `localConversation`.
- `src/app/api/spectra/run/route.ts` no longer accepts `localConversation`, no longer prepares browser-local conversation context, and now builds model conversation only from persisted thread history excluding the current user prompt.
- `src/features/spectra/pages/workspace-shell.tsx` has had `useSpectraSession`, `activeLocalThread`, `localConversation`, `appendLocalExchange`, local placeholders, and local active-run fallbacks removed.
- `src/features/spectra/pages/artifacts-shell.tsx` has had the same local/session conversation path removed and now uses durable `composerThread` state for placeholders/context/active-run behavior.

Immediate continuation steps from the audit checkpoint are complete except for browser/manual interaction testing.

Continuation progress in this follow-up pass:

- Removed active UI dependencies on `useSpectraSession`, removed `SpectraSessionProvider`, and deleted the obsolete client-local `src/context/spectra-session-context.tsx`.
- Removed `localConversation` from the active `/api/spectra/run` request path and from `useSpectraRun`.
- Added a `text_replace` stream event and client handling so a failed primary provider cannot leave partial public text appended before fallback output.
- Made selected artifacts the natural primary focus before continued-thread mode in workspace/artifacts, while still sending `threadId` for conversation history.
- Made the focus dropdown describe selected objects as additional thread focus.
- Made affected artifact result cards whole-card clickable and keyboard accessible.
- Returned `workspaceId` from `spectraWorkspaceItems.hide` and recorded workspace/artifact affected objects for placement removals.
- Added Workspace Home multi-select wiring through `ObjectLibrary` and the existing selection action bar.
- Added a visible artifact-editor remote-update conflict banner with "Keep local edits" and "Reload latest" actions.
- Rendered result-card summaries through the shared `RichText` renderer in compact mode.
- Added a narrow context path for focused artifact runs so the route skips the broad artifact catalog unless broad/global/selection/workspace context is needed.
- Added move-to-workspace and move-to-Inbox API/UI actions for workspace object libraries. Drag-and-drop movement is still open.

Validation after these changes:

- WSL Node `<local-workspace> node_modules/typescript/bin/tsc --noEmit` passed.
- WSL Node `<local-workspace> node_modules/vitest/vitest.mjs run src/features/spectra/__tests__/wave4-operation-engine.test.ts` passed.
- WSL Node `<local-workspace> node_modules/eslint/bin/eslint.js . --max-warnings=0` passed.
- WSL Node `<local-workspace> node_modules/vitest/vitest.mjs run` passed: 72 test files passed, 1 skipped; 382 tests passed, 3 skipped.
- `PATH=<local-workspace> node node_modules/convex/bin/main.js codegen` passed.
- `PATH=<local-workspace> node node_modules/next/dist/bin/next build` passed. Running the absolute node binary without putting its directory on `PATH` caused Turbopack to fail spawning a child `node` process; the PATH-correct command passed.

## Next Implementation Plan

### Phase 1 - Make Current Patch Compile And Preserve Universal Threads

1. Remove `reasoning_delta` emission from `src/app/api/spectra/run/route.ts`.
2. Update tests that asserted reasoning deltas if they hit Spectra stream events. Keep lower-level OpenRouter reasoning extraction tests only if they do not expose reasoning to UI.
3. Make `ResultCardStack.toggleContinuation` use existing `run.threadId` where available instead of always `keepRunAsThread`.
4. Add `threadId` to `ResultCardStreamView` or use `card.provenance.threadId`/run detail lookup. Prefer adding a lightweight `threadId` to stream card view if backend card/run has it.
5. Remove the workspace/artifacts local conversation continuation path for new runs:
   - `activeLocalThread`
   - `localConversation`
   - `appendLocalExchange`
   - `openLocalThread`
   Keep only legacy fallback if a run genuinely lacks `threadId`.
6. Verify quick chat opens/follows the same real thread in right panel and `/chat`.

### Phase 2 - Dirty State Repair

1. Refactor `ArtifactEditor` baseline:
   - `baselineRef` or state with `{ artifactId, title, summary, tagDraft, content }`.
   - local editable state reset on artifact id change.
   - after save, set baseline to saved payload and clear dirty.
   - when props change and not dirty, adopt props as baseline.
2. Close behavior:
   - open/close without edits must not prompt.
   - edit then close prompts.
   - save resets dirty.
   - AI update while clean refreshes baseline.
   - AI update while dirty should not overwrite local edits silently.

### Phase 3 - K-Bar Dedup And Command Foundation

1. Remove Cmd/Ctrl+K listener from `GlobalSearch`.
2. Keep global KBar as the only keyboard listener.
3. Register Spectra object and action commands:
   - open workspace/artifact/thread
   - create artifact/thread/workspace
   - select/add/remove focus item
   - tile selected
   - clear selection
   - move artifact to workspace
   - send artifact to Inbox if supported
   - fallback "Ask Spectra: {query}" bottom action.
4. Dispatch typed Spectra command events consumed by workspace/chat shells.

### Phase 4 - Focus Model

1. Introduce shared focus type, likely:
   ```ts
   type SpectraFocusState = {
     threadId?: string;
     workspaceId?: string;
     global?: boolean;
     artifactIds: string[];
     selectedObjectIds: string[];
   };
   ```
2. Render compact focus chips.
3. Derive current backend fields from focus state.
4. In `/chat`, clearing thread focus must switch to a visible new chat composer state.

### Phase 5 - Multi-Select And Multi-Artifact Tiles

1. Persist latest multi-selection in `localStorage`.
2. Add Ctrl/Cmd-click toggle to artifact cards/list rows/home search results.
3. Add `openSelectedArtifacts` that sets tile state in one batched state update.
4. Add local tiled surface:
   - max one thread panel
   - multiple artifact panels
   - workspace/home remains visible by default
   - adaptive 2/3/4+ layout
   - resize split borders
5. Add "Focus this set" local work-set rail/tab.

### Phase 6 - Cards, Welcome, Icons, Motion

1. Extend `SpectraCardState`:
   - `active`
   - `completed`
   - `multi-selected`
   - `drag-preview`
   - `drop-target`
2. Add CSS states in `src/app/globals.css`.
3. Convert ad hoc welcome cards to `data-spectra-card` treatment.
4. Improve workspace icon selector and remove generic bordered icon boxes where possible.
5. Fix document hover controls after inspecting Tiptap drag/plus positioning.
6. Add skeleton and panel transition improvements.

### Phase 7 - Performance And Context Efficiency

1. Split context builder behavior:
   - artifact/thread focus: no broad artifact catalog by default
   - workspace focus: current workspace metadata and visible/selected objects
   - global/search prompts: bounded catalog
2. Avoid broad `getSpectraOverview(..., true)` after purely local UI actions.
3. Add optimistic result/thread card updates where safe.

### Phase 8 - Affected Object Cards And Placement

1. Add shared `AffectedObjectCard`.
2. Render artifact and workspace affected cards under assistant responses.
3. Make entire card clickable.
4. `/chat` affected workspace click should navigate/open `/workspace` and preserve thread context where possible.
5. Mixed-workspace selected artifacts:
   - If current workspace exists, place there and show context.
   - If no current workspace and one selected workspace can be inferred, place there.
   - If multiple workspaces and placement matters, ask a natural clarification.

## Validation Plan

Run after implementation:

```bash
npx convex codegen
npx tsc --noEmit
npm run lint
npm run test:run
npm run build
```

If time or environment prevents full build, record exactly what was run and why anything was skipped. Do not claim Wave 7.5 complete unless these pass or a concrete known external blocker is documented.

Manual acceptance checks:

1. Open and close an artifact without editing: no prompt.
2. Edit artifact and close: prompt appears.
3. Save artifact: prompt disappears.
4. Quick chat from workspace creates an immediate visible thread/result state.
5. Open that running thread in `/chat` before completion.
6. Right panel shows each user/assistant message once after stream, refresh, and reopen.
7. No raw provider reasoning, planner JSON, ids, schema names, or internal route names appear to user.
8. Markdown and math render in `/chat` and right panel.
9. Cmd/Ctrl+K opens exactly one command palette.
10. Multi-select survives local UI changes and can be cleared.
11. Multiple artifacts can be opened together without flicker once tile work lands.

## Final Commit Requirement

After all implementation and validation:

```bash
git status
git add -A
git commit -m "wave 7.5 audit fixes and multi-artifact workspace foundations"
```

Do not commit before tests/checks unless explicitly directed.

## Final Wave 7.5 Implementation Report

Completed: 2026-06-27.

This section supersedes the earlier mid-audit checklist where it conflicts. The earlier audit map is intentionally preserved for handoff traceability.

### Shared Thread And Chat/Workspace Architecture

- `/chat`, `/workspace`, right-panel run details, thread-reference artifacts, and result-card continuation now route through the same `spectraThreads` thread object whenever a run has a `threadId`.
- Workspace and Artifacts shells no longer open current run details by fabricating local session messages. They keep an `activeRunPanelId` and let `RunDetailPanel` load the persisted run/thread detail.
- `ResultCardStack` now uses `card.provenance.threadId` before falling back to legacy `keepRunAsThread`, so new Spectra runs are not converted into duplicate threads.
- New result cards receive immediate provenance at run creation, including thread/workspace/artifact focus.
- `/workspace?workspaceId=...` now opens the requested workspace, which supports K-bar and affected-card navigation from `/chat`.

### Thread Timing, Naming, And Placement

- New Spectra runs create the thread shell before model work begins.
- Threads receive immediate short fallback titles from the first prompt, and backend generated titles are capped to short 2-4 word style.
- Artifact-focused runs infer workspace placement from the artifact when exactly one workspace placement exists.
- Workspace-created runs stay workspace-linked; global runs remain unplaced/global.

### Right Panel Duplication And Thinking Traces

- Right-panel run details render the real shared thread via `ThreadConversation` when possible.
- Provider/private reasoning is no longer streamed to the client in Spectra run events.
- Live progress is represented as structured public trace steps derived from safe status/operation events.
- Duplicate user message rendering is avoided by checking persisted run ids before showing live optimistic messages.

### Markdown, Math, And Output Safety

- Chat and right-panel thread surfaces share `ConversationSurface` and `RichText`, preserving markdown, math, code, lists, links, quotes, and streamed markdown finalization.
- Spectra API and run errors were sanitized away from object ids, planner/schema names, Convex internals, and internal route concepts.
- Assistant-facing operation errors now ask for normal product choices instead of object ids.

### Dirty State And Artifact Editing

- Artifact editors now track explicit baselines per artifact.
- Opening/closing without edits does not mark dirty.
- Saves update the dirty baseline.
- Incoming server/AI edits are adopted when the editor is clean.
- Artifact editor child state resets correctly when switching artifacts.

### Multi-Artifact Workflows

- Added shared `ArtifactTileSurface`.
- Workspace and Artifacts surfaces can batch-open selected artifacts into a tiled work surface.
- The home/workspace surface remains visible by default.
- "Focus this set" isolates the selected group as the main work surface.
- Tile close, close-all, save, revert, archive, dirty tracking, and thread-reference continuation are wired through existing artifact studio paths.
- Multi-selection persists locally in `localStorage` and restores when re-entering selection mode.
- Ctrl/Cmd-click artifact-card selection works where cards receive `onToggleContext`.

### Focus And Context

- `/chat` now distinguishes continuing an existing thread from starting a new thread with selected context.
- If the user changes away from thread focus in `/chat`, the next send creates a new thread.
- A visible banner explains that the current conversation is reference-only when the next message will create a new thread.
- Focus control now shows compact chips for thread, workspace, open artifact, and selected artifacts so multi-focus is visible.
- Backend context still includes selected artifacts alongside continued thread context where selected.

### K-Bar Command Center

- Cmd/Ctrl+K has one owner: the app-level command palette.
- Spectra local search no longer advertises or captures Cmd/Ctrl+K.
- K-bar now searches Spectra workspaces, artifacts, and threads.
- K-bar can open workspaces, open artifacts, open threads, start a new Spectra thread, tile selected artifacts, focus the current set, clear selection, ask Spectra with the typed query, place artifacts into workspaces, and send placed artifacts back to Inbox by removing placement.
- Spectra surfaces consume shared K-bar events consistently.

### Affected Objects And AI Actions

- Assistant responses show affected artifact cards and now affected workspace cards.
- Affected workspace cards are clickable from `/chat` and navigate to `/workspace`.
- Result-card and affected-object actions use product language and direct object navigation.

### Performance And Token Efficiency

- Focused artifact/thread/selection runs no longer include broad catalog context by default unless the prompt asks for broad search/comparison.
- Workspace switching keeps cached state where possible.
- K-bar actions and selection/tile state are local and immediate; they do not wait for AI.
- Simple UI actions avoid AI calls.

### Cards, States, Responsiveness, And Visual Polish

- Shared card state coverage now includes active, completed, multi-selected, drag-preview, and drop-target.
- Selection state is sourced from local state, preventing stuck selected visuals after deselection.
- Selection and result bars expose clearer action states.
- Workspace icon choices were expanded with subject-appropriate icons.
- Generic Cmd-K copy was removed from local Spectra search.
- Tiled panels use stable responsive grid tracks and preserve access to primary actions.

### Validation Completed

All required checks passed:

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint . --max-warnings=0
./node_modules/.bin/vitest run
./node_modules/.bin/convex codegen
./node_modules/.bin/next build
```

Observed test result:

- 72 test files passed, 1 skipped.
- 382 tests passed, 3 skipped.
- Production build generated 107 routes successfully.

Manual browser/E2E tests were not run because the prompt requested normal code/build checks and specifically did not require browser/E2E unless already lightweight and configured. No failing validation remains from the required check set.
