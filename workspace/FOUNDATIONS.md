# Shared Foundations

These rules apply to every approach unless a shell explicitly overrides presentation.

## 1. World Model

The workspace is one continuous world.

- Workstreams are spatial anchors in that world.
- Widgets are the visible units inside workstreams.
- Artifacts are the persisted objects behind many widgets.
- Threads are also widgets when shown on canvas, but still open in the push-panel.
- The hub is not a workstream. It is a utility layer living at the edges of the viewport.

### Codebase reality

The current codebase already has:

- `workstreams`,
- `artifacts`,
- `artifactVersions`,
- `chats`,
- `plannerItems`,
- `workstreamMemory`,
- clarification cards,
- ManageBac-based workstream creation.

It does not yet have a first-class persistent widget table.

That means the redesign should treat the current artifact model as the persistence backbone, then either:

1. extend `artifacts.layout` and related metadata so artifacts can behave as workspace widgets properly, or
2. introduce a dedicated workspace-item/widget layer that references artifacts, chats, planner items, and utility instances.

This document assumes option 2 is cleaner long-term, with option 1 as an incremental bridge if needed.

## 2. Widget / Artifact Contract

The product should stop treating widgets as a separate special class.

- A widget is a rendered workspace object with position, size, affordances, and AI-editability.
- An artifact is the persisted model and version history behind a widget.
- One artifact can render as different widget shells depending on context.
- A thread preview on the canvas is a widget.
- A rich document preview is a widget.
- A quiz, timetable, planner, whiteboard, progress tracker, concept map, or visualization is also a widget.

### Recommended persistence split

```text
artifact
  = persisted content + version history + source provenance

workspace item / widget instance
  = placement + size + visual shell + group + pin state + render mode

chat thread
  = conversation record

thread widget
  = on-canvas representation of that chat thread
```

This avoids forcing one artifact to have only one visual presence.

### Required widget categories

Categories should remain visible so the workspace is not semantically flat.

- `threads`
- `documents`
- `planner`
- `boards`
- `visualizations`
- `media`
- `references`
- `custom`

These are categories, not prisons.

- AI can create a custom widget that still belongs to a category.
- The UI can group by category without wrapping everything in boxed cards.
- The user can reorganize the category layout, but categories remain discoverable.

## 3. Default Rendering Language

The UI should move away from "every item is a rectangle card."

Preferred render language:

- open composition,
- border-light surfaces,
- typographic anchors,
- floating labels,
- soft grouping fields,
- subtle color lanes,
- ghost separators,
- content-shaped blocks rather than uniform boxes.

Avoid:

- nested containers,
- repetitive card stacks,
- thick chrome around every item,
- layouts where the grouping box is more visible than the work itself.

## 4. AI Creation Contract

AI should be allowed to act, but it must act legibly.

### Default behavior

- AI may create widgets, artifacts, or layout changes automatically when confidence is high.
- AI may edit existing widgets/artifacts directly.
- Every material action gets provenance.

### Missing first-class AI actions

The current tool layer already supports memory recall/save, note creation, planner updates, thread forking, and workstream context lookup.

It does not yet expose first-class actions for:

- create workspace,
- create widget,
- move widget,
- merge threads into workspace,
- attach artifacts to workspace,
- propose workspace from repeated topic,
- ask structured clarification specifically for workspace mutations.

Those actions should exist before the architecture is considered complete.

### Provenance UI

Every auto-created or auto-edited result should show a lightweight action chip or inline ribbon:

```text
AI created this timetable widget    [Revert]
AI reorganized this workspace       [Revert]
AI updated the Biology tracker      [Revert]
```

If reverted:

```text
Change reverted                     [Restore]
```

### When AI should ask questions

If confidence is low or scope is ambiguous, AI should ask before mutating.

Question format should prefer structured response chips instead of plain text.

Example:

```text
What should I update?
[Current workspace] [All Biology widgets] [Only the timetable]
```

Rules:

- prefer one question over many,
- prefer multiple choice over free-form,
- persist the pending question until answered or dismissed,
- do not spam repeated clarification requests,
- do not invent a new workspace because of a vague enhancement request.

## 5. Hub Utility Model

The hub is a viewport utility layer, not a canvas object.

### Hub behavior

- Mostly hidden until hover, bump, hotkey, or explicit reveal.
- Some utilities can stay visible when active or pinned.
- Utilities live in compatible zones, not arbitrary freeform placement.

### Utility zones

- bottom center:
  primary AI command surface
- bottom corners:
  timer, deadline pulse, session status
- left and right edges:
  pinned workspace shortcuts, quick utilities, transient drawers
- top edge:
  breadcrumbs, view mode, reveal-all control

### Compatibility rules

- The command surface is horizontal only.
- Timer can float as a chip or dock to a corner.
- Workstream shortcuts can live on any edge.
- Utility clusters should snap to allowed edge slots so customization remains coherent.

### Reveal model

There should be two states:

1. ambient mode
   Only pinned or active items are visible.
2. reveal mode
   A command or button exposes all edge utilities at once for arrangement and discovery.

### Important interpretation

The hub is not globally "outside work."

It is only structurally outside the workstream model.

