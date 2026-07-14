# Spectra next-generation master plan

Status: planning contract; no major-system implementation is authorized by this document.

## Purpose and authority

This directory turns the current product, the live-acceptance evidence, the reference images, and the next-generation brief into an executable programme. The current product source of truth remains authoritative for the working Wave Z experience until a reviewed decision in 09_PRODUCT_DECISIONS.md replaces it. Completion claims in earlier Wave plans are evidence to verify, not facts assumed here.

The implementation programme starts with deliberate removal of obsolete memory, ManageBac, admin, and superadmin systems. That removal is expected to break imports, routes, schema validation, and tests. The breakage becomes a replacement ledger; it must not be hidden with compatibility wrappers, dummy payloads, renamed legacy modules, or fake data.

## Execution model — single-agent ownership

This entire programme must be executed end-to-end by the same primary agent.

Do not delegate implementation, research, review, testing, migration, UI work, or verification to subagents. Do not spawn parallel agents or divide the plans into concurrent workstreams. The primary agent retains responsibility for every decision, code change, integration, test, migration, visual comparison, and correction.

After every context compaction, the agent must reread:

- this master plan;
- the active phase and task;
- the relevant feature or artifact plan;
- the current implementation ledger;
- and the relevant UI references.

The agent must preserve a concise current-state record in the master plan so that sequential ownership survives long runs and context compaction.

## Document map

| Plan                                         | Contract                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| 01_NEXT_GENERATION_PRODUCT_ARCHITECTURE.md   | Bounded contexts, system topology, identities, data flow, operational guarantees |
| 02_ARTIFACT_TYPE_STANDARD.md                 | Mandatory protocol every artifact type implements                                |
| 03_MEMORY_AND_CONNECTED_INTELLIGENCE.md      | Scoped, compact, inspectable long-term intelligence                              |
| 04_MANAGEBAC_AND_SCHOOL_DATA.md              | Read-only school-data ingestion, identity resolution, provenance, overlays       |
| 05_ADMIN_AND_SUPERADMIN.md                   | New institutional and platform operations surfaces                               |
| 06_AGENT_ARTIFACT_SYSTEM.md                  | Privacy-preserving agent creation, distribution, use, evaluation, versions       |
| 07_REALTIME_COLLABORATION_AND_PERMISSIONS.md | Grants, presence, CRDT synchronization, comments, notifications                  |
| 08_EMBEDDED_ARTIFACTS_AND_VERSION_HISTORY.md | Embeds, meaningful versions, comparison, restore, retention                      |
| 09_PRODUCT_DECISIONS.md                      | Consequential choices requiring product-owner review                             |
| 10_DELETION_AND_MIGRATION_MAP.md             | File-, field-, integration-, and failure-level removal contract                  |
| 11_AI_RUNTIME_AND_OPERATIONS.md              | Durable runs, typed operations, conflict handling, retrieval, evaluation         |
| 12_UI_REFERENCE_REVIEW.md                    | Per-image keep/change/regenerate decisions and missing references                |
| 13_RESEARCH_AND_ALTERNATIVES.md              | Primary-source research matrix and the alternatives it changed                   |
| artifacts/\*.md                              | Domain contract for each artifact, inheriting the common standard                |

## Architectural convergence

Spectra is one product with five control planes:

1. Identity and authority decide who may see, use, comment on, change, share, restore, or delete a resource.
2. School data supplies trusted, provenance-bearing records without becoming editable Spectra content.
3. Artifacts supply structured environments for work; workspaces and Inbox are placements, not alternate owners or copies.
4. Threads and durable AI runs coordinate people, agents, retrieval, approvals, and typed artifact operations.
5. Memory derives compact, scoped intelligence from permitted events; it never grants access or bypasses source permissions.

Information crosses a boundary only through a typed reference with provenance, policy evaluation, and an audit event. A ManageBac assignment can create a planner-task overlay; the overlay references the external record but never mutates it. An agent may read a teacher resource only if the agent version and invoking user both have use rights. An embed never inherits more access than its source. Memory retrieval re-checks current access before returning evidence.

## Dependency graph

| Foundation                                                   | Unblocks                                               | Must wait for                                      |
| ------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------- |
| New principal, membership, role, capability, and grant model | sharing, school data, agents, comments, history, admin | deletion ledger and product decisions D-01 to D-04 |
| Artifact registry and typed content protocol                 | every artifact, embeds, history, AI operations         | identity/grants and D-05                           |
| Reactive metadata client plus collaboration transport        | live lists, presence, comments, simultaneous editing   | grants and D-06                                    |
| Durable AI run and operation engine                          | progressive creation/editing across all types          | artifact protocol and D-07                         |
| External-record and secret-management foundations            | ManageBac and future SIS/LMS connectors                | tenant model and D-08                              |
| Version/change-group service                                 | safe AI edits, restore, agent publishing, embeds       | artifact content and collaboration                 |
| Memory event and claim model                                 | personalization and next-step intelligence             | authority, provenance, retention decisions         |
| Admin control plane                                          | memberships, integrations, governance, agents          | tenant model, audit, usage metering                |

## Implementation sequence

### Phase 0 — freeze and evidence

