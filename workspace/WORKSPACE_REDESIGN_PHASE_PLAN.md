# Workspace Redesign Phase Plan

Status: active implementation and handoff plan for the Spectra workspace redesign.

This file is intended to complement:

- [`WORKSPACE_FOUNDATION_V2.md`](./WORKSPACE_FOUNDATION_V2.md)
- [`README.md`](./README.md)

Those two files are the governing redesign docs for this pass.

All other files inside `workspace/` are reference and inspiration only.

## 0. Source-Of-Truth Hierarchy

When implementation details conflict, use this order:

1. [`WORKSPACE_FOUNDATION_V2.md`](./WORKSPACE_FOUNDATION_V2.md)
2. [`README.md`](./README.md)
3. the current codebase realities and compatibility constraints
4. the reference exploration docs only when they clarify V2, not when they re-open direction decisions

### Product truths this plan assumes

- There is one final workspace direction, not three equal shells.
- Magnetic Surface is the structural lead.
- Semantic Constellations informs overview identity and relationship language.
- Focal Lenses informs focus choreography, clarity, and polish.
- Wildcard D is not being implemented now.
- The three-shell toggle is not the product.
- State transitions are explicit and must not be driven by scroll, proximity, or passive camera drift.
- The hub is not a canvas workstream node in the target product.
- The command surface is a singular object, not a toolbar.

## 1. Audit And Map

This section maps what exists now, what is reusable, what conflicts with V2, what is missing for Phase 1, and what should be deferred to Phase 2.

## 1.1 Existing relevant modules

### Frontend workspace shell and state

