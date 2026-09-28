# Obsolete-system deletion and migration map

## Execution rule

This is Phase 1, before replacement construction. First capture reversible data exports and dependency baselines; then remove product runtime code. Do not preserve compatibility routes, wrappers, schema aliases, hidden navigation, renamed legacy modules, or “temporary” fake services. Generated Convex files are regenerated after exports disappear; they are not hand-edited.

Plan lock precedes Phase 1: remove all retired artifact-plan/type references and register `artifacts/10_SHEETS.md` as the complete structured-data, calculation, analysis, and graphing product. No compatibility type key, registry entry, route, checklist, UI promise, or migration wrapper survives.

The failure ledger records: failure ID, deleted symbol/file, importer/test, expected replacement plan/task, owner, phase, and disposition. A red build is acceptable temporarily; an unowned failure is not.

## Pre-removal evidence and data disposition

| Domain            | Export before delete                                                                                  | Do not migrate as truth                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| memory            | active userMemory/userMemoryEntries, status/source/scope timestamps, user preference consent          | model summaries, embeddings, duplicate/inferred claims without provenance                     |
| org/personal soul | source documents only if user/school owns and explicitly wants export                                 | chunks/capsules as new memory                                                                 |
| ManageBac         | integration owner, non-secret capability/config metadata, user overlays, source IDs/hashes/timestamps | encrypted token ciphertext, guessed endpoint availability, copied source payload as artifacts |
| admin             | active organizations, users, invitations, branding, verified domains, policy-relevant settings        | old role assumptions, analytics snapshots, demo seeds                                         |
| superadmin        | organization lifecycle/limits and auditable operator actions worth retaining                          | hard-coded operator identity, platform aggregate caches                                       |
| agents            | encrypted rollback export of definitions, resource references, collaborators, and ownership only      | old prompts, visibility/accessLevel, mode/model heuristics, analytics, routes, or published state as new truth |
| chat modes        | no product-data migration; retain only ordinary conversation content that can render without a mode    | old mode labels/settings, prompts, parsers, reveal components, routes, or analytics            |

Exports are encrypted, access-controlled, hash-manifested, time-limited, and tested for restore into offline migration tooling. Secrets are revoked and never included.

## Memory deletion map

### Routes and UI

- Delete src/app/api/memory/route.ts and src/app/api/personal-soul/route.ts.
- Remove memory/personalization UI and calls from src/context/sidebar-context.tsx, src/hooks/use-chat-state.ts, src/components/chat/chat-composer.tsx, chat-sidebar.tsx, unified-panel.tsx, route-trace-drawer.tsx, chat-message.tsx, chat-layout.tsx, src/components/command-palette.tsx, src/components/layout/app-shell.tsx, src/app/page.tsx, src/app/models/page.tsx, and settings/onboarding paths discovered by import tracing.
- Delete old org-soul pages src/app/admin/soul/page.tsx and src/app/admin/school/soul/page.tsx with the admin domain.

### Backend, runtime, schema, and jobs

- Delete convex/memory.ts, convex/personalSoul.ts, and convex/soul.ts; remove their public/internal API references.
- Remove userMemory and userMemoryEntries tables including vector indexes; remove userSoulPreferences; remove orgSoulDocs and orgSoulChunks plus storage/vector references.
- Remove memory/soul cron entries from convex/crons.ts and constants/config from convex/constants.ts and convex/env.ts.
- Remove memory injection/write/read/extraction from src/lib/orchestrator/post-process.ts, pipeline.ts, runtime-context.ts, retrieval.ts, tool-definitions.ts, and tool-executor.ts. Preserve unrelated citation/retrieval functions only after splitting them into memory-free modules.
- Remove old context-builder references from src/features/spectra/ai/context-builder.ts if any remain; the active run must not call legacy memory through an indirect orchestrator import.
- Remove memory/soul cleanup calls from convex/users.ts, userLifecycle.ts, notifications.ts, notes.ts, artifacts.ts, plannerItems.ts, accessRequests.ts, feedback.ts, auditLog.ts, and API bootstrap/join/invitation/artifact/note/planner routes where dependency tracing confirms them.

### Tests and docs

