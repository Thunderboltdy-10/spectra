# Realtime collaboration and permissions

## Recommendation and alternatives

Convex reactive queries are the right metadata/activity foundation: a query subscription reruns when dependencies change, and optimistic updates can make ordinary mutations immediate ([Convex realtime](https://docs.convex.dev/realtime), [optimistic updates](https://docs.convex.dev/client/react/optimistic-updates)). They are not by themselves a rich-text or freeform-canvas concurrency protocol.

| Content approach               | Strength                                                     | Cost/risk                                                   |
| ------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------- |
| last-write-wins JSON mutations | simple                                                       | lost edits, whole-document bandwidth, unsafe concurrency     |
| domain operational transform   | precise central control                                      | high per-type algorithm cost                                |
| Automerge                      | local-first documents, built-in sync/history model           | larger integration shift, smaller Tiptap ecosystem          |
| Yjs                            | mature CRDT, Tiptap/ProseMirror fit, awareness, subdocuments | must design authenticated provider, persistence, compaction |

Decision: use Convex for authorized durable metadata/comments/activity/grants and a self-hosted Yjs service for suitable live content, behind a transport abstraction that can move to managed infrastructure later without rewriting artifact adapters. Yjs awareness is ephemeral and never history ([Yjs awareness](https://docs.yjs.dev/getting-started/adding-awareness)); editor patterns are documented here: [Yjs collaborative editor](https://docs.yjs.dev/getting-started/a-collaborative-editor). Spectra is online-first; Automerge/local-first remains research only and no offline editing is implemented.

## Permission model

Artifacts are private by default. Direct sharing targets a user (and future group/class) with read-only or modify. Workspace access normally projects corresponding access to every placed artifact; an artifactAccessException can remove or narrow access for one artifact/person. Public access is a separate explicit principal, never default. The backend represents extensible capabilities—read, modify, share, delete, restore, use, comment, publish—while current UI exposes only the simple modes users need. Agent creator-only deletion and formative-response privacy remain type rules.

Effective access evaluates direct grants, workspace grant projections, artifact exceptions, lifecycle, source/embed constraints, membership, and operator session. UI explains “Access through Biology workspace” or direct access and lets an authorized sharer remove individual artifact access. A no-access placement renders a bounded placeholder/request path. Public links are revocable, explicit, view-only by default, non-indexed, optionally expiring/domain-restricted, and never created as a side effect of workspace sharing.

Sharing changes require preview of affected audience and embedded/linked consequences. Removing the owner, last manager, or last school owner is transactionally blocked. Permission caches and room tokens carry policy version; revocation bumps version and actively disconnects sessions.

## Collaboration services

- collaborationRooms map artifact/version/type to policy and persistence strategy.
- collaborationUpdates are append-only binary deltas partitioned by room and sequence.
- collaborationSnapshots contain state vector, content hash, schema version, createdAt, and compaction boundary.
- presence leases carry cursor/selection/viewport/active region and expire quickly.
- regionClaims identify actor/run, semantic region and overlap domain, base state vector, lease/queue, and release reason.
- comments carry thread, author, state, mentions, resolvedAt, and type-specific semantic anchor.
- changeGroups bridge low-level updates to meaningful product activity/version history.

Room tokens are short-lived, artifact-specific, capability-specific, and minted after server policy evaluation. The gateway validates token, rate/size limits, schema adapter, and policy version. It cannot mint grants.

## Concurrent human and AI editing

Humans and AI claim the smallest stable semantic region before durable mutation: line/block, slide object, card side, quiz field/option, Sheet cell/range, task field, canvas node, or type equivalent. Non-overlapping claims proceed and animate concurrently. Overlap queues or pauses the later actor and exposes base/current/proposed state with keep/apply/merge/cancel. A provably commutative operation may rebase; no silent last-write-wins is allowed. AI broadcasts distinct working presence and real region effects. Approval claims are durable and single-winner.

If permission changes mid-run, pending operations reauthorize before commit. Completed authorized operations remain in history; future work stops. Rejecting AI removes proposals, not already approved changes. Partial failure creates one change group with per-operation outcome and recovery action.

## Online-first reconnect and recovery

There is no offline editing, local mutation queue, background upload, or offline promise. On connection loss the editor stops accepting changes it cannot durably synchronize, preserves the currently focused field in memory long enough to copy/recover, and displays reconnecting/unsynchronized state. On reconnect it re-authenticates, re-checks grants/policy version, compares Yjs state vectors, confirms or rejects any already-sent update, validates schema, and restores live editing. If access was revoked, nothing uploads. Schema incompatibility opens read-only recovery/export of the current field only where policy allows.

## Comments, activity, and notifications

Comment anchors are type-specific and survive edits through stable region IDs/relative positions/geometry plus fallback excerpt. Orphaned anchors remain visible in an “unplaced comments” queue. Mentions validate audience before notification. Notification preferences support immediate/digest, per-artifact mute, and security overrides.

Activity records meaningful actions, not keystrokes: joined/shared, changed structure, AI change group, comment, version, publish, restore, import, permission change. Presence is not activity. Analytics uses aggregate events and never reconstructs private content.

## Scale and verification

Coalesce cursor updates, send state-vector diffs, compact by update count/bytes/time, virtualize off-screen content, and split very large canvases/Sheets workbooks by subdocument/region. Test latency, packet loss, duplicated/out-of-order frames, tab sleep, process restart, clock skew, 2/10/50 participants, region contention, large artifacts, revocation, reconnect, and schema migration.

## Collaboration tasks

### RTC-01 Implement private-default read-only/modify grants, workspace propagation, artifact exceptions, access explanations, explicit public links, extensible capabilities, and invariants

- [ ] Implemented
- [ ] Verified

### RTC-02 Implement the self-hosted Yjs transport behind a provider abstraction and document measured migration requirements for future managed infrastructure

- [ ] Implemented
- [ ] Verified

### RTC-03 Implement short-lived room tokens, policy versions, revocation disconnect, and gateway limits

- [ ] Implemented
- [ ] Verified

### RTC-04 Implement update logs, snapshots, state vectors, compaction, and corruption recovery

- [ ] Implemented
- [ ] Verified

### RTC-05 Implement ephemeral presence, cursors, selections, viewports, and accessible collaborator indicators

- [ ] Implemented
- [ ] Verified

### RTC-06 Implement semantic comments, mentions, orphan recovery, resolution, and notification preferences

- [ ] Implemented
- [ ] Verified

### RTC-07 Implement change groups and meaningful activity without keystroke noise

- [ ] Implemented
- [ ] Verified

### RTC-08 Implement human/AI exclusive overlapping-region claims, queue/pause, safe rebase, compare/resolve, rejection, release cleanup, and partial recovery

- [ ] Implemented
- [ ] Verified

### RTC-09 Implement online-only reconnect, unsynchronized warnings, permission/schema/state-vector recheck, focused-field recovery, and revoked-access stop with no offline queue

- [ ] Implemented
- [ ] Verified

### RTC-10 Prove bandwidth, scale, packet-failure, restart, revocation, and cross-tenant isolation

- [ ] Implemented
- [ ] Verified
