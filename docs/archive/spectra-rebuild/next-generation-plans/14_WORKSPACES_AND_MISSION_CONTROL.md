# Workspaces and mission control plan

## Product boundary

Home and Workspaces are the connective tissue of Spectra, not a folder list. They unify private work, shared collaboration, school-sourced class structure, current AI activity, assignments, tasks, time, artifacts, agents, and recent context without changing the permissions of the underlying objects.

The required reference surfaces are Home (`05_home.png`), Workspace List (`06_workspace_list.png`), Workspace Board (`07_workspace_board.png`), Workspace Timeline (`08_workspace_timeline.png`), and Workspace Canvas (`09_workspace_canvas.png`). Their information architecture, density, hierarchy, components, spacing, typography, state language, and behaviors are executable specifications. All visible controls must work. Narrow and tiled layouts preserve the same priorities through progressive disclosure rather than collapsing into an unrelated mobile product.

## Workspace model and access

A workspace has stable identity, school scope, title, description, icon/color/cover, provenance, lifecycle, members/grants, views, placements, relationships, source bindings, and activity preferences. Artifacts remain independent permissioned objects. Workspace access normally projects read-only or modify access to contained artifacts, but owners can remove a person from an individual artifact or add narrower direct access. Public workspace/artifact access is always explicit.

The server computes effective access with provenance: direct grant, workspace projection, owner, school operation session, or explicit public grant. Moving/placing/linking an artifact never silently widens access; the UI previews audience changes and blocks unresolved escalation. Revoking workspace access immediately affects open editors, embeds, AI context, runs, comments, and search. Admin and superadmin management pages do not grant ordinary access to private workspace content.

Workspace membership is distinct from school membership and does not create a second school membership. Students, teachers, school admins, and superadmins have the same ordinary workspace creation/use/sharing features. Future groups/classes may simplify distribution/discussion but cannot become a core creation dependency.

## Views and projections

- Home combines greeting/continuation, urgent tasks and deadlines, timetable, recent/pinned workspaces/artifacts, active/recoverable AI runs, and relevant recommendations. Every item is permission-filtered and links to its source.
- Workspace List supports search, sort, filter, favorites, archive, ownership/shared/source badges, grid/list density, creation/import, and complete empty/loading/error/revoked states.
- Board is a configurable view over stable cards/placements, columns/groups, filters, bulk actions, comments/presence, drag/reorder, and cross-view links. Dragging updates placement/view data, not underlying artifact content unless the control explicitly edits a task field.
- Timeline projects tasks, milestones, dates, source records, and artifacts across zoom levels. It preserves timezone/source authority and uses typed moves with preview where consequences exist.
- Canvas arranges artifact cards, notes, groups, connectors, and discussion context spatially. It is a workspace composition view, not the full Whiteboard artifact; opening or embedding a Whiteboard preserves its own identity and access.

All views share stable placement IDs and one reactive query model, so an update appears consistently without duplicate records. Search, filters, selected workspace, view state, and recoverable navigation survive reload where safe. No view promises offline editing.

## ManageBac-generated class workspaces

The first verified synchronization automatically and idempotently creates one workspace for each current readable class, keyed by immutable external source identity rather than display name. It creates source-linked timetable layers, assignments/planner tasks, readable assessments/deadlines/resources, and useful links among class, time, task, and artifact records. Each imported item retains tenant, capability/route, source ID/version/hash, fetch time, provenance, and overlay boundary. A visible operation-specific progress sequence ends with a completion summary; ordinary safe items do not require per-record approval.

Later synchronization never reconstructs a workspace from scratch. Unchanged source records remain untouched. New classes/records are created automatically only when policy classifies them as ordinary and unambiguous; consequential structures are proposed. Source-field changes compare hashes/versions and update only source-owned fields. User title/color/layout, placements, notes, links, artifacts, task overlays, and other customization are preserved. Removed records are tombstoned or detached and never delete user work. Duplicate prevention uses the external identity key across retries and reconnects. Ambiguous mappings and consequential reorganization enter a legible review queue with AI summaries/recommendations and explicit user choice.