- Delete or replace src/lib/**tests**/memory-compaction.test.ts, post-process-memory-routing.test.ts, post-process-free-tier-memory.test.ts and memory-specific cases in retrieval.test.ts, retrieval-search-tier.test.ts, runtime-contract.test.ts, routing tests, auto-settings.test.ts, api-routes.integration.test.ts, notes-route.integration.test.ts, artifacts-route.integration.test.ts, editor tests, and scenario evals.
- Remove obsolete memory/soul claims from root README/old audits, docs/spectra-rebuild/00_AGENT_KICKOFF_PROMPT.md, 01_PRODUCT_DECISIONS.md, 05_REBUILD_EXECUTION_PLAN.md, 06_DELETION_AND_MIGRATION_POLICY.md, SPECTRA_PRODUCT_SOURCE_OF_TRUTH.md, SPECTRA_LIVE_ACCEPTANCE_PLAN.md, SPECTRA_AGENT_HARNESS_DESIGN.md, Wave plans, and generated audits. Preserve historical files only under a clearly labeled archive that is excluded from source-of-truth search.

## ManageBac deletion map

### Routes, pages, utilities

- Delete src/app/managebac/page.tsx, src/app/api/managebac/route.ts, and src/app/api/admin/managebac/route.ts.
- Delete src/lib/managebac.ts; src/lib/managebac/client.ts, mapper.ts, normalizer.ts, sync.ts, admin-config.ts; shared/managebac-crypto.ts.
- Remove navigation, command palette, sidebar, onboarding, chat/retrieval, bootstrap, artifacts, planner, analytics, and page references found in app-shell.tsx, sidebar-context.tsx, command-palette.tsx, old chat components, src/app/page.tsx, src/app/analytics/page.tsx, src/app/api/bootstrap/route.ts, api/artifacts, api/notes, api/planner, and legacy orchestrator retrieval/tool files.

### Backend, schema, env, jobs

- Delete convex/managebacSync.ts and remove scheduled sync calls from convex/crons.ts.
- Remove orgs.managebacConfig in full: encryptedToken, baseUrl, enabled, studentMappings, sync fields, discovery/capability fields.
- Drop managebacUserLinks and all indexes.
- Remove managebac_sync source-type variants and managebacItemId fields from artifacts, plannerItems, notes/other legacy tables; remove cleanup and hydration logic from users.ts, userLifecycle.ts, plannerItems.ts, artifacts.ts, notes.ts, notifications.ts, auditLog.ts, accessRequests.ts, constants.ts.
- Remove MANAGEBAC_API_TOKEN and MANAGEBAC_BASE_URL from .env.example and runtime validators during the deletion phase. If an undeclared MANAGEBAC_ENCRYPTION_KEY exists in deployments, revoke/remove it too. The replacement later declares restricted authenticated server-secret encryption/key configuration and approved development credential injection, not the old env contract or a mandatory external vault.
- Regenerate convex/\_generated/api.d.ts and data model types after removals.

### Tests and docs

- Delete src/lib/**tests**/managebac-crypto.test.ts, managebac-mapper.test.ts, managebac-normalizer.test.ts and ManageBac cases in retrieval, API integration, routing, runtime-context, scenario, artifacts/planner tests and scripts/live-route-validation.ts.
- Remove old endpoint and sync claims from all product/Wave/live-acceptance/generated documents enumerated in the memory section. The new 04 plan becomes canonical only after review.

## Admin deletion map

### Pages and routes

- Delete src/app/admin/page.tsx, admin/branding/page.tsx, admin/soul/page.tsx, admin/school/page.tsx, admin/school/analytics/page.tsx, admin/school/branding/page.tsx, admin/school/members/page.tsx, admin/school/soul/page.tsx.
- Delete src/app/api/admin/branding, managebac, seed-demo, settings, soul, switch-org, users routes.
- Delete src/app/api/school-admin/analytics, dashboard, members, notifications routes.
- Delete obsolete admin-specific onboarding src/components/onboarding/admin-onboarding.tsx and remove admin destinations/actions from app shell, command palette, root/onboarding/join/request-access flows. Preserve generic form/table primitives only after confirming they import no legacy service.

### Backend and schema dependencies

- Delete convex/admin.ts and convex/schoolAdmin.ts.
- Remove old admin permission helpers/role comparisons from convex/shared.ts, accessControl.ts, helpers.ts, users.ts, userLifecycle.ts, accessRequests.ts, invitations flows, feedback.ts, notifications.ts, auditLog.ts, usage.ts, resources.ts, agents.ts, and API auth helpers. Do not remove generic identity/org records needed for export; detach them until replacement tenancy exists.
- Remove or export/drop schoolInvitations, admin notification variants, studentAnalytics, branding/settings fields, legacy access requests, demo seed state, and any admin-only materialized aggregates identified by schema use. Generic feedback/audit/usage data may be exported, but old functions and permission semantics are deleted.
- Remove admin route expectations from middleware/navigation and Clerk bootstrap/webhook logic. School role must no longer live as users.role in the final schema.

