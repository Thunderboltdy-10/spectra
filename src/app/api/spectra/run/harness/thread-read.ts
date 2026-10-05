import { createHash } from "node:crypto";
import { rows } from "./effects";
import { readQuery } from "./io";

type ThreadMessage = Record<string, unknown>;

function excerpts(value: unknown) {
  return rows(value).map((message: ThreadMessage) => {
    const content = typeof message.content === "string" ? message.content : "";
    const excerpt = content.slice(0, 3_000);
    return { messageId: message._id, role: message.role, createdAt: message.createdAt,
      content: excerpt, offset: 0, revision: createHash("sha256").update(content).digest("hex"),
      totalCharacters: content.length, nextOffset: excerpt.length < content.length ? excerpt.length : null,
      complete: excerpt.length === content.length, partial: excerpt.length < content.length };
  });
}

/**
 * Read a conversation: one message by id (in chunks, bound to its revision), the latest window,
 * or the messages before or after one message (`from` + `direction`), so a read can page on from
 * any passage. Finding a passage is semantic.searchThreads' job.
 */
export async function executeThreadRead(actorClerkId: string, args: Record<string, unknown>) {
  const invalid = () => ({ ok: false, code: "invalid_arguments", retryable: false,
    message: "Use a messageId with offset/revision, or from with a direction. Do not mix these views." });
  if (typeof args.threadId !== "string") return invalid();
  if (typeof args.from === "string") {
    if (args.messageId !== undefined || (args.direction !== "older" && args.direction !== "newer")) return invalid();
    const request = { actorClerkId, threadId: args.threadId, messageId: args.from, direction: args.direction,
      limit: typeof args.limit === "number" ? Math.min(24, args.limit) : 16 };
    const result = await readQuery<typeof request, Record<string, unknown>>("spectraThreads:listMessagesFrom", request, "that Spectra conversation");
    if (!result.ok) return result;
    const messages = excerpts(result.value?.messages);
    return { ok: true, thread: { id: args.threadId }, messages, direction: args.direction, more: result.value?.more === true };
  }
  const chunk = typeof args.messageId === "string";
  if ((!chunk && (args.offset !== undefined || args.revision !== undefined)) ||
      (chunk && typeof args.offset === "number" && args.offset > 0 && !args.revision)) return invalid();
  const name = chunk ? "spectraThreads:readMessage" : "spectraThreads:listMessages";
  const request = { actorClerkId, threadId: args.threadId,
    ...(chunk ? { messageId: args.messageId, offset: args.offset, revision: args.revision,
      limit: typeof args.limit === "number" ? Math.min(6_000, args.limit) : 3_000 }
      : { limit: typeof args.limit === "number" ? Math.min(24, args.limit) : 16 }),
  };
  const result = await readQuery<typeof request, Record<string, unknown>>(name, request, "that Spectra conversation");
  if (!result.ok) return result;
  const value = result.value;
  if (!value || typeof value !== "object") return { ok: false, code: "thread_not_found" };
  if (chunk) return { ok: true, ...value };
  const messages = excerpts(value.messages);
  return { ok: true, thread: { id: args.threadId }, messages, direction: "older", more: value.hasOlder === true };
}
