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
| editor           | route/component, responsive breakpoints, selection/anchor model, live-sync/validity policy |
| operations       | inspect, create, patch, reorganize, validate, summarize, duplicate, import/export |
| aiSkill          | on-demand purpose/selection, regions, operations, preservation, approvals, links, effects |
| collaboration    | CRDT/domain adapter, awareness payload, comment anchors, conflict policy          |
| history          | snapshot strategy, meaningful-version triggers, diff and partial-restore adapter  |
| context          | search fragmenter, context serializer, token estimator, redaction rules           |
| lifecycle        | template, duplicate, move/place, archive, trash, purge, restore rules             |
| capabilities     | canPresent, canExecute, canAssessFormatively, canEmbedInteractively               |
| interoperability | major formats, staged import/export, fidelity, quarantine, recovery                |
| migrations       | ordered schema migrations, compatibility window, fixture corpus                   |
| quality          | accessibility contract, performance budgets, security risks, acceptance suites    |

Unknown type keys are quarantined and render recoverable metadata, never coerced into a document.

## Typed content and region addressing

Content must have a discriminated, schema-validated root. Do not store arbitrary v.any payloads as the only contract. Large binary assets live in object storage; content stores stable asset references and accessibility metadata.

Every editable unit exposes a stable regionId. Regions form an artifact-specific tree or graph and declare kind, parent, order/geometry, readable text/semantic data, edit capability, validation rules, and live state vector. IDs survive reordering and ordinary rewrites. Granularity includes lines, blocks, slide objects, card sides, quiz fields/options, Sheet cells/ranges, task fields, canvas nodes, and equivalent type regions. JSON Pointer may be an internal transport for simple fields, but AI targets semantic regions and domain operations rather than brittle array indexes.

An exclusive active claim protects the smallest safe overlapping semantic region. Non-overlapping claims proceed concurrently. A second actor targeting an occupied region queues or pauses and receives current/base/proposed state plus explicit resolution. Claim expiry, disconnect, cancellation, permission change, and worker failure release it deterministically. No artifact may fall back to silent last-write-wins for overlapping human or AI changes.

## Save and state model

There is no manual save boundary and no offline editing. Humans and AI work against current live state, including changes not yet grouped into a named version. Collaborative types persist incremental operations through self-hosted Yjs; transactional settings use reactive domain mutations. Visible states are synchronizing, synchronized, reconnecting, unsynchronized, invalid, conflict/queued, and permission lost. “Saved” or “Synchronized” means durable, authorized, and schema-valid—not merely React state. Network loss stops new durable edits and never creates an offline queue.

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

Blue working traces attach to real targeted regions, not only cards. Text forms/replaces/morphs in place; options/answer state, Sheet ranges/charts, slide objects, task properties, canvas nodes, and other regions perform type-specific transitions tied to committed operations. Independent edits may animate concurrently and may trail backend output slightly for legibility. Effects are refined rather than electrical/noisy, reconcile to durable state, and fully clear on completion, failure, rejection, cancellation, reconnect, or permission loss. Reduced motion uses restrained outlines/state labels. They are ephemeral projections of durable operation state, never decorative fabrication.

If a user changes a targeted region after the AI base state, the adapter may safely rebase a provably commutative operation, retarget by stable regionId, or pause with a three-way preview. It must not silently overwrite. Before AI edits an artifact with uncheckpointed human changes, history creates a coherent user-attributed checkpoint. Each coherent AI operation batch then creates its own AI-attributed history entry. Rejection cancels proposed operations and preserves unrelated completed work. Partial failure records completed, skipped, failed, and compensatable operations and clears all ephemeral effects.

Each type ships a dedicated on-demand AI skill. It explains purpose/selection criteria, semantic regions, bounded inspection, every typed operation, preservation, validation, approvals, relationships/embeds, import behavior, and working effects. Ordinary runtime context contains only a compact cross-artifact selection/composition guide; it never injects all artifact skills into every request.

## Collaboration and permissions

