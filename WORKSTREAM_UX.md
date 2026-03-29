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
