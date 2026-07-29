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

User identity is global, but a normal account may have at most one active school membership. A membership has status, management-role additions, capabilities, cohort metadata, and dates; role does not reduce ordinary product capability. Students, teachers, school admins, and superadmins can create, use, and share the same artifacts and agents. Classes/groups are future distribution/discussion structures, not core prerequisites. A platform operator is derived from normalized SUPER_ADMIN_EMAILS and an authenticated session; entering a school creates a labeled operational session, never a second membership or silent school-admin bootstrap.

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

Metadata and activity use Convex reactive queries, scoped by server-side authorization. High-frequency collaborative content uses a self-hosted authenticated Yjs service behind a transport abstraction with short-lived room tokens, append-only updates, and periodic snapshots. Ordinary mutations, comments, grants, region claims, versions, and activity remain Convex transactions. Spectra is online-first: no offline editing or offline mutation queue. Network loss stops new durable edits, reports reconnecting/unsynchronized state honestly, and reconciles authorized in-flight state after reconnect.

AI and import writes never bypass domain commands. A command validates actor, artifact type, schema, current live state vector, stable target regions, active region ownership, rate/budget, and approval requirements. One actor holds an exclusive claim for an overlapping semantic region; non-overlapping regions remain concurrent. Conflicting work queues or pauses for visible resolution and never silently overwrites. Live synchronized state is authoritative before a named version. If AI starts over uncheckpointed human state, create a user-authored checkpoint first; every coherent AI batch then creates an AI-attributed change group/version.

## Event and consistency model

- Strong transaction: authority changes, artifact lifecycle, placement, approval claim, operation idempotency, version creation.
- Eventually consistent: search index, embeddings, aggregates, thumbnails, suggested relationships, memory consolidation.
- Ephemeral: presence, cursors, active selection, region claims/leases, typing, transient AI working trace.
- Durable but append-only: audit, run events, connector sync log, collaboration updates until compacted.

Every eventually consistent projection stores source version and processing status. UI must disclose stale or failed projections without replacing source content. Jobs are idempotent and leased; retries use deterministic keys.

## Search, retrieval, and context

Create permission-filtered search fragments per artifact region, external record, resource, thread excerpt, and memory claim. The query planner first applies tenant and grant filters, then lexical/vector ranking, then diversity and token budgets. Retrieval results include source version, reason, sensitivity, and allowed use. Re-check access at assembly time so stale indexes cannot leak revoked content.

The context manifest is durable and inspectable: continued thread, explicit focus, visible objects, selected/routed agent version, workspace, retrieved evidence, memory capsule, on-demand artifact skill, and excluded items/reasons. Medium-to-high-confidence routing automatically loads only the chosen agent’s relevant instructions, skills, tools, resource bindings, and specialized context. Low confidence uses ordinary Spectra. Continuation, focus, workspace, and agent remain separate axes.

## Security and privacy invariants

- No school boundary, resource grant, or agent resource binding is inferred from a title, email string, or client request alone.
- Artifacts are private by default. Direct sharing exposes read-only or modify; workspace access normally propagates to placed artifacts, with explicit per-artifact access removal. Public access is always explicit. The backend capability model remains extensible without complicating the current UX.
- A parent thread, embed, agent, or cross-artifact reference never escalates access to its source. Workspace propagation is an explicit grant projection and respects artifact exceptions.
- Student prompts and private work remain unavailable to teacher agent creators and school admins unless the student explicitly shares them or a narrowly defined safeguarding/legal process is invoked and audited.
- Secret values never enter client-visible Convex documents, browser payloads, ordinary logs, AI context, or general audit metadata. Use pragmatic restricted server-side encryption with rotation/fingerprints/audit; an expensive external vault is optional, not a prerequisite.
- Memory, search, analytics, and embeddings inherit source scope and deletion.
- Restore creates a new version; audit history is append-only and separately retained.
- Deleting an artifact revokes room tokens immediately, tombstones search, schedules content/asset deletion, and retains only legally required minimal audit data.

These controls support data minimization, purpose limitation, accuracy, retention, and security principles in [GDPR Article 5](https://eur-lex.europa.eu/eli/reg/2016/679/art_5/oj/eng) and the US Department of Education’s guidance that school officials receive only data needed for legitimate educational interests: [FERPA guidance](https://studentprivacy.ed.gov/faq/what-must-educational-agencies-or-institutions-do-ensure-only-school-officials-legitimate).

## Failure and recovery

| Failure                           | Required behavior                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Convex unavailable                | stop new durable metadata/domain actions, show reconnecting, retain only the current in-memory field for explicit copy/recovery |
| collaboration gateway unavailable | stop durable editing, show reconnecting/unsynchronized, retain current in-memory field only; never pretend saved or queue offline work |
| AI worker dies                    | lease expires, new worker resumes from checkpoint/idempotency ledger                                              |
| permission revoked mid-session    | invalidate subscriptions and room token, stop writes/runs, offer copy of the currently edited field only if policy allows; never queue upload |
| connector partially fails         | retain prior normalized records, mark affected capabilities stale, expose item-level errors                       |
| search/memory projection lags     | show source content normally; omit or label stale suggestions                                                     |
| schema migration fails            | keep old schema reader in offline migration tooling only, roll back deployment, never in product runtime          |

## Performance budgets

- Cached navigation acknowledgement under 100 ms; reactive metadata settlement under 1 s on healthy networks.
- Presence/cursor updates coalesced to at most 10 Hz per active user and dropped when off-screen.
- No whole-artifact upload for a normal keystroke or object move.
- Initial artifact shell under 200 KB compressed excluding on-demand media; type editor loaded on demand.
- Initial AI context reports a token estimate and follows memory/runtime relevance targets without treating roughly 1,000 memory tokens as a quality-damaging absolute ceiling.
- Large whiteboards, decks, Sheets workbooks, and histories virtualize rendering and fetch by viewport/page/range.
- Storage, bandwidth, rendering, collaboration, and model usage are fully metered and optimized. Commercial enforcement remains disabled; superadmin can configure/simulate per-school limits for later activation without schema redesign.

## Architecture tasks

### A-01 Define schemas, indexes, retention classes, and data ownership for every bounded context

- [ ] Implemented
- [ ] Verified

### A-02 Implement global identity, at-most-one active school membership, ordinary role parity, and operational superadmin school context

- [ ] Implemented
- [ ] Verified

### A-03 Implement centralized policy evaluation and resource grants with revocation propagation

- [ ] Implemented
- [ ] Verified

### A-04 Replace HTTP polling metadata paths with authorized reactive queries

- [ ] Implemented
- [ ] Verified

### A-05 Implement abstracted self-hosted Yjs transport, snapshot/update persistence, online-only reconnect, and outage recovery

- [ ] Implemented
- [ ] Verified

### A-06 Implement typed domain commands, exclusive overlapping-region control, activity, audit, idempotency, metering, and projection jobs

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
