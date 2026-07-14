# Collaborative whiteboard artifact plan

## Product and reference contract

This artifact inherits the standard. `18_whiteboard_editor.png` is the executable specification for generous canvas, tools, frames, discussion/sources, presence, details, linked work, and AI treatment. Implement every visible control plus minimap, pages/layers, search, object outline/accessibility view, templates, presentation, import/export, history comparison, panel/card/embed, narrow/touch, and reduced-motion states.

Whiteboards are private by default with read-only/modify sharing, workspace projection exceptions, and explicit public access. Internally extensible capabilities handle comments/object locks without making the main share UX complicated. Hidden/inaccessible embedded artifacts never leak through board render, search, export, AI, or history.

## Model, editing, and scale

Content is a versioned spatial scene graph: board settings, pages, frames, layers, shapes, rich text, stickies, images/files, artifact embeds, connectors, groups, tables/cards, drawings, sources, comments, and constraints. Every node has stable ID, type, geometry, z-order, parent/frame, style tokens, semantic label, accessibility order, provenance, locked state, and version metadata. Common draw/text/sticky/connector/frame/select actions are obvious; layers, constraints, accessibility, source, and advanced styling use progressive disclosure.

Yjs subdocuments partition pages/regions/layers; a spatial index loads viewport plus margin. Presence includes viewport, cursor, selection, tool, and followed user. Incremental node operations coalesce drag frames and commit final geometry. Same node/property/text/connector endpoint is an exclusive region; independent nodes proceed concurrently. Conflicting delete/edit/layout pauses or queues with a clear resolution. Comments anchor to node or coordinate with frame fallback. Network loss shows reconnect/unsynchronized/recovery, blocks unsafe mutation, and does not offer offline editing.

Use level-of-detail rendering, image thumbnails, viewport culling, worker-based layout/indexing, update compaction, and metered asset/object/bandwidth rates. The scale target for tens of thousands of nodes and many collaborators must be established by real fixtures, not decorative claims.

## AI skill, effects, history, and embeds

The on-demand whiteboard skill defines purpose/selection, regions, bounded viewport/frame inspection, node and topology summaries, operations, preservation/locked nodes, layout validation, approvals, related artifacts, and effects. AI creates/places/connects/groups/aligns/distributes/clusters/labels nodes, converts text to diagrams, and reorganizes selected regions. Broad layout uses ghost/bounding-box preview. It cannot move locked/out-of-scope nodes or expose inaccessible embeds.

Actual nodes participate in Spectra effects: a node materializes, connector draws, group settles, or selected region reorganizes deliberately. Independent regions animate concurrently; effects clear completely on every terminal state and reduced motion remains legible.

Human sessions and every coherent AI/layout batch create distinct history, with a user checkpoint before AI over unversioned live work. Comparison opens historical/current boards with synchronized viewport/frame/node selection. Partial restore remaps IDs/references safely and creates a new current version. Live/pinned embeds include boards and embedded source artifacts without access escalation.

## Interchange, failure, and accessibility

Import images, PDF pages, sanitized SVG, CSV-generated sticky grids, and staged safe structured interchange from common whiteboard exports where technically possible. Export PNG/SVG/PDF by frame/page/board plus portable structured package. Quarantine active SVG/scripts, unsafe archives, links, fonts, and assets; preserve originals and report unsupported nodes, connectors, comments, frames, styles, embeds, permissions, and fidelity. Proprietary formats may require documented export steps.

Keyboard users receive ordered object tree, directional navigation, geometry inputs, connector descriptions, semantic labels, accessible reading order, and a non-spatial outline. Failures include dropped/duplicate updates, corrupt/extreme geometry, missing assets/fonts, occupied/unavailable region, concurrent delete/edit, reconnect, revocation, incomplete AI layout, inaccessible embed, and import quarantine. Recoverable unsynchronized state is never uploaded after revocation.

## Tasks

### BOARD-01 Define scene/pages/frames/layers/nodes/connectors/geometry/sources/accessibility schemas, stable regions, manifests, validation, and migrations

- [ ] Implemented
- [ ] Verified

### BOARD-02 Build exact reference plus canvas/tools/minimap/layers/search/outline/templates/present/panel/card/embed/history/responsive states with every control functional

- [ ] Implemented
- [ ] Verified

### BOARD-03 Implement partitioned live Yjs sync, viewport loading, presence/comments, exclusive region conflicts, coalesced drag, reconnect/recovery, and permission revocation

- [ ] Implemented
- [ ] Verified

### BOARD-04 Implement spatial index, level of detail, worker layout, compaction, metering, asset/object safety, and measured large-board/many-user performance

- [ ] Implemented
- [ ] Verified

### BOARD-05 Implement on-demand whiteboard skill, AI inspect/create/connect/group/layout/reorganize proposals, real node/region effects, conflict handling, cleanup, and reduced motion

- [ ] Implemented
- [ ] Verified

### BOARD-06 Implement attributed history/checkpoints, synchronized comparison, partial restore/remapping, live/pinned embeds, and permission-safe context/export

- [ ] Implemented
- [ ] Verified

### BOARD-07 Implement image/PDF/SVG/CSV/structured-package import and PNG/SVG/PDF/package export with quarantine, fidelity/unsupported reports, recovery, and tests

- [ ] Implemented
- [ ] Verified

### BOARD-08 Prove every UI control, spatial/keyboard accessibility, scale, mixed human/AI collaboration, history, embeds, asset failure, revocation, and recovery

- [ ] Implemented
- [ ] Verified

