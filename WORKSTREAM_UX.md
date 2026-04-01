# Spectra Workspace UX

This file is now the master brief for the workspace redesign. The detailed architecture lives in the new [`workspace/`](<local-workspace> folder so the shared rules, the three shells, and the implementation guardrails can evolve separately without becoming unreadable.

## What Changed

The earlier version of this document correctly identified the main problem: Spectra has the right primitives but the wrong feel. The canvas, hub, search, panel logic, artifacts, and AI all exist, but they currently feel stitched together rather than authored as one system.

This rewrite changes the framing in five important ways:

1. The canvas stays the primary world.
2. The hub stops being a pseudo-workspace and becomes a utility layer.
3. Widgets and artifacts become the same underlying concept, but semantic categories remain visible so the UI does not devolve into chaos.
4. AI is allowed to create and edit by default, but every material action gets explicit provenance and one-click revert.
5. The three approaches become three distinct UX shells over one shared canvas/widget/panel engine.

## Non-Negotiables

- No scroll-to-enter or scroll-to-exit workspaces.
- Camera control only happens on first load, explicit enter, explicit exit, or explicit recenter actions.
- The right push-panel remains essential for threads and document/artifact work.
- The search / AI command surface returns to a cleaner spotlight-style component rather than a dense toolbar input.
- The hub is mostly hidden at the edges unless pinned, active, or deliberately revealed.
- The focused workspace should dominate most of the viewport.
- Users can customize layout, but only inside safe zone rules so the product does not become shapeless.
- Defaults must be strong enough that a new student or teacher can work immediately without setup.

## Recommended Direction

The strongest current direction is no longer the previous bottom-hub "Portal Canvas" recommendation.

The new recommended shell is:

- [`Approach B: Magnetic Surface`](<local-workspace>

Why:

- It preserves the infinite canvas better than the desk framing suggested before.
- It matches your preference for a strong central active zone with hidden edge utilities.
- It supports the right-panel choreography you want without forcing a permanent heavy dock.
- It is the best fit for "AI-native but still productive" because it keeps the active work visible and the chrome peripheral.

The other two primary shells remain valid and should still be implemented as hard preview toggles:

- [`Approach A: Semantic Constellations`](<local-workspace>
- [`Approach C: Focal Lenses`](<local-workspace>

There is also one optional wildcard that is worth keeping as a reference because it meaningfully departs from the 2D map model:

- [`Wildcard D: Strata Canvas`](<local-workspace>

## Document Map

- [`workspace/README.md`](<local-workspace>
  The overview, tradeoffs, and file map.
- [`workspace/FOUNDATIONS.md`](<local-workspace>
  The shared engine: widgets, AI behavior, hub utilities, camera rules, panel choreography, defaults, and safety.
- [`workspace/IMPLEMENTATION_GUARDRAILS.md`](<local-workspace>
  The execution order, preview toggle model, and what to preserve from the current codebase.
- [`workspace/BACKEND_AND_EVOLUTION.md`](<local-workspace>
  The memory, embedding, workspace-creation, and AI mutation rules that should survive compaction.
- The individual approach files
  The three materially different shells plus the wildcard.

## Core Principle

Spectra should feel like a place where work naturally accumulates, AI naturally helps, and the student or teacher never wonders where something went or why the camera just moved.

The winning experience is not "maximally futuristic." It is:

- clear on first contact,
- spatially memorable after repeated use,
- powerful under the surface,
- visually premium without being decorative noise,
- opinionated enough to start working immediately,
- flexible enough to become personal over time.

## Immediate Next Step

Before implementation starts, the docs in [`workspace/`](<local-workspace> should be treated as the working source of truth for:

- the shared workspace engine,
- the three previewable shells,
- the AI creation and revert contract,
- the panel and command-surface choreography,
- the memory and workspace-evolution model,
- the guardrails that prevent the product from becoming either rigid or chaotic.

---

# Brainstorming & Implementation Plan (Updated April 1, 2026)

## Strategy
Following our discussion, the path forward involves unifying the underlying data model to support a genuine "widget" ecosystem across all shells, and overhauling the front-end to bring three entirely distinct aesthetic paradigms to life using the shared engine.

### 1. Backend Foundations: The Unified Widget Ecosystem
We have migrated `workspaceItems` to the `convex/schema.ts` as a first-class table entity. 
- A workspace item can be *any* generic object (thread, document, planner, visualization, custom). 
- It maintains intrinsic coordinates (`x`, `y`), dimensions (`width`, `height`), and a `renderMode`.
- **Why this matters**: We decouple content from layout. When AI creates a visualization artifact, it can drop it onto the canvas as a custom widget without rewriting front-end logic.

### 2. Frontend Redesign: Delivering Three Unforgettable Aesthetics
We are completely rewriting `workspace-shell-stage.tsx`, `workspace-canvas.tsx`, `internal-content-nodes.tsx`, and `workspace-command-bar.tsx` to support the three different approaches dynamically via the `WorkspaceShellMode` toggle.

#### Approach A: Semantic Constellations (The "Deep Space" Paradigm)
- **Vibe**: Dark, ethereal, physics-based, data-heavy, relationship-driven.
- **Visuals**: We drop boxes and cards entirely. Widgets are rendered as glowing text clusters connected by thin orbital rings and vector lines. Heavy use of `radial-gradient` meshes, glow effects (`mix-blend-mode: screen`), and spatial nodes. The "Right Panel" flies in cleanly, suppressing the rest of the canvas into a deeply blurred backdrop (`backdrop-filter: blur(40px) brightness(0.6)`).
- **Interactions**: Fluid, floating hover states. Instead of strict grid layouts, widgets repel slightly, forming organic clusters.

#### Approach B: Magnetic Surface (The "Tactile Glass" Paradigm) - Recommended
- **Vibe**: Fast, tactile, translucent, highly structured but infinite.
- **Visuals**: The macOS-meets-Linear ideal. Gorgeous frosted glass panels (`backdrop-filter: blur(24px)`), sharp 1px borders, subtle white noise textures. Elements snap into magnetic lanes, with drawers seamlessly fading out into the edges. 
- **Command Bar**: A beautiful pill-shaped command palette at the bottom center. When you hit `Cmd+K`, it expands fluidly, casting a massive drop shadow, and acts as the universal AI entry point for both navigating to workstreams and triggering widget creation.

#### Approach C: Focal Lenses (The "Guided Focus" Paradigm)
- **Vibe**: Immersive, luxurious, cinematic.
- **Visuals**: A "vignette" around the active workstream. Peripheral noise fades to deep shadow, and the active content sits front-and-center bathed in a soft directional glow. High contrast typography. 
- **Layout**: Center stage is dominant. It doesn't use the whole screen width, instead keeping content intentionally constrained and highly legible. The rest of the screen operates like a dark room until you bring the spotlight there.

### 3. The "Hub" and Command Surface Choreography
The Hub is no longer a fake workstream. It is an ambient layer at the edge of the viewport.
- **The Drawer Model**: Things like Timers, Deadlines, and Global Activity are stored in hidden edge drawers or the bottom dock. They are visible only when explicitly invoked or when contextually relevant (e.g. a deadline approaches).
- **The Search Bar Animation**: When opening the right panel (Thread/Note), the bottom command bar smoothly animates downwards, disappearing below the screen fold, and re-emerges *inside* the right panel as the chat input. It maintains the illusion of being a singular, unified physical object moving through the interface.

### 4. Implementation Next Steps
- Implement the highly styled React Flow custom nodes for the 3 approaches in `internal-content-nodes.tsx`.
- Refactor the Spotlight UI in `workspace-command-bar.tsx` to handle the new transitions and edge-drawer behaviors.
- Connect the frontend components to the new Convex `workspaceItems` APIs to support moving, creating, and grouping.

We are entering the Execution Phase.
