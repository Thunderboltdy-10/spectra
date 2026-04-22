import type { RouteTrace, RuntimeExecutionPath, StudyMode } from "@/types";

export type RuntimeSurface = "chat" | "workspace" | "artifact";

export type RuntimeEventType =
  | "delta"
  | "thinking"
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
  | "mode_switched"
  | "notice"
  | "collab_start"
  | "agent_summoned"
  | "collab_progress"
  | "collab_done"
  | "collab_synthesizing"
  | "done"
  | "error";

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

export type RuntimeResponseArtifacts = {
  routeTrace?: RouteTrace;
  citations?: Array<{ url: string; title: string }>;
  modelUsed?: string;
  thinkingContent?: string;
};

export type RuntimeEventBase = {
  type: RuntimeEventType;
  timestamp?: number;
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

export type RuntimeDoneEvent = RuntimeEventBase & {
  type: "done";
  messageId?: string;
  routeTrace?: RouteTrace;
  modelUsed?: string;
  citations?: Array<{ url: string; title: string }>;
  thinkingContent?: string;
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
  | RuntimeToolCallEvent
  | RuntimeToolResultEvent
  | RuntimeModeSwitchedEvent
  | RuntimeNavigationInstructionEvent
  | RuntimeModelSelectedEvent
  | RuntimeDoneEvent
  | RuntimeErrorEvent
  | RuntimeGenericEvent;

export function toLegacyChatStreamEvent(event: RuntimeEvent): Record<string, unknown> {
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
