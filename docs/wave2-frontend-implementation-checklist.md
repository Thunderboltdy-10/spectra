# Wave 2 — Surface Foundation: Frontend Implementation Checklist

> Generated from analysis of existing workspace frontend files against the authoritative spec (`docs/workspace-authoritative-spec.md`).
> This is planning input only — no code was edited.

---

## Current File Inventory

| File | Purpose | Status |
|------|---------|--------|
| `src/app/workspace/page.tsx` | Page orchestrator, demo data, layout | Exists, needs major rework |
| `src/components/workspace/workspace-canvas.tsx` | ReactFlow continuous canvas | Exists, partially aligned |
| `src/components/workspace/glance-cards.tsx` | Glance-tier item cards | Exists, partially aligned |
| `src/components/workspace/focus-panel.tsx` | Right-panel deep-edit surface | Exists, **architecturally misaligned** |
| `src/components/workspace/workspace-dock.tsx` | Left-edge workspace selector | Exists, partially aligned |
| `src/components/workspace/command-bar.tsx` | Bottom-center unified command bar | Exists, partially aligned |
| `src/components/workspace/timer-widget.tsx` | Bottom-right timer/focus | Exists, aligned |
| `src/components/workspace/planner-edge.tsx` | Right-edge planner panel | Exists, **positionally misaligned** |
| `src/components/workspace/tint-zone.tsx` | Tint zone wrapper for grouped items | Exists, aligned |
| `src/stores/workspace-store.ts` | Zustand workspace state | Exists, needs expansion |
| `src/lib/workspace/contracts.ts` | Types, constants, zoom tiers | Exists, needs expansion |
| `src/lib/workspace/events.ts` | Window event bus | Exists, aligned |
| `src/lib/artifact-types.ts` | Canonical type mappings | Exists, aligned |

---

## Architectural Mismatches (Must Fix in Wave 2)

### AM-1: FocusPanel is a right-panel — spec says NO right-panel model

**Current**: `focus-panel.tsx` is a resizable right-panel that slides out from the right edge via `AnimatePresence`. The page layout in `page.tsx` renders it as a flex sibling to the main content, creating a classic right-panel architecture.

**Spec says**: "Opening notes, threads, or other deep-edit targets in `/workspace` must expand the corresponding hub or edge surface. These surfaces may be large and powerful, but they are part of the hub ecology, not a separate panel system." (§5)

**Required change**: Replace `FocusPanel` with right-edge hub surface(s) that expand from a collapsed/tab state. They must be part of the hub ecology (edge-rail-constrained, expandable-on-hover, lockable-open). The current separate panel component and `panelOpen` / `panelTarget` store state need rethinking.

### AM-2: Planner is on the RIGHT edge — spec says LEFT edge, above workspace selector

**Current**: `planner-edge.tsx` renders `fixed right-0 top-1/2` as a right-edge slide-out panel with a vertical tab trigger.

**Spec says**: "planner: left edge, above workspace selector" (§4 hub positions).

**Required change**: Move planner to left edge, positioned above the workspace dock. Planner must also become a real operating layer with timetable, reminders, input, notifications, and planner navigation (§9).

### AM-3: WorkspaceInterior breaks continuous canvas model

**Current**: `page.tsx` uses `AnimatePresence mode="wait"` to switch between `<WorkspaceCanvas>` (all-workspaces view) and `<WorkspaceInterior>` (committed workspace view). `WorkspaceInterior` is a completely different component — a scrollable list of TintZones with GlanceCards — not the canvas.

**Spec says**: "The user must be able to pan naturally, zoom naturally... enter and leave workspaces through spatial motion rather than crude mode jumps" (§1). The canvas must be continuous.

**Required change**: Remove the `WorkspaceInterior` component. Workspace entry/exit must happen through zoom-driven spatial transition on the same `<WorkspaceCanvas>`. The canvas already has `buildNodes` logic for committed workspace items — the interior view must use the canvas renderer, not a separate scrollable list.

### AM-4: No hub primitive system exists

**Current**: Each hub surface (dock, command bar, timer, planner, focus panel) is independently positioned with `fixed` CSS. There is no shared hub primitive that provides edge-rail constraints, expansion model, or pin/unpin behavior.

**Spec says**: Hub ecology with edge-rail-constrained motion, per-item hover expansion, per-item locked-open state, global hub visibility states (hidden/collapsed/expanded) (§7, §8).

**Required change**: Create a `HubSurface` primitive component that all edge-bound surfaces use. This primitive must enforce edge-rail constraints and provide the expansion model.

---

## Missing Wave 2 Surface Pieces

### M-1: Hub primitive component — `hub-surface.tsx` (NEW FILE)

