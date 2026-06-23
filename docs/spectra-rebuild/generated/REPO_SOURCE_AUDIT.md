# Repo Source Audit

Generated during Phase -1 analysis on 2026-06-17. This is historical and planning evidence only. Product source of truth remains `docs/spectra-rebuild/`.

## Executive Summary

The repo is a Next.js 16 / React 19 app with Convex, Clerk, OpenRouter, Tailwind, Radix primitives, TipTap, AI SDK packages, and many prior Spectra systems layered together. The current product has working shell/theme/auth/bootstrap pieces, but `/workspace`, `/artifacts`, and `/chat` are not yet built around the new shared primitives from the rebuild docs.

The most important current-state mismatch:

- `/chat` is a full chat surface backed by `src/lib/orchestrator/pipeline.ts`.
- `/workspace` is a wrapper over the old `src/components/workspace-v2` canvas and uses `workstreams`, `workspaceItems`, `workspaceCommandResults`, widgets, and a quick-chat-like AI path.
- `/artifacts` is still note/editor-first and opens `ArtifactAiSurface` as a right AI side panel.
- Convex schema already has many useful concepts, but the canonical new entities are split across old table names and semantics.
- Old root markdown contains useful lessons but conflicts with the new rebuild direction and should not keep steering implementation.

## Stack and Scripts

`package.json`:

- `npm run dev` -> `next dev`
- `npm run build` -> `next build`
- `npm run lint` -> `eslint . --max-warnings=0`
- `npm run test:run` -> `vitest run`
- `npm run convex:dev` -> `convex dev`

Key dependencies:

- Next.js, React, TypeScript, Tailwind 4
- Convex and Clerk
- OpenRouter provider, AI SDK packages
- TipTap editor
- Radix UI, lucide-react, framer-motion
- React Flow / xyflow, zod, vitest

## App Shell and Theme

Keep/adapt:

