export const WORKSPACE_STATUSES = ["active", "archived"] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const ARTIFACT_STATUSES = ["active", "draft", "archived", "deleted"] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const THREAD_STATUSES = ["active", "archived", "deleted"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const AI_RUN_STATUSES = ["queued", "running", "awaiting_confirmation", "awaiting_resolution", "completed", "failed", "cancelled"] as const;
export type AIRunStatus = (typeof AI_RUN_STATUSES)[number];

/** Run is still actively working — the island should stay non-idle. */
export function isWorkingAiRunStatus(status: AIRunStatus | string): boolean {
  return status === "queued" || status === "running";
}

/** Run reached a settled UI state (done, failed, cancelled, or waiting on the user). */
export function isSettledAiRunStatus(status: AIRunStatus | string): boolean {
  return !isWorkingAiRunStatus(status);
}

export const OPERATION_STATUSES = ["proposed", "executing", "waiting", "executed", "failed", "cancelled"] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export const RESULT_CARD_STATUSES = ["queued", "running", "awaiting_confirmation", "awaiting_resolution", "completed", "failed", "cancelled"] as const;
export type ResultCardStatus = (typeof RESULT_CARD_STATUSES)[number];

export const SURFACES = ["chat", "workspace", "artifact"] as const;
export type SpectraSurface = (typeof SURFACES)[number];

export {
  CURRENT_WORKSPACE_VIEWS as WORKSPACE_VIEWS,
  type WorkspaceView,
} from "../../../../shared/workspace-view";

export const ACTOR_TYPES = ["user", "ai", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