Capture production-like schema counts, export reversible migration snapshots, record active imports, and preserve the current acceptance fixtures. Freeze feature work in the four obsolete domains. Do not freeze security repairs.

### Phase 1 — remove obsolete systems first

Execute 10_DELETION_AND_MIGRATION_MAP.md. Delete the old memory, ManageBac, admin, and superadmin routes, UI, Convex functions, schema fields/tables, env declarations, tests, utilities, cron entries, generated API references, and documentation claims. Remove hard-coded platform-operator identity. Record every resulting TypeScript, schema, test, navigation, and runtime failure as an owned replacement item. The application may temporarily lack these capabilities.

### Phase 2 — identity, authority, audit, and secrets

Create user identities independent of school membership; organizations/schools; memberships; groups/classes; platform-operator eligibility from SUPER_ADMIN_EMAILS; scoped operator sessions; capability policies; resource grants; audit events; encrypted secret references; retention jobs. Migrate current user/org identity only after invariant and rollback tests pass.

### Phase 3 — artifact and reactive foundations

Create the artifact registry, typed content stores, placements, relationships, grants, comments, activity, versions, embeds, search fragments, and migration registry. Replace polling projections with Convex reactive queries for metadata and activity. Introduce the authenticated collaboration gateway and Yjs document rooms only after permission revocation and reconnect prototypes pass.

### Phase 4 — durable AI collaborator

Replace process-local background execution with leased durable jobs and resumable event streams. Implement typed read/operation contracts, base-version preconditions, region locks/advisories, approvals, deterministic idempotency, checkpoints, partial recovery, and evaluation. Preserve the strongest existing progressive-shell and typed-worker ideas after reimplementation against the common artifact protocol.

### Phase 5 — first artifact cohort

Upgrade document, flashcard deck, quiz, and planner task together. They validate the shared protocol across rich text, ordered collections, assessment structures, and time-bound state. Release collaboration/history/embed support by capability, not with a global “collaborative” label.

### Phase 6 — school and institutional systems

Build new admin/superadmin control planes, secret vault integration, ManageBac capability discovery, staged imports, class/workspace creation, timetable/planner projections, and governance. Start with one pilot school and read-only API access.

### Phase 7 — agent product

Build the agent artifact, guided training, resource-version bindings, eval suites, publishing, audience grants, explicit invocation, routing suggestions, privacy-preserving analytics, improvement proposals, and creator governance.

### Phase 8 — rich artifact cohort

Ship timetable/calendar, presentation, code/interactive visualization, whiteboard, dataset, and portfolio in risk-based slices. Sandboxed code execution and large-canvas synchronization require separate security/performance gates.

### Phase 9 — connected intelligence and expansion

Enable memory capture only after inspect/correct/delete/export controls, scope-contamination tests, retention jobs, and retrieval audit are live. Expand to additional connectors and artifact types through the registry rather than special-case routes.

## Sequential execution order

No implementation, investigation, review, or verification work in this programme should be assigned to parallel agents.

The primary agent must execute work in dependency order:

1. establish and verify the shared foundation;
2. implement one bounded system or artifact at a time;
3. integrate it with every previously completed system;
4. test its local and cross-product behavior;
5. record remaining issues;
6. continue only when the current work is stable.

## Release gates

Every phase needs: schema migration rehearsal, authorization matrix tests, accessibility review, narrow/wide/tiled visual acceptance, latency and bandwidth budgets, telemetry with privacy review, destructive-action recovery, and a dedicated verification pass performed by the same agent only after implementation is complete. During verification, the agent must reread the requirements, inspect the finished implementation as though reviewing unfamiliar work, use the live product, and reopen implementation tasks whenever a defect is found. A feature is not “collaborative” until simultaneous edit, reconnect, permission-revocation, and AI-conflict tests pass.

## Programme tasks

### M-01 Approve the architecture and decision register

- [ ] Implemented
- [ ] Verified

### M-02 Capture migration snapshots and the pre-removal dependency baseline

- [ ] Implemented
- [ ] Verified

### M-03 Execute the obsolete-system deletion map and publish the failure ledger

- [ ] Implemented
- [ ] Verified

### M-04 Deliver identity, memberships, grants, operator sessions, audit, and secrets

- [ ] Implemented
- [ ] Verified

### M-05 Deliver the artifact registry, reactive projections, collaboration, history, and embeds

- [ ] Implemented
- [ ] Verified

### M-06 Deliver the durable AI run and typed-operation platform

- [ ] Implemented
- [ ] Verified

### M-07 Upgrade and release the four existing artifact products

- [ ] Implemented
- [ ] Verified

### M-08 Deliver school data, school admin, and platform operations through pilot rollout

- [ ] Implemented
- [ ] Verified

### M-09 Deliver agent artifacts with privacy and evaluation gates

- [ ] Implemented
- [ ] Verified

### M-10 Deliver rich artifacts with security and scale gates

- [ ] Implemented
- [ ] Verified

### M-11 Enable scoped connected intelligence and user controls

- [ ] Implemented
- [ ] Verified

### M-12 Run cross-product migration, accessibility, security, performance, and live acceptance

- [ ] Implemented
- [ ] Verified
