# Wave 0 Implementation Plan

Generated during Phase -1 analysis on 2026-06-17. Do not implement until Pablo approves.

## Goal

Foundation reset only. Wave 0 should create the new Spectra skeleton, disconnect active legacy workspace/artifact paths, introduce shared primitive scaffolding, and leave the app buildable and testable.

Wave 0 is not the full rebuild. It should be small enough to review in one pass.

## Non-Goals

Do not build:

- real model execution for workspace/artifacts
- full chat rebuild
- canvas
- semantic zoom
- multi-agent orchestration
- complex router
- ManageBac flows
- admin analytics
- custom blueprint builder
- full artifact editors
- full RAG/resources repair

## Entry Criteria

Before Wave 0 starts:

- Pablo approves deletion/disconnection strategy.
- Pablo confirms root markdown cleanup preference: delete vs archive to `docs/legacy-extracted/`.
- Decide whether local Convex data can be reset.
- Decide fixed model id/env name for rebuild AI path.

Default assumptions if approved:

- Use clean rebuild over migration.
- Keep Convex.
- Keep shell/theme/auth bootstrap.
- Hide admin/analytics/agents from primary nav for v1.
- Use built-in code-defined blueprints only.

## Work Packages

### W0-1: Create New Spectra Namespace

Add:

```txt
src/features/spectra/
  core/
  blueprints/
  operations/
  ai/
  components/
  pages/
```

Deliverables:

- shared TypeScript primitive types
- status/source enums
- no imports from old workspace/artifact/orchestrator modules

Validation:

- typecheck compiles with new namespace
- legacy import ban covers this folder

### W0-2: Core Types

Create shared types for:

- `Workspace`
- `Artifact`
- `ArtifactBlueprint`
- `WorkspaceItem`
- `Thread`
- `Message`
- `AIRun`
- `Operation`
- `ResultCard`
- optional `FocusSpace`

Deliverables:

- `src/features/spectra/core/types.ts`
- `src/features/spectra/core/status.ts`

Validation:

- types are exported from one index
- no old `workstream` naming in public new types except migration comments if needed

### W0-3: Blueprint Registry Scaffold

Create built-in blueprints:

- `document`
- `thread_reference`
- `flashcard_deck`
- `quiz`
- `planner_task`

Deliverables:

- registry lookup by key
- default content shape
- allowed operation names
- simple validation placeholder using zod or existing structured validators

Validation:

- tests prove all five blueprints exist
- unknown blueprint key fails clearly
- generated flashcard deck is one artifact conceptually

### W0-4: Convex Schema/Core Tables

Revise or add schema tables for:

- `workspaces`
- `artifacts`
- `workspaceItems`
- `threads`
- `messages`
- `aiRuns`
- `operations`
- `resultCards`
- optional `focusSpaces`

Keep:

- `users`, `orgs`, auth-related basics
- `userPreferences` as needed
- resources only if not blocking build

Decision point:

- If clean schema rewrite is too large for Wave 0, create additive `spectra*` tables first and plan old table deletion for Wave 1.
- Preferred direction is clean direct table names if local data reset is approved.

Validation:

- Convex schema compiles.
- Basic seed/demo records can be added later.
- No new schema depends on old `workspaceCommandResults`.

### W0-5: Operation Schema and Validator Scaffold

Create operation schema for allowed Wave 0 operation names:

- `artifact.create`
- `artifact.update`
- `workspaceItem.add`
- `workspaceItem.hide`
- `thread.create`
- `resultCard.create`
- `resultCard.update`
- `plannerTask.create`
- `quiz.create`
- `flashcardDeck.create`

Deliverables:

- operation input validation
- confirmation policy helper
- object explosion policy helper
- executor stub that records "not implemented" or no-op result safely

Validation:

- unit tests for safe direct creation vs confirmation-required actions
- bulk object creation requires confirmation
- delete requires confirmation

### W0-6: AIRun Lifecycle Stub

Create basic lifecycle functions:

- create queued run
- mark running
- complete with summary
- fail with error
- cancel
- create/update associated result card

No real model call required.

Deliverables:

- Convex mutations or server functions for lifecycle
- TypeScript helper in `src/features/spectra/ai/run-lifecycle.ts`
- status transitions are explicit

Validation:

- tests for valid lifecycle transitions
- failed run can produce failed result card
- every workspace/artifact command stub creates an `AIRun`

### W0-7: Fixed Model Config

Create rebuild-specific model config:

```txt
src/features/spectra/ai/model-config.ts
```

Rules:

- one fixed OpenRouter model id
- optional env override
- no old router import
- no exploration, diversity, phase router, or multi-agent behavior

Suggested default:

- `SPECTRA_MODEL_ID`
- fallback to a strong DeepSeek model through OpenRouter, final id to be confirmed before implementation

Validation:

- no imports from `src/lib/routing/**`
- config can be read in tests

### W0-8: New `/workspace` Shell

Replace active `/workspace` route with a new shell using AppShell and new components.

Shell content:

