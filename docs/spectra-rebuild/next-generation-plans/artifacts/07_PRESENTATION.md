# Presentation artifact plan

## Product and reference contract

Presentation inherits the standard. `15_presentation_editor.png` is the executable specification for shell, slide rail, spacious canvas, toolbar, notes, right rail, linked work, and AI treatment. Implement every visible control plus layout/theme/media/components, presenter/rehearsal, comments/presence/history, recording/export, panel/card/embed, responsive review, touch, keyboard, and reduced-motion states.

Spectra-native quality is canonical and is not constrained by PowerPoint compatibility. Presentations are private by default with read-only/modify sharing, workspace exceptions, and explicit public presenting. Presenter mode pins a version so live collaborator changes never alter the current show unexpectedly.

## Scene model and editing

Use a versioned structured slide scene graph: narrative/outline, theme tokens, masters/layouts, sections, slides, text/media/shapes/components, charts/tables, artifact embeds, transitions, speaker notes, citations, accessibility metadata, and settings. Stable slide/object/text/notes/chart IDs define collaboration, comments, AI targets, working effects, and partial restore.

Editing includes guides/snapping, alignment/distribution, grouping, layers, crop/mask, reusable components, sections, keyboard movement, accessible reading order, overflow indicators, and selection semantics. Common creation/layout actions are obvious; advanced animation, theme/master, accessibility, export, and component configuration use progressive disclosure.

Yjs/domain operations synchronize scene/text live. Awareness includes slide, selected objects, and viewport. Same slide object/text range/notes region has exclusive active ownership; non-overlapping objects/slides proceed concurrently. Conflicts queue/pause with resolution. Comments anchor to slide/object/notes. Network loss presents reconnect/unsynchronized/recovery and no offline editing.

## AI skill, effects, history, and cross-artifact data

The on-demand presentation skill covers selection, narrative planning, regions, inspection, creation/edit/layout/theme/notes/check operations, preservation, approvals, validation, relationships, and effects. AI works narrative-first: objective/audience/arc, outline, slide plans, then valid slides. It can rewrite selected text, generate notes, use permitted media, create charts from stable Sheets ranges, and check overflow/contrast/reading order/source coverage. It cannot fabricate citations or use inaccessible sources. Broad regeneration uses a proposal branch.

Real effects bind to actual objects: text forms/morphs, a shape/image/chart materializes, an object moves/resizes, or a layout settles. Independent objects/slides animate concurrently. Effects fully clear on success/failure/rejection/cancel/revocation/navigation; reduced motion uses clear static transitions.

Meaningful human sessions, generated slide batches, theme application, import, publish/export, and every coherent AI batch create distinct attributed history. AI checkpoints unversioned human work first. Universal comparison synchronizes slide/object selection and can partially restore slides/theme/notes into a new current version. Sheets-derived charts can remain live or pin a source version, and source permission changes degrade safely.

## Import, export, failure, and performance

Stage PPTX, ODP, and controlled Google Slides export ingestion. Export PDF, images/video where supported, present package, PPTX/ODP with declared fidelity tiers. Quarantine archives/media/macros/links, preserve original files, and report substitutions/unsupported fonts, masters, charts, equations, transitions, animation, media, notes, accessibility, and embeds. Imported content becomes editable native scene objects wherever technically possible; unrecoverable items remain safe placeholders with source preview and replacement path.

Virtualize thumbnails, lazy-load assets, cache previews, and target 60fps normal editing. Handle missing fonts/assets, processing/build failures, overflow, incompatible effects, reconnect, occupied object, concurrent delete/edit, partial AI generation, permission loss, unavailable live Sheets source, and import quarantine.

## Tasks

### PRES-01 Define scene/theme/master/layout/notes/media/chart/embed/transition/accessibility schemas, stable regions, manifests, validation, and migrations

- [ ] Implemented
- [ ] Verified

### PRES-02 Build exact reference plus rail/canvas/panels/notes/presenter/rehearsal/card/embed/history/responsive review states with every control functional

- [ ] Implemented
- [ ] Verified

### PRES-03 Implement complete native layout/guides/grouping/layers/components/media/charts/keyboard/reading-order controls with progressive disclosure

- [ ] Implemented
- [ ] Verified

### PRES-04 Implement live scene/text collaboration, presence/comments, exclusive object regions, reconnect/recovery, coherent versions/checkpoints, comparison, and partial restore

- [ ] Implemented
- [ ] Verified

### PRES-05 Implement on-demand presentation skill, narrative-first AI operations/checks, Sheets chart links, real object effects, cleanup, and reduced motion

- [ ] Implemented
- [ ] Verified

### PRES-06 Implement pinned presenting and staged PPTX/ODP/Google-export import plus PDF/media/PPTX/ODP export with quarantine, fidelity, recovery, and tests

- [ ] Implemented
- [ ] Verified

### PRES-07 Prove every UI control, accessibility, render performance, large decks, missing assets, mixed human/AI conflict, source revocation, history, embeds, and recovery

- [ ] Implemented
- [ ] Verified

