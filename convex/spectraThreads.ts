import { query } from "./_generated/server";
import { internalMutation, mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";
import {
  ensureThreadWorkspacePlacement,
  requireArtifactCapability,
  requireWorkspaceCapability,
} from "./spectraShared";
import {
  findPrimaryNode,
  placeSourceNode,
  purgeSourceNodes,
  syncArtifactSummary,
  syncSourceNodes,
} from "./orgTreeShared";
import { incrementOperationalCounter } from "./operationalCounters";

const vOrigin = v.union(
  v.literal("chat"),
  v.literal("workspace"),
  v.literal("artifact"),
);
const vRole = v.union(
  v.literal("user"),
  v.literal("assistant"),
  v.literal("system"),
  v.literal("tool"),
);

const THREAD_READ_SCHEMA_VERSION = 1;
const INITIAL_MESSAGE_LIMIT = 32;
const MESSAGE_PAGE_LIMIT = 48;
const TRACE_CHILD_LIMIT = 40;
const LIST_CURSOR_VERSION = 1;
const MESSAGE_CURSOR_VERSION = 1;
const TRACE_CURSOR_VERSION = 1;
const BACKFILL_CURSOR_VERSION = 1;

function encodeCursor(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T; } catch { return undefined; }
}

function requireCursor<T>(value: string, kind: string): T {
  const decoded = decodeCursor<T>(value);
  if (!decoded) throw new Error(`This ${kind} cursor is invalid or expired. Reload the view and try again.`);
  return decoded;
}

type ThreadListCursor = {
  version: typeof LIST_CURSOR_VERSION;
  kind: "thread-list";
  ownerAccountId: string;
  schoolId: string;
  includeArchived: boolean;
  status: "active" | "archived";
  cursor: string | null;
};

type MessageCursor = {
  version: typeof MESSAGE_CURSOR_VERSION;
  kind: "thread-messages";
  threadId: string;
  order: "desc";
  cursor: string;
};

type TraceCursor = {
  version: typeof TRACE_CURSOR_VERSION;
  kind: "thread-trace";
  runId: string;
  family: "operations" | "cards" | "events";
  order: "desc" | "asc";
  cursor: string;
  after?: number;
};

type BackfillCursor = {
  version: typeof BACKFILL_CURSOR_VERSION;
  kind: "thread-read-backfill";
  cursor: string;
};

function assertThreadListCursor(
  value: string | undefined,
  actor: { _id: Id<"accounts">; schoolId: Id<"schools"> },
  includeArchived: boolean,
) {
  if (!value) return null;
  const cursor = requireCursor<ThreadListCursor>(value, "thread list");
  if (
    cursor.version !== LIST_CURSOR_VERSION ||
    cursor.kind !== "thread-list" ||
    cursor.ownerAccountId !== String(actor._id) ||
    cursor.schoolId !== String(actor.schoolId) ||
    cursor.includeArchived !== includeArchived ||
    (cursor.status !== "active" && cursor.status !== "archived") ||
    typeof cursor.cursor !== "string"
  )
    throw new Error("This thread list cursor belongs to another query. Reload the list and try again.");
  return cursor;
}

function childCursor(
  runId: Id<"spectraAiRuns">,
  family: TraceCursor["family"],
  order: TraceCursor["order"],
  cursor: string,
  after?: number,
) {
  return encodeCursor({
    version: TRACE_CURSOR_VERSION,
    kind: "thread-trace",
    runId: String(runId),
    family,
    order,
    cursor,
    ...(after === undefined ? {} : { after }),
  });
}

