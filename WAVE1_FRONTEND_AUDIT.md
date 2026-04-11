# Wave 1 Frontend Replacement Audit — Spectra Workspace Redesign

**Date:** 2026-04-11  
**Scope:** Read-only audit of all workspace-related frontend files  
**Branch:** `redesign` (commit `93e3eff` — "Fresh start")  
**Status:** The entire previous workspace frontend (16,597 lines) was deleted in the latest commit. The workspace is a blank slate.

---

## 1. Current Surface Map

### 1.1 What Was Deleted ("Fresh start" commit `93e3eff`)

The following workspace frontend files were **completely removed**:

| Deleted File | Lines | Purpose |
|---|---|---|
| `src/components/workspace/workspace-canvas.tsx` | 1,978 | Central ReactFlow canvas, zoom model, caching, viewport |
| `src/components/workspace/workstream-focus-panel.tsx` | 1,962 | Workstream deep-dive/focus panel |
| `src/components/workspace/views/internal-content-nodes.tsx` | 1,523 | Workspace item renderers (Glance/Touch/Deep) |
| `src/components/workspace/edge-utility-overlay.tsx` | 1,002 | Hub items: timer, dock, quick chat, radial menu, breadcrumb |
| `src/components/workspace/right-push-panel.tsx` | 812 | Right-side deep edit panel |
| `src/components/workspace/views/workstream-internal-view.tsx` | 513 | Workstream internal column/lane view |
| `src/components/workspace/workspace-command-bar.tsx` | 469 | Workspace-level search/command bar |
| `src/components/workspace/workstream-create-dialog.tsx` | 341 | Workspace creation dialog |
| `src/components/workspace/workspace-toolbar.tsx` | 216 | Workspace toolbar (view toggles, controls) |
| `src/components/workspace/chat-side-panel.tsx` | 236 | Chat side panel for workspace |
| `src/components/workspace/hub-bar.tsx` | 1 | Hub bar stub |
| `src/components/workspace/hub-internal-view.tsx` | 1 | Hub internal view stub |
| `src/components/notes/notes-workspace.tsx` | 284 | Notes workspace view |
| `src/stores/workspace-store.ts` | 458 | Zustand workspace state store |
| `src/hooks/use-workspace-data.ts` | 145 | Workspace data fetching hook |
| `src/lib/workspace/auto-layout.ts` | 208 | Workspace auto-layout/positioning |
| `src/lib/workspace/contracts.ts` | 57 | Workspace contracts/types |
| `src/lib/workspace/position-persistence.ts` | 135 | Position persistence helpers |
| `src/lib/workspace/shell-mode.ts` | 30 | Workspace shell mode helpers |
| `src/lib/workspace/state-machine.ts` | 95 | Workspace state machine |
| `src/lib/workspace/zoom-helpers.ts` | 63 | Zoom utility helpers |
| `convex/workspaceItems.ts` | 1,558 | Backend workspace items queries/mutations |
| `convex/workspaceOrchestration.ts` | 230 | Workspace orchestration logic |
| `src/app/api/workspace-items/route.ts` | 413 | Workspace items API route |
| `src/app/api/workspace-orchestration/route.ts` | 138 | Workspace orchestration API route |
| All workspace-related test files | ~1,800+ | 14 test files covering canvas, sync, state, views |

**Total deleted:** ~16,597 lines across 47 files.

### 1.2 What Currently Exists

#### Workspace Page (entry point)
- **`src/app/workspace/page.tsx`** — A placeholder: renders "A fresh workspace UI is coming soon." **No functionality.**

#### Backend Stubs (preserved but hollow)
- **`convex/workspaceHelpers.ts`** — Stub: `recordWorkspaceMutation()` is a no-op
- **`convex/workspaceItemSync.ts`** — Stub: `syncWorkspaceItemForArtifact()` and `removeWorkspaceItemForArtifact()` are no-ops
- Comment in both: "The workspace UI layer has been removed; these functions are stubs that keep the backend working"

#### Surviving Workspace-Adjacent Infrastructure
- **`src/lib/workspace/events.ts`** — Event dispatch/subscribe for `workspace:content-mutated`. Still functional, used by `use-chat-panel.ts`.
- **`src/lib/artifact-types.ts`** — Full canonical workspace type mapping (16 legacy → 9 canonical types). Includes `CANONICAL_WORKSPACE_TYPES`, `ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE`, `LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE`. **This is high-value surviving work.**
- **`convex/ghosts.ts`** — Ghost suggestion backend (622 lines). Calls stubbed `syncWorkspaceItemForArtifact` and `recordWorkspaceMutation`.
- **`convex/schema.ts`** — Schema still has `workspaceItems`, `workspaceTopicClusters`, `ghostSuggestions`, and `workspaceMutations` tables with full field definitions including `topicCluster`, `clusterOverride`, `provenanceSource`, `itemType`, `sourceKind`, etc.

