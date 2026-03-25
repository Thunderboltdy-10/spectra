export type CompactableMessage<TId extends string = string> = {
  _id: TId;
  createdAt: number;
  role: "user" | "assistant" | "system";
  content: string;
  mode: string;
};

type CompactionWindowInput<TId extends string = string> = {
  messages: CompactableMessage<TId>[];
  keepLatestMessages: number;
  compactedUntilMessageId?: TId;
};

type CompactionWindow<TId extends string = string> =
  | {
      ok: false;
      reason:
        | "not_enough_messages"
        | "invalid_keep_latest"
        | "missing_boundary"
        | "already_compacted";
      compactedUntilMessageId?: TId;
    }
  | {
      ok: true;
      toCompact: CompactableMessage<TId>[];
      compactedUntilMessageId: TId;
      retainedMessages: number;
    };

export function computeCompactionWindow<TId extends string>(
  input: CompactionWindowInput<TId>,
): CompactionWindow<TId> {
  const sorted = [...input.messages].sort((a, b) => a.createdAt - b.createdAt);
  if (sorted.length < 12) {
    return { ok: false, reason: "not_enough_messages" };
  }

  if (!Number.isFinite(input.keepLatestMessages)) {
    return { ok: false, reason: "invalid_keep_latest" };
  }
  const keepLatest = Math.min(12, Math.max(4, Math.round(input.keepLatestMessages)));

  const boundaryIndex = sorted.length - keepLatest - 1;
  if (boundaryIndex < 0) {
    return { ok: false, reason: "missing_boundary" };
  }

  const boundaryMessage = sorted[boundaryIndex];
  if (!boundaryMessage) {
    return { ok: false, reason: "missing_boundary" };
  }

  let startIndex = 0;
  if (input.compactedUntilMessageId) {
    const previousIndex = sorted.findIndex((message) => message._id === input.compactedUntilMessageId);
    if (previousIndex >= 0) {
      startIndex = previousIndex + 1;
    }
  }

  if (startIndex > boundaryIndex) {
    return {
      ok: false,
      reason: "already_compacted",
      compactedUntilMessageId: input.compactedUntilMessageId,
    };
  }

  const toCompact = sorted.slice(startIndex, boundaryIndex + 1);
  if (toCompact.length === 0) {
    return {
      ok: false,
      reason: "already_compacted",
      compactedUntilMessageId: input.compactedUntilMessageId,
    };
  }

  return {
    ok: true,
    toCompact,
    compactedUntilMessageId: boundaryMessage._id,
    retainedMessages: sorted.length - (boundaryIndex + 1),
  };
}
