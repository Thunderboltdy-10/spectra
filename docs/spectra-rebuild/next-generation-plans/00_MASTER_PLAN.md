> Historical plan: superseded by `SPECTRA_DEFINITIVE_TRANSFORMATION_PLAN.md`. Retained as implementation evidence only.

# Spectra next-generation master plan

Status: active implementation contract. The persistent goal remains active until every Implemented and Verified checkbox in this plan set is genuinely complete.

## Authority and execution model

This directory is the canonical contract for the next generation of Spectra. The resolved decisions in 09_PRODUCT_DECISIONS.md supersede contradictory earlier Wave/product documents. Earlier completion claims remain evidence to verify, not accepted completion.

One primary agent owns the entire programme. Do not create, spawn, delegate to, or use sub-agents for research, implementation, review, testing, migration, UI work, or verification. Work is sequential even when a dependency graph could theoretically support parallelism. “Independent verification” means a later, fresh verification stage after all implementation boxes are complete; it does not authorize another agent.

After every context compaction, before acting:

1. reload the frontend-design skill;
2. reread the persistent goal;
3. reread this master plan;
4. reread the currently relevant system/artifact plan;
5. inspect only the reference images relevant to the current work;
6. reread the active implementation/defect ledger.

The frontend-design skill governs every implementation surface. The supplied images are executable visual specifications: the live application must be extremely close before verification, while still implementing every functional, permission, failure, collaboration, history, embed, responsive, and accessibility state the images imply.

## Document map

