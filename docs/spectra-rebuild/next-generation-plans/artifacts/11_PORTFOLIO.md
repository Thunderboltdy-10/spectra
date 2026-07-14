# Portfolio artifact plan

## Why this is an artifact

A portfolio is more than a document when it curates versioned evidence, reflections, outcomes/competencies, timelines, verification, audience-specific presentation, and source provenance. It directly supports CAS and broader project/learning portfolios while keeping imported records separate. It inherits the artifact standard.

## Data model and experience

Content includes purpose/programme, profile/intro, sections, experience/project entries, date ranges, roles, goals/outcomes/competencies, structured reflections, evidence items (artifact/resource/external record/link/file), supervisor/teacher verification references, hours only where supported, tags, cover/theme, audience-specific views, and completion/readiness rules.

Representations: editing timeline/grid/story views; reflection/evidence editor; outcome coverage map; source-change queue; presentation/published view; card/embed/history; PDF/web export. ManageBac CAS records appear as immutable source-linked entries that the student can enrich with private or shared reflections/evidence. Source deletion leaves a provenance tombstone and offers detach/archive; it never erases authored reflection.

Permissions support private draft, selected reviewer/commenter, class/school presentation, and published view. Verification is a signed workflow, not ordinary edit access; later edits mark affected verification stale. Admins/teachers do not automatically see a student portfolio. Audience preview shows exactly what a viewer will see and excludes private evidence/comments.

Collaboration is mainly student plus invited reviewers: rich text CRDT, transactional evidence/order/outcome fields, anchored comments, suggestions, and verification. History renders the actual portfolio and can partially restore entries/reflections without rewriting external records or verification history.

AI can convert permitted CAS experiences into draft entries, prompt meaningful reflection without writing false personal experience, organize evidence, map outcomes with confidence/explanation, identify gaps, and build audience-specific narratives. It must label inference and never invent hours, participation, supervisor statements, or verification.

## Failures and migration

Handle missing/revoked evidence, changed external source, stale verification, inaccessible audience item, large media, incomplete import, and offline reflection. Export reports excluded/private/missing evidence. No automatic migration from generic documents; users may convert selected documents through preview. Valid CAS overlays migrate only after identity/source audit.

## Tasks

### PORT-01 Define entries, reflections, outcomes, evidence, source links, audience views, and verification schemas

- [ ] Implemented
- [ ] Verified

### PORT-02 Build timeline/grid/story, coverage, review, publish, card/embed/history, and export experiences

- [ ] Implemented
- [ ] Verified

### PORT-03 Implement private/reviewer/published grants, audience preview, comments/suggestions, and verification workflow

- [ ] Implemented
- [ ] Verified

### PORT-04 Implement ManageBac CAS import, provenance, overlay, stale rebase, detach, and deletion behavior

- [ ] Implemented
- [ ] Verified

### PORT-05 Implement AI import/organize/reflect/map/gap/narrative tools with anti-fabrication checks

- [ ] Implemented
- [ ] Verified

### PORT-06 Implement meaningful versions, partial restore, stale verification, and evidence reference retention

- [ ] Implemented
- [ ] Verified

### PORT-07 Prove privacy, audience preview, source/evidence failure, accessibility, offline recovery, and export fidelity

- [ ] Implemented
- [ ] Verified
