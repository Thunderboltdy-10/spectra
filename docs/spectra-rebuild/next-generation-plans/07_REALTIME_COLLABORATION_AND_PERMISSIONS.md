# Realtime collaboration and permissions

## Recommendation and alternatives

Convex reactive queries are the right metadata/activity foundation: a query subscription reruns when dependencies change, and optimistic updates can make ordinary mutations immediate ([Convex realtime](https://docs.convex.dev/realtime), [optimistic updates](https://docs.convex.dev/client/react/optimistic-updates)). They are not by themselves a rich-text or freeform-canvas concurrency protocol.

| Content approach | Strength | Cost/risk |
|---|---|---|
| last-write-wins JSON mutations | simple | lost edits, whole-document bandwidth, poor offline |
| domain operational transform | precise central control | high per-type algorithm cost |
| Automerge | local-first documents, built-in sync/history model | larger integration shift, smaller Tiptap ecosystem |
| Yjs | mature CRDT, Tiptap/ProseMirror fit, awareness, subdocuments | must design authenticated provider, persistence, compaction |

Recommend Convex for authorized durable metadata/comments/activity/grants and Yjs for suitable live content. Yjs awareness is deliberately ephemeral and should not be persisted as document history ([Yjs awareness](https://docs.yjs.dev/getting-started/adding-awareness)); collaborative editor patterns are documented here: [Yjs collaborative editor](https://docs.yjs.dev/getting-started/a-collaborative-editor). Prototype self-hosted versus managed transport before D-06; do not couple the artifact protocol to a vendor.

## Permission model

Resource grants target user, group/class, school, or public subject and grant owner/manager/editor/commenter/viewer/use capabilities. Type policy refines these (agent delete remains owner-only; assessment response visibility is specialized). A policy decision considers global identity, active membership, operator session, resource classification, direct and group grants, lifecycle, link/embed mode, and requested action.

Recommend additive grants within an audience plus an explicit privacy boundary, not arbitrary deny rules in v1. Effective access is the highest allowed capability after boundary constraints; UI explains its source. Workspace access does not automatically grant every placed artifact. A placement can be a no-access placeholder with request-access. Public links are separate revocable principals with expiry, password/domain options, indexing disabled by default, and view-only default.

Sharing changes require preview of affected audience and embedded/linked consequences. Removing the owner, last manager, or last school owner is transactionally blocked. Permission caches and room tokens carry policy version; revocation bumps version and actively disconnects sessions.

## Collaboration services

- collaborationRooms map artifact/version/type to policy and persistence strategy.
- collaborationUpdates are append-only binary deltas partitioned by room and sequence.
- collaborationSnapshots contain state vector, content hash, schema version, createdAt, and compaction boundary.
- presence leases carry cursor/selection/viewport/active region and expire quickly.
- comments carry thread, author, state, mentions, resolvedAt, and type-specific semantic anchor.
- changeGroups bridge low-level updates to meaningful product activity/version history.

Room tokens are short-lived, artifact-specific, capability-specific, and minted after server policy evaluation. The gateway validates token, rate/size limits, schema adapter, and policy version. It cannot mint grants.

## Concurrent human and AI editing

AI submits domain operations against base artifact version/state vector and stable target regions. It broadcasts a distinct working presence and real region trace. Non-overlapping operations merge. Commutative moves/insertions can rebase. Direct competing edits pause the affected operation and show current/user/AI proposal; unrelated operations continue. Approval claims are durable and single-winner.

If permission changes mid-run, pending operations reauthorize before commit. Completed authorized operations remain in history; future work stops. Rejecting AI removes proposals, not already approved changes. Partial failure creates one change group with per-operation outcome and recovery action.

## Offline and reconnect

Offline-capable types retain encrypted local updates with artifact ID, base state vector, schema version, and policy expiry. UI clearly says “offline changes”, not saved. On reconnect: authenticate, re-check grant, sync state vectors, apply compatible updates, run validation, and group activity. If access was revoked, do not upload; allow local export only when classification policy permits. Schema incompatibility opens a recovery/export path.

Not all types promise offline editing initially. Code execution, external-record refresh, agent publishing, assessment submission, and destructive administration require online authority.

## Comments, activity, and notifications

Comment anchors are type-specific and survive edits through stable region IDs/relative positions/geometry plus fallback excerpt. Orphaned anchors remain visible in an “unplaced comments” queue. Mentions validate audience before notification. Notification preferences support immediate/digest, per-artifact mute, and security overrides.

Activity records meaningful actions, not keystrokes: joined/shared, changed structure, AI change group, comment, version, publish, restore, import, permission change. Presence is not activity. Analytics uses aggregate events and never reconstructs private content.

## Scale and verification

Coalesce cursor updates, send state-vector diffs, compact by update count/bytes/time, virtualize off-screen content, and split very large canvases/datasets by subdocument/region. Test with latency, packet loss, duplicated/out-of-order frames, tab sleep, process restart, clock skew, 2/10/50 participants, large artifacts, revocation, and schema migration.

## Collaboration tasks

### RTC-01 Implement centralized resource grants, policy explanations, public links, and invariants

- [ ] Implemented
- [ ] Independently verified

### RTC-02 Prototype Yjs managed versus self-hosted transport and decide D-06 with measurements

- [ ] Implemented
- [ ] Independently verified

### RTC-03 Implement short-lived room tokens, policy versions, revocation disconnect, and gateway limits

- [ ] Implemented
- [ ] Independently verified

### RTC-04 Implement update logs, snapshots, state vectors, compaction, and corruption recovery

- [ ] Implemented
- [ ] Independently verified

### RTC-05 Implement ephemeral presence, cursors, selections, viewports, and accessible collaborator indicators

- [ ] Implemented
- [ ] Independently verified

### RTC-06 Implement semantic comments, mentions, orphan recovery, resolution, and notification preferences

- [ ] Implemented
- [ ] Independently verified

### RTC-07 Implement change groups and meaningful activity without keystroke noise

- [ ] Implemented
- [ ] Independently verified

### RTC-08 Implement AI conflict detection, safe rebase, pause/compare, rejection, and partial recovery

- [ ] Implemented
- [ ] Independently verified

### RTC-09 Implement offline queues, permission/schema recheck, reconnect, and revoked-access recovery

- [ ] Implemented
- [ ] Independently verified

### RTC-10 Prove bandwidth, scale, packet-failure, restart, revocation, and cross-tenant isolation

- [ ] Implemented
- [ ] Independently verified

