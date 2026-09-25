import type { AIRun, ResultCard, SpectraId } from "../core";
import { getSpectraModelId } from "./model-config";

export type RunAttemptStatus =
  | "queued"
  | "running"
  | "awaiting_confirmation"
  | "awaiting_resolution"
  | "completed"
  | "failed"
  | "cancelled";

export function isRetryableRunStatus(status: RunAttemptStatus): boolean {
  return status === "failed" || status === "cancelled";
}

/** A transport/model AbortError is not a user stop. Only the durable run
 * transition made by the Stop or Cancel action authorizes the cancelled UI. */
export function classifyRunAttemptAbort(input: {
  current: {
    status: RunAttemptStatus;
    executionId?: string;
    workerId?: string;
  } | null;
  executionId: string;
  workerId: string;
}):
  | "user_stopped"
  | "already_settled"
  | "ownership_lost"
  | "runtime_abort"
  | "state_unavailable" {
  const { current } = input;
  if (!current) return "state_unavailable";
  if (current?.status === "cancelled") return "user_stopped";
  if (current?.status === "completed" || current?.status === "failed")
    return "already_settled";
  if (
    current.executionId !== input.executionId ||
    current.workerId !== input.workerId
  )
    return "ownership_lost";
  return "runtime_abort";
}

type CreateRunInput = {
  id: SpectraId<"aiRuns">;
  ownerAccountId: string;
  schoolId?: string;
  sourceSurface: AIRun["sourceSurface"];
  userPrompt: string;
  threadId?: SpectraId<"threads">;
  workspaceId?: SpectraId<"workspaces">;
  artifactId?: SpectraId<"artifacts">;
  now?: number;
};

export function createQueuedRun(input: CreateRunInput): AIRun {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    ownerAccountId: input.ownerAccountId,
    schoolId: input.schoolId,
    sourceSurface: input.sourceSurface,
    threadId: input.threadId,
    workspaceId: input.workspaceId,
    artifactId: input.artifactId,
    status: "queued",
    userPrompt: input.userPrompt,
    modelUsed: getSpectraModelId(),
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function markRunRunning(run: AIRun, now = Date.now()): AIRun {
  if (run.status !== "queued") {
    throw new Error(`Cannot mark ${run.status} run as running.`);
  }
  return { ...run, status: "running", updatedAt: now };
}

export function completeRun(run: AIRun, finalSummary: string, now = Date.now()): AIRun {
  if (run.status !== "queued" && run.status !== "running" && run.status !== "awaiting_confirmation" && run.status !== "awaiting_resolution") {
    throw new Error(`Cannot complete ${run.status} run.`);
  }
  return {
    ...run,
    status: "completed",
    finalSummary,
    updatedAt: now,
    completedAt: now,
  };
}

export function failRun(run: AIRun, error: string, now = Date.now()): AIRun {
  if (run.status === "completed" || run.status === "cancelled") {
    throw new Error(`Cannot fail ${run.status} run.`);
  }
  return {
    ...run,
    status: "failed",
    error,
    updatedAt: now,
    completedAt: now,
  };
}

export function cancelRun(run: AIRun, now = Date.now()): AIRun {
  if (run.status === "completed" || run.status === "failed") {
    throw new Error(`Cannot cancel ${run.status} run.`);
  }
  return {
    ...run,
    status: "cancelled",
    updatedAt: now,
    completedAt: now,
  };
}

export function createResultCardForRun(params: {
  id: SpectraId<"resultCards">;
  run: AIRun;
  title?: string;
  summary?: string;
  now?: number;
}): ResultCard {
  const now = params.now ?? Date.now();
  return {
    id: params.id,
    runId: params.run.id,
    surface: params.run.sourceSurface,
    workspaceId: params.run.workspaceId,
    artifactId: params.run.artifactId,
    status: params.run.status === "queued" ? "queued" : params.run.status,
    variant: params.run.status === "failed" ? "error" : "status",
    title: params.title ?? "Spectra run",
    summary: params.summary ?? params.run.finalSummary ?? params.run.error,
    actions: [],
    createdAt: now,
    updatedAt: now,
  };
}