- [src/app/layout.tsx](<local-workspace> defines ClerkProvider, global providers, fonts, metadata, and deployment consistency check.
- [src/components/providers.tsx](<local-workspace> wires ThemeProvider, SidebarProvider, PanelProvider, command palette, settings drawer, cookie consent, toasts, and global error boundary.
- [src/components/layout/app-shell.tsx](<local-workspace> provides the main shell and uses `ChatSidebar`.
- [src/components/chat/chat-sidebar.tsx](<local-workspace> carries much of the current product feel: Spectra nav, chat history, settings, role-aware admin links, theme toggle, utility dock.
- [src/app/globals.css](<local-workspace> has the current Spectra tokens, light/dark palettes, brand colors, radii, motion tokens, and mode colors.

Risks:

- AppShell includes many old tour entries and admin/model/agent navigation. Wave 0 should hide admin/analytics/agents from active primary flow unless Pablo explicitly wants them visible.
- Current CSS leans on large radii in places. Rebuild UI should respect theme without copying every old surface shape.

## Current Routes

Active user routes include:

- `/chat`
- `/workspace`
- `/artifacts`
- `/agents`
- `/models`
- `/analytics`
- `/admin`, `/admin/school/*`, `/super-admin/*`
- feature pages such as flashcards, images, notes, bookmarks, achievements, ManageBac

Wave 0 active route goal:

- Keep `/chat` loadable.
- Replace `/workspace` active surface with a new shell, not `WorkspaceV2`.
- Replace `/artifacts` active surface with an artifact library/inbox shell, not the current editor-first page.
- Hide or de-emphasize admin/analytics/agents in active navigation for v1 rebuild.

## Current Workspace System

Primary entry:

- [src/app/workspace/page.tsx](<local-workspace> wraps `WorkspaceV2`, hydrates legacy preferences, closes global panel, shows loading/live indicators, and includes a manual back button.

Old implementation:

- `src/components/workspace-v2/*`
- `src/components/workspace/*`
- [src/hooks/use-workspace-data.ts](<local-workspace>
- [src/app/api/workspace-data/route.ts](<local-workspace>
- `convex/workstreams.ts`
- `convex/workspaceItems.ts`
- `convex/workspaceCommandResults.ts`
- `convex/workspaceWidgets.ts`
- `convex/workspaceItemSync.ts`
- `convex/workspaceOrchestration.ts`
- `convex/workspaceHelpers.ts`

Observed behavior and structure:

- Current workspace is built around `workstreams`, not the rebuild `Workspace` primitive.
- `WorkspaceV2` contains demo data fallback, canvas/world layout, widgets, command bar, minimap, zoom controls, threads, artifacts, result islands, and topic/timeline calculations in a large client component.
- `useWorkspaceData` fetches `/api/workspace-data`, maps `workspaceCommandResults` to result-card-like data, and bridges backend shapes to old frontend types.
- `/api/workspace-data` is a mega route handling fetches plus many command mutations: create/update/reopen/dismiss result, quick action, search, create note, create artifact, create planner item, widget actions, and preference/view changes.
- Convex `workspaceItems` mixes source projection, layout, search, topic signals, planner/chat/artifact joins, and legacy workspace-facing type mapping.

Keep as evidence/inspiration:

- Workspace result card behavior concepts.
- Event invalidation via `workspace-content-mutated`.
- Some canonical artifact type mapping in `src/lib/artifact-types.ts`.
- Some zoom math and workspace theme utilities for later canvas wave.

Do not preserve as foundation:

- `WorkspaceV2` monolith.
- `/api/workspace-data` mega route.
- `workstream` terminology as primary product primitive.
- `workspaceCommandResults` as new ResultCard primitive.
- `workspaceWidgets` as the new core surface.

## Current Artifacts System

Primary entry:

- [src/app/artifacts/page.tsx](<local-workspace>

Current behavior:

- `/artifacts` is a two/three-pane editor UI: left list, center TipTap editor, right `ArtifactAiSurface`.
- It uses `useNotesData`, which wraps `useArtifactData`, preserving old note naming.
- It auto-selects the first note/artifact via query params.
- It treats artifacts largely as rich text documents, even though `ARTIFACT_TYPES` includes many old types.

Backend/API:

- [src/app/api/artifacts/route.ts](<local-workspace> provides list/get/stats/search/hub/version/create/update/archive/restore/delete/pin/restoreVersion/applyAiEdit.
- `convex/artifacts.ts` includes migration from legacy `notes`, version creation, owner/workstream validation, list/search/get, and artifact mutation/version helpers.
- `convex/schema.ts` has both `notes` and `artifacts`, plus `artifactVersions`.

Keep/adapt:

- Version history and AI edit infrastructure.
- Artifact list/search/get/update/archive route behavior as reference.
- TipTap editor primitives for the `document` blueprint later.
- `artifactVersions` idea.

Disconnect/rewrite:

- `/artifacts` as editor-first page.
- `ArtifactAiSurface` as default right sidebar behavior.
- `notes` dual-read/dual-write as an active mental model.
- Old 16-type artifact taxonomy as v1 core.

## Current Chat and AI Pipeline

Primary entry:

- [src/app/chat/page.tsx](<local-workspace> requires actor and renders `ChatLayout`.
- [src/app/api/chat/route.ts](<local-workspace> calls `runChatPipeline` from `src/lib/orchestrator/pipeline.ts`.
- [src/components/chat/chat-layout.tsx](<local-workspace> is full-featured: composer, header, messages, model selector, mode selector, route trace panel, artifact saving, slash commands, guided tour.
- [src/hooks/use-chat-state.ts](<local-workspace> is a large client state hook for chats, streams, attachments, modes, model selection, resources, citations, route trace, clarification, and notifications.
- [src/hooks/use-chat-panel.ts](<local-workspace> is a lightweight panel chat hook used by artifact/workspace side surfaces.

AI/runtime code:

- `src/lib/orchestrator/pipeline.ts` is very large and handles request classification, routing, retrieval, memory, search, tools, multi-agent collaboration, artifact generation, workspace sync, post-processing, and streaming.
- `src/lib/orchestrator/runtime-contract.ts`, `src/lib/chat/streaming.ts`, and `src/lib/chat/message-state.ts` hold stream/event/message mechanics.
- `src/lib/routing/phase-router.ts`, `src/lib/routing/heuristic.ts`, `src/lib/model-config.ts`, `src/lib/model-anchor.ts`, `src/lib/model-broker.ts`, and `src/lib/model-selection.ts` implement complex routing.
- `src/lib/orchestrator/tool-definitions.ts` and `tool-executor.ts` define old AI tools.

Keep/adapt:

- Normal chat UI primitives and message rendering where practical.
- Markdown renderer, source/citation display, stop/regenerate/copy behavior.
- Stream parser and accumulator ideas.
- OpenRouter wrapper and usage tracking code as references.

Wave 0 should freeze/reduce:

- Complex routing.
- Multi-agent orchestration.
- Tool zoo.
- Decorative trace/thinking UI.
- Old artifact auto-save policy.

## Convex Schema Audit

`convex/schema.ts` is large and contains:

- org/user/auth/admin data
- resources/chunks/RAG
- agents and agent model stats
- workspaceItems, workspaceTopicClusters, ghostSuggestions, ghostRegenerationState, workspaceMutations, workspaceCommandResults, workspaceWidgets, workstreams, workstreamMemory
- plannerItems
- notes
- chats/messages
- usage, artifacts/artifactVersions, memory, analytics, notifications, flashcards, quizzes, SOUL, images, feedback, audit, model catalog, invitations, access requests, errors

Current tables roughly mapping to new primitives:

- `workstreams` -> old Workspace-like concept, but rename/rewrite to `workspaces` is preferred.
- `artifacts` -> closest to new Artifact, but type/content/status/provenance fields need rewrite around blueprint.
- `workspaceItems` -> closest to new WorkspaceItem, but carries too much legacy display/category/source state.
- `chats` -> closest to Thread, but is chat/page-specific and should become or feed `threads`.
- `messages` -> close to Message, but keyed to old `chatId`.
- `workspaceCommandResults` -> closest to ResultCard, but workstream-specific and too narrow.
- `workspaceMutations` -> closest to Operation log, but currently workspace-specific and mutation-history oriented.
- no first-class `aiRuns` table found.
- no first-class `operations` table found.
- no first-class `blueprints` table needed for v1 if built-ins are code-defined.
- no `focusSpaces` table found.

Wave 0 schema direction:

- Add or rewrite core tables to match `Workspace`, `Artifact`, `WorkspaceItem`, `Thread`, `Message`, `AIRun`, `Operation`, `ResultCard`, and optionally `FocusSpace`.
- Keep `orgs`, `users`, auth bootstrap, and minimal preferences.
- Preserve resources/chunks if not blocking, but avoid making RAG part of Wave 0 behavior.
- Prefer clean local data reset over migration if Pablo approves.

## Root Markdown Files Read as Historical Evidence

Root markdown files inspected:

- `README.md`
- `SPEC.md`
- `SKILL.md`
- `report.md`
- `AI_INTEGRATION_FULL_SYSTEM_AUDIT.md`
- `CURRENT_SYSTEM_AUDIT.md`
- `CLARIFICATION_SYSTEM_AUDIT.md`
- `WORKSPACE_AI_AUDIT.md`
- `spectra-redesign-context.md`
- `spectra-workspace-redesign-agent-execution-spec.md`
- `spectra_workspace_deep_gap_spec_expanded_agent_hardening.md`

Status:

- Useful as historical evidence.
- Not authoritative for the rebuild.
- Most conflict with the new school-first, admin-light, cards/panes-default direction.
- Implementation wave after approval should delete or archive almost all of them after extraction.

## Existing Tests

There are many Vitest tests under `src/lib/__tests__`, mostly for old orchestration, routing, resources, artifacts, flashcards, quizzes, slash commands, routes, memory, and ManageBac.

Useful test ideas to preserve:

- route/API integration testing patterns
- artifact route tests
- streaming/tool loop tests as reference only
- resource processing tests
- flashcard and quiz parser/format tests
- timezone and spending tests

New tests needed:

- legacy import ban for new Spectra modules
- blueprint validation
- operation validation
- AIRun lifecycle
- ResultCard hide/unhide
- chat-created artifact placement policy
- workspace-created artifact placement policy
- workspace item projection is a reference, not content ownership

