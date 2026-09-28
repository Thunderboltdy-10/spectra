# New Architecture Map

Generated during Phase -1 analysis on 2026-06-17. This maps the repo to the new rebuild direction and should guide Wave 0.

## Architecture Principle

Rebuild Spectra around objects and operations, not pages.

Pages are views over shared primitives:

- `/chat`: conversation view over Thread, Message, AIRun, ResultCard, Artifact.
- `/workspace`: operational cards/panes view over Workspace, WorkspaceItem, Artifact, Thread, AIRun, ResultCard.
- `/artifacts`: library/inbox view over Artifact, Blueprint, workspace placement.

## Proposed New Source Layout

Create a new namespace so old code is not imported accidentally:

```txt
src/features/spectra/
  core/
    ids.ts
    types.ts
    status.ts
  blueprints/
    registry.ts
    document.ts
    thread-reference.ts
    flashcard-deck.ts
    quiz.ts
    planner-task.ts
  operations/
    schema.ts
    validators.ts
    executor-stub.ts
  ai/
    model-config.ts
    run-lifecycle.ts
    stream-events.ts
  components/
    artifact-card.tsx
    blueprint-renderer.tsx
    result-card.tsx
    result-card-stack.tsx
    workspace-card.tsx
    command-bar.tsx
    run-thread-hub.tsx
  pages/
    chat-shell-notes.md
    workspace-shell.tsx
    artifacts-shell.tsx
```

Potential Convex layout:

```txt
convex/spectraCore.ts
convex/spectraArtifacts.ts
convex/spectraWorkspaces.ts
convex/spectraThreads.ts
convex/spectraRuns.ts
convex/spectraOperations.ts
```

If Pablo prefers direct names, use:

```txt
convex/workspaces.ts
convex/artifacts.ts
convex/workspaceItems.ts
convex/threads.ts
convex/messages.ts
convex/aiRuns.ts
convex/operations.ts
convex/resultCards.ts
```

But avoid mixing new code with old function names unless the old file is clearly rewritten.

## Core Primitives

### Workspace

Durable subject/project area.

Fields:

- owner/user/org ids
- title, description, icon/color
- status
- defaultView: `cards | canvas | timeline | library`
- created/updated/lastActivity timestamps

Repo mapping:

- old `workstreams` is similar but should not remain the public primitive name.

### Artifact

Canonical content object.

Fields:

- owner/user/org ids
- `blueprintKey`
- title, summary
- content validated by blueprint schema
- textIndex/tags
- status
- `createdFrom` source metadata
- created/updated timestamps

Repo mapping:

- old `artifacts` table is closest but currently uses `type`, `workstreamId`, editor mode, notes migration, and old taxonomy.
- old `notes` should be retired.

### Blueprint

Code-defined artifact schema/renderer/operations for v1.

Wave 0 built-ins:

- `document`
- `thread_reference`
- `flashcard_deck`
- `quiz`
- `planner_task`

No custom blueprint builder in v1.

### WorkspaceItem

Projection/reference from a workspace to a source object.

Fields:

- workspaceId
- sourceType: `artifact | thread | task | widget | custom`
- sourceId
- viewData: title override, summary, card variant, pinned, hidden
- layout: view, position, size, zIndex, collapsed
- timestamps

Important:

- Content does not live in WorkspaceItem.
- Removing/hiding WorkspaceItem does not delete source Artifact/Thread.

Repo mapping:

- old `workspaceItems` is close but too legacy/category/layout heavy.

### Thread and Message

Thread is persistent conversation. Message belongs to thread.

Thread fields:

- owner/user/org ids
- title, summaries
- origin: `chat | workspace | artifact`
- optional workspace/artifact ids
- status, timestamps

Message fields:

- threadId
- role
- content
- optional runId
- metadata
- timestamp

Repo mapping:

- active `/chat` uses `convex/spectraThreads.ts`, `spectraThreads`, and `spectraMessages`.
- old `chats` and `messages` remain migration compatibility only; they are not the active Spectra conversation foundation.
- `ConversationSurface` renders normal chat, temporary run detail, and real thread-reference artifacts from the same message/run/operation data.

### AIRun

Every AI command creates an AIRun.

Fields:

- owner/user/org ids
- sourceSurface: `chat | workspace | artifact`
- optional thread/workspace/artifact ids
- status: `queued | running | completed | failed | cancelled`
- userPrompt
- finalSummary/error/modelUsed/sessionId
- timestamps

Not every AIRun creates a visible Thread.

### Operation

Validated action performed by user/system/AI.

Fields:

- optional runId
- actorType: `user | ai | system`
- type
- status: `proposed | executed | failed | cancelled`
- input/output
- affected objects
- requiresConfirmation
- undoData
- timestamps

Examples:

- `artifact.create`
- `artifact.update`
- `workspaceItem.add`
- `thread.create`
- `resultCard.update`
- `plannerTask.create`
- `flashcardDeck.generate`
- `quiz.grade`

### ResultCard

Compact visible representation of a run.

Fields:

- runId
- surface
- optional workspace/artifact ids
- status/variant/title/summary
- actions
- hidden/dismissed state
- timestamps

Behavior:

- stacks above command bar
- persists until hidden
- hiding does not delete
- can open thread/artifact/details
- can continue run/thread from command bar context

