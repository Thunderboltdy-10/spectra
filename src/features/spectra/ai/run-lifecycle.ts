import type { AIRun, ResultCard, SpectraId } from "../core";
import { getSpectraModelId } from "./model-config";

type CreateRunInput = {
  id: SpectraId<"aiRuns">;
  ownerUserId: string;
  orgId?: string;
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
    ownerUserId: input.ownerUserId,
    orgId: input.orgId,
    sourceSurface: input.sourceSurface,
    threadId: input.threadId,
    workspaceId: input.workspaceId,
    artifactId: input.artifactId,
    status: "queued",
    userPrompt: input.userPrompt,
    modelUsed: getSpectraModelId(),
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
  if (run.status !== "queued" && run.status !== "running") {
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

