import type {
  AIRunStatus,
  ActorType,
  ArtifactStatus,
  OperationStatus,
  ResultCardStatus,
  SpectraSurface,
  ThreadStatus,
  WorkspaceStatus,
  WorkspaceView,
} from "./status";

export type SpectraId<TableName extends string = string> = string & {
  readonly __spectraTable?: TableName;
};

export type TimestampMs = number;

export type Workspace = {
  id: SpectraId<"workspaces">;
  ownerUserId: string;
  orgId?: string;
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  status: WorkspaceStatus;
  defaultView: WorkspaceView;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
  lastActivityAt: TimestampMs;
};

export type ArtifactCreatedFrom = {
  source: "chat" | "workspace" | "artifact" | "manual" | "ai";
  threadId?: SpectraId<"threads">;
  runId?: SpectraId<"aiRuns">;
  workspaceId?: SpectraId<"workspaces">;
};

export type Artifact = {
  id: SpectraId<"artifacts">;
  ownerUserId: string;
  orgId?: string;
  blueprintKey: string;
  title: string;
  summary?: string;
  content: unknown;
  textIndex?: string;
  tags: string[];
  status: ArtifactStatus;
  createdFrom?: ArtifactCreatedFrom;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
};

export type ArtifactBlueprint = {
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

export type WorkspaceItem = {
  id: SpectraId<"workspaceItems">;
  workspaceId: SpectraId<"workspaces">;
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
    view: Exclude<WorkspaceView, "library">;
    position?: { x: number; y: number };
    size?: { w: number; h: number };
    zIndex?: number;
    collapsed?: boolean;
  };
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
};

export type Thread = {
  id: SpectraId<"threads">;
  ownerUserId: string;
  orgId?: string;
  title: string;
  summaryShort?: string;
  summaryLong?: string;
  origin: SpectraSurface;
  workspaceId?: SpectraId<"workspaces">;
  artifactId?: SpectraId<"artifacts">;
  status: ThreadStatus;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
  lastMessageAt?: TimestampMs;
};

export type Message = {
  id: SpectraId<"messages">;
  threadId: SpectraId<"threads">;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  runId?: SpectraId<"aiRuns">;
  metadata?: unknown;
  createdAt: TimestampMs;
};

export type AIRun = {
  id: SpectraId<"aiRuns">;
  ownerUserId: string;
  orgId?: string;
  sourceSurface: SpectraSurface;
  threadId?: SpectraId<"threads">;
  workspaceId?: SpectraId<"workspaces">;
  artifactId?: SpectraId<"artifacts">;
  status: AIRunStatus;
  userPrompt: string;
  finalSummary?: string;
  error?: string;
  modelUsed?: string;
  sessionId?: string;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
  completedAt?: TimestampMs;
};

export type Operation = {
  id: SpectraId<"operations">;
  runId?: SpectraId<"aiRuns">;
  actorType: ActorType;
  type: string;
  status: OperationStatus;
  input: unknown;
  output?: unknown;
  affected: Array<{ type: string; id: string }>;
  requiresConfirmation?: boolean;
  undoData?: unknown;
  createdAt: TimestampMs;
  executedAt?: TimestampMs;
};

export type ResultCard = {
  id: SpectraId<"resultCards">;
  runId: SpectraId<"aiRuns">;
  surface: SpectraSurface;
  workspaceId?: SpectraId<"workspaces">;
  artifactId?: SpectraId<"artifacts">;
  status: ResultCardStatus;
  variant: "status" | "artifact" | "thread" | "operation" | "error";
  title: string;
  summary?: string;
  actions: Array<{
    key: string;
    label: string;
    targetType?: "artifact" | "thread" | "run" | "workspace";
    targetId?: string;
  }>;
  hiddenAt?: TimestampMs;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
};

export type FocusSpace = {
  id: SpectraId<"focusSpaces">;
  workspaceId?: SpectraId<"workspaces">;
  title: string;
  selected: Array<{ type: "artifact" | "thread" | "workspaceItem"; id: string }>;
  createdAt: TimestampMs;
  updatedAt: TimestampMs;
};

