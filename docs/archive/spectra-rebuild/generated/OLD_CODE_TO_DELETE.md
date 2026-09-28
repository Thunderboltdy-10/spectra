# Old Code to Delete or Disconnect

Generated during Phase -1 analysis on 2026-06-17. Do not execute deletion until Pablo approves Wave 0.

## Deletion Policy

Prefer clean rebuild over adaptation. Git history is the archive. If uncertainty remains after extraction, move old docs/code to `docs/legacy-extracted/` or a clearly named legacy folder, but do not leave legacy modules importable from new Spectra modules.

Wave 0 should delete or disconnect active paths, not necessarily remove every old file immediately. The key milestone is that new `/workspace` and `/artifacts` do not import old workspace/artifact/orchestration foundations.

## Root Markdown Cleanup

Recommended after approval:

Keep:

- `README.md` only if rewritten to the new product/scripts.
- `docs/spectra-rebuild/**`
- generated docs under `docs/spectra-rebuild/generated/**`

Delete or archive:

- `AI_INTEGRATION_FULL_SYSTEM_AUDIT.md`
- `CLARIFICATION_SYSTEM_AUDIT.md`
- `CURRENT_SYSTEM_AUDIT.md`
- `SPEC.md`
- `WORKSPACE_AI_AUDIT.md`
- `SKILL.md`
- `report.md`
- `spectra-redesign-context.md`
- `spectra-workspace-redesign-agent-execution-spec.md`
- `spectra_workspace_deep_gap_spec_expanded_agent_hardening.md`

Reason:

- They are old waves/audits/specs and conflict with the new product direction.
- Their useful ideas have been extracted into generated docs.
- Leaving them at root risks future agents treating them as source of truth.

## Active Route Disconnects

### `/workspace`

Current active path:

