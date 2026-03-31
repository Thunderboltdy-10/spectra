# Workstream UX Notes

## Goal
The committed workstream should feel like a productive spatial desk, not a mini dashboard.

## Current problems
- Structured view still reads as boxed widgets instead of grouped working zones.
- Zoom threshold is too shallow, so internal content appears before the user feels they have entered a distinct mode.
- Dragging flickers because the canvas is rerendering too aggressively during drag updates.
- Column view is clearer than structured view, but it still lacks purpose and spatiality.
- Graph mode is either failing to render or not visually legible enough to be useful.
- Hub and workstream entry are still under-explained.
- Command-bar scoping UI works visually but anchor placement is off.
- CreateArtifactDialog component exists but is NOT wired to any button — "New" in notes-workspace just auto-creates a blank document.
- Only "document" type artifacts are practically usable; other 9 types have no templates or initialization.
- Panel toggle bug: clicking the same panel button twice doesn't close it.
- Panel switch bug: switching from thread to artifact can cause "not found" errors.
- Settings drawer shows different content on different pages.

## Direction for this pass
- Make overview default more zoomed out in world-space terms by spacing content further apart, not by shrinking the whole UI.
- Reserve committed/internal content for deeper zoom only.
- Structured view should become full-width invisible lanes with faint separators, no boxed containers.
- Column view should stay denser but allow spatial drag.
- Graph view should render fewer, clearer nodes and visible relationships.
- Right-click on canvas becomes the creation affordance for workstreams/documents/threads.
- Workstream breadcrumb/back affordance should move lower and closer to search/toolbar rhythm later.

## Working principle
If a committed workstream does not help the user decide what to do next or manipulate objects meaningfully, it is not done.

---

## Wave 4 Brainstorm: Making the Workspace "Alive"

### The Core Question
Why would someone use this over ChatGPT + Word + File Explorer + Notion? Each does ONE thing well. Spectra must do the INTERSECTION better than the sum of parts.

### What "Alive" Means (Not Motion — Presence)
- **Ambient intelligence**: the workspace knows what you're working on and surfaces relevant things
- **Warmth**: not cold/clinical but textured, personal, like a well-used desk
- **Responsiveness**: every interaction has satisfying micro-feedback
- **Depth**: there's always more to discover beneath the surface
- **Presence**: a subtle feeling that AI is there, ready, watching over your work
- **No continuous motion at rest**: motion serves transitions only

### What Students/Teachers Actually Need
1. Quick access to current work (no 5-click navigation)
2. Context switching without losing context (jump between subjects/projects)
3. AI that understands MY work (not generic, knows MY documents/notes)
4. Visual organization that leverages spatial memory
5. Templates (never start from blank)
6. Progress tracking (how far am I? what's due?)
7. Rich documents (not just text — embeds, callouts, code, drawings)
8. Creation that feels fast and intentional (type picker, not auto-blank)

### Artifact System Gaps
- CreateArtifactDialog exists at `src/components/artifacts/create-artifact-dialog.tsx` but is NEVER mounted
- Notes workspace "New" button bypasses it entirely (auto-creates blank document)
- 10 artifact types defined in `src/lib/artifact-types.ts` but no templates
- No canvas/drawing artifact type for freeform visual thinking
- "Other" artifacts shouldn't have rich text formatting (would break markdown)

### Ambient Polish Targets
- Workstream zone warmth: subtle gradient tint per visible workstream (3% opacity of color)
- "Currently working on" glow: last-accessed workstream gets soft border glow
- Content items: scale(1.01) on hover, 150ms ease
- Panel open/close: spring physics
- Internal node entry: stagger fade-in (30ms per item, -4px y-drift)
- Workstream card hover: shadow deepens, border warms
- Standardized transition timing across all components
- NO continuous animation at rest

### Implementation Priority
1. Quick wins: B1 (blur fix), B2 (panel toggle), B10 (settings)
2. Core creation: B11 (artifact creation + templates), B6 (artifact organization)
3. Experience: B7 (doc metadata), B9 (context menu), B3 (resizable panels)
4. Animation: B4 (multi-visible), B5 (unified AI input), B14 (ambient polish)
5. Features: B12 (hub + timer), B8 (block controls), B13 (file attachment)
