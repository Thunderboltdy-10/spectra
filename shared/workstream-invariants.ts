export type WorkspaceThreadType = "conversation" | "artifact_edit";

type BranchableMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export function shouldAdjustWorkstreamScopedCount(params: {
  status: "active" | "archived";
  nextWorkstreamIdProvided: boolean;
  previousWorkstreamId?: string;
  nextWorkstreamId?: string;
}) {
  return params.status === "active"
    && params.nextWorkstreamIdProvided
    && params.previousWorkstreamId !== params.nextWorkstreamId;
}

export function resolveArtifactThreadWorkstream(params: {
  threadType: WorkspaceThreadType;
  requestedWorkstreamId?: string;
  artifactWorkstreamId?: string;
}) {
  if (
    params.threadType === "artifact_edit"
    && params.artifactWorkstreamId
    && params.requestedWorkstreamId
    && params.artifactWorkstreamId !== params.requestedWorkstreamId
  ) {
    throw new Error("Artifact threads must stay attached to the artifact workstream.");
  }

  return params.artifactWorkstreamId ?? params.requestedWorkstreamId;
}

function compactMessageText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function summarizeCopiedChatMessages(messages: BranchableMessage[]) {
  let latestUserPrompt: string | undefined;

  for (const message of messages) {
    if (message.role !== "user") continue;
    latestUserPrompt = compactMessageText(message.content).slice(0, 120);
  }

  return {
    latestUserPrompt,
    messageCount: messages.length,
  };
}