A shared primitive for all edge-bound workspace surfaces. Must support:
- [ ] Edge position enum: `top | bottom | left | right`
- [ ] Collapsed / hover-expanded / locked-open states
- [ ] Edge-rail-constrained drag (horizontal on top/bottom, vertical on left/right)
- [ ] Consistent expansion animation
- [ ] Global hub visibility prop integration (`hidden | collapsed | expanded`)
- [ ] Pin/unpin affordance

### M-2: Right-edge deep-edit surfaces — `deep-edit-surface.tsx` (NEW FILE, replaces `focus-panel.tsx`)

Replace the right-panel model with hub-ecology deep-edit surfaces:
- [ ] Wrap in `HubSurface` with `edge="right"`
- [ ] Tab/collapsed state showing item icon + title vertically
- [ ] Hover-expand to preview
- [ ] Click/lock to full deep-edit mode
- [ ] Support multiple simultaneous open surfaces (stacked vertically on right edge)
- [ ] Content renderers: note editor, code editor, flashcard review, quiz, thread chat, AI assist
- [ ] Remove dependency on `panelOpen` / `panelTarget` store pattern

### M-3: Semantic zoom transition system (CANVAS REWORK)

The canvas zoom tiers exist in contracts but the rendering transitions are incomplete:
- [ ] Landscape tier (zoom < 0.20): Workspace envelopes as readable territory cards — **current implementation works**
- [ ] Summary tier (0.20–0.55): Interior structure visible, group headers, item counts, previews appear — **partially implemented but only in territory node, needs refinement**
- [ ] Detail tier (zoom > 0.55): Full item cards with touch interaction, inline editing affordances — **implemented as item nodes but only after explicit commit**
- [ ] Auto-commit/auto-exit: `VIEWPORT.AUTO_ENTRY_THRESHOLD` (0.9) exists but is not implemented — zooming in should auto-commit to workspace, zooming out should auto-exit
- [ ] Content representation must change smoothly per tier — not binary switch
- [ ] Workspace entry/exit should compute center and zoom from actual content bounds and spatial envelope, not crude defaults
- [ ] fitView on committed workspace (currently has a TODO comment placeholder)
- [ ] Dots must remain fixed screen-size (ReactFlow Background dots should stay perceptually consistent across zoom levels)

### M-4: Planner left-edge rework — `planner-edge.tsx` (REWORK)

- [ ] Reposition from right edge to left edge, above workspace dock
- [ ] Wrap in `HubSurface` with `edge="left"`
- [ ] Add timetable view
- [ ] Add reminder input
- [ ] Add notification indicators
- [ ] Add planner navigation (date switching)
- [ ] Sync behavior with timer widget
- [ ] Remove the full-screen backdrop overlay approach

### M-5: Command/result card system — `result-card.tsx` (NEW FILE)

**Spec §10**: AI responses should default to command/result cards above the unified command bar, not thread creation.
- [ ] Processing state: loading indicator + prompt snippet
- [ ] Completion state: dismissible result card, ~2 lines max
- [ ] Single press reopens relevant context
- [ ] Double-click opens associated thread or deep-edit surface
- [ ] Stacks above command bar with AnimatePresence

### M-6: Workspace selector dock rework — `workspace-dock.tsx` (MINOR REWORK)

- [ ] Wrap in `HubSurface` with `edge="left"`
- [ ] Add `onGoHome` handler (currently passed but no actual behavior)
- [ ] Ensure planner sits above it in the left-edge stack
- [ ] Add drag handle for vertical repositioning within left edge rail

### M-7: Command bar enhancements — `command-bar.tsx` (ENHANCE)

- [ ] Wire creation callbacks to real Convex mutations (currently all `noop`)
- [ ] Add workspace context intelligence (visible items, current zoom tier)
- [ ] Integration point for result cards (M-5) appearing above
- [ ] Unified action surface: search, AI, create must feel like one surface
- [ ] Wrap in `HubSurface` with `edge="bottom"`

### M-8: Glance layer strengthening — `glance-cards.tsx` (ENHANCE)

- [ ] Cards must render differently per zoom tier (landscape: minimal chip, summary: current card, detail: expanded with interaction)
- [ ] Add click-to-open-hub-surface behavior (replacing click-to-open-right-panel)
- [ ] Add drag affordance for canvas repositioning at detail tier
- [ ] Hover preview state

### M-9: Background system — `workspace-canvas.tsx` (ENHANCE)

Spec §14:
- [ ] Dots mode with fixed screen-size dots (current: partial, uses ReactFlow `BackgroundVariant.Dots`)
- [ ] Blank mode
- [ ] Grid mode
- [ ] Background mode selector (could be in command bar or hub widget)
- [ ] Visually clean transitions between modes