### Tests and docs

- Delete/replace school-access-state-machine.test.ts, invitations.test.ts and admin cases in api-routes.integration, auth/access, bootstrap/join, analytics, notification, feedback, user lifecycle, and route tests.
- Remove old admin UI/permission claims from live acceptance, product source, Wave plans, root docs, generated audits, and the old UI documentation. Preserve only clearly historical evidence.

## Superadmin deletion map

### Pages and routes

- Delete src/app/super-admin/page.tsx, feedback/page.tsx, schools/page.tsx, schools/new/page.tsx, schools/[id]/page.tsx.
- Delete every src/app/api/super-admin route: admins, audit-logs, errors, feedback, notifications, org-members, stats, storage, schools, schools/[id], schools/[id]/soul, schools/[id]/usage.
- Remove superadmin navigation, switch-school cookie actions, and client role checks from app shell, sidebar/context, command palette, root/admin pages, and onboarding.

### Auth, backend, schema, env

- Delete convex/superAdmin.ts and convex/platformStatsAggregates.ts; remove imports/calls from users, userLifecycle, chats/messages, usage, seed, org deletion, crons, and aggregation jobs.
- Remove the hard-coded SUPER_ADMIN_EMAIL and isSuperAdminEmail/isAdminLikeActor bootstrap semantics from src/lib/auth-server.ts. Remove implicit local-demo admin and admin-role promotion where tied to this path. Preserve requireActor only by rewriting it in Phase 2; do not leave requireSuperAdmin as a wrapper around old logic.
- Remove org-switch cookie authorization from src/app/api/admin/switch-org/route.ts with that route. Remove any assumption that platform operator is a member/admin of the target org.
- Drop platformStats and obsolete aggregate/source cache tables after export; remove superadmin notification/error/admin-list schema variants that have no non-legacy consumer.
- Replace .env.example comment “single platform superadmin fixed in code” with no placeholder during Phase 1. Phase 2 introduces required SUPER_ADMIN_EMAILS parsing, normalization, empty-list production failure, and tests.

### Tests and docs

- Remove superadmin cases from auth, API integration, access-state, invitation, usage/storage, feedback, audit, and school lifecycle tests. Add failures to the replacement ledger rather than weakening expectations.
- Remove old fixed-email, org-switch, reset-platform-data, and dashboard claims across docs and generated Convex API types.

## Legacy agent deletion map

Delete the entire pre-rebuild agent implementation before constructing the new Agent artifact:

- Delete `src/app/agents/**`, `src/app/api/agents/**`, `src/components/agents/**`, `convex/agents.ts`, legacy agent-matching/model-feedback utilities/tests, and old agent navigation/onboarding/catalog/editor surfaces.
- Remove `agents` and `agentModelStats` tables and old agent fields/indexes from chats, resources/chunks, artifacts, workspaces, usage, analytics, and user-lifecycle cascades. Old resource ownership/bindings are exported for rollback but do not remain as compatibility fields.
- Remove selected-agent state, manual agent chips/pickers, old auto-matching, old agent prompt injection, old agent-specific retrieval scopes, model/mode preferences, usage increments, and collaborator semantics from the legacy chat/orchestrator.
- Remove old agent API expectations, fixtures, generated API types, seeds, and docs. Do not map the old implementation behind the new reference UI.
- Later phases build the universal Agent artifact, immutable versions, resource bindings, skills/tools/evals, sharing, and automatic routing from the new plans and new schema namespaces. An optional future user-controlled importer may inspect the encrypted rollback export, but no automatic migration or runtime adapter is allowed.

## Obsolete chat-mode deletion map

Delete the full legacy study-mode system while retaining ordinary conversation and the new artifact blueprints:

