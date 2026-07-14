# Next-generation product architecture

## Current-state findings

The active product is more coherent than older repository documentation suggests, but it is not yet the foundation required by this expansion:

- Workspace, Inbox, artifact, thread, run, result-card, placement, and operation concepts are present and worth preserving conceptually.
- The browser data layer calls /api/spectra and caches or polls results; it does not use Convex React subscriptions. “Realtime” run events are HTTP stream/poll behavior, not a shared reactive data model.
- The current authorization helpers require artifact/workspace ownership. There is no general grant model, collaborator role, class audience, presence, or comment system.
- Four blueprint keys are hard-coded. Content is largely stored as untyped any values; versions contain whole before/after payloads.
- AI runs expose useful lifecycle and progressive-content ideas, but active controllers and background tasks are process-local. A server restart can strand work despite durable-looking database records.
- Artifact Studio and the run route are multi-thousand-line modules. Adding new types there would amplify coupling.
- Existing agents, memory, ManageBac, admin, and superadmin belong to the old product architecture and must be removed, not adapted.

## Target topology

| Bounded context | Owns                                                         | Does not own                                          |
| --------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| Identity        | global user, verified emails, sessions                       | school role or resource rights                        |
| Tenancy         | school, membership, group, class, invitation                 | platform-operator eligibility                         |
| Authority       | capabilities, grants, policy decisions, revocation           | content                                               |
| Artifacts       | identity, lifecycle, typed content reference, schema version | workspace placement or thread history                 |
| Collaboration   | CRDT streams, awareness, comments, change groups             | durable artifact metadata                             |
| Workspaces      | placements, views, grouping, pinned state                    | artifact content                                      |
| Threads/runs    | messages, context manifest, approvals, run events            | artifact truth                                        |
| Intelligence    | memories, relationships, retrieval plans, suggestions        | source authority                                      |
| School data     | connectors, external records, sync runs, mappings, overlays  | user-authored artifact state                          |
| Operations      | school admin and platform operations                         | private student work by default                       |
| Metering        | model/storage/action usage and cost allocation               | prompt content unless explicitly sampled with consent |

## Principal and tenant model

User identity is global. A user can hold zero or more memberships in schools. A membership has status, role set, capabilities, cohort metadata, and dates; role is not stored on the user. Classes and groups contain memberships, not copied users. A platform operator is an independently evaluated principal derived from a normalized allowlist in SUPER_ADMIN_EMAILS and an authenticated session; it is not silently bootstrapped into a school admin role.

A request establishes an actor context: user identity, active school, membership, platform-operator eligibility, optional time-boxed operator delegation, and request provenance. Every backend query/mutation evaluates this context. Client-side role gating is display only.

## Core data contracts

Recommended logical records (physical table partitioning may follow load tests):

- users, verifiedEmails, organizations, memberships, groups, groupMemberships, invitations.
- platformOperators and operatorSessions with reason, scope, expiry, read/write mode, and revocation.
- artifacts with typeKey, schemaVersion, ownerId, lifecycle, contentRef, currentVersionId, timestamps, classification.
- artifactContents or type-specific stores, artifactPlacements, artifactRelations, resourceGrants.
- collaborationRooms, collaborationSnapshots, collaborationUpdates, presence leases.
- comments, commentAnchors, reactions, changeGroups, artifactVersions, versionAssets.
- threads, messages, contextManifests, aiRuns, runAttempts, runEvents, operations, approvals.
- integrations, secretRefs, connectorCapabilities, syncRuns, externalRecords, identityMappings, userOverlays.
- memoryClaims, memoryEvidence, memoryRelations, memoryCapsules, memoryRetrievalEvents.
- auditEvents, notifications, usageEvents, dailyAggregates, incidents, feedback.

All externally visible IDs are opaque. All records carry tenant scope where applicable. Sensitive tables use explicit retention classes. Timestamps are UTC instants; user-facing recurring time also preserves IANA timezone and local rule.

## Read and write paths

Metadata and activity use Convex reactive queries, scoped by server-side authorization. High-frequency collaborative content uses an authenticated Yjs transport with short-lived room tokens; the service persists append-only updates and periodic snapshots. Ordinary mutations, comments, grants, versions, and activity remain Convex transactions. This hybrid avoids pushing every keystroke through whole-document mutations while retaining a single authoritative policy/audit plane.

AI and import writes never bypass domain commands. A command validates actor, artifact type, schema, base version/state vector, target regions, rate/budget, and approval requirements. Successful commands append activity and change-group records transactionally. Collaborative content changes are committed into a named change group before an artifact version can reference them.

## Event and consistency model

