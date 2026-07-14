# Document artifact plan

## Product and inheritance

The document inherits 02_ARTIFACT_TYPE_STANDARD.md. Preserve the reference editor’s calm page canvas, formatting toolbar, linked work, details, quick chat, structured blocks, progressive AI edits, and pending states. Evolve it into a professional collaborative writing product rather than a single-user rich-text field.

## Domain model and capabilities

Content is a ProseMirror/Tiptap document with stable block/inline region IDs, headings/outline, rich text, tables, lists, callouts, code/math, citations/footnotes, equations, media/attachments, embeds, mentions, and accessible alt/caption metadata. Separate page properties, cover/icon, document content, comments, citations, and assets. Support templates, duplicate, page break/print, find/replace, outline navigation, word count, reading time, focus mode, and export/import DOCX, PDF, Markdown, HTML with fidelity reports.

Yjs is the natural collaboration adapter for Tiptap. Presence includes caret/selection and active block. Comments anchor to relative text positions plus block/fallback excerpt. Meaningful versions group writing sessions, AI change groups, imports, explicit checkpoints, and publish/export milestones.

AI tools inspect outline or selected blocks; insert/move/rewrite/summarize/format/cite blocks; create tables; embed/link artifacts; preserve comments/marks; and verify requested constraints. Broad rewrites use proposal/compare; focused edits preserve untargeted blocks. Blue traces follow the actual block range. Retrieval fragments by heading/paragraph/table row with citation lineage.

Permissions follow shared grants. Commenters may suggest/comment, not edit. Optional published view is separate from editable sharing. Embedded source artifacts retain their own access. Sensitive source citations do not become public merely because the document is public.

## UI, failure, performance, migration

Full screen keeps central page, outline/navigation, and right Details/Comments/History/Intelligence. Panel mode prioritizes reading and basic edits; compact embed shows an excerpt/outline. Mobile uses edge-to-edge page and sheet toolbars. Virtualize very large documents, lazy-load media, and cap initial collaborative state through subdocuments/sections if measurements require it.

Offline changes are explicit. Invalid paste is sanitized with recovery preview. Missing assets/citations remain marked. Import produces a report for unsupported constructs. Migrate current structured document blocks through versioned validation, assign stable IDs, export invalid payloads, and remove document-specific branching from Artifact Studio.

## Tasks

### DOC-01 Define versioned content schema, stable regions, properties, citations, embeds, and assets

- [ ] Implemented
- [ ] Independently verified

### DOC-02 Build full/panel/card/embed/history/print renderers and responsive editor shell

- [ ] Implemented
- [ ] Independently verified

### DOC-03 Implement formatting, tables, code/math, media, citations, outline, find, templates, and focus mode

- [ ] Implemented
- [ ] Independently verified

### DOC-04 Implement Yjs text collaboration, presence, anchored comments, offline/reconnect, and versions

- [ ] Implemented
- [ ] Independently verified

### DOC-05 Implement typed AI block operations, proposals, progressive traces, preservation, and verification

- [ ] Implemented
- [ ] Independently verified

### DOC-06 Implement permission-safe search/context/relationships and embedded-source behavior

- [ ] Implemented
- [ ] Independently verified

### DOC-07 Implement DOCX/PDF/Markdown/HTML import/export with fidelity and failure reports

- [ ] Implemented
- [ ] Independently verified

### DOC-08 Migrate current documents, versions, links, placements, and assets; remove legacy branches

- [ ] Implemented
- [ ] Independently verified

### DOC-09 Prove accessibility, large-document performance, concurrent edits, restore, and data-loss recovery

- [ ] Implemented
- [ ] Independently verified