- [`src/app/workspace/page.tsx`](<local-workspace>
- [`src/stores/workspace-store.ts`](<local-workspace>
- [`src/components/workspace/workspace-canvas.tsx`](<local-workspace>
- [`src/components/workspace/workspace-toolbar.tsx`](<local-workspace>
- [`src/components/workspace/workspace-command-bar.tsx`](<local-workspace>
- [`src/components/workspace/right-push-panel.tsx`](<local-workspace>
- [`src/components/workspace/views/internal-content-nodes.tsx`](<local-workspace>
- [`src/components/workspace/hub-internal-view.tsx`](<local-workspace>
- [`src/components/workspace/hub-bar.tsx`](<local-workspace>

### Workspace support utilities

- [`src/lib/workspace/auto-layout.ts`](<local-workspace>
- [`src/lib/workspace/position-persistence.ts`](<local-workspace>
- [`src/lib/workspace/events.ts`](<local-workspace>
- [`src/lib/workspace/shell-mode.ts`](<local-workspace>
- [`src/lib/workspace/zoom-helpers.ts`](<local-workspace>
- [`src/hooks/use-workspace-data.ts`](<local-workspace>

### Convex data and sync

- [`convex/schema.ts`](<local-workspace>
- [`convex/workstreams.ts`](<local-workspace>
- [`convex/workspaceItems.ts`](<local-workspace>
- [`convex/workspace-item-sync.ts`](<local-workspace>
- [`convex/artifacts.ts`](<local-workspace>
- [`convex/plannerItems.ts`](<local-workspace>
- [`convex/workstreamMemory.ts`](<local-workspace>

### API and orchestration

- [`src/app/api/workstreams/route.ts`](<local-workspace>
- [`src/app/api/workspace-items/route.ts`](<local-workspace>
- [`src/app/api/artifacts/route.ts`](<local-workspace>
- [`src/app/api/planner/route.ts`](<local-workspace>
- [`src/lib/orchestrator/tool-definitions.ts`](<local-workspace>
- [`src/lib/orchestrator/tool-executor.ts`](<local-workspace>
- [`src/lib/orchestrator/pipeline.ts`](<local-workspace>
- [`src/hooks/use-chat-panel.ts`](<local-workspace>

## 1.2 What already exists and should be reused

### Canvas and spatial engine

- React Flow is already the correct engine for the workspace surface.
- The current pan/zoom/viewport persistence model is reusable.
- The current workstream auto-layout is directionally correct and only needs scaling/state integration changes, not replacement.

### Panel and content backends

- The right push-panel already exists and routes chat/document/artifact/planner content correctly.
- Artifacts plus `artifactVersions` already support content provenance and revert at the artifact level.
- Chat threads, planner items, workstream memory, and clarification interrupts are already real and should be used more directly by the redesign.

### Workspace instance groundwork

- A `workspaceItems` table already exists.
- Artifact-to-workspace-item syncing already exists.
- Position persistence for workstreams and workspace items already exists.

### AI/orchestration groundwork

- The orchestrator already knows about memory, workstream context, planner updates, note creation, thread forking, and clarification.
- The missing piece is not “AI exists or not”; the missing piece is first-class workspace mutation tooling.

## 1.3 What conflicts with V2 and blocks the redesign

### Conflict A: shell-mode architecture still leaks into product logic

Files:

- [`src/lib/workspace/shell-mode.ts`](<local-workspace>
- [`src/app/workspace/page.tsx`](<local-workspace>
- [`src/components/workspace/workspace-toolbar.tsx`](<local-workspace>
- [`src/components/workspace/workspace-canvas.tsx`](<local-workspace>
- [`src/components/workspace/views/internal-content-nodes.tsx`](<local-workspace>

Why it conflicts:

- The code still treats A/B/C as parallel UI states.
- V2 explicitly rejects that as the product direction.
- Even if Phase 2 keeps temporary feature flags during migration, new logic must not depend on shell choice.

### Conflict B: zoom bands are acting as state

Files:

- [`src/stores/workspace-store.ts`](<local-workspace>
- [`src/components/workspace/workspace-canvas.tsx`](<local-workspace>
- [`src/lib/workspace/zoom-helpers.ts`](<local-workspace>

Why it conflicts:

- V2 requires explicit states: `WORLD_OVERVIEW`, `FOCUSED`, `DEEP_WORK`, `COMMAND_MODE`, `UTILITY_REVEAL`.
- Current logic still derives too much meaning from camera zoom.
- In V2, zoom is a result of state, not the source of state.

### Conflict C: hub-as-node and `__hub__` sentinel logic

Files:

- [`src/components/workspace/hub-internal-view.tsx`](<local-workspace>
- [`src/components/workspace/workspace-canvas.tsx`](<local-workspace>
- [`src/components/workspace/hub-bar.tsx`](<local-workspace>
- [`src/stores/workspace-store.ts`](<local-workspace>

Why it conflicts:

- V2 explicitly says the hub is not a canvas workstream node.
- The target product uses viewport edge utilities instead.
- The current hub flow is a compatibility artifact and should be quarantined, not extended.

### Conflict D: widget model is still too thin

Files:

- [`convex/schema.ts`](<local-workspace>
- [`convex/workspaceItems.ts`](<local-workspace>
- [`convex/workspace-item-sync.ts`](<local-workspace>

Why it conflicts:

- Current `workspaceItems` mostly stores position plus a few source fields.
- V2 requires item category, provenance, group, render props, hidden/collapsed states, and multi-source orchestration support.
- Without that, Phase 2 would be forced to invent frontend-only structure again.

### Conflict E: AI cannot mutate workspace structure as a first-class capability

Files:

- [`src/lib/orchestrator/tool-definitions.ts`](<local-workspace>
- [`src/lib/orchestrator/tool-executor.ts`](<local-workspace>

Why it conflicts:

- The orchestrator can create notes and planner items, but it cannot explicitly create workstreams, create/move widgets, attach items, or reorganize workspace layout.
- V2 requires those as first-class actions, with provenance and revert.

## 1.4 What is missing for Phase 1

The following are architectural prerequisites, not visual polish:

- explicit workspace state machine
- explicit command mode and utility reveal contracts
- canonical workspace item contract
- workspace mutation history for provenance and revert
- workstream creation/suggestion contracts
- merge candidate and attach flow contracts
- orchestrator tool coverage for workspace mutations
- artifact type expansion for richer widgets
- shims so the old UI continues running while the new contracts land

## 1.5 What is Phase 2 by default, not Phase 1

The following are explicitly deferred to the frontend-heavy pass:

- removing the shell toggle from the user-visible UI
- removing the hub node visually
- final command surface visual design
- panel transfer animation
- overview cluster territory rendering
- relationship line rendering
- anti-card-soup widget presentation
- typography, spacing, shadow, opacity, and motion tuning

## 2. Two-Phase Plan

The redesign is split into exactly two implementation phases.

## 2.1 Phase 1: Logic / Backend / State / Orchestration / Contracts

This phase exists to make Phase 2 straightforward and safe.

Phase 2 should not need to invent data shape, mutation semantics, provenance rules, or state-machine behavior while simultaneously doing rendering work.

### Phase 1 goals

1. Create an explicit workspace state model that matches V2.
2. Expand `workspaceItems` into a canonical widget-instance model while keeping legacy fields alive for compatibility.
3. Add workspace mutation history with revert plumbing for widget/layout/workstream structure changes.
4. Add backend and API operations for create/move/update/attach/reorganize widget flows.
5. Add AI tools for those operations.
6. Expand artifact types so the Phase 2 renderer has the right semantic vocabulary.
7. Keep the current UI operational through compatibility shims rather than trying to finish the redesign in this phase.

### Phase 1 non-goals

- no final visual redesign
- no shell renderer cleanup beyond what is required for compatibility
- no final edge utility UI
- no final command surface or animation polish

### Phase 1 dependencies

- Convex schema/codegen must be kept consistent.
- Existing ownership validation in workstream/artifact/planner/chat models must remain intact.
- Current workspace UI still expects legacy `workspaceItems` fields and existing routes.
- Existing artifact AI revert/version flows must not regress.

### Phase 1 workstreams and order of operations

#### Phase 1A. State contracts and shims

Goals:

- add an explicit workspace state machine
- separate state from zoom
- define edge utility and workspace item contracts for later UI work

Likely files:

- [`src/stores/workspace-store.ts`](<local-workspace>
- [`src/lib/workspace/state-machine.ts`](<local-workspace>
- [`src/lib/workspace/contracts.ts`](<local-workspace>

Deliverables:

- canonical `workspaceState`
- `commandModeOpen` and `utilityRevealOpen`
- `lastCanvasState`
- utility-zone contract
- legacy zoom band retained only as a renderer hint, not as authority
- removal of dead hub-focus state from the store

Risks:

- accidentally breaking current canvas assumptions
- mixing “overlay mode” state with “camera state” again

Done means:

- store/state speaks V2 vocabulary even if the UI has not caught up visually

#### Phase 1B. Workspace item model expansion

Goals:

- make `workspaceItems` durable enough for the redesign
- preserve legacy fields used by current UI
- populate canonical fields for new consumers

Likely files:

- [`convex/schema.ts`](<local-workspace>
- [`convex/workspaceItems.ts`](<local-workspace>
- [`convex/workspace-item-sync.ts`](<local-workspace>

Deliverables:

- canonical `itemType`
- `sourceKind` and `sourceId`
- `category`
- `zIndex`
- `collapsed`
- `hidden`
- `visualGroup`
- `renderProps`
- `provenanceSource`
- `provenanceAction`
- legacy `type`, `sourceArtifactId`, `sourceChatId`, `sourcePlannerItemId` preserved

Risks:

- type/codegen drift
- current workspace fetch path breaking if legacy fields disappear or change shape

Done means:

- Phase 2 can render against canonical widget contracts while the current UI still works

#### Phase 1C. Workspace mutation provenance and revert

Goals:

- support provenance for non-artifact workspace mutations
- support one-click revert at the data layer

Likely files:

- [`convex/schema.ts`](<local-workspace>
- [`convex/workspaceItems.ts`](<local-workspace>
- any shared Convex workspace helper modules

Deliverables:

- `workspaceMutations` table
- mutation records for widget creation, widget update, widget move, attach flow, layout reorganization, workstream creation
- revert mutation path for those records

Risks:

- trying to create a fully general undo engine and overcomplicating Phase 1

Done means:

- every workspace structure mutation has a durable provenance record and a revert path, even if Phase 2 renders that provenance differently

#### Phase 1D. Workspace orchestration APIs

Goals:

- expose clean data operations that Phase 2 UI and orchestrator can call

Likely files:

- [`convex/workspaceItems.ts`](<local-workspace>
- [`convex/workspaceOrchestration.ts`](<local-workspace>
- [`src/app/api/workspace-items/route.ts`](<local-workspace>
- [`src/app/api/workspace-orchestration/route.ts`](<local-workspace>

Required operations:

- `create_widget`
- `update_widget`
- `move_widget`
- `attach_items_to_workstream`
- `list_merge_candidates`
- `update_workstream_layout`
- `create_workstream`
- `suggest_workspace_from_topic`
- `revertMutation`

Risks:

- route naming and Convex function naming drifting apart
- creating duplicate functionality between old CRUD actions and new orchestration actions

Done means:

- there is a clean Phase 2-ready backend surface for workspace mutations

#### Phase 1E. Orchestrator tool expansion

Goals:

- let the AI call the workspace structure operations explicitly

Likely files:

- [`src/types/index.ts`](<local-workspace>
- [`src/lib/orchestrator/tool-definitions.ts`](<local-workspace>
- [`src/lib/orchestrator/tool-executor.ts`](<local-workspace>

Required tools:

- `create_workstream`
- `create_widget`
- `update_widget`
- `move_widget`
- `attach_items_to_workstream`
- `list_merge_candidates`
- `update_workstream_layout`
- `suggest_workspace_from_topic`

Done means:

- the orchestrator can talk about workspace mutations using the same backend contracts the UI will use

#### Phase 1F. Artifact type expansion

Goals:

- give the renderer and orchestration layer a richer artifact vocabulary

Likely files:

- [`src/lib/artifact-types.ts`](<local-workspace>
- [`convex/workspace-item-sync.ts`](<local-workspace>

Required additions:

- `whiteboard`
- `visualization`
- `quiz`
- `concept_map`
- `code_output`
- `custom`

Done means:

- Phase 2 does not need to fake new widget kinds using old generic artifact buckets

### Phase 1 likely files touched

- [`src/stores/workspace-store.ts`](<local-workspace>
- [`src/lib/workspace/state-machine.ts`](<local-workspace>
- [`src/lib/workspace/contracts.ts`](<local-workspace>
- [`convex/schema.ts`](<local-workspace>
- [`convex/workspaceItems.ts`](<local-workspace>
- [`convex/workspace-item-sync.ts`](<local-workspace>
- [`convex/workspaceOrchestration.ts`](<local-workspace>
- [`src/app/api/workspace-items/route.ts`](<local-workspace>
- [`src/app/api/workspace-orchestration/route.ts`](<local-workspace>
- [`src/lib/orchestrator/tool-definitions.ts`](<local-workspace>
- [`src/lib/orchestrator/tool-executor.ts`](<local-workspace>
- [`src/lib/artifact-types.ts`](<local-workspace>

### Phase 1 exit criteria

Phase 1 is done when all of the following are true:

- the store has an explicit state machine aligned with V2
- backend widget contracts are canonical and stable
- workspace mutations have provenance and revert
- orchestrator tools exist for workspace mutations
- merge candidates and topic-suggestion foundations exist
- current UI still functions against compatibility fields and routes
- Phase 2 can focus on rendering and interaction rather than inventing architecture

## 2.2 Phase 2: Frontend / UI / Animations / Rendering / Interactions

This phase should be executed by a frontend-heavy agent after Phase 1 is complete enough.

Phase 2 should assume the data/state/orchestration layer already exists and should not spend time redesigning backend contracts.

### Phase 2 goals

1. Remove the shell-preview feeling and ship one coherent final workspace.
2. Replace hub-as-node with edge utility overlays.
3. Make overview, focused, and deep-work visually distinct.
4. Replace current internal card/list rendering with the anti-card-soup widget language.
5. Implement the command surface and panel handoff as a singular object.
6. Land the relationship, silhouette, and focus choreography described in V2.

### Phase 2 dependencies on Phase 1

Phase 2 should assume these Phase 1 foundations exist and use them instead of creating ad hoc substitutes:

- explicit `workspaceState`
- command mode and utility reveal state
- canonical `workspaceItems` fields
- `workspaceMutations` provenance/revert data
- orchestration/API endpoints for widget/workspace mutation flows
- artifact type expansion

### Phase 2 workstreams and order of operations

#### Phase 2A. Collapse the UI onto one product direction

Goals:

- remove user-visible shell switching
- collapse shell-specific renderers into one synthesized renderer

Likely files:

- [`src/app/workspace/page.tsx`](<local-workspace>
- [`src/components/workspace/workspace-toolbar.tsx`](<local-workspace>
- [`src/lib/workspace/shell-mode.ts`](<local-workspace>
- [`src/components/workspace/views/internal-content-nodes.tsx`](<local-workspace>

Done means:

- no user-facing shell toggle remains
- no major renderer path depends on A/B/C as separate products

#### Phase 2B. Replace hub node with edge utility overlay system

Goals:

- remove hub-as-node visuals
- move utility rendering into viewport space

Likely files:

- [`src/components/workspace/hub-internal-view.tsx`](<local-workspace>
- [`src/components/workspace/hub-bar.tsx`](<local-workspace>
- [`src/components/workspace/workspace-canvas.tsx`](<local-workspace>
- new edge utility components

Specific requirements:

- zones: bottom-left, bottom-right, left-edge, right-edge, top-center, top-right
- ambient vs reveal-all behavior
- pinned utility behavior
- no new canvas node pretending to be the hub

Done means:

- utilities are no longer rendered as a workstream-like canvas object

#### Phase 2C. Implement overview / focused / deep-work rendering states

Goals:

- make state visually explicit
- align camera and rendering with the Phase 1 state machine

Likely files:

- [`src/components/workspace/workspace-canvas.tsx`](<local-workspace>
- any new overview/focus rendering components

Specific requirements:

- `WORLD_OVERVIEW`: readable territories, non-readable widget silhouettes, relationship hints
- `FOCUSED`: one workstream dominant, neighbors desaturated/low opacity, readable widgets
- `DEEP_WORK`: panel open, canvas narrowed, workstream remains focused

Done means:

- the same workspace feels materially different in overview, focused, and deep-work states

#### Phase 2D. Rebuild widget rendering language

Goals:

- remove card soup
- render threads/documents/planner/visualization/media/reference/custom widgets differently

Likely files:

- [`src/components/workspace/views/internal-content-nodes.tsx`](<local-workspace>
- any new category/widget renderer components

Specific requirements:

- threads as strips
- documents as sheets/excerpts
- planner as timeline/milestone bars
- visualizations as modules
- categories as labels and rhythm, not boxed sections

Done means:

- the workstream field reads like an open composition, not grouped cards on a canvas

#### Phase 2E. Command surface and panel choreography

Goals:

- make the command surface singular and premium
- implement the “one object transfers into the panel” behavior

Likely files:

- [`src/components/workspace/workspace-command-bar.tsx`](<local-workspace>
- [`src/components/workspace/right-push-panel.tsx`](<local-workspace>
- [`src/components/workspace/workspace-canvas.tsx`](<local-workspace>

Specific requirements:

- bottom-center ambient command surface
- picker above the bar
- scoped badge when focused
- panel footer version during deep work
- transfer animation that reads as the same object

Done means:

- the command surface no longer feels like a toolbar or duplicated input

#### Phase 2F. Overview identity, relationship language, and polish

Goals:

- add the A-inspired overview memorability
- add the C-inspired focus choreography and polish
- remove remaining visual remnants of the old implementation

Likely files:

- workspace canvas and renderer components
- theme/CSS files

Specific requirements:

- territorial fields
- relationship lines
- silhouette treatment
- typography hierarchy
- motion polish
- anti-twitch utility reveal behavior

Done means:

- the workspace feels like the V2 product, not a transitional prototype

### Phase 2 likely files touched

- [`src/app/workspace/page.tsx`](<local-workspace>
- [`src/components/workspace/workspace-canvas.tsx`](<local-workspace>
- [`src/components/workspace/views/internal-content-nodes.tsx`](<local-workspace>
- [`src/components/workspace/workspace-command-bar.tsx`](<local-workspace>
- [`src/components/workspace/right-push-panel.tsx`](<local-workspace>
- [`src/components/workspace/hub-internal-view.tsx`](<local-workspace>
- [`src/components/workspace/hub-bar.tsx`](<local-workspace>
- [`src/components/workspace/workspace-toolbar.tsx`](<local-workspace>
- CSS/theme files and any new workspace-specific UI modules

### Phase 2 exit criteria

- no user-visible shell toggle
- no hub node
- no zoom-band-driven behavior
- one coherent command surface
- one coherent edge utility system
- one coherent workspace renderer
- overview, focused, and deep-work states clearly distinct
- provenance and revert visible wherever AI mutates structure

## 3. Phase 2 Handoff Expectations

This section exists so the later frontend-heavy run knows what it should and should not spend time deciding.

### What Phase 2 should assume is already decided

- product direction is already decided by V2
- there is no need to compare A/B/C again
- the shell toggle is dead
- the hub is an overlay utility system in the target product
- explicit states are correct
- provenance/revert is mandatory

### What Phase 2 is allowed to change

- visual composition
- renderer/component structure
- animation implementation
- typography and spacing
- surface treatment
- utility reveal affordances

### What Phase 2 should not re-open

- whether to keep three shells
- whether the hub should remain a node
- whether scroll should trigger state transitions
- whether widgets should all be cards
- whether AI provenance can be hidden

## 4. Quality Gate Before Phase 2 Starts

Before a Phase 2 agent begins, confirm:

- Phase 1 contracts compile and pass targeted validation.
- `workspaceItems` canonical fields are present in real responses.
- workspace mutation history and revert paths are callable.
- orchestrator tool definitions and executors are updated.
- the current UI still runs against compatibility fields.

If those are not true, Phase 2 will end up rebuilding foundations in frontend code, which is exactly what this split is meant to avoid.