- Delete `src/lib/modes.ts`, `src/lib/contracts/studyModes.ts`, `src/components/chat/chat-mode-selector.tsx`, mode analytics components, mode-specific prompt/config registries, and mode selection/suggestion UI.
- Remove the old taxonomy (`auto`, `tutor`, `marker`, `exam`, `draft_coach`, `quiz`, `flashcard`, `research`, `explain`, `document`, `general`, `image`, and aliases) from shared validators/types, chat/message schema, API request/response contracts, preferences, URL params, routing/classification, model selection, telemetry, tests, and seed data.
- Delete old mode-specific generation/render paths such as quiz reveal/parser/view, flashcard chat generation, image chat route/reveal/gallery coupling, research-mode subagent/tool orchestration, and document-mode special cases. Preserve only independently justified generic tools/assets that the new adaptive runtime or first-class artifacts later adopt through new contracts.
- General conversation becomes the only chat baseline. Research is an adaptive retrieval/tool operation; image creation is an operation/resource; Quiz and Flashcard Deck are first-class artifacts. None is a chat mode.
- Remove old mode query parameters, badges, persistence, progress strings, and analytics breakdowns. Historical messages must render without requiring a mode value; migration strips or archives the old label without changing message content.

## Cross-cutting integration audit

Run repository searches for: managebac, userMemory, memoryEntries, personalSoul, userSoul, orgSoul, schoolAdmin, superAdmin, SUPER_ADMIN, isAdminLikeActor, managebac_sync, managebacItemId, platformStats, legacy agents/agentModelStats/agent matching, StudyMode/vStudyMode/MODE_REGISTRY/chat mode selector, every retired mode literal/route/component, and every removed Convex API symbol. Search source, scripts, tests, docs, environment files, lock/config files, generated types, CI, seed data, fixtures, and deployment configuration. Zero runtime hits is the gate; historical archive references must carry a non-authoritative banner.

Inspect these indirect integration zones even if string search is clean: auth/session actor shape; schema validators/unions; cascade deletion; cron registration; notification kinds; audit action unions; usage aggregation; route navigation; command palette; onboarding; Clerk webhook; seed/demo; model prompts/tool descriptions; import restrictions; live acceptance scripts; environment deployment secrets.

## Replacement gates

Phase 2 begins only after deleted runtime symbols have zero imports and every failure is mapped. The new domains use new schema/function namespaces and are built to plans 03–05. Offline migration scripts may read exports; product runtime may not. Delete migration readers after signed migration completion and retention window.

Replacement identity must not reintroduce old users.role semantics as an ordinary capability gate. It supports at most one active school membership and separate operational superadmin sessions. Replacement secrets use pragmatic restricted server-side encryption and no old ManageBac env/token wrapper. Replacement analytics/metering may migrate safe aggregates but never old private-content access assumptions or cohort suppression.

## Deletion tasks

### DEL-00 Remove retired artifact-plan/type references and register Sheets as the structured-data, calculation, analysis, and graphing product

- [ ] Implemented
- [ ] Verified

### DEL-01 Capture encrypted exports, hashes, schema counts, active import graph, and rollback rehearsal

- [x] Implemented
- [ ] Verified

### DEL-02 Delete old memory/personal-soul/org-soul UI, APIs, backend, schema, jobs, utilities, tests, and docs

- [ ] Implemented
- [ ] Verified

### DEL-03 Delete old ManageBac UI, APIs, backend, fields, cron, env, utilities, tests, and docs

- [ ] Implemented
- [ ] Verified

### DEL-04 Delete old admin UI, APIs, backend, permission rules, schema, tests, and docs

- [ ] Implemented
- [ ] Verified

### DEL-05 Delete old superadmin UI, APIs, backend, aggregates, fixed identity, tests, and docs

- [ ] Implemented
- [ ] Verified

### DEL-06 Delete the entire legacy agent UI, APIs, backend, schema, resources/collaboration/routing coupling, tests, seeds, and docs

- [ ] Implemented
- [ ] Verified

### DEL-07 Delete the complete obsolete chat-mode taxonomy, selector, persistence, prompts, renderers, routes, analytics, tests, and mode-specific runtime branches without deleting the new Quiz/Flashcard artifact blueprints

- [ ] Implemented
- [ ] Verified

### DEL-08 Regenerate Convex/API types and create the complete compile/schema/test/runtime failure ledger

- [ ] Implemented
- [ ] Verified

### DEL-09 Prove zero runtime imports, routes, cron jobs, schema aliases, env dependencies, navigation entries, old agent symbols, and chat-mode branches

- [ ] Implemented
- [ ] Verified

### DEL-10 Resolve each failure only through its planned replacement; reject stubs and compatibility wrappers

- [ ] Implemented
- [ ] Verified

### DEL-11 Migrate validated identity/overlay/source records and mode-free historical conversations; reconcile counts/hashes

- [ ] Implemented
- [ ] Verified

### DEL-12 Revoke secrets, expire exports/readers, remove migration tooling, and sign deletion completion

- [ ] Implemented
- [ ] Verified