| Plan                                         | Contract                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 01_NEXT_GENERATION_PRODUCT_ARCHITECTURE.md   | Topology, single-school identity, authority, data flow, metering, operational guarantees            |
| 02_ARTIFACT_TYPE_STANDARD.md                 | Mandatory artifact, AI-skill, live-save, import, effects, and conformance protocol                  |
| 03_MEMORY_AND_CONNECTED_INTELLIGENCE.md      | Default-on scoped background memory and controls                                                    |
| 04_MANAGEBAC_AND_SCHOOL_DATA.md              | Verified read-only capabilities, first/later sync, identity, provenance, overlays                   |
| 05_ADMIN_AND_SUPERADMIN.md                   | Complete school/platform operations without ordinary-content exposure                               |
| 06_AGENT_ARTIFACT_SYSTEM.md                  | Universal agent creation/use, automatic routing, privacy, evaluation, versions                      |
| 07_REALTIME_COLLABORATION_AND_PERMISSIONS.md | Private-default sharing, self-hosted Yjs, region control, reconnect                                 |
| 08_EMBEDDED_ARTIFACTS_AND_VERSION_HISTORY.md | Live/pinned embeds, human/AI history, checkpoint and restore                                        |
| 09_PRODUCT_DECISIONS.md                      | Resolved product decisions and consequences                                                         |
| 10_DELETION_AND_MIGRATION_MAP.md             | Exact obsolete-system deletion and failure-ledger contract                                          |
| 11_AI_RUNTIME_AND_OPERATIONS.md              | Durable adaptive runs, native progress protocol, artifact skills, real effects                      |
| 12_UI_REFERENCE_REVIEW.md                    | Exact 21-image implementation and verification matrix                                               |
| 13_RESEARCH_AND_ALTERNATIVES.md              | Primary-source evidence and selected alternatives                                                   |
| 14_WORKSPACES_AND_MISSION_CONTROL.md         | Home, workspace views, access projection, class generation, and cross-product composition           |
| 15_IMPLEMENTATION_AND_VERIFICATION_LEDGER.md | Active phase, evidence, failures/defects, migrations, and one-reference-at-a-time visual acceptance |
| artifacts/*.md                               | Complete type-specific products inheriting the standard                                             |

First-class artifact types are Document, Flashcard Deck, Quiz, Planner Task, Agent, Timetable/Calendar, Presentation, Sheets, Code/Interactive Visualisation, and Collaborative Whiteboard. CAS and structured data flow into these general-purpose types and Workspaces rather than a dedicated artifact.

## Resolved product invariants

- A normal user has at most one active school membership. Superadmin school access is an operational session, never another membership.
- Students, teachers, school admins, and superadmins have identical ordinary Spectra creation/use/sharing capability. Admin roles only add management pages. Everyone can create, use, and share agents.
- Ordinary Spectra capability is a user right, not a school-admin setting. School or platform operators cannot enable, disable, or narrow legitimate AI, memory, agent, artifact, creation, import/export, or execution capabilities for ordinary users. Educational context shapes workflows, agents, and ManageBac integration rather than imposing classroom-style AI guardrails. Permission boundaries, privacy, secret isolation, runtime sandboxing, abuse/security response, legal retention, metering, and future commercial limits remain operational controls; they must not become disguised feature gates.
- Artifacts are private by default. Direct sharing presents read-only or modify. Workspace access normally flows to its artifacts, with per-artifact access removal. Public access is explicit and never default. The backend retains extensible capabilities without exposing needless complexity.
- No commercial storage/model/usage limits are enforced now. Meter everything efficiently and let superadmin define, adjust, simulate, and later enable per-school limits without redesign.
- Collaboration uses self-hosted Yjs behind a transport abstraction. Spectra is online-first and does not support offline editing or offline mutation queues. Network loss produces honest reconnect/unsynchronized/recovery states.
- Secrets remain server-side and out of browser, AI context, ordinary logs, and client-visible database records. Use pragmatic encryption/secret handling appropriate to current scale, with rotation and audit, without unnecessary managed-infrastructure cost.
- Analytics are not small-cohort suppressed. Admin/superadmin analytics may be extensive but exclude private prompts, threads, memory, and unrelated artifacts. Teacher analytics remain limited to useful agent/assigned-experience signals.
- Medium-to-high-confidence specialized-agent routing is automatic, visible, and reversible. Low confidence uses ordinary Spectra. Continued threads retain their agent unless explicit selection or strong evidence justifies a change. Available agents are retrieved on demand, never all injected at startup.
- Memory is enabled by default, maintained silently in the background, approximately 1,000 initial tokens but expandable when evidence shows usefulness suffers. Users can inspect, correct, delete, pause, and control it.
- Save means durable synchronization plus validity, never a manual editing boundary. Humans and AI operate on live state. Same semantic region has exclusive active ownership/conflict control; non-overlapping regions may update concurrently.
- Meaningful human sessions and every coherent AI operation batch create distinguishable history. If live human changes lack a checkpoint when AI begins, create a user checkpoint first, then an AI version. Restore creates a new current version.
- AI runs are durable and resumable but adaptive, not a mandatory stage checklist. The active model emits concise operation-specific progress events through hidden structured tags; runtime strips them, validates them, and synchronizes every run representation. No secondary naming model and no memory-maintenance trace. The obsolete chat-mode taxonomy/selector is removed: quiz, flashcards, images, research, tutoring, explanation, and similar work are ordinary adaptive operations or first-class artifacts, not mutually exclusive chat modes.
- Blue AI effects are real, artifact/region-aware, ephemeral, polished, concurrent for independent edits, and fully cleared after completion/failure/rejection/cancellation. Reduced motion remains complete.
- Each artifact owns an on-demand AI skill describing purpose, selection, regions, operations, preservation, validation, approvals, links, and effects. Ordinary context carries only a compact artifact-selection/composition guide.
- Progressive disclosure keeps common actions obvious and advanced configuration in inspectors/menus. Redundant or nonfunctional controls are prohibited. Every control and every feature is verified in the live UI.
- Quizzes are practice/formative only. Code stores any language but initial execution prioritizes browser web, React/TypeScript, HTML/CSS/JS, and Python; compiled execution is deferred. Spectra-native presentations are not constrained by PowerPoint.
- Major-format import, quarantine, fidelity reporting, recovery, and useful export are adoption requirements for every applicable artifact.

## Dependency graph

| Foundation                                                 | Unblocks                                | Hard prerequisite                       |
| ---------------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| Deletion/failure ledger                                    | every replacement                       | exports and active dependency baseline  |
| Single-school identity, operator sessions, capability core | permissions, school data, admin, agents | deletion complete                       |
| Metering, audit, pragmatic secrets                         | admin, ManageBac, later limits          | identity/tenant scope                   |
| Artifact registry, type skills, regions, imports           | every artifact, AI, history, embeds     | authority                               |
| Reactive metadata and self-hosted Yjs transport            | live save, presence, comments, editors  | grants and region policy                |
| Region ownership/conflict service                          | safe human/AI collaboration             | stable type regions                     |
| Change groups/version service                              | AI edits, restore, publishing, imports  | live persistence                        |
| Durable run/operation/progress/effects platform            | cross-artifact AI                       | registry, regions, history              |
| External records and sync policy                           | ManageBac-created structures            | identity, secrets, audit                |
| Default-on memory                                          | personalization/router                  | authority, retrieval, deletion controls |
| Complete UI shell/design system                            | every reference surface                 | frontend-design and reference tokens    |

## Implementation sequence

### Phase 0 — plan lock and evidence

Encode all resolved decisions, remove retired type plans and references, establish Sheets as the structured-data product, inventory all 21 images, record baseline schema/data/import graph, export reversible migration evidence, and establish implementation/defect/visual ledgers. Plans must pass consistency checks before product code changes.

### Phase 1 — obsolete-system deletion

Execute 10_DELETION_AND_MIGRATION_MAP.md. Completely remove old memory, personal/org soul, ManageBac, admin, superadmin, agent, and chat-mode UI/routes/functions/schema/env/tests/jobs/docs/integrations. Preserve the new first-class Quiz/Flashcard and future Agent plans, but no implementation, schema, route, mode selector, prompt taxonomy, or compatibility path from the obsolete systems. Remove hard-coded operator identity. Regenerate API/schema types. Accept temporary compile/test failures only when every failure is mapped to a real replacement; never create wrappers, stubs, dummy data, or hidden legacy paths.

### Phase 2 — identity, authority, metering, audit, secrets

Implement global identity with at most one active school membership; ordinary role parity; school roles as additional-management capabilities; SUPER_ADMIN_EMAILS eligibility; labeled time-boxed operator school sessions; private-default read-only/modify sharing; workspace-to-artifact access propagation with exceptions; explicit public access; audit; efficient usage/storage/model metering with disabled enforcement; limit-policy simulation/configuration; pragmatic encrypted server-side secrets and rotation.

### Phase 3 — artifact, saving, collaboration, history, and embed foundations

Implement the artifact registry, type manifests and on-demand skills, typed content/migrations/import framework, stable regions, live synchronization/validity state, Convex reactive metadata, self-hosted Yjs transport abstraction, presence/comments, exclusive overlapping-region ownership, reconnect/recovery, change groups, pre-AI user checkpoint, AI-attributed versions, type-aware history comparison/restore, and live/pinned embeds. No offline editing.

### Phase 4 — durable adaptive AI collaborator

Replace process-local execution with leased resumable work. Implement adaptive planning/retrieval/approval only when needed; active-model structured progress events; operation-specific traces; typed artifact operations loaded through on-demand skills; agent routing; authorization and base-state checks; region queue/pause/resolution; coherent AI versions; real blue region effects; cancellation/failure cleanup; evaluation and recovery.

### Phase 5 — workspace shell and four existing artifacts

Execute 14_WORKSPACES_AND_MISSION_CONTROL.md and bring Home, workspace List/Board/Timeline/Canvas, Document, Flashcard Deck, Quiz, and Planner Task to the supplied references and complete functional plans. Existing code receives no reduced standard. Implement every control, representation, permission, import/export, collaboration/history/embed state, AI operation/effect, responsive state, and error path before marking complete.

### Phase 6 — school data and operational products

Implement new school-admin and superadmin products, metering/future-limit controls, feedback, rights-preserving governance, storage, and integrations. Administration observes and operates the service but never becomes a feature-control panel for AI, memory, agents, artifacts, creation, import/export, or execution. Build the verified read-only ManageBac capability manifest from the tenant API Manager/reference. Resolve identity strictly by verified school email. First successful sync automatically and idempotently creates class workspaces, timetable layers, source-linked assignments/tasks, deadlines/assessments where readable, permitted resources, provenance, and links with progress/summary. Later syncs preserve customization/overlays, apply safe non-conflicting source changes, tombstone removals, avoid duplicates, and review consequential ambiguity.

### Phase 7 — universal agent product and memory

Implement agent library/guided creation for every ordinary user; resources, skills, tools, evals, versions, sharing, private invocation, automatic routing, visible override, useful unsuppressed aggregate analytics without private content, and improvement proposals. Enable default-on background memory only after control, scoping, deletion, contamination, and usefulness evals pass.

### Phase 8 — rich artifact products

Implement Presentation, Sheets, Code/Interactive Visualisation, Collaborative Whiteboard, and Timetable/Calendar one at a time to their complete plans and references. Prioritize native presentation quality; spreadsheet-scale calculation/collaboration; browser/React/Python runtime safety; large-canvas synchronization; and ManageBac/time integration. Add major imports/exports and cross-artifact links during each type, not as deferred polish.

### Phase 9 — implementation completeness gate

Review every plan from top to bottom. For every task verify all surfaces, states, permissions, errors, integrations, responsive representations, AI operations/effects, imports/exports, and adjacent interactions. Mark Implemented only after this review. All implementation boxes across all plans must be complete before independent verification begins.

### Phase 10 — independent live verification

Reload frontend-design and activate Control Chrome. Use the existing localhost:3000 application as a real user. Run code checks and integration tests, then test every route/control/state/workflow and cross-feature combination. For each of the 21 references: open surface, capture, compare, record exact discrepancy, fix, recapture, repeat until extremely close. When a defect appears, reopen implementation if required and repair before re-verifying. Only then mark Verified.

## Sequential execution discipline

No work in this programme is assigned to parallel agents. The primary agent completes one bounded dependency at a time, integrates it with all completed foundations, runs local regression, records remaining issues, and continues only when stable. A successful build is not product verification.

## Release and completion gates

Every phase requires migration rehearsal, authorization matrix, data-isolation checks, real network/reconnect behavior, accessibility, keyboard/touch, wide/narrow/tiled visual acceptance, latency/bandwidth/storage/model efficiency, destructive recovery, and adjacent regressions. Collaboration is incomplete until non-overlapping edits, same-region conflict, AI over live human state, permission revocation, reconnect, and run interruption pass. UI is incomplete until every reference idea and visible control works.

The persistent goal is complete only when no unchecked box remains, no known defect or compatibility path remains, every reference has a final comparison record, and the current repository/app—not documentation claims—passes the complete contract.

## Master implementation checklist

### M-01 Lock the revised plans, resolved decisions, ten-artifact registry, 21-image matrix, single-agent rule, and compaction protocol

- [x] Implemented
- [ ] Verified

### M-02 Capture migration exports, schema/import baseline, visual baseline, and owned failure ledger

- [x] Implemented
- [ ] Verified

### M-03 Delete obsolete memory, ManageBac, admin, superadmin, agent, and chat-mode systems with zero runtime compatibility paths

- [ ] Implemented
- [ ] Verified

### M-04 Deliver single-school identity, ordinary role parity, operator sessions, private-default sharing, workspace inheritance exceptions, and explicit public access

- [ ] Implemented
- [ ] Verified

### M-05 Deliver audit, pragmatic secrets, complete metering, disabled-default enforcement, and future per-school limit controls

- [ ] Implemented
- [ ] Verified

### M-06 Deliver registry/type skills, stable regions, major-format import framework, live synchronization/validity, reactive data, self-hosted Yjs, comments, and region conflict control

- [ ] Implemented
- [ ] Verified

### M-07 Deliver human/AI change groups, pre-AI user checkpoints, AI-attributed versions, type-aware comparison/restore, and embeds for every artifact

- [ ] Implemented
- [ ] Verified

### M-08 Deliver durable resumable adaptive runs, automatic agent routing, native progress events, typed operations, real working effects, approvals, cleanup, and recovery

- [ ] Implemented
- [ ] Verified

### M-09 Bring Home and all workspace views to functional and visual reference fidelity

- [ ] Implemented
- [ ] Verified

### M-10 Bring Document, Flashcard Deck, Quiz, and Planner Task to full reference/product parity including collaboration, imports, AI effects, history, and embeds

- [ ] Implemented
- [ ] Verified

### M-11 Deliver verified read-only ManageBac capability coverage, strict identity resolution, automatic first sync, safe later sync, class workspaces, tasks, timetable, provenance, and conflicts

- [ ] Implemented
- [ ] Verified

### M-12 Deliver complete school-admin/superadmin products, feedback, governance, analytics without private content, storage/usage inspection, and future limit controls

- [ ] Implemented
- [ ] Verified

### M-13 Deliver universal agent creation/use/sharing, guided training, resources/skills/evals, automatic routing, private sessions, versions, and useful analytics

- [ ] Implemented
- [ ] Verified

### M-14 Deliver default-on background memory with permission scope, usefulness, consolidation, inspection, correction, deletion, pause, and contamination protection

- [ ] Implemented
- [ ] Verified

### M-15 Deliver Presentation, Sheets, Code/Interactive Visualisation, Whiteboard, and Timetable as complete, importable, collaborative, AI-native products

- [ ] Implemented
- [ ] Verified

### M-16 Complete implementation review across every plan and close every implementation checkbox before verification

- [ ] Implemented
- [ ] Verified

### M-17 Run code, integration, permission, migration, performance, accessibility, and cross-feature verification including all required combinations

- [ ] Implemented
- [ ] Verified

### M-18 Perform one-by-one Chrome screenshot comparison and iterative repair against all 21 reference images

- [ ] Implemented
- [ ] Verified

### M-19 Prove no offline editing, no hidden obsolete paths, no private analytics leakage, no stale working effects, no silent same-region overwrite, and no unverified controls

- [ ] Implemented
- [ ] Verified

### M-20 Complete the persistent goal only after every plan checkbox and defect ledger item is closed

- [ ] Implemented
- [ ] Verified