Users may still want:

- quick notes,
- deadlines,
- pinned documents,
- timetable fragments,
- cross-workstream references

to appear both as utilities and as workspace content.

The system should not hard-ban that. It should only avoid making the hub a fake normal workspace.

## 6. Camera and Navigation Rules

These rules are strict.

- No auto-enter by scroll.
- No auto-exit by scroll.
- No forced camera movement because a nearby workspace became "active" while panning.
- Panning should remain panning.
- Zooming should remain zooming.

### Camera may move automatically only when:

1. first load fit-to-world,
2. explicit click / keyboard entry into a workspace,
3. explicit exit back to overview,
4. explicit recenter or home action,
5. explicit jump from a shortcut, search result, or AI command.

### Focus behavior

When a workstream is entered:

- compute the bounding box of its visible widgets,
- find a clean framing target,
- fit that target to the viewport with safe padding,
- do not clip important widgets,
- do not over-zoom into a random corner.

### Neighbor behavior

- The active workspace should dominate the viewport.
- Nearby workstreams may remain faintly visible as landmarks.
- They should never hijack the camera while the user is panning.

## 7. Right Push-Panel Choreography

The right panel remains central to the product.

### It must support

- thread conversations,
- documents,
- whiteboards,
- custom artifacts with AI editing,
- resizable widths,
- version history where relevant.

### Command-surface handoff

When a right panel opens:

1. the workspace command surface leaves the main viewport,
2. it animates downward and out,
3. after a short delay, the same surface reappears in the panel footer.

This should feel like a transfer, not like two unrelated inputs existing at once.

### Panel animation

- the clicked widget emits a ghost or lift motion toward the panel edge,
- the panel opens with spring-weighted motion,
- the canvas narrows without jank,
- closing reverses the choreography.

## 8. Default Objects on First Use

The system should start helpful, not blank.

For a student, defaults should likely include:

- one workstream per detected class,
- one general workspace,
- one CAS / projects workspace if data suggests it,
- one Extended Essay workspace when relevant,
- the AI command surface,
- a focus timer,
- a timetable utility if ManageBac data exists,
- a deadline utility if assignments exist.

For a teacher, defaults should likely include:

- one workstream per class taught,
- one planning workspace,
- timetable and deadlines,
- presentation / lesson artifact suggestions.

No new user should land in an empty void with no prompts.

## 8A. Workspace Evolution Over Time

Workspaces should not only be created on day one.

They should also be able to emerge later.

### Trigger for AI-suggested workspace creation

A new workspace becomes a candidate when multiple signals align:

- repeated topic recurrence across chats,
- multiple artifacts around the same topic,
- planner density around the same theme,
- user memory indicating durable ongoing relevance,
- no existing strong workstream match.

### Creation rule

Do not create on first mention.

Prefer:

```text
topic appears repeatedly
  + memory confidence rises
  + multiple related artifacts/threads exist
  -> suggest or auto-create workspace
  -> attach the best matching existing items
  -> show provenance + revert
```

## 8B. Embedding Strategy

The codebase already supports server-side embeddings and vector retrieval for memory.

Recommendation:

- keep canonical memory and retrieval server-side,
- optionally experiment later with browser-local clustering for low-cost visual relationship hints,
- do not make browser embeddings the critical path for workspace correctness in v1.

Why:

- browser support and model footprint complicate reliability,
- server-side memory is already real in the current codebase,
- visual relationship hints can tolerate approximation better than core retrieval.

## 9. Whiteboard Artifact

There should be a first-class whiteboard artifact.

- It is a type of artifact and therefore a type of widget.
- It opens in the right panel.
- It can be resized and persisted.
- It should not become "a full freehand canvas on top of the main canvas."
- The drawing surface belongs inside the artifact shell, not on the global workspace plane.

Possible type additions:

- `whiteboard`
- `visual_widget`
- `custom_widget`

The current artifact type catalog is not yet rich enough for the intended model.

## 10. Error Handling for AI-Generated UI

Because widgets may be code-backed, failure handling must be explicit.

Required safety features:

- renderer boundary for custom widget failures,
- visible fallback state,
- one-click `Fix with AI`,
- schema validation before render when possible,
- lint / type / render checks before persisting executable widget code,
- automatic rollback to last valid version if a generated widget fails hard.

### User-facing recovery

Every failed generated widget should offer:

- `Restore previous`
- `Fix with AI`
- `Open code/details`

## 11. Themes and Visual Identity

The product should remain globally coherent, but workstreams can have light personalization.

Allowed workspace-level identity:

- primary color,
- secondary color,
- accent treatment,
- optional subtle atmosphere shift.

Avoid:

- turning each workspace into a completely different product,
- allowing unrestricted color chaos.

## 12. Shared Flow Summary

```text
Overview
  -> click workspace
  -> camera fits active workspace
  -> ambient utilities reduce
  -> workspace dominates viewport
  -> click widget
  -> right panel opens
  -> command surface transfers into panel
  -> AI edits directly
  -> provenance chip appears
  -> user can revert or restore
  -> close panel
  -> stay in workspace
  -> exit explicitly
  -> return to overview
```
