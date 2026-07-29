# Document artifact plan

## Product and reference contract

The document inherits `02_ARTIFACT_TYPE_STANDARD.md`. `01_document_editor.png` is the executable visual specification for full-screen composition, hierarchy, spacing, typography, toolbar, page canvas, details/activity rail, linked work, quick AI entry, and localized blue working treatment. Every visible idea and control must be functional. Panel, embed, history comparison, narrow, tiled, touch, keyboard, reduced-motion, and failure states extend the same design language.

Documents are private by default and share through read-only or modify access. Workspace-projected access can be removed per document. Explicit publication is a separate grant and never publishes inaccessible embedded sources or citations.

## Model, regions, and editing

Content is a versioned ProseMirror/Tiptap document with stable block and inline-region IDs: headings/outline, paragraphs, lists, tasks, tables/cells, callouts, code, math/equations, citations/footnotes, media/attachments, captions/alt text, mentions, page breaks, and artifact embeds. Properties, icon/cover, content, comments, citation records, assets, placements, and access remain separate typed data.

Common writing and formatting are immediately visible; advanced layout, citation, accessibility, and property controls use progressive disclosure. Support templates, duplicate, outline navigation, find/replace, word count, reading time, focus mode, print/page layout, and coherent selection behavior. There are no redundant or inert controls.

Self-hosted Yjs synchronizes live content through the shared transport abstraction. Save status means synchronized and valid, not a manual boundary. Presence shows caret, selection, and active block. Comments anchor through relative text positions plus stable block/fallback excerpt. Same line/block/table cell is an exclusive active semantic region; independent blocks can be edited concurrently. A conflicting actor queues or pauses and receives a resolution experience. Network loss blocks new edits where state cannot be safely synchronized, exposes reconnect/unsynchronized/recovery state, and never offers offline editing.

## AI skill, effects, and history

Load the document AI skill only when inspecting/creating/editing this type. It defines document purpose/selection, regions, operations, inspection fragments, preservation, validation, approvals, relationships, and effects. Operations inspect outline/selected blocks, insert/move/rewrite/summarize/format/cite, create tables, link/embed artifacts, preserve marks/comments, and verify requested constraints. Broad rewrites use proposal/compare; focused edits assert preservation of untargeted regions.

The actual targeted text/table/embed participates in the Spectra working effect: text forms, replaces, or morphs in place; independent blocks may animate concurrently. The effect may trail backend output slightly for legibility but must remain causally synchronized. It fully clears on success, failure, rejection, cancellation, permission loss, or navigation; reduced motion uses quiet state transitions.

Meaningful human sessions/idle boundaries, imports, explicit checkpoints, and every coherent AI operation batch create distinct attributed history. If AI starts over uncheckpointed live human changes, create a coherent user-authored checkpoint first. History uses the universal comparison layout with synchronized document outline/block selection, and restore creates a new current version. Embeds can be live or pinned and respect source access.

## Import, export, failures, and scale

Staged import supports DOCX, ODT, Markdown, HTML, plain text, and PDF content extraction where technically possible. Export supports DOCX, PDF, Markdown, HTML, and plain text. Every import is scanned, quarantined until validated, reports font/layout/comment/citation/embed/formula/media substitutions and unsupported constructs, preserves original bytes for recovery, and produces editable native content rather than a flattened shell. Export reports unavoidable fidelity loss.

Full screen keeps the calm page canvas and details/comments/history/intelligence rail. Panel prioritizes reading and focused editing; compact embed shows configured excerpts/outline; mobile uses edge-to-edge content and sheet toolbars. Virtualize large outlines/tables, lazy-load assets, and introduce section subdocuments only when measured. Explicit failures cover invalid paste/import, missing assets/fonts/citations, inaccessible embeds, invalid structure, permission revocation, collaboration conflict, reconnect, and partial AI work.

## Tasks

### DOC-01 Define versioned document/properties/assets/citation/embed schemas, stable line/block/cell regions, manifests, migrations, and validation

- [ ] Implemented
- [ ] Verified

### DOC-02 Build exact full-screen reference plus panel/card/live-or-pinned embed/history/print and responsive editor representations

- [ ] Implemented
- [ ] Verified

### DOC-03 Implement every editing control: formatting, tables, code/math, media, citations, outline, find, templates, focus, accessibility, and progressive disclosure

- [ ] Implemented
- [ ] Verified

### DOC-04 Implement live Yjs persistence, synchronization/validity, presence, comments, region ownership/conflicts, reconnect/recovery, and meaningful versions

- [ ] Implemented
- [ ] Verified

### DOC-05 Implement on-demand document skill, typed AI inspect/create/edit/verify/proposal operations, real in-region effects, cleanup, and reduced motion

- [ ] Implemented
- [ ] Verified

### DOC-06 Implement private-default sharing, workspace exceptions, publication, permission-safe context/search/relationships, embeds, and mid-run revocation

- [ ] Implemented
- [ ] Verified

### DOC-07 Implement DOCX/ODT/Markdown/HTML/text/PDF import and DOCX/PDF/Markdown/HTML/text export with quarantine, fidelity, recovery, and tests

- [ ] Implemented
- [ ] Verified

### DOC-08 Migrate current documents, versions, links, placements, and assets; remove every legacy branch without compatibility wrappers

- [ ] Implemented
- [ ] Verified

### DOC-09 Prove every control and state in the actual UI, accessibility, large-document performance, mixed human/AI collaboration, comparison/restore, embeds, and data-loss recovery

- [ ] Implemented
- [ ] Verified