- Strong transaction: authority changes, artifact lifecycle, placement, approval claim, operation idempotency, version creation.
- Eventually consistent: search index, embeddings, aggregates, thumbnails, suggested relationships, memory consolidation.
- Ephemeral: presence, cursors, active selection, typing, transient AI working trace.
- Durable but append-only: audit, run events, connector sync log, collaboration updates until compacted.

Every eventually consistent projection stores source version and processing status. UI must disclose stale or failed projections without replacing source content. Jobs are idempotent and leased; retries use deterministic keys.

## Search, retrieval, and context

Create permission-filtered search fragments per artifact region, external record, resource, thread excerpt, and memory claim. The query planner first applies tenant and grant filters, then lexical/vector ranking, then diversity and token budgets. Retrieval results include source version, reason, sensitivity, and allowed use. Re-check access at assembly time so stale indexes cannot leak revoked content.

The context manifest is durable and inspectable: continued thread, explicit focus, visible objects, selected agent/version, workspace, retrieved evidence, memory capsule, and excluded items/reasons. This preserves the current useful distinction between continuation and context while making agent selection a separate axis.

## Security and privacy invariants

- No school boundary, resource grant, or agent resource binding is inferred from a title, email string, or client request alone.
- A parent artifact, workspace, thread, embed, or agent never escalates access to a referenced source.
- Student prompts and private work remain unavailable to teacher agent creators and school admins unless the student explicitly shares them or a narrowly defined safeguarding/legal process is invoked and audited.
- Secret values never enter Convex documents, browser payloads, logs, AI context, or general audit metadata; only vault references do.
- Memory, search, analytics, and embeddings inherit source scope and deletion.
- Restore creates a new version; audit history is append-only and separately retained.
- Deleting an artifact revokes room tokens immediately, tombstones search, schedules content/asset deletion, and retains only legally required minimal audit data.

These controls support data minimization, purpose limitation, accuracy, retention, and security principles in [GDPR Article 5](https://eur-lex.europa.eu/eli/reg/2016/679/art_5/oj/eng) and the US Department of Education’s guidance that school officials receive only data needed for legitimate educational interests: [FERPA guidance](https://studentprivacy.ed.gov/faq/what-must-educational-agencies-or-institutions-do-ensure-only-school-officials-legitimate).

## Failure and recovery

| Failure                           | Required behavior                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Convex unavailable                | local collaborative draft may continue only if room authorization is still valid; metadata actions queue visibly  |
| collaboration gateway unavailable | fall back to read-only last snapshot or local unsynced draft; never pretend saved                                 |
| AI worker dies                    | lease expires, new worker resumes from checkpoint/idempotency ledger                                              |
| permission revoked mid-session    | invalidate subscriptions and room token, stop writes, preserve unsent local copy for export only if policy allows |
| connector partially fails         | retain prior normalized records, mark affected capabilities stale, expose item-level errors                       |
| search/memory projection lags     | show source content normally; omit or label stale suggestions                                                     |
| schema migration fails            | keep old schema reader in offline migration tooling only, roll back deployment, never in product runtime          |

## Performance budgets

- Cached navigation acknowledgement under 100 ms; reactive metadata settlement under 1 s on healthy networks.
- Presence/cursor updates coalesced to at most 10 Hz per active user and dropped when off-screen.
- No whole-artifact upload for a normal keystroke or object move.
- Initial artifact shell under 200 KB compressed excluding on-demand media; type editor loaded on demand.
- Initial AI context reports a token estimate and respects the budgets in the memory and runtime plans.
- Large whiteboards, decks, datasets, and histories virtualize rendering and fetch by viewport/page/range.

## Architecture tasks

### A-01 Define schemas, indexes, retention classes, and data ownership for every bounded context

- [ ] Implemented
- [ ] Verified

### A-02 Implement global identity, multi-school memberships, groups/classes, and active actor context

- [ ] Implemented
- [ ] Verified

### A-03 Implement centralized policy evaluation and resource grants with revocation propagation

- [ ] Implemented
- [ ] Verified

### A-04 Replace HTTP polling metadata paths with authorized reactive queries

- [ ] Implemented
- [ ] Verified

### A-05 Implement collaboration transport, snapshot/update persistence, and outage recovery

- [ ] Implemented
- [ ] Verified

### A-06 Implement typed domain commands, activity, audit, idempotency, and projection jobs

- [ ] Implemented
- [ ] Verified

### A-07 Implement permission-filtered search, retrieval, and durable context manifests

- [ ] Implemented
- [ ] Verified

### A-08 Implement deletion, retention, export, legal-hold, and tenant-offboarding workflows

- [ ] Implemented
- [ ] Verified

### A-09 Prove latency, bandwidth, reconnect, revocation, and cross-tenant isolation budgets

- [ ] Implemented
- [ ] Verified

### A-10 Migrate active Spectra entities without compatibility code in the final runtime

- [ ] Implemented
- [ ] Verified
