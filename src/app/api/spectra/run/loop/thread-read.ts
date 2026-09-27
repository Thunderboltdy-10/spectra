import { createHash } from "node:crypto";
import { rows } from "./gather";
import { readQuery } from "./io";

/** The three history views have separate cursors. Never silently fall back to
 * recent messages when a search/chunk continuation is invalid or unavailable. */
export async function executeThreadRead(actorClerkId: string, args: Record<string, unknown>) {
  const invalid = () => ({ ok: false, code: "invalid_arguments", retryable: false,
    message: "Use a query with its searchCursor, a messageId with offset/revision, or before for older messages. Do not mix these views." });
  if (typeof args.threadId !== "string") return invalid();
  const chunk = typeof args.messageId === "string";
  const search = typeof args.query === "string";
  if ((chunk && (search || args.before !== undefined || args.searchCursor !== undefined)) ||
      (search && args.before !== undefined) ||
      (!search && args.searchCursor !== undefined) ||
      (!chunk && (args.offset !== undefined || args.revision !== undefined)) ||
      (chunk && typeof args.offset === "number" && args.offset > 0 && !args.revision)) return invalid();
  const name = chunk ? "spectraThreads:readMessage" : search ? "spectraThreads:searchMessages" : "spectraThreads:listMessages";
  const request = { actorClerkId, threadId: args.threadId,
    ...(chunk ? { messageId: args.messageId, offset: args.offset, revision: args.revision,
      limit: typeof args.limit === "number" ? Math.min(6_000, args.limit) : 3_000 }
      : search ? { query: args.query, cursor: args.searchCursor,
        limit: typeof args.limit === "number" ? Math.min(16, args.limit) : 8 }
      : { before: args.before, limit: typeof args.limit === "number" ? Math.min(24, args.limit) : 16 }),
  };
  const result = await readQuery<typeof request, Record<string, unknown>>(name, request, "that Spectra conversation");
  if (!result.ok) return result;
  const value = result.value;
  if (!value || typeof value !== "object") return { ok: false, code: "thread_not_found" };
  if (chunk || search) return { ok: true, ...value };
  const messages = rows(value.messages).map((message) => {
    const content = typeof message.content === "string" ? message.content : "";
    const excerpt = content.slice(0, 3_000);
    return { messageId: message._id, role: message.role, createdAt: message.createdAt,
      content: excerpt, offset: 0, revision: createHash("sha256").update(content).digest("hex"),
      totalCharacters: content.length, nextOffset: excerpt.length < content.length ? excerpt.length : null,
      complete: excerpt.length === content.length, partial: excerpt.length < content.length };
  });
  return { ok: true, thread: { id: args.threadId }, messages,
    hasOlder: value.hasOlder === true, before: value.olderBefore ?? value.nextCursor ?? null,
    nextCursor: value.nextCursor ?? null, complete: value.hasOlder !== true && messages.every((message) => message.complete),
  };
}