#### Chat/Panel/Editor Layer (non-workspace, but relevant)
- **`src/stores/chat-panel-store.ts`** — Simple panel open/close state (Zustand)
- **`src/stores/editor-store.ts`** — Editor mode, AI bar state, version history (Zustand)
- **`src/hooks/use-chat-panel.ts`** — Chat panel hook (275 lines): thread hydration, streaming, message send
- **`src/hooks/use-chat-state.ts`** — Monolithic chat state (3,724 lines): messages, routing, attachments, models, streaming
- **`src/hooks/use-canvas-state.ts`** — Code canvas preview state (133 lines) — NOT workspace canvas
- **`src/components/shared/right-side-panel.tsx`** — Generic right panel with resize (204 lines)
- **`src/components/shared/unified-ai-input.tsx`** — Shared AI input component (117 lines)
- **`src/components/chat/unified-panel.tsx`** — Full-featured chat panel (1,616 lines)
- **`src/components/command-palette.tsx`** — KBar-based Cmd+K palette (352 lines)
- **`src/components/study-timer.tsx`** — Pomodoro timer (592 lines)
- **`src/components/global-utility-dock.tsx`** — Floating utility dock (719 lines): feedback, timer, info panels
- **`src/components/layout/app-shell.tsx`** — App shell with sidebar (426 lines)

#### Artifact Views (artifacts page, not workspace)
- **`src/components/artifacts/canvas-view.tsx`** — Zone-based artifact view (197 lines) — NOT workspace canvas, just an artifact listing view
- **`src/components/artifacts/graph-view.tsx`** — Force-directed artifact graph (275 lines)
- **`src/components/artifacts/timeline-view.tsx`** — Day-grouped timeline (164 lines)
- **`src/components/artifacts/sections-view.tsx`** — Section-grouped listing (131 lines)
- **`src/components/artifacts/artifact-card.tsx`** — Artifact card component
- **`src/components/artifacts/artifact-editor.tsx`** — Artifact editor
- **`src/components/artifacts/artifact-ai-surface.tsx`** — AI edit surface
- **`src/components/artifacts/create-artifact-dialog.tsx`** — Creation dialog

---

## 2. Misleading / Duplicate / Dead Paths

### 2.1 DEAD — Completely Gone

| Path | Status | Notes |
|---|---|---|
| `src/components/workspace/*` | **DELETED** | Entire directory removed |
| `src/stores/workspace-store.ts` | **DELETED** | Must be rebuilt from scratch |
| `src/hooks/use-workspace-data.ts` | **DELETED** | Must be rebuilt from scratch |
| `src/lib/workspace/auto-layout.ts` | **DELETED** | Must be rebuilt from scratch |
| `src/lib/workspace/contracts.ts` | **DELETED** | Must be rebuilt from scratch |
| `src/lib/workspace/position-persistence.ts` | **DELETED** | Must be rebuilt from scratch |
| `src/lib/workspace/state-machine.ts` | **DELETED** | Must be rebuilt from scratch |
| `src/lib/workspace/zoom-helpers.ts` | **DELETED** | Must be rebuilt from scratch |
| `src/lib/workspace/shell-mode.ts` | **DELETED** | Must be rebuilt from scratch |
| `convex/workspaceItems.ts` | **DELETED** | All queries/mutations gone; schema tables remain |
| `convex/workspaceOrchestration.ts` | **DELETED** | Must be rebuilt |
| `src/app/api/workspace-items/route.ts` | **DELETED** | Must be rebuilt |
| `src/app/api/workspace-orchestration/route.ts` | **DELETED** | Must be rebuilt |

### 2.2 MISLEADING — Exists but Hollow / Stub

