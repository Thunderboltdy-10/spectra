import type { RouteTrace, RuntimeExecutionPath, StudyMode } from "@/types";

export type RuntimeSurface = "chat" | "workspace" | "artifact";

export type RuntimeEventType =
  | "text_delta"
  | "delta"
  | "phase_update"
  | "thinking"
  | "thinking_segment"
  | "tool_call"
  | "tool_result"
  | "skill_loaded"
  | "memory_read"
  | "memory_write"
  | "action_proposed"
  | "action_applied"
  | "artifact_patch_preview"
  | "artifact_patch_applied"
  | "version_created"
  | "version_restored"
  | "planner_updated"
  | "widget_created"
  | "widget_updated"
  | "workstream_layout_updated"
  | "helper_worker_started"
  | "helper_worker_finished"
  | "render_instruction"
  | "navigation_instruction"
  | "model_selected"
  | "model_fallback"
  | "mode_switched"
  | "notice"
  | "collab_start"
  | "agent_summoned"
  | "collab_progress"
  | "collab_done"
  | "collab_synthesizing"
  | "done"
  | "error";

export type RuntimeExecutionStatus = "idle" | "running" | "completed" | "failed";
export type RuntimeThinkingSegment = {
  id: string;
  label: string;
  content: string;
  status: RuntimeExecutionStatus;
};

export type RuntimePhaseEvent = RuntimeEventBase & {
  type: "phase_update";
  phaseId?: string;
  status?: RuntimeExecutionStatus | "planned" | "skipped";
  detail?: string;
  phasePlan?: unknown;
};

export type RuntimeThinkingSegmentEvent = RuntimeEventBase & {
  type: "thinking_segment";
  segment: RuntimeThinkingSegment;
};

export type RuntimeContextLayerBudget = {
  name: "system" | "history" | "memory" | "retrieval" | "search" | "attachments" | "workspace";
  requestedTokens: number;
  appliedTokens: number;
  included: boolean;
  reason: string;
};

export type RuntimeLayeredBudget = {
  totalBudget: number;
  reserveOutputTokens: number;
  layers: RuntimeContextLayerBudget[];
};

export type RuntimeSelectionSignals = {
  activeSurface: RuntimeSurface;
  explicitFocus: boolean;
  mutationIntent: boolean;
  targetCount: number;
  hasAttachments: boolean;
  needsSearch: boolean;
  outputType: "conversation" | "workspace_mutation" | "artifact_mutation" | "research" | "version_diff";
  versionIntent: boolean;
  diffIntent: boolean;
};

export type RuntimeContextEnvelope = {
  surface: RuntimeSurface;
  layeredBudget: RuntimeLayeredBudget;
  continuity: {
    continueThread: boolean;
    confidence: number;
    reason: string;
  };
  layers: {
    systemPrompt: string[];
    history: string[];
    memory: string[];
    retrieval: string[];
    search: string[];
    attachments: string[];
    workspace: string[];
  };
};

export type RuntimeRenderInstruction = {
  kind: "code" | "visual" | "document" | "table" | "markdown";
  title?: string;
  content?: string;
  language?: string;
  artifactId?: string;
  renderMode?: string;
  props?: Record<string, unknown>;
};

export type RuntimeResponseArtifacts = {
  routeTrace?: RouteTrace;
  citations?: Array<{ url: string; title: string }>;
  modelUsed?: string;
  activeModel?: string;
  executionPath?: RuntimeExecutionPath;
  thinkingContent?: string;
  renderInstructions?: RuntimeRenderInstruction[];
  artifactUpdates?: Array<Record<string, unknown>>;
};

export type RuntimeEventBase = {
  type: RuntimeEventType;
  timestamp?: number;
};

export type AiRunStatus =
  | "queued"
  | "routing"
  | "checking_context"
  | "waiting_for_clarification"
  | "running"
  | "streaming"
  | "applying_side_effects"
  | "completed"
  | "failed"
  | "cancelled";

export type RuntimeAttachmentRef = {
  resourceId: string;
  filename?: string;
  status?: "local_pending" | "uploading" | "uploaded" | "processing" | "indexed" | "failed_processing" | "storage_missing" | "detached" | "deleted" | "unavailable";
  usable?: boolean;
  reason?: string;
};

export type SelectedModelSnapshot = {
  modelId: string;
  provider?: string;
  family?: string;
  reason?: string;
};