- [src/app/workspace/page.tsx](<local-workspace> imports `@/components/workspace-v2/app`.

Wave 0 action:

- Replace active `/workspace` implementation with new rebuild shell.
- Ensure it does not import `src/components/workspace-v2/*` or old `src/components/workspace/*`.

Then delete/archive later:

- `src/components/workspace-v2/app.tsx`
- `src/components/workspace-v2/chrome.tsx`
- `src/components/workspace-v2/data.ts`
- `src/components/workspace-v2/icons.tsx`
- `src/components/workspace-v2/items.tsx`
- `src/components/workspace-v2/widgets.tsx`
- `src/components/workspace-v2/spectra-v2.css`

Likely disconnect/delete old workspace components:

- `src/components/workspace/workspace-canvas.tsx`
- `src/components/workspace/command-bar.tsx`
- `src/components/workspace/result-card.tsx`
- `src/components/workspace/threads-hub.tsx`
- `src/components/workspace/hub-surface.tsx`
- `src/components/workspace/lens-hub.tsx`
- `src/components/workspace/widget-host.tsx`
- `src/components/workspace/widget-renderers.tsx`
- `.bak` files under `src/components/workspace`

Reason:

- Old workspace is canvas-first, workstream-first, widget-heavy, and monolithic.
- New direction is cards/panes default, canvas later, shared primitives first.

### `/artifacts`

Current active path:

- [src/app/artifacts/page.tsx](<local-workspace> is editor-first and includes `ArtifactAiSurface`.

Wave 0 action:

- Replace active `/artifacts` implementation with new artifact library/inbox shell.
- Do not import old `ArtifactAiSurface` as the default page behavior.

Disconnect/delete later:

- `src/components/artifacts/artifact-ai-surface.tsx`
- `src/components/artifacts/create-artifact-dialog.tsx` if tied to old 16-type taxonomy
- `src/components/artifacts/canvas-view.tsx`
- `src/components/artifacts/graph-view.tsx`
- `src/components/artifacts/sections-view.tsx`
- `src/components/artifacts/timeline-view.tsx`

Keep/adapt carefully:

- `src/components/artifacts/artifact-card.tsx` only if it can be rewritten around blueprints.
- `src/components/artifacts/artifact-editor.tsx` only if useful for document blueprint.
- `src/components/editor/*` TipTap primitives for document blueprint.

Reason:

- `/artifacts` must be a real library/inbox, especially for unplaced chat-created artifacts.
- Current page behaves like a notes app.

## API Route Disconnects

Delete or disconnect from active new paths:

- [src/app/api/workspace-data/route.ts](<local-workspace>

Reason:

- It is a mega route combining page data, command results, quick actions, search, creation, widgets, and preferences.
- New architecture should use smaller core operations around `Workspace`, `Artifact`, `Thread`, `AIRun`, `Operation`, `ResultCard`, and `WorkspaceItem`.

Do not use as new foundation:

- old workspace quick action parsing
- `createResult`/`updateResult` as ResultCard replacement
- direct create note/artifact/planner routes through workspace-data

Possible transitional keep:

- `src/app/api/artifacts/route.ts` for reference and maybe temporary artifact list/get, but Wave 0 should plan a new blueprint-aware API/Convex layer.
- `src/app/api/chat/route.ts` can stay for `/chat`, but new Wave 0 should stub/freeze a simpler model path for rebuild surfaces.

## Convex Code to Rewrite or Retire

Rewrite around new schema:

- `convex/schema.ts` core workspace/artifact/chat/run areas
- `convex/artifacts.ts`
- `convex/workspaceItems.ts`
- `convex/chats.ts`
- `convex/messages` table usage

Disconnect/delete later:

- `convex/workspaceCommandResults.ts`
- `convex/workspaceWidgets.ts`
- `convex/workspaceOrchestration.ts`
- `convex/workspaceItemSync.ts` if not rewritten around new primitive projections
- `convex/ghosts.ts`
- `convex/workstreamAssignment.ts`
- `convex/workstreamMemory.ts`
- old `workstreams` model if replaced by `workspaces`

Keep if not blocking:

- `convex/users.ts`
- `convex/userPreferences.ts`
- `convex/resources.ts`
- `convex/rag.ts`
- `convex/usage.ts`
- `convex/models.ts` as inactive reference
- `convex/notifications.ts`
- `convex/flashcards.ts` and `convex/quizzes.ts` only if they do not conflict with blueprint artifact storage

Hide/defer:

- `convex/agents.ts`
- `convex/managebacSync.ts`
- `convex/schoolAdmin.ts`
- `convex/superAdmin.ts`
- analytics-heavy tables/functions

## AI Runtime to Freeze or Replace

Do not use as active foundation for rebuild surfaces:

- `src/lib/orchestrator/pipeline.ts`
- `src/lib/orchestrator/task-graph.ts`
- `src/lib/orchestrator/tool-definitions.ts`
- `src/lib/orchestrator/tool-executor.ts`
- `src/lib/orchestrator/skills.ts`
- `src/lib/routing/phase-router.ts`
- `src/lib/routing/heuristic.ts`
- `src/lib/model-broker.ts`
- complex dynamic router behavior

Wave 0 replacement direction:

- fixed model config module for rebuild
- operation validator scaffolding
- stub AIRun lifecycle
- no multi-agent path
- no active router exploration/diversity behavior
- no tool zoo

Keep as reference only:

- `src/lib/openrouter.ts`
- `src/lib/chat/streaming.ts`
- `src/lib/chat/message-state.ts`
- existing route/error helpers

## Navigation and Admin Deactivation

Hide or remove from primary sidebar during v1 rebuild:

- `/agents`
- `/models`
- `/analytics`
- `/admin`
- `/super-admin`
- `/managebac`

Reason:

- New product direction is school-first, admin-light.
- These pages distract from the user-facing core and depend on old architecture.

Do not necessarily delete auth/org/admin backend yet:

- Basic auth and org support may be useful later.
- Admin pages can be route-accessible or hidden behind role links later.

## Legacy Import Ban

Add a Wave 0 test or script so new rebuild modules do not import old active paths.

Suggested rule:

`src/features/spectra/**` and new route shells must not import from:

- `src/components/workspace-v2/**`
- `src/components/workspace/**`
- `src/components/artifacts/artifact-ai-surface`
- `src/app/api/workspace-data/**`
- `src/lib/orchestrator/**`
- `src/lib/routing/**`
- old workspace hooks/stores unless explicitly rewritten

Allowlist only:

- `src/components/layout/app-shell`
- `src/components/ui/**`
- theme/global providers
- `src/lib/utils`
- low-level `src/lib/openrouter` if needed
- auth/convex route helpers as needed

## Deletion Timing

Wave 0 should:

1. Create new route shells and shared primitive folders.
2. Disconnect `/workspace` and `/artifacts` from old active imports.
3. Add legacy import ban.
4. Remove root markdown junk after extraction.
5. Leave heavy backend deletion to the schema reset step only if build/test scope is controlled.

Do not delete product code before the new shells compile.

