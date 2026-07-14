# Spectra artifact type standard

This is the canonical protocol for every first-party and future third-party artifact. An artifact type is not ready because it has a card and editor. It is ready only when its manifest, content, operations, collaboration behavior, history renderer, embeds, permissions, accessibility, migrations, and tests satisfy this contract.

## Definition

An artifact is a durable, addressable, permissioned, versioned environment for structured user work that can be rendered, searched, embedded, related, collaborated on, and changed through typed human or AI operations. A class, external ManageBac record, workspace, thread, comment, saved view, or generic file is not automatically an artifact.

## Shared envelope

Every artifact has:

- immutable artifactId, typeKey, ownerId, createdAt, and origin provenance;
- mutable title, summary, lifecycle, classification, schemaVersion, contentRef, currentVersionId, updatedAt;
- one owner and zero or more grants; ownership transfer is an explicit audited workflow;
- placements in Inbox/workspaces without copying content;
- relationships with typed direction, source version, creator, confidence, and visibility;
- search fragments and preview assets derived from a known content version;
- a collaboration room policy, even if the initial type is single-writer;
- meaningful versions and change groups separate from low-level synchronization history;
- retention and deletion state: pending, active, archived, trashed, purging, purged;
- AI state: idle, preparing, reading, creating, editing, checking, awaiting approval, paused conflict, failed, complete.

Pending creation creates an authorized shell and operation reservation before content streams. A failed shell is either resumable, explicitly discardable, or converted to a valid partial draft; it never masquerades as a finished artifact.

## Type manifest

Each type registers one manifest in code and validation tooling:

| Manifest section | Required definition                                                               |
| ---------------- | --------------------------------------------------------------------------------- |
| identity         | stable typeKey, display name, icon, category, minimum app version                 |
| schemas          | content schema by version, metadata extension, operation input/output schemas     |
| renderers        | full, panel, compact card, embed compact/expanded, print/export, historical       |
| editor           | route/component, responsive breakpoints, selection/anchor model, autosave policy  |
| operations       | inspect, create, patch, reorganize, validate, summarize, duplicate, import/export |
| collaboration    | CRDT/domain adapter, awareness payload, comment anchors, conflict policy          |
| history          | snapshot strategy, meaningful-version triggers, diff and partial-restore adapter  |
| context          | search fragmenter, context serializer, token estimator, redaction rules           |
| lifecycle        | template, duplicate, move/place, archive, trash, purge, restore rules             |
| capabilities     | canPresent, canExecute, canAssess, canEmbedInteractively, canWorkOffline          |
| migrations       | ordered schema migrations, compatibility window, fixture corpus                   |
| quality          | accessibility contract, performance budgets, security risks, acceptance suites    |

Unknown type keys are quarantined and render recoverable metadata, never coerced into a document.

## Typed content and region addressing

Content must have a discriminated, schema-validated root. Do not store arbitrary v.any payloads as the only contract. Large binary assets live in object storage; content stores stable asset references and accessibility metadata.

Every editable unit exposes a stable regionId. Regions form an artifact-specific tree or graph and declare kind, parent, order/geometry, readable text/semantic data, edit capability, validation rules, and content version. IDs survive reordering and ordinary rewrites. JSON Pointer may be an internal transport for simple fields, but AI tools target semantic regions and domain operations rather than brittle array indexes.

## Save and state model

Human editing uses optimistic local state with visible sync states: saved, saving, offline changes, conflict/permission lost, validation blocked. Collaborative types sync incremental operations; non-collaborative settings use debounced transactions. “Saved” means persisted and authorized, not merely updated in React state.

Validation has three levels: local structural validation, transactional domain invariants, and asynchronous quality checks. Invalid partial AI content may be visible while pending, but publish/export/assessment actions are disabled with actionable errors.

## AI collaborator contract

An artifact adapter must let AI:

1. inspect a bounded outline and request specific regions;
2. create a shell and stream valid regions progressively;
3. submit typed operations with operationId, baseVersion/stateVector, target regions, rationale, and expected effect;
4. receive deterministic validation and conflict results;
5. checkpoint coherent partial work;
6. explain changes using user-facing region names;
7. preview or request approval for destructive, broad, assessed, published, or scheduling changes;
8. resume idempotently after interruption.

Blue working traces attach to real targeted regions. Creating traces may sweep a new shell and then individual regions; editing traces highlight only affected regions; checking traces show validation targets. They are ephemeral projections of durable operation state, not fabricated animations.

