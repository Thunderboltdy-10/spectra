# Spectra Core Architecture

## Core idea

Spectra must be rebuilt around objects and operations, not around pages.

Pages are views over shared primitives.

```txt
/chat       → conversation view over Thread/Message/AIRun/ResultCard/Artifact
/workspace  → operational view over Workspace/WorkspaceItem/Artifact/Thread/AIRun/ResultCard
/artifacts  → library/inbox view over Artifact/Blueprint/Workspace placement
```

## Entity model

### Workspace

A durable subject/project/group/area.

Examples:

- Physics
- Maths EE
- TOK Exhibition
- University Applications
- Computer Science
- Revision Week

Suggested fields:

```ts
type Workspace = {
  id: Id<"workspaces">;
  ownerUserId: Id<"users">;
  orgId?: Id<"orgs">;

  title: string;
  description?: string;
  icon?: string;
  color?: string;
  status: "active" | "archived";

  defaultView: "cards" | "canvas" | "timeline" | "library";
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
};
```

### Artifact

A canonical content object.

Artifacts are not just markdown. They are blueprint-based.

```ts
type Artifact = {
  id: Id<"artifacts">;
  ownerUserId: Id<"users">;
  orgId?: Id<"orgs">;

  blueprintKey: string;
  title: string;
  summary?: string;

  content: unknown;       // Validated by blueprint schema.
  textIndex?: string;     // Searchable text extraction.
  tags: string[];

  status: "active" | "draft" | "archived" | "deleted";

  createdFrom?: {
    source: "chat" | "workspace" | "artifact" | "manual" | "ai";
    threadId?: Id<"threads">;
    runId?: Id<"aiRuns">;
    workspaceId?: Id<"workspaces">;
  };

  createdAt: number;
  updatedAt: number;
};
```

### Blueprint

A blueprint defines artifact structure and behavior.

Built-in blueprints are code-defined first. Custom/user-defined blueprints are later.

```ts
type ArtifactBlueprint = {
  key: string;
  name: string;
  description: string;
  version: number;

  schema: unknown;
  defaultContent: unknown;

  rendererKey: string;
  operations: string[];
  searchableFields: string[];
};
```

### WorkspaceItem

A projection/reference from a workspace to an entity.

Content does **not** live in WorkspaceItem. It lives in Artifact/Thread/Task/etc.

```ts
type WorkspaceItem = {
  id: Id<"workspaceItems">;
  workspaceId: Id<"workspaces">;

  sourceType: "artifact" | "thread" | "task" | "widget" | "custom";
  sourceId: string;

  viewData: {
    titleOverride?: string;
    compactSummary?: string;
    cardVariant?: string;
    pinned?: boolean;
    hidden?: boolean;
  };

  layout: {
    view: "cards" | "canvas" | "timeline";
    position?: { x: number; y: number };
    size?: { w: number; h: number };
    zIndex?: number;
    collapsed?: boolean;
  };

  createdAt: number;
  updatedAt: number;
};
```

### Thread

A persistent AI conversation.

Threads can exist globally, inside chat, linked to an artifact, or referenced in a workspace.

Not all AI runs create threads.

```ts
type Thread = {
  id: Id<"threads">;
  ownerUserId: Id<"users">;
  orgId?: Id<"orgs">;

  title: string;
  summaryShort?: string;
  summaryLong?: string;

  origin: "chat" | "workspace" | "artifact";
  workspaceId?: Id<"workspaces">;
  artifactId?: Id<"artifacts">;

  status: "active" | "archived" | "deleted";

  createdAt: number;
  updatedAt: number;
  lastMessageAt?: number;
};
```

### Message

A message belongs to a thread.

```ts
type Message = {
  id: Id<"messages">;
  threadId: Id<"threads">;

  role: "user" | "assistant" | "system" | "tool";
  content: string;

  runId?: Id<"aiRuns">;
  metadata?: unknown;

  createdAt: number;
};
```

### AIRun

One execution of AI.

Every AI command creates a run. A run may or may not have a thread.

```ts
type AIRun = {
  id: Id<"aiRuns">;
  ownerUserId: Id<"users">;
  orgId?: Id<"orgs">;

  sourceSurface: "chat" | "workspace" | "artifact";
  threadId?: Id<"threads">;
  workspaceId?: Id<"workspaces">;
  artifactId?: Id<"artifacts">;

  status: "queued" | "running" | "completed" | "failed" | "cancelled";

  userPrompt: string;
  finalSummary?: string;
  error?: string;

  modelUsed?: string;
  sessionId?: string;

  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};
```

### Operation

Validated action performed by user/system/AI.

```ts
type Operation = {
  id: Id<"operations">;
  runId?: Id<"aiRuns">;

  actorType: "user" | "ai" | "system";
  type: string;
  status: "proposed" | "executed" | "failed" | "cancelled";

  input: unknown;
  output?: unknown;
  affected: Array<{ type: string; id: string }>;

  requiresConfirmation?: boolean;
  undoData?: unknown;

  createdAt: number;
  executedAt?: number;
};
```

### ResultCard

Compact visible representation of a run.

```ts
type ResultCard = {
  id: Id<"resultCards">;
  runId: Id<"aiRuns">;

  surface: "workspace" | "artifact" | "chat";
  workspaceId?: Id<"workspaces">;
  artifactId?: Id<"artifacts">;

  status: "running" | "completed" | "failed" | "hidden";

  title: string;
  summary?: string;
  actionLabel?: string;

  openTarget?: {
    type: "thread" | "artifact" | "workspace" | "operationLog";
    id: string;
  };

  hiddenAt?: number;
  createdAt: number;
  updatedAt: number;
};
```

## Core rule

```txt
Content lives in source entities.
WorkspaceItems only project/reference source entities.
AI actions go through validated Operations.
Visible AI progress/output goes through ResultCards.
```

## Suggested folder structure

```txt
src/features/spectra/
  core/
    types.ts
    ids.ts
    result.ts
    constants.ts

  blueprints/
    registry.ts
    document.ts
    thread-reference.ts
    flashcard-deck.ts
    quiz.ts
    planner-task.ts

  operations/
    schema.ts
    validate.ts
    execute.ts
    policies.ts

  ai/
    context-builder.ts
    model.ts
    prompt.ts
    run-controller.ts
    stream-events.ts

  workspace/
    WorkspaceRoot.tsx
    WorkspaceCardsView.tsx
    WorkspaceCanvasView.tsx
    WorkspaceCommandBar.tsx
    ResultCardStack.tsx
    RightRunThreadHub.tsx

  artifacts/
    ArtifactLibraryPage.tsx
    ArtifactCard.tsx
    ArtifactEditorSurface.tsx
    ArtifactRenderer.tsx

  chat/
    SpectraChatPage.tsx
    ThreadView.tsx
    MessageList.tsx
    ChatComposer.tsx
    CompactRunStatus.tsx
```

Backend conceptual structure:

```txt
convex/
  schema.ts
  spectraWorkspaces.ts
  spectraArtifacts.ts
  spectraThreads.ts
  spectraRuns.ts
  spectraOperations.ts
  spectraResultCards.ts
  spectraSeed.ts
```

Use actual Convex conventions and generated API names.