| Path | Status | Risk |
|---|---|---|
| `convex/workspaceHelpers.ts` | **STUB** | `recordWorkspaceMutation()` is a no-op. Callers (ghosts, artifacts) call it but nothing happens. |
| `convex/workspaceItemSync.ts` | **STUB** | Both exported functions are no-ops. Backend "sync" does nothing. |
| `convex/ghosts.ts` | **ORPHANED** | 622 lines of ghost logic that calls stubbed workspace helpers. Ghost suggestions can be created/stored but never appear in any UI. |
| `src/app/workspace/page.tsx` | **PLACEHOLDER** | Renders a "coming soon" message. Not a functional workspace. |
| Schema tables (`workspaceItems`, `workspaceTopicClusters`, `ghostSuggestions`, `workspaceMutations`) | **SCHEMA ONLY** | Tables exist in schema.ts but no queries/mutations read or write them (stubs return void). |

### 2.3 POTENTIALLY MISLEADING — Naming Overlap

| Path | Risk | Notes |
|---|---|---|
| `src/components/artifacts/canvas-view.tsx` | **Name collision** | This is a zone-based artifact listing, NOT a workspace canvas. Could confuse implementers. |
| `src/hooks/use-canvas-state.ts` | **Name collision** | This is for the code preview canvas (iframe sandbox), NOT workspace canvas. |
| `src/components/artifacts/timeline-view.tsx` | **Misleading progress** | This exists on the artifacts page only. The spec's "Timeline" view mode for workspace is completely different. |
| `src/components/artifacts/graph-view.tsx` | **Misleading progress** | Force-directed graph on artifacts page. Not the workspace spatial model. |

### 2.4 DUPLICATE / OVERLAPPING Responsibilities

| Area | Files | Issue |
|---|---|---|
| Panel systems | `right-side-panel.tsx`, `unified-panel.tsx`, `chat-panel-store.ts` | Three separate panel surfaces with no unified model. `unified-panel.tsx` (1,616 lines) is the full chat panel; `right-side-panel.tsx` is a generic resizable panel shell; `chat-panel-store.ts` manages open/close state. For Wave 1, only ONE panel path should own Deep Edit. |
| AI input | `unified-ai-input.tsx`, `chat-composer.tsx` | Two separate AI input components. `unified-ai-input.tsx` is simple (117 lines); `chat-composer.tsx` is the full-featured chat input (1,719 lines). The workspace quick chat must use ONE authoritative input. |
| Utility docks | `global-utility-dock.tsx`, `study-timer.tsx` | Timer is both a standalone component AND embedded in the global utility dock. No workspace-level edge-binding system exists. |
| Mode systems | `src/lib/modes.ts`, `src/lib/contracts/studyModes.ts` | Two separate mode registries. `modes.ts` has `ModeConfig` with icons/colors; `studyModes.ts` has the canonical `STUDY_MODES` array. Skills replacement needs one source of truth. |

---

## 3. Reusable Primitives (Low-Level Utilities Only)

These may be reused as leaf utilities. **None of them should define product behavior or workspace architecture.**

### 3.1 HIGH VALUE — Reuse Directly

| File | What | Reuse Notes |
|---|---|---|
| `src/lib/artifact-types.ts` | Canonical workspace type mapping | **Best surviving artifact.** The `CANONICAL_WORKSPACE_TYPES`, mapping tables, and resolver functions are exactly what Wave 1 needs. Use as-is. |
| `src/lib/workspace/events.ts` | Event dispatch/subscribe for workspace content changes | Small, clean, already consumed by `use-chat-panel.ts`. Keep as the invalidation primitive. |
| `src/stores/editor-store.ts` | Editor mode + AI bar state (Zustand) | Clean, 84 lines. Reuse for Deep Edit panel state. |
| `src/components/shared/right-side-panel.tsx` | Generic resizable right panel shell | 204 lines, clean slide-in animation. Reuse as the Deep Edit panel shell. |
| `src/components/shared/unified-ai-input.tsx` | Shared AI text input with styling | 117 lines, clean. Can be the quick-chat input leaf component. |
| `convex/schema.ts` (workspace tables) | Schema definitions for workspaceItems, clusters, ghosts, mutations | Tables are well-defined with correct fields. Backend Wave 1 rebuilds queries/mutations against this existing schema. |

### 3.2 MEDIUM VALUE — Reuse with Refactoring

