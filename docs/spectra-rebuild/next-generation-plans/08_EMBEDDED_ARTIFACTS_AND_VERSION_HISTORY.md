# Embedded artifacts and version history

## Embedded artifact model

An embed is a projection of one source artifact, never a copy and never an access grant. artifactEmbeds stores embedId, container type/id/region, sourceArtifactId, mode compact/expanded, interaction read/interact/edit, version policy live/pinned, pinnedVersionId, display preferences, context policy none/summary/visible-region, creator, and createdAt.

The container and source are authorized independently after workspace grant propagation and artifact exceptions are evaluated. A viewer without source access sees a bounded no-access/request-access state; the parent must not leak title, thumbnail, content, comments, or presence. If source access is revoked, a live embed locks immediately. A pinned embed retains a version only while the viewer and retention policy allow it. Public container access never silently makes an embedded source public.

## Embed experience

- Compact: identity, state, provenance, key summary, one primary action; suited to thread flow and narrow panels.
- Expanded: responsive type renderer with bounded interaction and “Open source”.
- Edit: explicit capability and affordance; edits mutate the source and create source history/activity. Container history records only embed configuration unless the source version is pinned.
- Loading: dimension-preserving skeleton; lazy load below viewport.
- Error: retry, open source, stale snapshot label; no blank iframe.
- Deleted/archived: tombstone with permitted provenance and replace/remove action.

Interactive code/visualizations run in a sandboxed frame with a versioned Spectra embed SDK, CSP, no ambient credentials, message allowlist, accessibility bridge, and resource budgets. Quizzes are preview/practice/formative only; embedded response state is separate from artifact content. Presentations offer slide navigation; Sheets expose permissioned live/pinned ranges or charts; timetable can add personal overlays; whiteboards use a viewport and deliberate “enter canvas” interaction.

Anthropic’s artifact work validates making generated outputs directly interactive, including tool-backed experiences, but Spectra’s source identity, ACL, context contribution, and version pinning must be explicit: [Anthropic Artifacts](https://claude.com/blog/build-artifacts), [interactive tools](https://claude.com/blog/interactive-tools-in-claude).

## Context and relationships

An embed contributes only its currently visible, permission-checked semantic summary by default. Deep context is retrieved from the source and logged in the thread context manifest. A malicious embedded experience cannot send arbitrary prompt text; SDK messages use typed events. Source and container appear as a provenance chain in citations and activity.

## Shared history model

Low-level live-sync updates are not shown as hundreds of product versions. changeGroups gather coherent human editing sessions by idle/meaning boundary and every coherent AI run/operation batch. If AI begins while current live human work is not covered by a version, first create a user-attributed checkpoint of that exact state; AI then receives a subsequent AI-attributed change group/version. Imports, restore, publish, and major structural actions also version. Human and AI attribution remains unmistakable. artifactVersions store versionId, artifactId, parentVersionId, content snapshot reference, schemaVersion, changeGroup IDs, creator(s), source human/AI/import/restore/migration, run/operation IDs, summary, createdAt, asset/resource bindings, and integrity hash.

Snapshot strategy is type-specific: complete normalized snapshots for small structured content; content-addressed trees/deltas plus periodic snapshots for code/presentations/large boards/Sheets; referenced Yjs state vector plus durable snapshot for collaborative content. A version must remain renderable without replaying an unbounded log.

## History experience

Match 20_history_comparison.png for every type: right-side vertical timeline with live, AI edit, user edit, and restored labels/attribution; one selected historical version on the left; current live editable artifact on the right; clear preview/edit state; draggable division where appropriate; and Restore as new version explanation/action. It groups meaningful versions by date/change group, showing collaborators, run/operation, summary, publish/import/restore labels, comments, and named checkpoints. Selecting another historical version replaces the left panel.

The left panel uses the artifact’s historical renderer, not raw JSON. Synchronize navigation where helpful: document headings, quiz questions, deck cards, slides, Sheet tabs/ranges, files, canvas viewport/layers, timetable range. Diff overlays are type-aware. Historical state is inert: no quiz response, code network, external refresh, or hidden live mutation.

Match 21_embedded_artifacts.png as the shared embed language: compact visualization, expanded flashcards, compact quiz and task, clear type/mode labels, expand/collapse/open-source actions, responsive containment, source links in Details, and persistent composer. Every artifact implements compact and expanded embeds; interactive/edit behavior is type- and permission-specific.

Restore always creates a new current version whose content equals the selected historical state after current-schema migration/validation. Partial restore selects semantic regions and submits ordinary domain operations with preview and conflict checks. Restore permission is editor plus restore capability; published/assessed/agent versions may require manager approval.

## Retention and performance

Recent meaningful versions retain full fast snapshots; older versions may use content-addressed deduplication and cold storage subject to school policy. Assets are reference-counted across versions. Purge removes versions/embeds/search/memory derivatives after retention, except minimal legal/audit records. Version list is paginated; comparison assets and large regions load on demand; integrity jobs detect missing/corrupt references.

Current history stores whole before/after any payloads and previews “before”; it is not retained. Migrate only validated versions worth preserving, label provenance confidence, and discard unrecoverable duplicate/no-op snapshots after export.

## Embed and history tasks

### EVH-01 Implement permission-independent embed records, modes, version policy, and no-access states

- [ ] Implemented
- [ ] Verified

### EVH-02 Implement every type’s compact/expanded/edit embed adapter matching the shared reference plus responsive loading/error/no-access/revoked states

- [ ] Implemented
- [ ] Verified

### EVH-03 Implement sandboxed interactive embed SDK, CSP, typed events, budgets, and accessibility bridge

- [ ] Implemented
- [ ] Verified

### EVH-04 Implement permission-checked context contribution and provenance chains

- [ ] Implemented
- [ ] Verified

### EVH-05 Implement human session grouping, mandatory pre-AI user checkpoints, every coherent AI-attributed version, distinct attribution, named checkpoints, and integrity hashes

- [ ] Implemented
- [ ] Verified

### EVH-06 Implement per-type snapshot/delta/content-addressing and compaction strategies

- [ ] Implemented
- [ ] Verified

### EVH-07 Match the shared history reference for every type with timeline, single left comparison, current live state, synchronized navigation, and type-aware diffs

- [ ] Implemented
- [ ] Verified

### EVH-08 Implement full and partial restore as new validated versions with approval/conflict handling

- [ ] Implemented
- [ ] Verified

### EVH-09 Implement retention, reference-counted assets, cold loading, deletion, and corruption repair

- [ ] Implemented
- [ ] Verified

### EVH-10 Migrate useful current versions and prove no permission escalation through embeds or history

- [ ] Implemented
- [ ] Verified