### FocusSpace

Deferred or optional in Wave 0. Useful later for a selected set of artifacts/threads/tasks and command context.

## Surface Contracts

### `/chat`

Wave 0:

- Keep route loading.
- Freeze complex changes.
- Do not rebuild full chat yet unless needed for core types.

Later:

- User prompt creates Thread Message -> AIRun -> assistant Message.
- Artifact created in chat goes to artifact library/inbox by default.
- Chat response shows artifact card with `Open` and `Add to workspace`.

### `/workspace`

Wave 0 shell:

- AppShell/sidebar retained.
- Route shows new workspace cards/panes scaffold.
- Command bar scaffold at bottom.
- Result card stack placeholder above command bar.
- Right run/thread hub placeholder.
- No old WorkspaceV2.
- No old canvas-first implementation.

Later:

- Created artifacts belong to current workspace by default.
- Simple commands create AIRun + ResultCard + Operations, not necessarily Thread.
- Complex commands create/continue Thread.

### `/artifacts`

Wave 0 shell:

- AppShell/sidebar retained.
- Real library/inbox scaffold.
- Type filters for first blueprint types.
- Placement status: unplaced vs in workspace.
- `Add to workspace` placeholder action.
- No editor-first layout.
- No artifact AI side panel default.

Later:

- List all artifacts.
- Search/filter/recent groups.
- Open/edit blueprint-specific artifacts.
- Chat-created artifacts show here by default.

## Data Flow: Workspace Command

Target flow:

```txt
User prompt in workspace command bar
-> create AIRun(status=queued/running)
-> create ResultCard(status=running)
-> build context from workspace/selection/thread
-> model response as structured plan
-> validate operations
-> execute safe operations or mark proposed requiring confirmation
-> update Operation rows
-> update ResultCard(done/failed)
-> optionally create/update Thread/Message
```

Wave 0 only stubs this; it does not call a model for product behavior.

## Data Flow: Artifact Creation

From chat:

```txt
AIRun from /chat
-> artifact.create Operation
-> Artifact(createdFrom.source="chat", threadId, runId)
-> no WorkspaceItem by default
-> ResultCard or chat artifact card shows Open / Add to workspace
```

From workspace:

```txt
AIRun from /workspace
-> artifact.create Operation
-> Artifact(createdFrom.source="workspace", workspaceId, runId)
-> WorkspaceItem(sourceType="artifact", sourceId=artifactId)
-> ResultCard shows Open
```

Manual artifact library creation:

```txt
User creates artifact in /artifacts
-> Artifact(createdFrom.source="manual")
-> no WorkspaceItem unless user chooses workspace
```

## Object Explosion Rules

Safe direct creation:

- result card
- operation log entry
- explicitly requested artifact
- explicitly requested thread

Confirmation required:

- new workspace
- bulk object creation
- bulk reorganizing
- delete
- sharing/publishing
- custom blueprint creation

Generated sets count as one artifact:

- 30 flashcards = one `flashcard_deck` artifact.
- quiz with many questions = one `quiz` artifact.

## Fixed Model Configuration

Wave 0 should introduce a rebuild-specific fixed model config and stop depending on old dynamic router for new surfaces.

Suggested file:

```txt
src/features/spectra/ai/model-config.ts
```

Suggested shape:

```ts
export const SPECTRA_DEFAULT_MODEL = "deepseek/deepseek-r1";
export const SPECTRA_PROVIDER = "openrouter";
```

Exact model can be adjusted by env:

```txt
SPECTRA_MODEL_ID
```

Rules:

- No auto-router for Wave 0.
- No exploration or diversity switching.
- No multi-agent worker path.
- Route all rebuild AI stubs through one path later.

## Blueprint Registry

Wave 0 should define code-only blueprints.

Registry shape:

```ts
type ArtifactBlueprint = {
  key: string;
  name: string;
  version: number;
  description: string;
  defaultContent: unknown;
  schema: unknown;
  rendererKey: string;
  operations: string[];
  searchableFields: string[];
};
```

Blueprint keys:

- `document`
- `thread_reference`
- `flashcard_deck`
- `quiz`
- `planner_task`

## Legacy Boundary

New code must not import old implementation paths.

Legacy paths:

- `src/components/workspace-v2/**`
- `src/components/workspace/**`
- `src/components/artifacts/artifact-ai-surface.tsx`
- `src/app/api/workspace-data/**`
- `src/lib/orchestrator/**`
- `src/lib/routing/**`

Allowed old support paths:

- `src/components/layout/app-shell.tsx`
- `src/components/ui/**`
- `src/components/theme-provider.tsx`
- `src/components/providers.tsx`
- `src/lib/utils.ts`
- `src/lib/auth-server.ts`
- `src/lib/convex-server.ts`
- `src/lib/openrouter.ts` as low-level transport only

## Testing Map

Wave 0 tests should prove:

- app builds
- `/chat`, `/workspace`, `/artifacts` route
- `/workspace` does not render/import WorkspaceV2
- `/artifacts` does not render/import ArtifactAiSurface
- blueprint registry has first five blueprints
- operation schema validates allowed operations
- AIRun lifecycle stub transitions through queued/running/completed/failed
- legacy import ban passes