| File | What | Reuse Notes |
|---|---|---|
| `src/stores/chat-panel-store.ts` | Panel open/close + workstream/thread IDs | Clean but too chat-specific. Extend into a unified panel store for Wave 1. |
| `src/hooks/use-chat-panel.ts` | Chat thread hydration + streaming | 275 lines. Thread creation/send logic is useful but workspace quick chat needs an action-resolution layer before thread creation. |
| `src/components/study-timer.tsx` | Pomodoro timer | 592 lines, self-contained. Reuse as hub timer widget but must become edge-bound. |
| `src/components/command-palette.tsx` | KBar Cmd+K palette | 352 lines using `kbar` library. Foundation for global search, but needs workspace-aware search results and navigation. |
| `src/components/chat/unified-panel.tsx` | Full chat panel with settings/tabs | 1,616 lines, very feature-rich but monolithic. Extract the chat message rendering and AI editing parts for Deep Edit. |

### 3.3 LOW VALUE — Reference Only

| File | What | Why Low |
|---|---|---|
| `src/components/artifacts/canvas-view.tsx` | Zone-based artifact view | Wrong paradigm (card grid, not spatial canvas). Name is misleading. |
| `src/components/artifacts/timeline-view.tsx` | Day-grouped timeline | Artifacts page only. Workspace timeline is a different concept. |
| `src/components/artifacts/graph-view.tsx` | Force-directed graph | Old paradigm. No spatial workspace relevance. |
| `src/components/global-utility-dock.tsx` | Floating utility dock | 719 lines, feedback-focused. Wrong constraints model for hub items. |
| `src/hooks/use-chat-state.ts` | Monolithic chat state (3,724 lines) | Too large, too coupled. The spec says split this. Not reusable as-is. |
| `src/lib/modes.ts` | Mode registry | Being replaced by skills. Reference only for compatibility mapping. |
| `src/lib/contracts/studyModes.ts` | Mode contracts/types | Being replaced by skills. Keep types for compatibility only. |

---

## 4. Recommended Wave 1 Frontend Architecture

### 4.1 Situation Summary

The workspace frontend is a **greenfield build**. The "Fresh start" commit intentionally wiped everything. This is actually advantageous — there is no legacy code to work around, only clean primitives to build on top of.

### 4.2 Required New Files (Wave 1 Phase C)

The following must be created from scratch:

```
src/stores/workspace-store.ts              # NEW — Zustand workspace state
src/hooks/use-workspace-data.ts            # NEW — Workspace content fetching
src/components/workspace/workspace-canvas.tsx    # NEW — ReactFlow canvas with semantic zoom
src/components/workspace/glance-renderers.tsx    # NEW — Glance-tier renderers (all 9 types)
src/components/workspace/tint-zones.tsx          # NEW — Soft background tint zone system
src/components/workspace/hub-dock.tsx            # NEW — Left-edge workspace selector dock
src/components/workspace/hub-quick-chat.tsx       # NEW — Bottom-center unified command bar
src/components/workspace/hub-timer.tsx            # NEW — Bottom-right timer widget
src/components/workspace/hub-create-launcher.tsx  # NEW — Creation launcher (+)
src/components/workspace/hub-collapse-toggle.tsx  # NEW — Hub collapse toggle
src/lib/workspace/auto-layout.ts           # NEW — Workspace territory layout (1500x1200px)
src/lib/workspace/zoom-helpers.ts          # NEW — Zoom band helpers
src/lib/workspace/position-persistence.ts  # NEW — Item position persistence
src/app/workspace/page.tsx                 # REPLACE — Actual workspace page
```

### 4.3 Required Backend Rebuilds (Wave 1 Phase B)

These must be un-stubbed / rebuilt before the frontend can consume them:

```
convex/workspaceItems.ts               # REBUILD — Queries and mutations for workspace items
convex/workspaceItemSync.ts            # REBUILD — Real sync (not stubs)
convex/workspaceHelpers.ts             # REBUILD — Real mutation recording (not stubs)
src/app/api/workspace-items/route.ts   # REBUILD — API route for workspace items
```

### 4.4 Authoritative Ownership Map

| Surface | Owner File | Responsibility |
|---|---|---|
| Workspace state | `src/stores/workspace-store.ts` | Camera, zoom band, view mode, active workspace, focused item, hub state |
| Workspace data | `src/hooks/use-workspace-data.ts` | Batched fetch of workspace content, LRU cache, invalidation via `workspace:content-mutated` |
| Canvas | `src/components/workspace/workspace-canvas.tsx` | ReactFlow instance, viewport, zoom-driven tier selection, node rendering |
| Glance tier | `src/components/workspace/glance-renderers.tsx` | Read-only preview cards for all 9 canonical types |
| Tint zones | `src/components/workspace/tint-zones.tsx` | Soft gradient-edged background regions per content group |
| Hub items | `src/components/workspace/hub-*.tsx` | Edge-bound persistent UI: dock, quick chat, timer, create, collapse |
| Panel (Deep Edit) | `src/components/shared/right-side-panel.tsx` + `unified-panel.tsx` | Escalated editing surface |
| Events | `src/lib/workspace/events.ts` | Content mutation event dispatch (already exists) |
| Type mapping | `src/lib/artifact-types.ts` | Canonical workspace type resolution (already exists) |

