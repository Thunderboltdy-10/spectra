# Collaborative whiteboard and canvas artifact plan

## Model and experience

This artifact inherits the standard. Content is a spatial scene graph: board settings, pages, frames, layers, shapes, rich text, sticky notes, images/files, embeds, connectors, groups, tables/cards, drawings, sources, comments, and spatial constraints. Every node has stable ID, type, geometry, z-order, parent/frame, style tokens, semantic label, accessibility order, provenance, and locked state.

Preserve the reference’s generous canvas, object tools, frames, discussion/sources, presence, and details. Add minimap, pages/layers, search, outline/accessibility view, templates, presentation mode, export, large-board loading, and explicit AI target/preview states. Keyboard users need an ordered object tree, directional navigation, geometry inputs, connector descriptions, and non-spatial alternatives.

## Collaboration and scale

Yjs subdocuments partition pages/regions/layers; a spatial index fetches viewport plus margin. Presence includes viewport, cursor, selection, tool, and followed user. Operations are incremental create/update/delete/reparent/order; dragging coalesces intermediate frames and commits final geometry. Comments anchor to nodes or coordinates with frame fallback.

Use level-of-detail rendering, image thumbnails, viewport culling, worker-based layout/indexing, update compaction, and server-enforced object/asset/rate limits. A board remains navigable with tens of thousands of objects; performance targets require fixture measurements before promises.

## AI spatial collaborator

The context adapter sends visible/selected frames, object summaries, topology, sources, and bounded thumbnails—not the whole board. AI operations create nodes, place via layout constraints, connect, group, align/distribute, cluster, label, convert text to diagram, and reorganize a selected region. Layout proposal previews bounding boxes/ghost nodes; user edits in the target region trigger rebase or pause. Blue traces follow nodes/region/layout pass.

AI-generated diagrams must use meaningful semantics and accessible reading order. Source nodes preserve citation links. It cannot move locked/out-of-scope nodes or expose hidden/no-access embeds.

## History, import/export, failure

Meaningful versions snapshot scene subdocuments and asset refs; history opens the historical board in the left panel with synchronized viewport or frame selection. Partial restore can restore nodes/frame/layer and handles ID collisions through reference remapping. Export PNG/SVG/PDF by frame/board and import supported images/SVG/structured interchange with sanitization.

Handle dropped updates, duplicate objects, corrupted geometry, missing assets/fonts, extreme coordinates, concurrent delete/edit, unavailable region, permission revocation, offline divergence, and incomplete AI layout. Preserve recoverable local updates and never upload after revocation.

## Tasks

### BOARD-01 Define scene graph, pages/frames/layers, nodes/connectors, geometry, sources, and accessibility order

- [ ] Implemented
- [ ] Verified

### BOARD-02 Build canvas/tools/minimap/layers/search/outline/templates/present/card/embed/history representations

- [ ] Implemented
- [ ] Verified

### BOARD-03 Implement partitioned CRDT sync, viewport loading, presence, coalesced drag, comments, and offline recovery

- [ ] Implemented
- [ ] Verified

### BOARD-04 Implement spatial index, level of detail, worker layout, compaction, quotas, and large-board telemetry

- [ ] Implemented
- [ ] Verified

### BOARD-05 Implement AI spatial inspect/create/connect/group/layout/reorganize with proposal and conflict handling

- [ ] Implemented
- [ ] Verified

### BOARD-06 Implement snapshots, synchronized comparison, partial restore/remapping, and PNG/SVG/PDF interchange

- [ ] Implemented
- [ ] Verified

### BOARD-07 Prove spatial/keyboard accessibility, 50-user collaboration, huge boards, asset failure, and revocation

- [ ] Implemented
- [ ] Verified