If a user changes a targeted region after the AI base version, the adapter may safely rebase commutative operations, retarget by stable regionId, or pause with a three-way preview. It must not silently overwrite. Rejection cancels proposed operations and preserves unrelated completed work. Partial failure records completed, skipped, failed, and compensatable operations.

## Collaboration and permissions

Shared roles are owner, manager, editor, commenter, viewer, and type-specific use. Delete-owner-only may be imposed by type; agents require it. Grants can target user, group/class, school, or public audience where policy permits. The policy engine evaluates resource classification, membership, grant, link policy, and operation capability.

Presence includes user identity/color, viewport, active region, selection/cursor, and last-seen lease; it is ephemeral. Comment anchors are durable semantic anchors with fallback excerpt/geometry and orphan recovery. AI appears as a distinct collaborator with run identity and cannot acquire broader access than its invoking actor plus selected agent resource rights.

## Representations

All types implement:

- compact card: identity, state, key domain signal, activity, permission-aware actions;
- panel: useful read/edit subset at constrained width;
- full screen: complete product with Details, History, Comments, Share, Activity areas;
- embed compact/expanded: permission-safe and responsive;
- historical renderer: faithful read-only past state beside current;
- pending/error/deleted/no-access/offline states;
- print/export representation where meaningful.

Layouts must support 320 px narrow panels, keyboard-only use, reduced motion, 200% zoom, screen-reader landmarks, high contrast, and touch targets. Type-specific shortcuts never override global safety/navigation shortcuts without disclosure.

## Search, context, relationships, and memory

The type fragmenter emits bounded semantic fragments with regionId, source version, sensitivity, and text/structured facets. The context serializer provides outline, selected regions, and requested details with exact token estimates. Embeds contribute only their visible summary by default; deep source content requires explicit retrieval and source permission.

Relationships are links, not access inheritance. Suggested relations remain suggestions until accepted or may be shown as private intelligence. Memory may learn a correction or workflow from artifact activity only through the memory policy; raw content is not automatically copied into memory.

## History and lifecycle

Low-level CRDT updates are compacted into snapshots. Product versions are created at publish, explicit save point, AI change-group completion, import, restore, major structural change, or elapsed activity boundary. Minor changes are grouped by actor and idle window. Restore creates a new version. Partial restore submits normal validated operations. Historical assets and external-resource versions remain resolvable or clearly unavailable.

Duplication creates new identity/owner, copies allowed content/assets, records origin, resets comments/activity/grants unless explicitly chosen, and never copies agent usage history. Moving changes placement only. Archive preserves links and access; trash hides ordinary retrieval; purge cascades search, embeddings, sync rooms, embeds, assets, and memory evidence according to retention policy.

## Extension and conformance

A type generator should scaffold manifest, schemas, adapters, fixtures, renderers, migrations, and test suites. Registry validation fails CI for missing capabilities or duplicated type keys. Extension APIs are versioned; no artifact may add a parallel ACL, history, comment, embed, or AI-run service.

## Standard tasks

### AS-01 Define and validate the shared artifact envelope and lifecycle state machine

- [ ] Implemented
- [ ] Verified

### AS-02 Build the type registry, manifest schema, lazy loading, and unknown-type quarantine

- [ ] Implemented
- [ ] Verified

### AS-03 Build stable semantic region addressing and typed operation adapters

- [ ] Implemented
- [ ] Verified

### AS-04 Build pending shells, progressive mutation, real working traces, checkpoints, and recovery

- [ ] Implemented
- [ ] Verified

### AS-05 Build shared save, validation, offline, conflict, and permission-loss states

- [ ] Implemented
- [ ] Verified

### AS-06 Build card, panel, full, embed, print, and historical renderer contracts

- [ ] Implemented
- [ ] Verified

### AS-07 Build grants, collaboration adapters, presence, comments, and activity hooks

- [ ] Implemented
- [ ] Verified

### AS-08 Build search fragmentation, context serialization, redaction, and token accounting

- [ ] Implemented
- [ ] Verified

### AS-09 Build versions, diffs, restore, import/export, templates, duplicate, archive, and purge hooks

- [ ] Implemented
- [ ] Verified

### AS-10 Build the type scaffold, migration runner, fixture corpus, and CI conformance suite

- [ ] Implemented
- [ ] Verified

### AS-11 Prove accessibility, responsive layouts, keyboard behavior, and performance budgets

- [ ] Implemented
- [ ] Verified

### AS-12 Migrate the four current blueprint types and remove hard-coded type branching

- [ ] Implemented
- [ ] Verified