### 4.5 Architectural Principles for New Code

1. **One authoritative renderer path.** All workspace items go through `workspace-canvas.tsx` → type-resolved renderers. No alternate view paths within the workspace.
2. **One authoritative content contract.** `use-workspace-data.ts` fetches everything in one batched call. Canvas consumes this, nothing else.
3. **Workspace store is the single source of truth** for camera, zoom, view mode, focus, hub state. No localStorage-driven state leaks.
4. **Hub items are edge-bound.** Custom constraint system, not Framer Motion `drag="y"`. Items track along edges with snap behavior.
5. **Zoom drives tier selection.** Far zoom (< 0.20) → Glance. Mid zoom (0.20–0.55) → summary cards. Deep zoom (≥ 0.55) → Touch tier (Wave 2). Progressive, not hard switches.
6. **ReactFlow is the canvas engine.** `@xyflow/react` is already installed. Workspace territories are ~1500x1200px at positions like (0,0), (2000,0), (4000,0). Scroll = zoom.
7. **Backend must be real before frontend.** The frontend must consume real `convex/workspaceItems.ts` queries, not stubs.

---

## 5. Highest-Risk Frontend Issues

### 5.1 Zoom & Spatial Logic — CRITICAL RISK

| Risk | Description | Mitigation |
|---|---|---|
| **Zoom thresholds wrong** | Previous implementation had wrong thresholds (0.3/0.7) with compressed territories. New build must use large territories (1500x1200px) with recalibrated bands (~0.15/0.20/0.55). | Define zoom bands in workspace store as constants. Test at each boundary. |
| **Scroll pans instead of zooms** | Previous implementation set `panOnScroll=true, zoomOnScroll=false`. Spec requires scroll = zoom. | Set `zoomOnScroll={true}, panOnScroll={false}, panOnDrag={true}` on ReactFlow. |
| **Proportional zoom narrative** | At far zoom, workspaces must be readable cards, not dots. Previous implementation made everything tiny. | Use 1500px+ territory widths. Test that far zoom (0.15) shows readable workspace cards with titles and item counts. |
| **Hard zoom boundary traps** | No route-like transitions at zoom boundaries. Must be progressive gain/loss of detail. | Interpolate opacity/scale/content between tiers. No `if (zoom > threshold) switch`. |
| **Auto-entry on deep zoom** | Zooming deep into a workspace should auto-commit. Previous code that did this was deleted as "buggy". | Re-implement with debounce and center-of-viewport check. |

### 5.2 Unified Command Bar — HIGH RISK

| Risk | Description | Mitigation |
|---|---|---|
| **Two separate chat/create surfaces** | Sketches show ONE unified bottom-center bar for both chat input and creation. Previous had separate quick chat (bottom-right) and radial menu (bottom-center). | Build as single component: `hub-quick-chat.tsx` integrates creation launcher. |
| **Quick chat resolves to thread only** | Spec requires action resolution BEFORE thread creation. Current `use-chat-panel.ts` goes straight to thread. | Add action-resolution layer: classify intent → direct artifact creation, planner creation, OR thread creation. |
| **Scope badge missing** | Quick chat must show workspace scope badge. No current implementation. | Add scope context display in unified command bar based on zoom level and active workspace. |

### 5.3 Planner Edge Layer — HIGH RISK

| Risk | Description | Mitigation |
|---|---|---|
| **Planner hub is not implemented** | Spec requires a persistent hub planner aggregating tasks from all workspaces. Nothing exists. | Build as collapsible hub widget with cross-workspace planner item aggregation. |
| **Planner items as workspace objects** | Planner items must project onto the canvas like artifacts. Current `convex/plannerItems.ts` exists but workspace projection is stubbed. | Ensure `workspaceItemSync` handles planner items with immediate projection. |
| **ManageBac deadlines** | Should surface in hub planner. Integration exists (`convex/managebacSync.ts`) but connection to workspace is severed. | Wire ManageBac deadlines through planner items into workspace projection. |

### 5.4 Renderer Ownership — HIGH RISK