function previewContent(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function compactThread(thread: Doc<"spectraThreads">) {
  return {
    _id: thread._id,
    _creationTime: thread._creationTime,
    title: thread.title,
    summaryShort: thread.summaryShort,
    previewText: thread.previewText,
    origin: thread.origin,
    workspaceId: thread.workspaceId,
    artifactId: thread.artifactId,
    contextWorkspaceIds: thread.contextWorkspaceIds,
    contextArtifactIds: thread.contextArtifactIds,
    pinned: thread.pinned,
    messageCount: thread.messageCount,
    lastRunId: thread.lastRunId,
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastMessageAt: thread.lastMessageAt,
    readSchemaVersion: thread.readSchemaVersion,
  };
}


function cleanTitle(value: string) {
  const words = value
    .replace(/[`*_#[\](){}<>]/g, " ")
    .replace(
      /\b(please|can|could|would|spectra|help|me|with|about|the|a|an|to|for|from|into|this|that|these|those)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "New thread";
  const title = words
    .slice(0, 4)
    .join(" ")
    .replace(/[.!?,;:]+$/, "")
    .slice(0, 48);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function cleanContent(value: string) {
  return value
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, 60_000);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function choiceRequest(metadata: unknown, messageId: string) {
  const choices = record(record(metadata).choices);
  const parseOptions = (value: unknown) =>
    Array.isArray(value)
      ? value.flatMap((option) => {
          const row = record(option);
          return typeof row.title === "string" && row.title.trim()
            ? [{
                title: row.title.trim(),
                description:
                  typeof row.description === "string" ? row.description : null,
              }]
            : [];
        })
      : [];
  const options = parseOptions(choices.options);
  const questions = Array.isArray(choices.questions)
    ? choices.questions.flatMap((question, index) => {
        const row = record(question);
        const prompt = typeof row.question === "string" ? row.question.trim() : "";
        const questionOptions = parseOptions(row.options);
        return prompt && questionOptions.length >= 2
          ? [{
              id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `question-${index + 1}`,
              prompt,
              options: questionOptions,
            }]
          : [];
      })
    : [];
  if (questions.length >= 2)
    return { kind: "choice_batch", messageId, questions: questions.slice(0, 4) };
  if (
    typeof choices.question === "string" &&
    choices.question.trim() &&
    options.length >= 2 &&
    options.length <= 6
  )
    return {
      kind: "choice",
      messageId,
      prompt: choices.question.trim(),
      options,
    };
  return null;
}

async function requireActor(ctx: Parameters<typeof getAuthenticatedActor>[0]) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor)
    throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

async function requireOwnedThread(
  ctx: Parameters<typeof getAuthenticatedActor>[0],
  threadId: Id<"spectraThreads">,
) {
  const actor = await requireActor(ctx);
  const thread = await ctx.db.get(threadId);
  if (
    !thread ||
    thread.ownerAccountId !== actor._id ||
    thread.schoolId !== actor.schoolId ||
    thread.status === "deleted"
  ) {
    throw new Error("Thread not found");
  }
  return { actor, thread };
}

export const create = mutation({
  args: {
    title: v.optional(v.string()),
    origin: vOrigin,
    workspaceId: v.optional(v.id("spectraWorkspaces")),
    artifactId: v.optional(v.id("spectraArtifacts")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    if (args.workspaceId)
      await requireWorkspaceCapability(ctx, args.workspaceId, "read");
    if (args.artifactId)
      await requireArtifactCapability(ctx, args.artifactId, "read");
    const now = Date.now();
    const threadId = await ctx.db.insert("spectraThreads", {
      ownerAccountId: actor._id,
      schoolId: actor.schoolId,
      title: args.title?.trim().slice(0, 88) || "New thread",
      origin: args.origin,
      workspaceId: args.workspaceId,
      artifactId: args.artifactId,
      status: "active",
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ensureThreadWorkspacePlacement(ctx, {
      threadId,
      ownerAccountId: actor._id,
      workspaceId: args.workspaceId,
      summary: "Conversation ready",
    });
    if (args.workspaceId) {
      await ctx.db.patch(args.workspaceId, {
        updatedAt: now,
        lastActivityAt: now,
      });
    }
    return threadId;
  },
});

export const appendMessage = mutation({
  args: {
    threadId: v.id("spectraThreads"),
    role: vRole,
    content: v.string(),
    runId: v.optional(v.id("spectraAiRuns")),
    executionId: v.optional(v.string()),
    clientMessageId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { actor, thread } = await requireOwnedThread(ctx, args.threadId);
    const content = cleanContent(args.content);
    if (!content) throw new Error("Message content is required");
    if (args.clientMessageId) {
      const existing = await ctx.db
        .query("spectraMessages")
        .withIndex("by_thread_client", (q) =>
          q
            .eq("threadId", args.threadId)
            .eq("clientMessageId", args.clientMessageId),
        )
        .unique();
      if (existing) return existing._id;
    }
    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (
        !args.executionId ||
        !run ||
        run.ownerAccountId !== thread.ownerAccountId ||
        run.threadId !== args.threadId ||
        run.executionId !== args.executionId
      )
        throw new Error("AI run not found");
      const partial =
        args.metadata &&
        typeof args.metadata === "object" &&
        (args.metadata as { partial?: unknown }).partial === true;
      if (partial && run.status !== "running")
        throw new Error("This run is no longer streaming.");
      if (args.role === "assistant") {
        const existing = (
          await ctx.db
            .query("spectraMessages")
            .withIndex("by_run", (q) => q.eq("runId", args.runId))
            .collect()
        ).find((message) => message.role === "assistant");
        if (existing) {
          // A retry is a new attempt of the same canonical run. Replace the
          // prior assistant attempt in place for identity, but move it to the
          // current end of the conversation so a successful retry cannot stay
          // stranded above newer trace rows or stale clarification UI.
          const now = Date.now();
          await ctx.db.patch(existing._id, {
            content,
            metadata: args.metadata,
            createdAt: now,
          });
          await ctx.db.patch(args.threadId, {
            lastMessageAt: now,
            lastRunId: args.runId,
            updatedAt: now,
            readSchemaVersion: THREAD_READ_SCHEMA_VERSION,
          });
          await ctx.db.patch(args.runId, {
            dockSummary: {
              ...(run.dockSummary ?? { recentSteps: [] }),
              inputRequest: choiceRequest(args.metadata, existing._id) ?? undefined,
            },
          });
          return existing._id;
        }
      }
    }
    const currentMessageCount =
      thread.messageCount ??
      (await ctx.db
        .query("spectraMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
        .collect()).length;
    const now = Date.now();
    const messageId = await ctx.db.insert("spectraMessages", {
      threadId: args.threadId,
      schoolId: actor.schoolId,
      role: args.role,
      content,
      runId: args.runId,
      clientMessageId: args.clientMessageId,
      metadata: args.metadata,
      createdAt: now,
      ordinal: currentMessageCount + 1,
    });
    const firstUserMessage = args.role === "user" && currentMessageCount === 0;
    await ctx.db.patch(args.threadId, {
      title:
        firstUserMessage && thread.title === "New thread"
          ? cleanTitle(content)
          : thread.title,
      messageCount: (thread.messageCount ?? 0) + 1,
      messageCount: currentMessageCount + 1,
      previewText: previewContent(content),
      lastMessageAt: now,
      lastRunId: args.runId ?? thread.lastRunId,
      updatedAt: now,
      readSchemaVersion: THREAD_READ_SCHEMA_VERSION,
    });
    if (args.role === "assistant" && args.runId) {
      const run = await ctx.db.get(args.runId);
      if (run)
        await ctx.db.patch(run._id, {
          dockSummary: {
            ...(run.dockSummary ?? { recentSteps: [] }),
            inputRequest: choiceRequest(args.metadata, messageId) ?? undefined,
          },
        });
    }
    if (args.role === "user" || args.role === "assistant")
      await incrementOperationalCounter(ctx, {
        schoolId: actor.schoolId,
        category: "thread_message",
        dimension: args.role,
        occurredAt: now,
      });
    return messageId;
  },
});

export const selectMessageChoice = mutation({
  args: {
    messageId: v.id("spectraMessages"),
    choiceKey: v.string(),
    choiceTitle: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("This choice is no longer available.");
    await requireOwnedThread(ctx, message.threadId);
    const metadata =
      message.metadata && typeof message.metadata === "object"
        ? (message.metadata as Record<string, unknown>)
        : {};
    const existing = metadata.choiceSelection;
    if (existing && typeof existing === "object") {
      const row = existing as { key?: unknown; title?: unknown };
      if (row.key === args.choiceKey)
        return {
          selected: true,
          alreadySelected: true,
          choiceTitle: row.title,
        };
      throw new Error("A choice was already selected for this question.");
    }
    const now = Date.now();
    await ctx.db.patch(args.messageId, {
      metadata: {
        ...metadata,
        choiceSelection: {
          key: args.choiceKey.slice(0, 120),
          title: args.choiceTitle.slice(0, 200),
          selectedAt: now,
        },
      },
    });
    if (message.runId) {
      const run = await ctx.db.get(message.runId);
      if (run) {
        const sequence = (run.eventSequence ?? 0) + 1;
        await ctx.db.insert("spectraRunEvents", {
          runId: run._id,
          executionId: run.executionId ?? "choice",
          sequence,
          type: "choice_selected",
          payload: {
            type: "choice_selected",
            runId: run._id,
            choiceTitle: args.choiceTitle.slice(0, 200),
          },
          createdAt: now,
        });
        await ctx.db.patch(run._id, {
          eventSequence: sequence,
          dockSummary: {
            ...(run.dockSummary ?? { recentSteps: [] }),
            inputRequest: undefined,
          },
          updatedAt: now,
        });
      }
    }
    return {
      selected: true,
      alreadySelected: false,
      choiceTitle: args.choiceTitle.slice(0, 200),
    };
  },
});

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 80, 200));
    const includeArchived = args.includeArchived === true;
    const requestedCursor = assertThreadListCursor(args.cursor, actor, includeArchived);
    const status = requestedCursor?.status ?? "active";
    const convexCursor = requestedCursor?.cursor ?? null;
    const page = await ctx.db
      .query("spectraThreads")
      .withIndex("by_account_school_status_updated", (q) =>
        q
          .eq("ownerAccountId", actor._id)
          .eq("schoolId", actor.schoolId)
          .eq("status", status),
      )
      .order("desc")
      .paginate({ cursor: convexCursor, numItems: limit });
    const visible = page.page;
    const nextCursor = page.isDone
      ? includeArchived && status === "active"
        ? encodeCursor({
            version: LIST_CURSOR_VERSION,
            kind: "thread-list",
            ownerAccountId: String(actor._id),
            schoolId: String(actor.schoolId),
            includeArchived,
            status: "archived",
            cursor: null,
          } satisfies ThreadListCursor)
        : null
      : encodeCursor({
          version: LIST_CURSOR_VERSION,
          kind: "thread-list",
          ownerAccountId: String(actor._id),
          schoolId: String(actor.schoolId),
          includeArchived,
          status,
          cursor: page.continueCursor,
        } satisfies ThreadListCursor);
    const workspaceIds = [...new Set(visible.flatMap((thread) =>
      [thread.workspaceId, ...(thread.contextWorkspaceIds ?? [])].filter(Boolean).map(String),
    ))].slice(0, limit * 8);
    const artifactIds = [...new Set(visible.flatMap((thread) =>
      [thread.artifactId, ...(thread.contextArtifactIds ?? [])].filter(Boolean).map(String),
    ))].slice(0, limit * 8);
    const [workspaces, artifacts] = await Promise.all([
      Promise.all(workspaceIds.map(async (id) => {
        try {
          const access = await requireWorkspaceCapability(ctx, id as Id<"spectraWorkspaces">, "read");
          return access.workspace.status === "active" ? { id, title: access.workspace.title } : null;
        } catch { return null; }
      })),
      Promise.all(artifactIds.map(async (id) => {
        try {
          const access = await requireArtifactCapability(ctx, id as Id<"spectraArtifacts">, "read");
          return access.artifact.status !== "deleted" ? { id, title: access.artifact.title } : null;
        } catch { return null; }
      })),
    ]);
    const workspaceById = new Map(workspaces.filter(Boolean).map((row) => [row!.id, row!]));
    const artifactById = new Map(artifacts.filter(Boolean).map((row) => [row!.id, row!]));
    return {
      threads: visible.map((thread) => ({
        ...compactThread(thread),
        contexts: {
          workspaces: [thread.workspaceId, ...(thread.contextWorkspaceIds ?? [])]
            .filter(Boolean).map(String).map((id) => workspaceById.get(id)).filter(Boolean),
          artifacts: [thread.artifactId, ...(thread.contextArtifactIds ?? [])]
            .filter(Boolean).map(String).map((id) => artifactById.get(id)).filter(Boolean),
        },
      })),
      hasMore: nextCursor !== null,
      nextCursor,
    };
  },
});

export const get = query({
  args: { threadId: v.id("spectraThreads") },
  handler: async (ctx, args) => {
    const { actor, thread } = await requireOwnedThread(ctx, args.threadId);
    const derivedArtifact = thread.artifactId
      ? null
      : (
          await ctx.db
            .query("spectraArtifacts")
            .withIndex("by_created_thread", (q) =>
              q.eq("createdFrom.threadId", args.threadId),
            )
            .order("desc")
            .take(12)
        ).find(
          (artifact) =>
            artifact.ownerAccountId === actor._id &&
            artifact.status !== "deleted",
        );
    const messagePage = await ctx.db
      .query("spectraMessages")
      .withIndex("by_thread_created", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .paginate({ cursor: null, numItems: INITIAL_MESSAGE_LIMIT });
    const messages = [...messagePage.page].reverse();
    const activeRun = thread.lastRunId ? await ctx.db.get(thread.lastRunId) : null;
    return {
      thread: derivedArtifact
        ? { ...thread, artifactId: derivedArtifact._id }
        : thread,
      messages,
      // Historical trace families are fetched on demand through getRunTrace.
      // Keep the field for old clients during the migration window.
      traces: [],
      messagePage: {
        hasOlder: !messagePage.isDone,
        olderBefore: messagePage.isDone
          ? undefined
          : encodeCursor({
              version: MESSAGE_CURSOR_VERSION,
              kind: "thread-messages",
              threadId: String(args.threadId),
              order: "desc",
              cursor: messagePage.continueCursor,
            } satisfies MessageCursor),
      },
      tracePage: { limit: TRACE_CHILD_LIMIT },
      activeExecution:
        activeRun &&
        activeRun.ownerAccountId === actor._id &&
        activeRun.schoolId === actor.schoolId &&
        ["queued", "running", "awaiting_confirmation", "awaiting_resolution"].includes(activeRun.status)
          ? { run: activeRun }
          : null,
      viewerName: actor.name,
    };
  },
});

export const getSummary = query({
  args: { threadId: v.id("spectraThreads") },
  handler: async (ctx, args) => {
    const { thread } = await requireOwnedThread(ctx, args.threadId);
    return { thread: compactThread(thread) };
  },
});

export const getActiveExecution = query({
  args: { threadId: v.id("spectraThreads") },
  handler: async (ctx, args) => {
    const { actor, thread } = await requireOwnedThread(ctx, args.threadId);
    if (!thread.lastRunId) return null;
    const run = await ctx.db.get(thread.lastRunId);
    if (
      !run ||
      run.threadId !== thread._id ||
      run.ownerAccountId !== actor._id ||
      run.schoolId !== actor.schoolId ||
      !["queued", "running", "awaiting_confirmation", "awaiting_resolution"].includes(run.status)
    )
      return null;
    return {
      run,
    };
  },
});

export const backfillReadMetadata = internalMutation({
  args: { limit: v.optional(v.number()), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const cursor = args.cursor
      ? requireCursor<BackfillCursor>(args.cursor, "thread metadata")
      : null;
    if (
      cursor &&
      (cursor.version !== BACKFILL_CURSOR_VERSION ||
        cursor.kind !== "thread-read-backfill")
    )
      throw new Error("This thread metadata cursor belongs to another migration.");
    const page = await ctx.db
      .query("spectraThreads")
      .order("asc")
      .paginate({ cursor: cursor?.cursor ?? null, numItems: limit });
    let updated = 0;
    for (const thread of page.page) {
      const [lastMessage, runs, created] = await Promise.all([
        ctx.db
          .query("spectraMessages")
          .withIndex("by_thread_created", (q) => q.eq("threadId", thread._id))
          .order("desc")
          .first(),
        ctx.db
          .query("spectraAiRuns")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .order("desc")
          .take(40),
        ctx.db
          .query("spectraArtifacts")
          .withIndex("by_created_thread", (q) =>
            q.eq("createdFrom.threadId", thread._id),
          )
          .order("desc")
          .take(20),
      ]);
      const workspaceIds = new Set<Id<"spectraWorkspaces">>();
      const artifactIds = new Set<Id<"spectraArtifacts">>();
      if (thread.workspaceId) workspaceIds.add(thread.workspaceId);
      if (thread.artifactId) artifactIds.add(thread.artifactId);
      for (const run of runs) {
        if (run.workspaceId) workspaceIds.add(run.workspaceId);
        if (run.artifactId) artifactIds.add(run.artifactId);
      }
      for (const artifact of created) artifactIds.add(artifact._id);
      const patch: Partial<Doc<"spectraThreads">> = {
        previewText: lastMessage ? previewContent(lastMessage.content) : thread.previewText,
        contextWorkspaceIds: [...workspaceIds].slice(-8),
        contextArtifactIds: [...artifactIds].slice(-8),
        lastMessageAt: lastMessage?.createdAt ?? thread.lastMessageAt,
        lastRunId: thread.lastRunId ?? runs[0]?._id,
        readSchemaVersion: THREAD_READ_SCHEMA_VERSION,
      };
      if (thread.messageCount === undefined) {
        patch.messageCount = await ctx.db
          .query("spectraMessages")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .collect()
          .then((messages) => messages.length);
      }
      await ctx.db.patch(thread._id, patch);
      updated += 1;
    }
    const nextCursor = page.isDone
      ? null
      : encodeCursor({
          version: BACKFILL_CURSOR_VERSION,
          kind: "thread-read-backfill",
          cursor: page.continueCursor,
        } satisfies BackfillCursor);
    return {
      scanned: page.page.length,
      updated,
      complete: page.isDone,
      nextCursor,
    };
  },
});

export const listMessages = query({
  args: {
    threadId: v.id("spectraThreads"),
    before: v.optional(v.union(v.string(), v.number())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnedThread(ctx, args.threadId);
    const limit = Math.max(1, Math.min(args.limit ?? MESSAGE_PAGE_LIMIT, 80));
    if (typeof args.before === "number")
      throw new Error("This older message cursor is from an older client. Reload the conversation to continue safely.");
    const cursor = args.before
      ? requireCursor<MessageCursor>(args.before, "message history")
      : null;
    if (
      cursor &&
      (cursor.version !== MESSAGE_CURSOR_VERSION ||
        cursor.kind !== "thread-messages" ||
        cursor.threadId !== String(args.threadId) ||
        cursor.order !== "desc")
    )
      throw new Error("This message cursor belongs to another conversation. Reload the conversation and try again.");
    const page = await ctx.db
      .query("spectraMessages")
      .withIndex("by_thread_created", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .paginate({ cursor: cursor?.cursor ?? null, numItems: limit });
    const messages = [...page.page].reverse();
    return {
      messages,
      hasOlder: !page.isDone,
      olderBefore: page.isDone
        ? undefined
        : encodeCursor({
            version: MESSAGE_CURSOR_VERSION,
            kind: "thread-messages",
            threadId: String(args.threadId),
            order: "desc",
            cursor: page.continueCursor,
          } satisfies MessageCursor),
      nextCursor: page.isDone
        ? null
        : encodeCursor({
            version: MESSAGE_CURSOR_VERSION,
            kind: "thread-messages",
            threadId: String(args.threadId),
            order: "desc",
            cursor: page.continueCursor,
          } satisfies MessageCursor),
    };
  },
});

export const getRunTrace = query({
  args: {
    threadId: v.id("spectraThreads"),
    runId: v.id("spectraAiRuns"),
    family: v.optional(
      v.union(v.literal("operations"), v.literal("cards"), v.literal("events")),
    ),
    eventAfter: v.optional(v.union(v.string(), v.number())),
    operationsBefore: v.optional(v.string()),
    cardsBefore: v.optional(v.string()),
    eventsCursor: v.optional(v.string()),
    skipOperations: v.optional(v.boolean()),
    skipCards: v.optional(v.boolean()),
    skipEvents: v.optional(v.boolean()),
    includeArtifacts: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { actor, thread } = await requireOwnedThread(ctx, args.threadId);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.threadId !== thread._id ||
      run.ownerAccountId !== thread.ownerAccountId ||
      run.schoolId !== actor.schoolId
    )
      throw new Error("AI run not found");
    const limit = Math.max(1, Math.min(args.limit ?? TRACE_CHILD_LIMIT, 100));
    const family =
      args.family ??
      (args.operationsBefore ? "operations" : args.cardsBefore ? "cards" : "events");
    if (
      (family === "operations" && args.skipOperations) ||
      (family === "cards" && args.skipCards) ||
      (family === "events" && args.skipEvents)
    )
      throw new Error("This run history request skipped its selected family.");
    if (
      (args.operationsBefore && family !== "operations") ||
      (args.cardsBefore && family !== "cards") ||
      (args.eventsCursor && family !== "events")
    )
      throw new Error("This run history cursor selected the wrong family. Reopen the run details.");
    const operationCursor = family === "operations" && args.operationsBefore
      ? requireCursor<TraceCursor>(args.operationsBefore, "operation history")
      : null;
    const cardCursor = family === "cards" && args.cardsBefore
      ? requireCursor<TraceCursor>(args.cardsBefore, "result history")
      : null;
    const eventCursor = family === "events" && args.eventsCursor
      ? requireCursor<TraceCursor>(args.eventsCursor, "run progress")
      : null;
    if (
      (operationCursor &&
        (operationCursor.version !== TRACE_CURSOR_VERSION ||
          operationCursor.kind !== "thread-trace" ||
          operationCursor.runId !== String(run._id) ||
          operationCursor.family !== "operations" ||
          operationCursor.order !== "desc")) ||
      (cardCursor &&
        (cardCursor.version !== TRACE_CURSOR_VERSION ||
          cardCursor.kind !== "thread-trace" ||
          cardCursor.runId !== String(run._id) ||
          cardCursor.family !== "cards" ||
          cardCursor.order !== "desc")) ||
      (eventCursor &&
        (eventCursor.version !== TRACE_CURSOR_VERSION ||
          eventCursor.kind !== "thread-trace" ||
          eventCursor.runId !== String(run._id) ||
          eventCursor.family !== "events" ||
          eventCursor.order !== "asc" ||
          typeof eventCursor.after !== "number"))
    )
      throw new Error("This run history cursor belongs to another run. Reopen the run details and try again.");
    if (typeof args.eventAfter === "string" && !args.eventsCursor)
      throw new Error("This run progress cursor is from an older client. Reopen the run details to continue safely.");
    const eventAfter = typeof args.eventAfter === "number" ? args.eventAfter : 0;
    const operationPage = family === "operations"
      ? await ctx.db
          .query("spectraOperations")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .order("desc")
          .paginate({ cursor: operationCursor?.cursor ?? null, numItems: limit })
      : null;
    const cardPage = family === "cards"
      ? await ctx.db
          .query("spectraResultCards")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .order("desc")
          .paginate({ cursor: cardCursor?.cursor ?? null, numItems: limit })
      : null;
    const eventPage = family === "events"
      ? await (eventCursor
          ? ctx.db
              .query("spectraRunEvents")
              .withIndex("by_run_sequence", (q) =>
                q.eq("runId", run._id).gt("sequence", eventCursor.after!),
              )
              .order("asc")
              .paginate({ cursor: eventCursor.cursor, numItems: limit })
          : ctx.db
              .query("spectraRunEvents")
              .withIndex("by_run_sequence", (q) =>
                q.eq("runId", run._id).gt("sequence", eventAfter),
              )
              .order("asc")
              .paginate({ cursor: null, numItems: limit }))
      : null;
    const artifactRows =
      family === "operations" && !operationCursor && args.includeArtifacts !== false
      ? await ctx.db
          .query("spectraArtifacts")
          .withIndex("by_ai_run", (q) => q.eq("aiRunId", run._id))
          .order("desc")
          .take(100)
      : [];
    const operations = operationPage ? [...operationPage.page].reverse() : [];
    const cards = cardPage ? [...cardPage.page].reverse() : [];
    const events = eventPage?.page ?? [];
    const artifacts = artifactRows
      .filter(
        (artifact) =>
          artifact.ownerAccountId === actor._id &&
          artifact.schoolId === actor.schoolId &&
          artifact.status !== "deleted",
      )
      .map((artifact) => ({
        _id: artifact._id,
        blueprintKey: artifact.blueprintKey,
        title: artifact.title,
        summary: artifact.summary,
        tags: artifact.tags,
        status: artifact.status,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
      }));
    return {
      run,
      operations,
      cards,
      events,
      artifacts,
      eventPage: eventPage
        ? {
            hasMore: !eventPage.isDone,
            after: events.at(-1)?.sequence ?? eventAfter,
            nextCursor: eventPage.isDone
              ? null
              : childCursor(run._id, "events", "asc", eventPage.continueCursor, eventAfter),
          }
        : undefined,
      operationPage: operationPage
        ? {
            hasMore: !operationPage.isDone,
            before: operationPage.isDone
              ? null
              : childCursor(run._id, "operations", "desc", operationPage.continueCursor),
          }
        : undefined,
      cardPage: cardPage
        ? {
            hasMore: !cardPage.isDone,
            before: cardPage.isDone
              ? null
              : childCursor(run._id, "cards", "desc", cardPage.continueCursor),
          }
        : undefined,
    };
  },
});

export const update = mutation({
  args: {
    threadId: v.id("spectraThreads"),
    title: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
    workspaceId: v.optional(v.union(v.id("spectraWorkspaces"), v.null())),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
  },
  handler: async (ctx, args) => {
    const { actor, thread } = await requireOwnedThread(ctx, args.threadId);
    if (args.workspaceId) {
      const workspace = await ctx.db.get(args.workspaceId);
      if (
        !workspace ||
        workspace.ownerAccountId !== actor._id ||
        workspace.schoolId !== actor.schoolId ||
        workspace.status !== "active"
      )
        throw new Error("Workspace not found");
    }
    const nextWorkspaceId =
      args.workspaceId === undefined
        ? thread.workspaceId
        : (args.workspaceId ?? undefined);
    const now = Date.now();
    const title =
      args.title === undefined ? thread.title : cleanTitle(args.title);
    await ctx.db.patch(args.threadId, {
      title,
      pinned: args.pinned ?? thread.pinned,
      workspaceId: nextWorkspaceId,
      status: args.status ?? thread.status,
      updatedAt: now,
      readSchemaVersion: THREAD_READ_SCHEMA_VERSION,
    });
    /* The tree is what the reader sees, so the new name, pin and home land there
       in this same transaction. A changed workspace moves the thread's one node
       (I1, I4) instead of hiding a row here and inserting one there; clearing the
       workspace moves it to General, because a thread is never homeless (D31). */
    await placeSourceNode(ctx, {
      accountId: thread.ownerAccountId,
      schoolId: thread.schoolId,
      kind: "thread",
      sourceId: args.threadId,
      name: title,
      target: nextWorkspaceId ? { workspaceId: nextWorkspaceId } : {},
      relocate:
        args.workspaceId !== undefined &&
        nextWorkspaceId !== thread.workspaceId,
      pinned: args.pinned ?? thread.pinned,
    });
    return { threadId: args.threadId };
  },
});

export const applyGeneratedMetadata = mutation({
  args: {
    threadId: v.id("spectraThreads"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { thread } = await requireOwnedThread(ctx, args.threadId);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.threadId !== args.threadId ||
      (run.status !== "running" && run.status !== "completed") ||
      run.executionId !== args.executionId
    )
      throw new Error("This title belongs to an older run attempt.");
    const messageCount = thread.messageCount ?? 0;
    const provisionalTitle =
      thread.title === "New thread" || thread.title.split(/\s+/).length >= 8;
    // Sparse title windows avoid sidebar instability while allowing a weak
    // first-prompt title to improve once the purpose becomes clear.
    const mayRetitle =
      messageCount <= 2 ||
      provisionalTitle ||
      (messageCount >= 6 && messageCount <= 8) ||
      (messageCount >= 16 && messageCount <= 18);
    const title =
      mayRetitle && args.title ? cleanTitle(args.title) : thread.title;
    const summary =
      args.summary?.replace(/\s+/g, " ").trim().slice(0, 320) ||
      thread.summaryShort;
    const now = Date.now();
    await ctx.db.patch(args.threadId, {
      title,
      summaryShort: summary,
      updatedAt: now,
      readSchemaVersion: THREAD_READ_SCHEMA_VERSION,
    });
    if (title !== thread.title)
      await syncSourceNodes(ctx, "thread", args.threadId, title);
    return { threadId: args.threadId };
  },
});

export const createFromRun = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    placeInWorkspace: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.ownerAccountId !== actor._id ||
      run.schoolId !== actor.schoolId
    )
      throw new Error("AI run not found");
    if (!run.threadId)
      throw new Error("This older run has no conversation to keep.");
    const thread = await ctx.db.get(run.threadId);
    if (
      !thread ||
      thread.ownerAccountId !== actor._id ||
      thread.status === "deleted"
    )
      throw new Error("Thread not found");
    const nodeId = args.placeInWorkspace
      ? await ensureThreadWorkspacePlacement(ctx, {
          threadId: thread._id,
          workspaceId: thread.workspaceId,
          summary: thread.summaryShort ?? run.finalSummary?.slice(0, 240),
          pinned: true,
        })
      : undefined;
    return { threadId: thread._id, nodeId };
  },
});

// Explicit one-way repair for rows created before threads became first-class
// workspace items. Runtime code never creates thread-reference artifacts.
export const migrateLegacyThreadReferences = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const legacy = await ctx.db
      .query("spectraArtifacts")
      .filter((q) => q.eq(q.field("blueprintKey"), "thread_reference"))
      .take(Math.max(1, Math.min(args.limit ?? 100, 500)));
    let migrated = 0;
    let removed = 0;
    for (const artifact of legacy) {
      const rawThreadId = (artifact.content as { threadId?: unknown } | null)
        ?.threadId;
      const threadId =
        typeof rawThreadId === "string"
          ? ctx.db.normalizeId("spectraThreads", rawThreadId)
          : null;
      const thread = threadId ? await ctx.db.get(threadId) : null;
      /* The reference artifact's own node tells us where a reader had filed it,
         which is where the real thread should end up. */
      const referenceNode = await findPrimaryNode(
        ctx,
        artifact.ownerAccountId,
        "work",
        artifact._id,
      );
      if (
        thread &&
        thread.ownerAccountId === artifact.ownerAccountId &&
        thread.schoolId === artifact.schoolId &&
        thread.status !== "deleted"
      ) {
        const destination =
          thread.workspaceId ?? referenceNode?.workspaceContextId;
        if (destination && !thread.workspaceId)
          await ctx.db.patch(thread._id, {
            workspaceId: destination,
            updatedAt: Date.now(),
            readSchemaVersion: THREAD_READ_SCHEMA_VERSION,
          });
        await ensureThreadWorkspacePlacement(ctx, {
          threadId: thread._id,
          workspaceId: destination,
          summary: thread.summaryShort ?? artifact.summary,
          pinned: referenceNode?.pinned === true,
        });
        migrated += 1;
      }
      const versions = await ctx.db
        .query("spectraArtifactVersions")
        .withIndex("by_artifact_created", (q) =>
          q.eq("artifactId", artifact._id),
        )
        .collect();
      const [outgoing, incoming] = await Promise.all([
        ctx.db
          .query("spectraArtifactLinks")
          .withIndex("by_source", (q) => q.eq("sourceArtifactId", artifact._id))
          .collect(),
        ctx.db
          .query("spectraArtifactLinks")
          .withIndex("by_target", (q) => q.eq("targetArtifactId", artifact._id))
          .collect(),
      ]);
      const links = [
        ...new Map(
          [...outgoing, ...incoming].map((link) => [link._id, link]),
        ).values(),
      ];
      await purgeSourceNodes(ctx, "work", artifact._id);
      await Promise.all([
        ...versions.map((version) => ctx.db.delete(version._id)),
        ...links.map((link) => ctx.db.delete(link._id)),
      ]);
      await ctx.db.delete(artifact._id);
      await syncArtifactSummary(ctx, artifact._id);
      removed += 1;
    }
    return {
      scanned: legacy.length,
      migrated,
      removed,
      complete: legacy.length < Math.max(1, Math.min(args.limit ?? 100, 500)),
    };
  },
});