- workspace header
- cards/panes area placeholder
- sample empty state or static demo cards from new primitive shapes
- bottom command bar scaffold
- result card stack placeholder above command bar
- right run/thread hub placeholder
- no canvas
- no WorkspaceV2 import

Design requirements:

- use existing theme tokens
- no in-app explanatory paragraphs about how the app works
- cards/panes default, dense and useful
- no decorative hero/dashboard layout

Validation:

- route loads
- old WorkspaceV2 UI absent
- command bar and result-card stack positions are visible
- responsive enough for desktop and reasonable narrow widths

### W0-9: New `/artifacts` Library Shell

Replace active `/artifacts` route with a new library/inbox shell.

Shell content:

- artifact library header
- search/filter row
- type filters for five blueprints
- unplaced/in workspace grouping placeholder
- artifact cards using new `ArtifactCard`
- Add to workspace action placeholder
- no default editor pane
- no ArtifactAiSurface import

Validation:

- route loads
- old note editor absent
- old artifact AI right sidebar absent
- library/inbox mental model is clear

### W0-10: Keep `/chat` Stable

Do not rebuild chat yet.

Possible Wave 0 edits only:

- ensure sidebar/nav points to new `/workspace` and `/artifacts`
- avoid breaking current `/chat`
- optionally add a future TODO boundary around old pipeline

Validation:

- `/chat` still loads
- existing chat page does not block Wave 0 build

### W0-11: Navigation Cleanup

Update primary sidebar for v1 rebuild:

Primary:

- Chat
- Workspace
- Artifacts

Hide/deprioritize:

- Agents
- Models
- Analytics
- Admin
- Super Admin
- ManageBac

Implementation option:

- Keep role-only secondary links behind a "More" or settings path if needed.
- For Wave 0, simplest is remove from primary nav array while leaving routes available.

Validation:

- sidebar no longer steers users into deferred architecture as primary workflow

### W0-12: Legacy Import Ban

Add a test or script that fails if `src/features/spectra/**` or new route shells import forbidden old paths.

Forbidden:

- `workspace-v2`
- `components/workspace`
- `artifact-ai-surface`
- `api/workspace-data`
- `lib/orchestrator`
- `lib/routing`

Validation:

- run with `npm run test:run` or a dedicated script
- intentionally clear failure message

### W0-13: Root Markdown Cleanup

After generated docs are reviewed, delete or archive root markdown junk.

Preferred:

- delete old root markdown files listed in `OLD_CODE_TO_DELETE.md`
- rewrite `README.md` to current setup and rebuild source-of-truth pointers

Conservative:

- move old docs to `docs/legacy-extracted/`
- keep a short index saying they are non-authoritative historical evidence

Validation:

- root no longer contains old specs/audits except README
- `docs/spectra-rebuild/**` remains intact

## Suggested Implementation Order

1. Create new namespace and types.
2. Add blueprint registry and tests.
3. Add operation schema and AIRun lifecycle stubs.
4. Add or rewrite Convex core schema tables.
5. Build new `/workspace` shell.
6. Build new `/artifacts` shell.
7. Clean sidebar navigation.
8. Add legacy import ban.
9. Run typecheck/lint/tests/build.
10. Delete/archive root markdown after docs approval.

## Wave 0 Test Checklist

Automated:

- `npm run lint`
- `npm run test:run`
- `npm run build`
- Convex schema generation/dev command as appropriate
- legacy import ban

Manual:

- start dev server
- open `/chat`
- open `/workspace`
- open `/artifacts`
- confirm `/workspace` is not WorkspaceV2
- confirm `/artifacts` is not old editor + AI sidebar
- confirm sidebar primary nav is Chat / Workspace / Artifacts
- confirm shells follow current theme and do not look like temporary broken UI

## Risks

### Schema rewrite blast radius

`convex/schema.ts` is large and many existing tests/routes depend on it. If direct rewrite makes Wave 0 too risky, use additive `spectra*` tables first and make direct rename/deletion a Wave 1 task.

### Chat breakage

Old chat is complex and tied to schema. Wave 0 should avoid changing chat data paths unless necessary.

### Old imports sneaking back

The repo has many old helpers with attractive names. The legacy import ban is required, not optional.

### UI quality regression

New shells are skeletal but must still look intentional. Do not ship ugly placeholders. Use restrained cards/panes and existing tokens.

## Approval Questions for Pablo

1. Delete old root markdown files outright, or archive them under `docs/legacy-extracted/`?
2. Is local Convex data reset acceptable for the rebuild?
3. Confirm the fixed OpenRouter model id for Wave 0 stubs and later Wave 3 chat/runtime work.
4. Should Agents/Models/Admin remain reachable from secondary nav, or hidden entirely during v1 rebuild?

## Definition of Done

Wave 0 is done when:

- new Spectra primitive namespace exists
- first blueprint registry exists
- operation/run/result scaffolding exists
- `/workspace` and `/artifacts` use new shells
- old workspace/artifact active paths are disconnected
- app builds
- legacy import ban passes
- root markdown junk is removed or archived after approval

