# Presentation artifact plan

## Product and content model

This artifact inherits the standard. It uses a structured slide scene graph, not flattened screenshots: deck narrative/outline, theme tokens, masters/layouts, slides, components, text, media, charts/tables, embeds, transitions, speaker notes, citations, accessibility metadata, and presentation settings. Stable slide/node IDs enable collaboration, comments, AI targeting, and partial restore.

Preserve the reference’s slide rail, spacious canvas, toolbar, notes, and details. Add layout/theme/media/component panels, presenter view, comments/presence/history, recording/export, and responsive edit/review modes. Editing should support guides, alignment, grouping, layers, crop/mask, reusable components, slide sections, keyboard movement, and accessible reading order.

## Collaboration, AI, history

Yjs/domain operations synchronize scene graph and text; awareness includes selected nodes/slide/viewport. Large media remains asset-referenced. Comments anchor to slide/node/notes. Meaningful versions occur at outline approval, generated slide batch, theme application, publish/export, and explicit checkpoint. History renders actual slides, can synchronize slide selection, and partially restore slides/theme/notes.

AI works narrative-first: propose audience/objective/arc, outline, slide plans, then progressively create valid slides. It can apply layouts/themes, rewrite selected text, generate speaker notes, find/create permitted visuals, build charts from datasets, check overflow/contrast/reading order/source coverage, and explain edits. Broad regeneration uses a proposal branch. AI must not fabricate citations or use inaccessible assets.

## Import/export, performance, failure

Native Spectra is canonical. Export PDF and present mode first; PPTX import/export uses explicit fidelity tiers and reports substitutions for fonts, effects, charts, animation, and embeds. Do not constrain the native model to perfect PowerPoint round-trip. On present, pin a version so collaborator edits do not unexpectedly change the live show.

Virtualize slide thumbnails, lazy-load assets, cache render previews, and keep editor interactions at 60 fps for normal decks. Handle missing fonts/assets, media processing, overflow, incompatible imported effects, offline changes, concurrent node edits, and partial AI generation.

## Tasks

### PRES-01 Define scene graph, theme/master/layout, notes, media, embed, transition, and accessibility schemas

- [ ] Implemented
- [ ] Independently verified

### PRES-02 Build rail/canvas/panels/notes, presenter, card/embed/history, and responsive review modes

- [ ] Implemented
- [ ] Independently verified

### PRES-03 Implement layout, guides, grouping, layers, components, media, charts, keyboard, and reading order

- [ ] Implemented
- [ ] Independently verified

### PRES-04 Implement realtime scene/text collaboration, presence, comments, versions, and partial restore

- [ ] Implemented
- [ ] Independently verified

### PRES-05 Implement narrative-first AI outline/slides/theme/edit/notes/check with progressive traces

- [ ] Implemented
- [ ] Independently verified

### PRES-06 Implement pinned presenting, PDF/media output, and tiered PPTX import/export reports

- [ ] Implemented
- [ ] Independently verified

### PRES-07 Prove accessibility, render performance, large decks, missing assets, conflicts, and recovery

- [ ] Implemented
- [ ] Independently verified