### M-10: Organizational lenses in same canvas (CANVAS REWORK)

Spec §12: `byType`, `byTopic`, and `timeline` must exist as lenses within the same spatial environment.
- [ ] Currently, view mode tabs exist in `WorkspaceInterior` — they need to move into the canvas
- [ ] `byType` lens: group items by canonical type (current default)
- [ ] `byTopic` lens: cluster by topic/subject with dynamic spatial grouping
- [ ] `timeline` lens: arrange items chronologically on a time axis
- [ ] Lens switching must rearrange nodes on the same canvas, not swap components
- [ ] View mode selector must be accessible from canvas (toolbar or command bar)

---

## Store Changes Required (`workspace-store.ts`)

- [ ] Remove `panelOpen` / `panelTarget` — replace with hub-surface-oriented state
- [ ] Add `hubVisibility: 'hidden' | 'collapsed' | 'expanded'` global state
- [ ] Add `openHubSurfaces: Map<string, { edge, locked, itemId }>` for tracking open hub items
- [ ] Add `pinnedHubItems: string[]` for pinned objects
- [ ] Add `backgroundMode: 'dots' | 'blank' | 'grid'` state
- [ ] Add `autoCommitEnabled: boolean` for zoom-to-commit behavior
- [ ] Expand `setViewport` to trigger auto-commit/auto-exit when zoom crosses threshold
- [ ] Add `lensMode: ViewMode` that works within the canvas (currently `viewMode` is only used in the removed `WorkspaceInterior`)

---

## Contracts Changes Required (`contracts.ts`)

- [ ] Add `HubSurfacePosition` type: `{ edge: 'top' | 'bottom' | 'left' | 'right'; order: number; locked: boolean }`
- [ ] Add `HubVisibility` type
- [ ] Add `BackgroundMode` type
- [ ] Add content-bounds computation helpers for workspace entry/exit zoom calculations
- [ ] Validate zoom tier thresholds against actual rendering needs (current thresholds may need tuning)

---

## File-Level Implementation Order

1. **`src/lib/workspace/contracts.ts`** — Add hub, background, and bounds types
2. **`src/stores/workspace-store.ts`** — Expand state for hub ecology, remove panel state
3. **`src/components/workspace/hub-surface.tsx`** — NEW: Hub primitive
4. **`src/components/workspace/planner-edge.tsx`** — REWORK: Move left, wrap in hub primitive
5. **`src/components/workspace/workspace-dock.tsx`** — MINOR: Wrap in hub primitive, stack with planner
6. **`src/components/workspace/deep-edit-surface.tsx`** — NEW: Right-edge deep-edit (replaces focus-panel)
7. **`src/components/workspace/result-card.tsx`** — NEW: Command/result cards
8. **`src/components/workspace/command-bar.tsx`** — ENHANCE: Result card integration, hub wrap
9. **`src/components/workspace/workspace-canvas.tsx`** — REWORK: Semantic zoom transitions, auto-commit, lenses, background modes
10. **`src/components/workspace/glance-cards.tsx`** — ENHANCE: Tier-aware rendering
11. **`src/components/workspace/tint-zone.tsx`** — MINOR: Ensure canvas-compatible (may need node wrapper)
12. **`src/app/workspace/page.tsx`** — REWORK: Remove `WorkspaceInterior`, remove right-panel layout, wire real data, hub orchestration
13. **`src/components/workspace/focus-panel.tsx`** — DELETE: Replaced by `deep-edit-surface.tsx`

---

## Risk Notes

1. **Backend dependency**: Spec §15 says real creation flows must work. Wave 2 frontend can stub Convex calls, but the command bar create callbacks (`onCreateNote`, etc.) must have a real mutation path by Wave 3.
2. **ReactFlow limitations**: Hub surfaces are `fixed` positioned overlays, not ReactFlow nodes. The hub ecology operates outside the canvas coordinate system — this is correct, but interaction between canvas clicks and hub surfaces needs careful event handling.
3. **Demo data removal timing**: `page.tsx` has inline `DEMO_WORKSPACES` and `DEMO_PLANNER_TASKS`. These should be replaced with Convex queries during Wave 2, but can remain as fallback during initial surface work.
4. **framer-motion dependency**: Both `focus-panel.tsx` and `page.tsx` use framer-motion (`motion`, `AnimatePresence`). The deep-edit-surface replacement should continue using framer-motion for consistency.
5. **Zoom tier tuning**: Current thresholds (landscape < 0.20, summary < 0.55, detail ≥ 0.55) may need adjustment once real content is rendered — the visual transitions must feel natural, not jarring.
