import type { Doc } from "./_generated/dataModel";

export const RUN_TAB_PROJECTION_VERSION = 1;

/**
 * The Live Dock polls this shape. Keep it deliberately smaller than the run
 * document: context snapshots, plans, usage payloads, routing reasons and
 * approval detail belong to the run detail query, not the tab index.
 */
export function projectRunTabSummary(run: Doc<"spectraAiRuns">) {
  return {
    _id: run._id,
    executionId: run.executionId,
    status: run.status,
    phase: run.phase,
    sourceSurface: run.sourceSurface,
    threadId: run.threadId,
    workspaceId: run.workspaceId,
    artifactId: run.artifactId,
    userPrompt: run.userPrompt.slice(0, 12_000),
    decision: run.decision,
    finalSummary: run.finalSummary?.slice(0, 2_000),
    error: run.error?.slice(0, 2_000),
    modelUsed: run.modelUsed?.slice(0, 200),
    providerUsed: run.providerUsed?.slice(0, 200),
    attemptCount: run.attemptCount,
    recoveryState: run.recoveryState,
    retryable: run.retryable,
    traceDegraded: run.traceDegraded,
    selectedAgentId: run.selectedAgentId,
    selectedAgentVersionId: run.selectedAgentVersionId,
    dockSummary: run.dockSummary
      ? {
          checkpointSummary:
            run.dockSummary.checkpointSummary?.slice(0, 800),
          recentSteps: run.dockSummary.recentSteps
            .map((step) => step.slice(0, 800))
            .slice(-8),
          inputRequest: run.dockSummary.inputRequest,
        }
      : undefined,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