export type AiRun = {
  id: string;
  surface: RuntimeSurface;
  status: AiRunStatus;
  userId?: string;
  conversationId?: string;
  threadId?: string;
  workspaceId?: string;
  artifactId?: string;
  parentRunId?: string;
  createdAt?: number;
  startedAt?: number;
  completedAt?: number;
  input?: {
    text: string;
    attachments: RuntimeAttachmentRef[];
    selectedItems?: Array<{ type: string; id: string }>;
    mode?: string;
    userSelectedModelId?: string;
  };
  events: AiRunEvent[];
  selectedModel?: SelectedModelSnapshot;
  modelUsed?: string;
  activeModel?: string;
  executionPath?: RuntimeExecutionPath;
  routeTrace?: RouteTrace;
};

export type RuntimeTextDeltaEvent = RuntimeEventBase & {
  type: "text_delta";
  content: string;
};

export type RuntimeToolCallEvent = RuntimeEventBase & {
  type: "tool_call";
  toolName: string;
  toolCallId: string;
  arguments?: string;
};

export type RuntimeToolResultEvent = RuntimeEventBase & {
  type: "tool_result";
  toolName: string;
  toolCallId: string;
  summary: string;
  result?: unknown;
};

export type RuntimeModeSwitchedEvent = RuntimeEventBase & {
  type: "mode_switched";
  mode: StudyMode;
  reason?: string;
};

export type RuntimeNavigationInstructionEvent = RuntimeEventBase & {
  type: "navigation_instruction";
  chatId?: string;
  workstreamId?: string;
  artifactId?: string;
  title?: string;
  reason?: string;
};

export type RuntimeModelSelectedEvent = RuntimeEventBase & {
  type: "model_selected";
  modelUsed: string;
  executionPath?: RuntimeExecutionPath;
  routeTrace?: RouteTrace;
};

export type RuntimeModelFallbackEvent = RuntimeEventBase & {
  type: "model_fallback";
  fromModel: string;
  toModel: string;
  reason: string;
  attemptIndex?: number;
};

export type RuntimeDoneEvent = RuntimeEventBase & {
  type: "done";
  messageId?: string;
  routeTrace?: RouteTrace;
  modelUsed?: string;
  activeModel?: string;
  executionPath?: RuntimeExecutionPath;
  citations?: Array<{ url: string; title: string }>;
  thinkingContent?: string;
  renderInstructions?: RuntimeRenderInstruction[];
  artifactUpdates?: Array<Record<string, unknown>>;
};

export type RuntimeErrorEvent = RuntimeEventBase & {
  type: "error";
  error: {
    code: string;
    message: string;
    retryable?: boolean;
  };
};

export type RuntimeGenericEvent = RuntimeEventBase & Record<string, unknown>;

export type RuntimeEvent =
  | RuntimeTextDeltaEvent
  | RuntimeToolCallEvent
  | RuntimeToolResultEvent
  | RuntimePhaseEvent
  | RuntimeThinkingSegmentEvent
  | RuntimeModeSwitchedEvent
  | RuntimeNavigationInstructionEvent
  | RuntimeModelSelectedEvent
  | RuntimeModelFallbackEvent
  | RuntimeDoneEvent
  | RuntimeErrorEvent
  | RuntimeGenericEvent;

export type AiRunEvent = RuntimeEvent;

export function validateAiRunEventContract(events: AiRunEvent[]) {
  const errors: string[] = [];
  const firstModelSelectedIndex = events.findIndex((event) => event.type === "model_selected");
  const firstAnswerIndex = events.findIndex((event) => event.type === "text_delta" || event.type === "delta");

  if (firstAnswerIndex >= 0 && firstModelSelectedIndex < 0) {
    errors.push("answer text was emitted before any model_selected event");
  } else if (firstAnswerIndex >= 0 && firstModelSelectedIndex > firstAnswerIndex) {
    errors.push("model_selected must be emitted before answer text");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function toLegacyChatStreamEvent(event: RuntimeEvent): Record<string, unknown> {
  if (event.type === "text_delta") {
    return {
      ...event,
      type: "delta",
    };
  }
  if (event.type === "mode_switched") {
    return {
      ...event,
      type: "mode_switch",
      mode: event.mode,
    };
  }
  if (event.type === "navigation_instruction") {
    return {
      ...event,
      type: "thread_fork",
    };
  }
  if (event.type === "model_selected") {
    return {
      ...event,
      type: "route_model",
    };
  }
  return event;
}
