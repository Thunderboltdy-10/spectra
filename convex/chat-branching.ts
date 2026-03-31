type BranchableMessage = {
  _id: string;
  role: "user" | "assistant" | "system";
  content: string;
  parentMessageId?: string;
  createdAt: number;
};

export function selectMessagesForBranch<T extends BranchableMessage>(
  messages: T[],
  pivotMessageId: string,
) {
  const pivotIndex = messages.findIndex((message) => message._id === pivotMessageId);
  if (pivotIndex < 0) {
    throw new Error("Message not found");
  }
  return messages.slice(0, pivotIndex + 1);
}

export function summarizeBranchedMessages(messages: BranchableMessage[]) {
  let latestUserPrompt: string | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      latestUserPrompt = message.content.replace(/\s+/g, " ").trim().slice(0, 120);
    }
  }

  return {
    latestUserPrompt,
    messageCount: messages.length,
  };
}

export function resolveBranchedParentMessageId<T extends string>(
  sourceParentMessageId: T | undefined,
  sourceToBranchedId: ReadonlyMap<string, T>,
) {
  if (!sourceParentMessageId) return undefined;
  return sourceToBranchedId.get(sourceParentMessageId);
}
