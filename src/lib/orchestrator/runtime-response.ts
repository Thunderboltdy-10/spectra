import type { RuntimeEvent, RuntimeResponseArtifacts } from "@/lib/orchestrator/runtime-contract";

export function buildRuntimeDoneEvent(params: {
  messageId?: string;
  artifacts?: RuntimeResponseArtifacts;
}): RuntimeEvent {
  return {
    type: "done",
    messageId: params.messageId,
    routeTrace: params.artifacts?.routeTrace,
    modelUsed: params.artifacts?.modelUsed,
    activeModel: params.artifacts?.activeModel ?? params.artifacts?.modelUsed,
    executionPath: params.artifacts?.executionPath,
    citations: params.artifacts?.citations,
    thinkingContent: params.artifacts?.thinkingContent,
    renderInstructions: params.artifacts?.renderInstructions,
    artifactUpdates: params.artifacts?.artifactUpdates,
  };
}

export function buildRuntimeErrorEvent(error: {
  code: string;
  message: string;
  retryable?: boolean;
}): RuntimeEvent {
  return {
    type: "error",
    error,
  };
}