## Collaboration, AI, history, and effects

Board/card/placement/canvas regions have stable semantic IDs. Non-overlapping edits can proceed concurrently. Same placement, card field, timeline event, or canvas node uses exclusive active ownership/conflict control and never silently overwrites. Presence is view-appropriate; comments target workspaces, placements, or source objects without duplicating artifact comments.

The ordinary runtime carries a compact workspace-composition guide. An on-demand workspace skill explains views, placements, projections, access preservation, ManageBac sources, available operations, validation, approvals, and links. AI may create/reorganize views, group/link permissioned artifacts, map deadlines, or propose workspace summaries. It cannot widen access, override source-owned fields, expose hidden content, or perform consequential bulk reorganization without review.

AI effects bind to the actual cards, groups, timeline items, placement fields, or canvas nodes being created/changed. They are ephemeral and clear on completion, failure, rejection, cancellation, permission loss, or navigation. Human view-layout sessions and coherent AI batches create distinguishable history; if AI begins over uncheckpointed human work, a user checkpoint is created first. Restore creates a new current view configuration and never rewinds artifact content unintentionally.

## Imports, failures, performance, and verification

Workspace-level migration can import folder/board structures from controlled manifests and create links to separately quarantined artifact imports. It reports unsupported hierarchy, sharing, link, and source metadata; it never fabricates permissions. Export provides a portable manifest plus referenced artifact export choices and access warnings.

Explicit states cover empty/new school, partial first sync, stale source, duplicate source identity, permission change, moved/deleted artifact, failed view query, reconnecting/unsynchronized live state, invalid drag, occupied region, interrupted AI run, tombstone, and import quarantine. Virtualize large lists/boards/timelines, window timeline queries, viewport-load canvas placements, and meter bandwidth/storage/render cost without enforcing commercial limits.

Independent verification opens all five reference surfaces in Chrome, captures and compares each one, repairs discrepancies iteratively, and tests every control plus responsive, permission, source-sync, AI, collaboration, history, embed, failure, accessibility, and adjacent-artifact path.

## Tasks

### WS-01 Define workspace, grants/projections/exceptions, provenance, views, placements, source bindings, lifecycle, and portable manifest schemas

- [ ] Implemented
- [ ] Verified

### WS-02 Build Home and Workspace List to exact references with complete search/filter/create/import/archive/loading/empty/error/responsive behavior

- [ ] Implemented
- [ ] Verified

### WS-03 Build Board, Timeline, and Canvas to exact references on shared stable placements with every visible control functional

- [ ] Implemented
- [ ] Verified

### WS-04 Implement private-default direct/workspace-projected access, per-artifact exceptions, explicit public access, audience previews, revocation, and operator isolation

- [ ] Implemented
- [ ] Verified

### WS-05 Implement automatic idempotent first ManageBac class-workspace creation with source-linked tasks/time/resources, provenance, progress, and summary

- [ ] Implemented
- [ ] Verified

### WS-06 Implement safe later sync with hashes/versions, source-field ownership, preserved overlays/customization, tombstones/detach, duplicate prevention, and conflict review

- [ ] Implemented
- [ ] Verified

### WS-07 Implement view collaboration, stable-region ownership, comments/presence, human/AI history, restore, on-demand AI skill, real effects, and cleanup

- [ ] Implemented
- [ ] Verified

### WS-08 Implement portable workspace import/export, quarantine/fidelity reports, scale/telemetry, reconnect/recovery, accessibility, and cross-view consistency

- [ ] Implemented
- [ ] Verified

### WS-09 Independently verify all five reference surfaces and cross-feature combinations in the live app, iterating screenshots until extremely close

- [ ] Implemented
- [ ] Verified