Artifacts are private by default. The primary sharing UX offers read-only and modify. Workspace access normally projects to its artifacts, while an explicit artifact exception removes access for a person. Public access is always explicit and never default. Internally, extensible capabilities cover ownership, sharing, deletion, restore, comments, use, and future fine-grained needs without exposing them prematurely. Agents retain creator-only deletion.

Presence includes user identity/color, viewport, active region, selection/cursor, and last-seen lease; it is ephemeral. Comment anchors are durable semantic anchors with fallback excerpt/geometry and orphan recovery. AI appears as a distinct collaborator with run identity and cannot acquire broader access than its invoking actor plus selected agent resource rights.

## Representations

All types implement:

- compact card: identity, state, key domain signal, activity, permission-aware actions;
- panel: useful read/edit subset at constrained width;
- full screen: complete product with Details, History, Comments, Share, Activity areas;
- embed compact/expanded: permission-safe and responsive;
- historical renderer: faithful read-only past state beside current;
- pending/error/deleted/no-access/reconnecting/unsynchronized/permission-lost states;
- print/export representation where meaningful.

Layouts must support 320 px narrow panels, keyboard-only use, reduced motion, 200% zoom, screen-reader landmarks, high contrast, and touch targets. Common actions remain obvious; advanced/rare configuration uses inspectors or expandable sections. Redundant controls are removed and every rendered control must function. Type-specific shortcuts never override global safety/navigation shortcuts without disclosure.

## Search, context, relationships, and memory

The type fragmenter emits bounded semantic fragments with regionId, source version, sensitivity, and text/structured facets. The context serializer provides outline, selected regions, and requested details with exact token estimates. Embeds contribute only their visible summary by default; deep source content requires explicit retrieval and source permission.

Relationships are links, not access inheritance. Suggested relations remain suggestions until accepted or may be shown as private intelligence. Memory may learn a correction or workflow from artifact activity only through the memory policy; raw content is not automatically copied into memory.

## History and lifecycle

Low-level CRDT updates are compacted into snapshots. Product versions are created at meaningful human editing-session/idle boundaries, mandatory pre-AI user checkpoints, every coherent AI run/operation batch, import, restore, publish, or major structural change. They are not created per keystroke. Human and AI attribution is visually distinct. Restore creates a new version; partial restore submits ordinary validated region operations. Historical assets and external-resource versions remain resolvable or clearly unavailable.

Every applicable type defines the major formats users already own, staged support, import preview, isolated parsing, unsupported-feature quarantine, itemized fidelity report, recovery/download-original path, and useful exports. Import cannot silently flatten, discard, or execute macros/code. Importing existing work is a release requirement, not deferred polish.

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

### AS-03 Build stable semantic region addressing, exclusive overlapping-region claims, visible conflict resolution, and typed operation adapters

- [ ] Implemented
- [ ] Verified

### AS-04 Build pending shells, progressive mutation, type-specific real region effects, full cleanup, checkpoints, and recovery

- [ ] Implemented
- [ ] Verified

### AS-05 Build live synchronization/validity, online-only reconnect, conflict/queue, and permission-loss states with no manual or offline save boundary

- [ ] Implemented
- [ ] Verified

### AS-06 Build card, panel, full, embed, print, and historical renderer contracts

- [ ] Implemented
- [ ] Verified

### AS-07 Build grants, collaboration adapters, presence, comments, and activity hooks

- [ ] Implemented
- [ ] Verified

### AS-08 Build on-demand artifact skills, compact selection guide, search fragmentation, context serialization, redaction, and token accounting

- [ ] Implemented
- [ ] Verified

### AS-09 Build human-session/pre-AI/AI versions, type-aware diffs/restore, major-format import quarantine/fidelity/export, templates, duplicate, archive, and purge hooks

- [ ] Implemented
- [ ] Verified

### AS-10 Build the type scaffold, migration runner, fixture corpus, and CI conformance suite

- [ ] Implemented
- [ ] Verified

### AS-11 Prove every visible control, progressive disclosure, accessibility, responsive layouts, keyboard/touch behavior, working-effect cleanup, and performance budgets in the actual UI

- [ ] Implemented
- [ ] Verified

### AS-12 Migrate the four current blueprint types and remove hard-coded type branching

- [ ] Implemented
- [ ] Verified