| Risk | Description | Mitigation |
|---|---|---|
| **Multiple renderer paths** | `artifacts/canvas-view.tsx`, `artifacts/graph-view.tsx`, `artifacts/timeline-view.tsx` exist as non-workspace views. New workspace renderers must NOT duplicate or share their logic. | Workspace renderers are a completely separate system. Artifact page views are irrelevant. |
| **Glance renderers for all 9 types** | Every canonical type needs a Glance renderer. Previous implementation had some but they were deleted. | Build renderers for: Note, Visual, Code, Export, Board, Flashcard Deck, Quiz, Thread, Planner. No generic fallback cards. |
| **Deep Edit panel coverage** | Current `unified-panel.tsx` is chat-centric. Deep Edit needs per-type editing surfaces. | Use `right-side-panel.tsx` as shell, extend with type-specific editors inside. Chat panel stays for thread continuation. |
| **Version history integration** | `editor-store.ts` has version history state but it's only wired to TipTap editor. Workspace items need version-aware rendering. | Ensure workspace Deep Edit surfaces connect to version history for applicable types. |

### 5.5 State Management — MEDIUM RISK

| Risk | Description | Mitigation |
|---|---|---|
| **No workspace store exists** | `workspace-store.ts` was deleted. All workspace state must be designed from scratch. | Design carefully: camera, zoom band, view mode (`byType | byTopic | timeline`), active workstream, focused item, hub collapse state. Persist `viewMode` to localStorage. |
| **Chat state monolith** | `use-chat-state.ts` (3,724 lines) is a known problem. Workspace quick chat should NOT import this. | Build workspace quick chat with `use-chat-panel.ts` (lighter, 275 lines) or a new dedicated hook. |
| **LRU cache missing** | Previous unbounded `contentCacheRef` was deleted. Must rebuild with bounded LRU (5–7 workspaces). | Implement LRU in `use-workspace-data.ts`. Evict on workspace count threshold. |

### 5.6 Visual Language — MEDIUM RISK

| Risk | Description | Mitigation |
|---|---|---|
| **Prototype/wireframe feel** | Testing report (200 issues) consistently flagged dashed outlines, dotted backgrounds, wireframe aesthetic. | Use soft tint zones with radial gradient edges at 6-8% opacity. No dashed boxes. Clean, refined visual language from day one. |
| **Accessibility** | Testing report flagged: no ARIA labels, no keyboard navigation, no focus indicators, no skip-nav. | Build with accessibility from the start: ARIA labels, keyboard navigation, focus management, proper contrast. |

---

## 6. Summary of Conclusions

### The workspace frontend is a complete greenfield build.

The "Fresh start" commit deleted ALL workspace components, the workspace store, workspace hooks, workspace utilities, workspace layout helpers, workspace tests, and the workspace API routes. Backend workspace helpers are stubs. The schema tables survive but are unread.

### What this means for Wave 1:

1. **There is nothing to refactor.** Every workspace frontend file must be created from scratch.
2. **Backend must be rebuilt first.** `convex/workspaceItems.ts` (queries/mutations) and real `workspaceItemSync.ts`/`workspaceHelpers.ts` must exist before any canvas can consume data.
3. **Reusable primitives are limited to:** `artifact-types.ts` (canonical types), `workspace/events.ts` (event system), `editor-store.ts` (editor state), `right-side-panel.tsx` (panel shell), `unified-ai-input.tsx` (input component), and the schema tables.
4. **The deleted code is reference material**, recoverable via `git show 93e3eff^:path/to/file`, but should NOT be copy-pasted. The spec and recovery docs explain in detail why the previous implementation had fundamental architectural problems.
5. **ReactFlow (`@xyflow/react`) is installed** and ready to use. Type stubs exist in `vendor-modules.d.ts`.

### Execution order for Wave 1 frontend:

1. Rebuild `convex/workspaceItems.ts` with real queries/mutations (backend-first)
2. Un-stub `convex/workspaceItemSync.ts` and `convex/workspaceHelpers.ts`
3. Create `src/stores/workspace-store.ts` with correct state shape
4. Create `src/hooks/use-workspace-data.ts` with batched fetch + LRU cache
5. Create `src/components/workspace/workspace-canvas.tsx` with correct spatial model
6. Create glance renderers for all 9 canonical types
7. Create hub item shells (dock, quick chat, timer, create, collapse)
8. Create tint zone system
9. Replace `src/app/workspace/page.tsx` placeholder with real workspace page
