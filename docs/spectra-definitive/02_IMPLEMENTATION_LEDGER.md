# Implementation ledger

| Phase | State | Active scope | Requirement IDs | Evidence |
|---|---|---|---|---|
| 0 | Complete | Canonical programme, compatibility, flags, inventories, baseline | All foundational | `docs/spectra-definitive/`, `src/features/spectra/migrations/`, `scripts/generate-spectra-inventory.mjs`; lint/types/build and 449 tests green |
| 1 | Complete | Architectural kernels | WORK, AI, SURFACE, SETTINGS | `work/registry`, `events`, `core/capability-truth`, `settings/schema`, `work/session`, `tools/registry`, `compute/files`, `runs/streaming`; kernel and route tests |
| 2 | Complete | Cloudflare realtime | COLLAB-001..004, 013..015, 023 | `workers/collaboration/`, `realtime/providers/`; 11 room tests, provider tests, Wrangler production dry-run |
| 3 | Complete | Native Yjs models, direct document/code bindings, local durability, concurrency policy and AI resume | COLLAB-005..022 | `work/models/yjs/`, `realtime/persistence/`, `realtime/policies/`, Tiptap/CodeMirror bindings, Cloudflare AI provider; strict types, 108 focused tests, architecture guard, Worker dry-run |
| 4 | Complete | Action Protocol V2, state/recovery, Tool Registry V2, Luna native modality, Parallel server search, verified evidence | AI-001..022 | `actions/protocol/`, `runs/state`, `runs/steering`, `tools/`, `sources/`, `compute/files/`, run-route registry/state/protocol adapters; strict types, 64 focused tests, architecture guard |
| 5 | Complete | Live Dock V2, shared conversations, required input, persistence, truthful multi-run state and safe-boundary steering | RUN-001..009, RUN-011..013 | `components/live-dock.tsx`, `runs/live-dock/`, shared `ConversationSurface`, run steering endpoint/hook, choice projection; strict types, 59 focused tests, architecture guard |
| 6 | Complete | Canonical routes, distinct Library/Workspace, persisted split-tree workbench, local route sessions, singular sidebar, Inspector V2, copy gate | SURFACE-001..017 | `workbench/`, `components/workbench-split-tree.tsx`, shared artifact studio state, canonical route pages/redirects, `components/workbench-inspector-tabs.tsx`, `check:copy`; strict types and 9 focused tests |
| 7 | Complete | Semantic anchors, Reference V2, viewport context, permission-aware index, rich content, verified sources, Comments V2 | REF-001..009, CTX-001..004, SOURCE-001..012, COMMENT-001..005 | `anchors/`, `references/`, `context/`, `rich-content/`, `sources/`, semantic comment dual-read, shared renderer; strict types, 12 Phase 7 tests and 35 focused regression tests |
| 8 | Complete | Full scoped Settings, quick drawer, Compute Broker, PDF Inspector, attachment bundles, local autocomplete, bounded Pyodide and worker builds | SETTINGS-001..011, COMPUTE-001..010 | `settings/`, `compute/broker`, `compute/pdf`, `compute/files`, `compute/autocomplete`, `compute/build`, runtime asset routes and engine scorecards; 31 focused tests, strict types, scoped lint, architecture/copy checks and production build |
| 9 | Complete | Canonical Calendar and temporal actions, flexible Plan domain, provider-neutral School adapters, accurate ManageBac synchronization, user/admin separation, class workspace materialization, truthful analytics/administration | CAL-001..008, SCHOOL-001..011, ADMIN-001..004 | `convex/calendar.ts`, `calendarShared.ts`, `calendar/`, `plan/model.ts`, `integrations/school/`, ManageBac user/admin applications, `convex/analytics.ts`, metric registry; Convex codegen, strict types, lint, architecture/copy guards, production build, 552 tests |
| 10 | Pending | Agent Foundry | AGENT, MEM | — |
| 11 | Pending | Dedicated work-type passes | WORK-* | — |
| 12 | Pending | Functional hardening | All functional IDs | — |
| 13 | Pending | Visual system | POLISH-001..003 | — |
| 14 | Pending | Motion | POLISH-004..010, COLLAB-026, RUN-010 | — |
| 15 | Pending | Landing | LANDING-001..008 | — |
| 16 | Pending | Cleanup and release gate | All IDs | — |
