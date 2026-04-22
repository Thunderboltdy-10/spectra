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
    citations: params.artifacts?.citations,
    thinkingContent: params.artifacts?.thinkingContent,
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
