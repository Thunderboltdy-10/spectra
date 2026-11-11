import { query } from "./functions";
import { internalMutation, mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthenticatedActor, getOptionalAuthenticatedActor } from "./identityShared";
import {
  ensureThreadWorkspacePlacement,
  requireArtifactCapability,
  requireWorkspaceCapability,
} from "./spectraShared";
import {
  artifactSummaryFor,
  findPrimaryNode,
  placeSourceNode,
  purgeSourceNodes,
  syncSourceNodes,
} from "./orgTreeShared";
import { incrementOperationalCounter } from "./operationalCounters";
import {
  evaluateAccessForActorWithLoadedResource,
  evaluateArtifactAccessForActorWithSummary,
} from "./authorityShared";
import { releaseSnapshotObject } from "./artifactSnapshots";
import { lastRunEventSequence, RUN_TAB_PROJECTION_VERSION } from "./spectraRunProjection";

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
  const json = JSON.stringify(value);
  // Convex functions run on a web-standard runtime where Node's Buffer is not
  // guaranteed to exist. The list endpoint only encodes bounded ASCII cursor
  // metadata, so use the platform encoder when available and retain the Node
  // fallback for local tooling/tests.
  const base64 =
    typeof btoa === "function"
      ? btoa(json)
      : Buffer.from(json, "utf8").toString("base64");
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursor<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
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
    cursor.cursor !== null && typeof cursor.cursor !== "string"
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

/** The names a thread is born with, before its first message names it. */
const BIRTH_TITLE = /^(new (thread|conversation|chat)|untitled)$/i;

/** A one-line preview: a reply's citations drop out, and a reference reads as its label. */
function previewContent(value: string) {
  return value
    .replace(/\s?\[\[cite:[^\]]*\]\]/g, "")
    .replace(/\[\[ref:[^\]|]+(?:\|([^\]]+))?\]\]/g, (_match, label: string | undefined) => label ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
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

function compactActiveExecution(
  run: Pick<Doc<"spectraAiRuns">, "_id" | "executionId" | "status" | "phase" | "updatedAt">,
) {
  return {
    _id: run._id,
    executionId: run.executionId,
    status: run.status,
    phase: run.phase,
    updatedAt: run.updatedAt,
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

/**
 * The caption writer's name for a thread (already 2-6 words, sentence case),
 * tidied but not rewritten: stripping words would make it worse.
 */
function generatedTitle(value: string) {
  const title = value
    .replace(/[`*_#<>"“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:]+$/, "")
    .split(" ")
    .slice(0, 8)
    .join(" ")
    .slice(0, 80)
    .trim();
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : "";
}

/** A name the owner typed: their words, tidied, never rewritten. */
function ownerTitle(value: string) {
  const title = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 88)
    .trim();
  if (!title) throw new Error("A chat name is required.");
  return title;
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

type ChoiceOption = { key: string; title: string; description: string | null };
type ChoiceBatchSelection = { questionId: string; choiceKey: string; choiceTitle: string };
type ChoiceRequest =
  | { kind: "choice"; messageId: string; clarificationId?: string; executionId?: string; prompt: string; options: ChoiceOption[] }
  | { kind: "choice_batch"; messageId: string; clarificationId?: string; executionId?: string; questions: Array<{ id: string; prompt: string; options: ChoiceOption[] }> };

const MAX_CHOICE_KEY_LENGTH = 120;

function boundedChoiceKey(
  value: unknown,
  index: number,
  prefix: string,
  usedKeys: Set<string>,
) {
  const supplied = typeof value === "string" ? value.trim() : "";
  const source = supplied || (typeof value === "string" ? value : "option");
  const slug = source
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  const base = (supplied || `${prefix}:${index}:${slug || "option"}`).slice(
    0,
    MAX_CHOICE_KEY_LENGTH,
  );
  if (!usedKeys.has(base)) {
    usedKeys.add(base);
    return base;
  }
  let suffix = 2;
  let key = base;
  while (usedKeys.has(key)) {
    const suffixText = `:${suffix++}`;
    key = `${base.slice(0, MAX_CHOICE_KEY_LENGTH - suffixText.length)}${suffixText}`;
  }
  usedKeys.add(key);
  return key;
}

function parseChoiceOptions(value: unknown, prefix: string) {
  const usedKeys = new Set<string>();
  return Array.isArray(value)
    ? value.flatMap((option, index) => {
        const row = record(option);
        const title = typeof row.title === "string" ? row.title.trim() : "";
        if (!title) return [];
        return [{
          key: boundedChoiceKey(row.key, index, prefix, usedKeys),
          title,
          description:
            typeof row.description === "string" ? row.description.trim() || null : null,
        } satisfies ChoiceOption];
      })
    : [];
}

function choiceRequest(metadata: unknown, messageId: string): ChoiceRequest | null {
  const choices = record(record(metadata).choices);
  const identity = record(record(metadata).clarification);
  const identityFields: Pick<Extract<ChoiceRequest, { kind: "choice" }>, "clarificationId" | "executionId"> = typeof identity.id === "string" && typeof identity.executionId === "string"
    ? { clarificationId: identity.id, executionId: identity.executionId }
    : {};
  const options = parseChoiceOptions(choices.options, "choice");
  const questions = Array.isArray(choices.questions)
    ? choices.questions.flatMap((question, index) => {
        const row = record(question);
        const prompt = typeof row.question === "string" ? row.question.trim() : "";
        const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `question-${index + 1}`;
        const questionOptions = parseChoiceOptions(row.options, id);
        return prompt && questionOptions.length >= 2
              ? [{
                  id,
                  prompt,
                  options: questionOptions,
                }]
          : [];
      })
    : [];
  if (
    questions.length >= 2 &&
    new Set(questions.map((question) => question.id)).size !== questions.length
  )
    return null;
  if (questions.length >= 2)
    return { kind: "choice_batch", messageId, ...identityFields, questions: questions.slice(0, 4) };
  if (
    typeof choices.question === "string" &&
    choices.question.trim() &&
    options.length >= 2
  )
    return {
      kind: "choice",
      messageId,
      ...identityFields,
      prompt: choices.question.trim(),
      options,
    };
  return null;
}

function clarificationTargets(run: Doc<"spectraAiRuns">) {
  const snapshot = record(run.contextSnapshot);
  const ids = [
    run.artifactId ? String(run.artifactId) : undefined,
    ...([...(Array.isArray(snapshot.open) ? snapshot.open : []), ...(Array.isArray(snapshot.references) ? snapshot.references : [])] as Array<Record<string, unknown>>).flatMap((item) => typeof item?.id === "string" ? [item.id] : []),
    ...((Array.isArray(snapshot.targetResolutions) ? snapshot.targetResolutions : []) as Array<Record<string, unknown>>).flatMap((item) => [
      ...(typeof item.resolvedArtifactId === "string" ? [item.resolvedArtifactId] : []),
      ...(Array.isArray(item.candidates)
        ? (item.candidates as Array<Record<string, unknown>>).flatMap((candidate) =>
            typeof candidate.id === "string" ? [candidate.id] : [],
          )
        : []),
    ]),
  ];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 32);
}

function validateChoiceSelection(
  clarification: Record<string, unknown>,
  choiceKey: string,
  choiceTitle: string,
  batchSelections: ChoiceBatchSelection[] | undefined,
) {
  const questions = Array.isArray(clarification.questions)
    ? clarification.questions.map((question) => record(question))
    : [];
  if (questions.length > 0) {
    if (choiceKey !== "batch" || !batchSelections || batchSelections.length !== questions.length)
      throw new Error("This batch clarification requires one exact answer per question.");
    const questionIds = questions.map((question) =>
      typeof question.id === "string" ? question.id : "",
    );
    if (
      questionIds.some((id) => !id) ||
      new Set(questionIds).size !== questionIds.length
    )
      throw new Error("This clarification has duplicate question ids. Start a new request.");
    const submittedIds = batchSelections.map((selection) => selection.questionId);
    if (
      new Set(submittedIds).size !== submittedIds.length ||
      submittedIds.some((id) => !questionIds.includes(id))
    )
      throw new Error("Each batch answer must belong to its original question.");
    const selections = questions.map((question, index) => {
      const questionId = questionIds[index]!;
      const submitted = batchSelections.find((selection) => selection.questionId === questionId);
      if (!submitted)
        throw new Error("This batch clarification requires one exact answer per question.");
      const submittedTitle = submitted.choiceTitle.trim();
      if (submitted.choiceKey === "skip") {
        if (submittedTitle !== "Skipped")
          throw new Error("Skipped is the only valid skip value.");
        return { questionId, choiceKey: "skip", choiceTitle: "Skipped" };
      }
      const offeredOptions = Array.isArray(question.options)
        ? question.options.map((option) => record(option))
        : [];
      const offered = offeredOptions.find((option) => option.key === submitted.choiceKey);
      if (
        !offered ||
        typeof offered.title !== "string" ||
        offered.title.trim() !== submittedTitle
      )
        throw new Error("That answer was not offered for its question.");
      return {
        questionId,
        choiceKey: submitted.choiceKey,
        choiceTitle: submittedTitle,
      };
    });
    const canonicalTitle = selections
      .map((selection, index) => `${index + 1}) ${selection.choiceTitle}`)
      .join("; ");
    return { canonicalTitle, selections };
  }
  const offeredOptions = Array.isArray(clarification.options)
    ? clarification.options.map((option) => record(option))
    : [];
  const offered = offeredOptions.find((option) => option.key === choiceKey);
  if (choiceKey === "skip" && choiceTitle.trim() === "Skipped")
    return { canonicalTitle: "Skipped", selections: undefined };
  if (
    !offered ||
    typeof offered.title !== "string" ||
    offered.title.trim() !== choiceTitle.trim()
  )
    throw new Error("That choice was not offered for this request. Choose one of the current options.");
  return { canonicalTitle: offered.title.trim(), selections: undefined };
}

function sameBatchSelections(left: unknown, right: ChoiceBatchSelection[] | undefined) {
  if (!right) return left === undefined;
  if (!Array.isArray(left) || left.length !== right.length) return false;
  return right.every((selection) => {
    const row = record(left.find((item) => record(item).questionId === selection.questionId));
    return row.choiceKey === selection.choiceKey && row.choiceTitle === selection.choiceTitle;
  });
}

function withClarificationIdentity(metadata: unknown, messageId: Id<"spectraMessages">, run: Doc<"spectraAiRuns">) {
  const base = record(metadata);
  const request = choiceRequest(base, String(messageId));
  if (!request) return { metadata: base, clarification: null };
  const offered = request.kind === "choice"
    ? request.options
    : request.questions.flatMap((question) => question.options.map((option) => ({ ...option, key: `${question.id}:${option.key}` })));
  const clarificationId = `clarification:${crypto.randomUUID()}`;
  const clarification = {
    id: clarificationId,
    messageId,
    executionId: run.executionId ?? "legacy",
    status: "pending" as const,
    options: offered.map((option) => ({ key: option.key, title: option.title, ...(option.description ? { description: option.description } : {}) })),
    ...(request.kind === "choice_batch"
      ? {
          questions: request.questions.map((question) => ({
            id: question.id,
            prompt: question.prompt,
            options: question.options.map((option) => ({
              key: option.key,
              title: option.title,
              ...(option.description ? { description: option.description } : {}),
            })),
          })),
        }
      : {}),
    targetIds: clarificationTargets(run),
    targetRevisions: record(run.contextSnapshot).targetRevisions,
    authority: { ownerAccountId: String(run.ownerAccountId), ...(run.schoolId ? { schoolId: String(run.schoolId) } : {}), capturedAt: Date.now() },
    createdAt: Date.now(),
  };
  return {
    metadata: {
      ...base,
      choices:
        request.kind === "choice"
          ? { ...record(base.choices), options: request.options }
          : base.choices,
      clarification,
    },
    clarification,
  };
}

/** Run states a thread is still moving in. */
const LIVE_RUN_STATUSES = ["queued", "running", "awaiting_confirmation", "awaiting_resolution"] as const;

/**
 * The account's live pulse: when its threads last changed and which runs are
 * moving. Every open page subscribes to this one small read instead of
 * polling lists; a change tells the page to refresh what it shows (the rail's
 * threads, the island's run tabs). It reads one thread row and the few live
 * runs, so it re-runs only when one of those moves.
 */
export const pulse = query({
  args: {},
  handler: async (ctx) => {
    const actor = await getOptionalAuthenticatedActor(ctx);
    if (!actor) return null;
    const latest = await ctx.db
      .query("spectraThreads")
      .withIndex("by_account_school_status_updated", (q) =>
        q.eq("ownerAccountId", actor.accountId).eq("schoolId", actor.schoolId).eq("status", "active"),
      )
      .order("desc")
      .first();
    const live = (
      await Promise.all(
        LIVE_RUN_STATUSES.map((status) =>
          ctx.db
            .query("spectraAiRuns")
            .withIndex("by_account_status", (q) => q.eq("ownerAccountId", actor.accountId).eq("status", status))
            .take(20),
        ),
      )
    )
      .flat()
      .map((run) => `${run._id}:${run.status}`)
      .sort();
    return { threadsAt: latest?.updatedAt ?? 0, live };
  },
});

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

async function selectedActiveExecution(
  ctx: Parameters<typeof getAuthenticatedActor>[0],
  { actor, thread }: Awaited<ReturnType<typeof requireOwnedThread>>,
) {
  const runId = thread.lastRunId;
  if (!runId) return null;
  const tab = await ctx.db
    .query("spectraRunTabs")
    .withIndex("by_account_run", (q) =>
      q.eq("ownerAccountId", actor._id).eq("runId", runId),
    )
    .first();
  let run: NonNullable<Doc<"spectraRunTabs">["runSummary"]>;
  if (
    tab?.ownerAccountId === actor._id &&
    tab.schoolId === actor.schoolId &&
    tab.threadId === thread._id &&
    tab.runId === runId &&
    tab.projectionVersion === RUN_TAB_PROJECTION_VERSION &&
    tab.runSummary?._id === runId &&
    tab.runSummary.threadId === thread._id
  ) {
    run = tab.runSummary;
  } else {
    // Legacy or inconsistent projections need only the selected canonical row.
    const canonicalRun = await ctx.db.get(runId);
    if (
      !canonicalRun ||
      canonicalRun._id !== runId ||
      canonicalRun.ownerAccountId !== actor._id ||
      canonicalRun.schoolId !== actor.schoolId ||
      canonicalRun.threadId !== thread._id
    ) return null;
    run = canonicalRun;
  }
  return ["queued", "running", "awaiting_confirmation", "awaiting_resolution"].includes(run.status)
    ? { run: compactActiveExecution(run) }
    : null;
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
          const enriched = withClarificationIdentity(args.metadata, existing._id, run);
          await ctx.db.patch(existing._id, {
            content,
            metadata: enriched.metadata,
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
              inputRequest: choiceRequest(enriched.metadata, existing._id) ?? undefined,
            },
            ...(enriched.clarification ? { clarification: enriched.clarification } : { clarification: undefined }),
          });
          return existing._id;
        }
      }
    }
    const currentMessageCount = thread.messageCount;
    const lastOrdinal = await ctx.db
      .query("spectraMessages")
      .withIndex("by_thread_ordinal", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .first();
    const nextOrdinal = (lastOrdinal?.ordinal ?? 0) + 1;
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
      ordinal: nextOrdinal,
    });
    if (args.role === "assistant" && args.runId) {
      const run = await ctx.db.get(args.runId);
      if (run) {
        const enriched = withClarificationIdentity(args.metadata, messageId, run);
        await ctx.db.patch(messageId, { metadata: enriched.metadata });
        if (enriched.clarification)
          await ctx.db.patch(run._id, {
            clarification: enriched.clarification,
            dockSummary: {
              ...(run.dockSummary ?? { recentSteps: [] }),
              inputRequest: choiceRequest(enriched.metadata, messageId) ?? undefined,
            },
          });
      }
    }
    const firstUserMessage = args.role === "user" && currentMessageCount === 0;
    await ctx.db.patch(args.threadId, {
      title:
        firstUserMessage && BIRTH_TITLE.test(thread.title.trim())
          ? cleanTitle(content)
          : thread.title,
      ...(currentMessageCount === undefined
        ? {}
        : { messageCount: currentMessageCount + 1 }),
      previewText: previewContent(content),
      lastMessageAt: now,
      lastRunId: args.runId ?? thread.lastRunId,
      updatedAt: now,
      readSchemaVersion: THREAD_READ_SCHEMA_VERSION,
    });
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
    clarificationId: v.optional(v.string()),
    executionId: v.optional(v.string()),
    choiceKey: v.string(),
    choiceTitle: v.string(),
    batchSelections: v.optional(v.array(v.object({
      questionId: v.string(),
      choiceKey: v.string(),
      choiceTitle: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("This choice is no longer available.");
    await requireOwnedThread(ctx, message.threadId);
    const metadata =
      message.metadata && typeof message.metadata === "object"
        ? (message.metadata as Record<string, unknown>)
        : {};
    const clarification = record(metadata.clarification);
    if (!clarification.id || !Array.isArray(clarification.options))
      throw new Error("This clarification is no longer available. Start a new request.");
    if (args.clarificationId !== clarification.id || !args.executionId || args.executionId !== clarification.executionId)
      throw new Error("This clarification belongs to an older run attempt. Start a new request.");
    if (message.runId) {
      const run = await ctx.db.get(message.runId);
      if (!run || run.executionId !== args.executionId || run.status !== "awaiting_resolution")
        throw new Error("This clarification is no longer active. Start a new request.");
    }
    const validated = validateChoiceSelection(
      clarification,
      args.choiceKey,
      args.choiceTitle,
      args.batchSelections,
    );
    const existing = metadata.choiceSelection;
    if (existing && typeof existing === "object") {
      const row = existing as { key?: unknown; title?: unknown };
      if (
        row.key === args.choiceKey &&
        row.title === validated.canonicalTitle &&
        sameBatchSelections((existing as { selections?: unknown }).selections, validated.selections)
      )
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
          clarificationId: clarification.id,
          executionId: args.executionId,
          key: args.choiceKey,
          title: validated.canonicalTitle,
          ...(validated.selections ? { selections: validated.selections } : {}),
          selectedAt: now,
        },
      },
    });
    if (message.runId) {
      const run = await ctx.db.get(message.runId);
      if (run) {
        const sequence = (await lastRunEventSequence(ctx, run)) + 1;
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
          clarification: { ...run.clarification!, status: "selected", selectedAt: now, selectedKey: args.choiceKey },
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
      choiceTitle: validated.canonicalTitle,
    };
  },
});

export const validateChoiceContinuation = query({
  args: {
    messageId: v.id("spectraMessages"),
    clarificationId: v.string(),
    executionId: v.string(),
    choiceKey: v.string(),
    batchSelections: v.optional(v.array(v.object({
      questionId: v.string(),
      choiceKey: v.string(),
      choiceTitle: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("This clarification is no longer available. Start a new request.");
    await requireOwnedThread(ctx, message.threadId);
    const metadata = record(message.metadata);
    const clarification = record(metadata.clarification);
    const selection = record(metadata.choiceSelection);
    if (clarification.id !== args.clarificationId || clarification.executionId !== args.executionId)
      throw new Error("This clarification belongs to an older run attempt. Start a new request.");
    if (message.runId) {
      const run = await ctx.db.get(message.runId);
      if (!run || run.executionId !== args.executionId || run.status !== "awaiting_resolution")
        throw new Error("This clarification is no longer active. Start a new request.");
    }
    const validated = validateChoiceSelection(
      clarification,
      args.choiceKey,
      typeof selection.title === "string" ? selection.title : "",
      args.batchSelections,
    );
    if (selection.key !== args.choiceKey)
      throw new Error("That choice was not selected for this request. Choose one of the current options again.");
    if (selection.title !== validated.canonicalTitle || !sameBatchSelections(selection.selections, validated.selections))
      throw new Error("That batch answer no longer matches the selected options. Choose the current options again.");
    return { valid: true, selected: true };
  },
});

/** Resolve a selected clarification by durable message identity, even when the
 * thread's newest-message page no longer contains the asking message. */
export const getChoiceContinuation = query({
  args: {
    messageId: v.id("spectraMessages"),
    clarificationId: v.string(),
    executionId: v.string(),
    choiceKey: v.string(),
    batchSelections: v.optional(v.array(v.object({
      questionId: v.string(),
      choiceKey: v.string(),
      choiceTitle: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("This clarification is no longer available. Start a new request.");
    const { actor, thread } = await requireOwnedThread(ctx, message.threadId);
    const metadata = record(message.metadata);
    const clarification = record(metadata.clarification);
    const selection = record(metadata.choiceSelection);
    if (
      clarification.id !== args.clarificationId ||
      clarification.executionId !== args.executionId ||
      selection.clarificationId !== args.clarificationId ||
      selection.key !== args.choiceKey
    )
      throw new Error("This clarification belongs to an older run attempt. Start a new request.");
    const validated = validateChoiceSelection(
      clarification,
      args.choiceKey,
      typeof selection.title === "string" ? selection.title : "",
      args.batchSelections,
    );
    if (
      selection.title !== validated.canonicalTitle ||
      !sameBatchSelections(selection.selections, validated.selections)
    )
      throw new Error("That answer no longer matches the selected options. Start a new request.");
    const askingRun = message.runId ? await ctx.db.get(message.runId) : null;
    if (
      !askingRun ||
      askingRun.executionId !== args.executionId ||
      askingRun.ownerAccountId !== actor._id ||
      askingRun.schoolId !== actor.schoolId ||
      askingRun.threadId !== thread._id
    )
      throw new Error("This clarification belongs to an older run attempt. Start a new request.");
    return {
      message: {
        _id: message._id,
        content: message.content,
        runId: message.runId,
        metadata: message.metadata,
      },
      askingRun: {
        userPrompt: askingRun.userPrompt,
        planIntent: askingRun.planIntent,
      },
      clarification,
      selection,
    };
  },
});

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    /** Only the threads themselves: lists that show titles skip reading the works and workspaces each one is about. */
    brief: v.optional(v.boolean()),
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
    /* A chat whose Library node is in the Trash is deleted as far as its owner
       can tell; it returns to the list when the node is restored. */
    const kept = await Promise.all(
      page.page.map(async (thread) => {
        const node = await findPrimaryNode(ctx, actor._id, "thread", String(thread._id));
        return !node || node.deletedAt === undefined;
      }),
    );
    const visible = page.page.filter((_, index) => kept[index]);
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
    if (args.brief) {
      return { threads: visible.map((thread) => ({ ...compactThread(thread), contexts: undefined })), hasMore: nextCursor !== null, nextCursor };
    }
    const workspaceIds = [...new Set(visible.flatMap((thread) =>
      [thread.workspaceId, ...(thread.contextWorkspaceIds ?? [])].filter(Boolean).map(String),
    ))].slice(0, 48);
    const artifactIds = [...new Set(visible.flatMap((thread) =>
      [thread.artifactId, ...(thread.contextArtifactIds ?? [])].filter(Boolean).map(String),
    ))].slice(0, 48);
    const [workspaces, artifacts] = await Promise.all([
      Promise.all(workspaceIds.map(async (id) => {
        try {
          const workspace = await ctx.db.get(id as Id<"spectraWorkspaces">);
          const loaded = workspace
            ? {
                resource: workspace,
                ownerAccountId: workspace.ownerAccountId,
                schoolId: workspace.schoolId,
                lifecycle: workspace.status,
              }
            : null;
          const access = await evaluateAccessForActorWithLoadedResource(
            ctx,
            actor,
            "workspace",
            id,
            loaded,
          );
          return access.allowed && access.capabilities.includes("read") && access.loaded.resource.status === "active"
            ? { id, title: access.loaded.resource.title }
            : null;
        } catch { return null; }
      })),
      Promise.all(artifactIds.map(async (id) => {
        try {
          const artifactId = id as Id<"spectraArtifacts">;
          const summary = await artifactSummaryFor(ctx, artifactId);
          const resourceType =
            summary?.blueprintKey === "agent"
              ? ("agent" as const)
              : summary
                ? ("artifact" as const)
                : undefined;
          const access = await evaluateArtifactAccessForActorWithSummary(
            ctx,
            actor,
            artifactId,
            resourceType,
            summary,
          );
          const projection = summary?.projection as { title?: unknown } | undefined;
          const loadedResource = access.allowed ? access.loaded.resource : null;
          const canonicalTitle =
            loadedResource &&
            "title" in loadedResource &&
            typeof loadedResource.title === "string"
              ? loadedResource.title
              : undefined;
          return access.allowed && access.capabilities.includes("read")
            ? {
                id,
                title:
                  typeof projection?.title === "string"
                    ? projection.title
                    : canonicalTitle ?? id,
              }
            : null;
        } catch { return null; }
      })),
    ]);
    const workspaceById = new Map(workspaces.filter(Boolean).map((row) => [row!.id, row!]));
    const artifactById = new Map(artifacts.filter(Boolean).map((row) => [row!.id, row!]));
    return {
      threads: visible.map((thread) => ({
        ...compactThread(thread),
        // The primary work or workspace is often in the context list too; each appears once.
        contexts: {
          workspaces: [...new Set([thread.workspaceId, ...(thread.contextWorkspaceIds ?? [])].filter(Boolean).map(String))]
            .map((id) => workspaceById.get(id)).filter(Boolean),
          artifacts: [...new Set([thread.artifactId, ...(thread.contextArtifactIds ?? [])].filter(Boolean).map(String))]
            .map((id) => artifactById.get(id)).filter(Boolean),
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
    const derivedArtifactSummary = thread.artifactId
      ? null
      : (
          await ctx.db
            .query("spectraArtifactSummaries")
            .withIndex("by_created_thread", (q) =>
              q.eq("createdFromThreadId", args.threadId),
            )
            .order("desc")
            .take(12)
        ).find(
          (artifact) =>
            artifact.ownerAccountId === actor._id &&
            artifact.schoolId === actor.schoolId &&
            artifact.status !== "deleted",
        );
    // Rows created before the read model are a bounded compatibility path. A
    // successful summary backfill removes this canonical scan from steady
    // state without changing the thread's visible artifact choice.
    const derivedArtifact =
      derivedArtifactSummary ??
      (thread.artifactId
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
          ));
    const messagePage = await ctx.db
      .query("spectraMessages")
      .withIndex("by_thread_created", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .paginate({ cursor: null, numItems: INITIAL_MESSAGE_LIMIT });
    const messages = [...messagePage.page].reverse();
    const activeExecution = await selectedActiveExecution(ctx, { actor, thread });
    const derivedArtifactId = derivedArtifact
      ? "artifactId" in derivedArtifact
        ? derivedArtifact.artifactId
        : derivedArtifact._id
      : undefined;
    return {
      thread: compactThread(
        derivedArtifactId ? { ...thread, artifactId: derivedArtifactId } : thread,
      ),
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
      activeExecution,
      viewerName: actor.name,
    };
  },
});

export const getSummary = query({
  args: { threadId: v.id("spectraThreads") },
  handler: async (ctx, args) => {
    const { thread } = await requireOwnedThread(ctx, args.threadId);
    return {
      thread: compactThread(thread),
      // The agent this thread keeps using until the user clears it.
      retainedAgentId: thread.retainedAgentId,
      // Neither the owner nor an earlier run has named it yet.
      needsTitle: !thread.titleSetByOwner && !thread.titleGeneratedAt,
      // What the user already allowed in this thread: it is not asked again here.
      allowedPermissionCategories: thread.allowedPermissionCategories ?? [],
    };
  },
});

/**
 * What a run needs of its thread's past: the running notes and every message
 * after them (newest `limit`), as role and text only.
 */
export const agentHistory = query({
  args: { threadId: v.id("spectraThreads"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { thread } = await requireOwnedThread(ctx, args.threadId);
    const limit = Math.max(1, Math.min(Math.round(args.limit ?? 80), 120));
    const through = thread.summaryThrough ?? 0;
    const page = await ctx.db
      .query("spectraMessages")
      .withIndex("by_thread_created", (q) => q.eq("threadId", args.threadId).gt("createdAt", through))
      .order("desc")
      .take(limit + 1);
    return {
      notes: thread.summaryLong,
      through,
      /** Older unfolded messages exist beyond this page. */
      more: page.length > limit,
      messages: page
        .slice(0, limit)
        .reverse()
        .map((message) => ({ role: message.role, content: message.content, runId: message.runId, createdAt: message.createdAt })),
    };
  },
});

const THREAD_NOTES_CHARS = 16_000;

/** A run folds the thread's oldest messages into its running notes. Notes only move forward. */
export const recordThreadNotes = mutation({
  args: {
    threadId: v.id("spectraThreads"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    notes: v.string(),
    through: v.number(),
  },
  handler: async (ctx, args) => {
    const { thread } = await requireOwnedThread(ctx, args.threadId);
    const run = await ctx.db.get(args.runId);
    if (!run || run.threadId !== args.threadId || run.executionId !== args.executionId)
      throw new Error("These notes belong to an older run attempt.");
    const notes = args.notes.trim().slice(0, THREAD_NOTES_CHARS);
    if (!notes || args.through <= (thread.summaryThrough ?? 0)) return { recorded: false };
    // Not a change the user made: the thread keeps its place in their lists.
    await ctx.db.patch(args.threadId, { summaryLong: notes, summaryThrough: args.through });
    return { recorded: true };
  },
});

/** The thread's name as it changes, or null once it is gone: the chat header follows it live. */
export const liveName = query({
  args: { threadId: v.id("spectraThreads") },
  handler: async (ctx, args) => {
    const actor = await getOptionalAuthenticatedActor(ctx);
    if (!actor) return null;
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.ownerAccountId !== actor.accountId || thread.schoolId !== actor.schoolId || thread.status === "deleted")
      return null;
    return { _id: thread._id, title: thread.title, summaryShort: thread.summaryShort, previewText: thread.previewText };
  },
});

export const getActiveExecution = query({
  args: { threadId: v.id("spectraThreads") },
  handler: async (ctx, args) => {
    const { actor, thread } = await requireOwnedThread(ctx, args.threadId);
    return selectedActiveExecution(ctx, { actor, thread });
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

/**
 * Messages next to one message: the older ones before it or the newer ones after it, in
 * conversation order. Lets the AI read on from a passage it found, in either direction.
 */
export const listMessagesFrom = query({
  args: {
    threadId: v.id("spectraThreads"),
    messageId: v.id("spectraMessages"),
    direction: v.union(v.literal("older"), v.literal("newer")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { actor, thread } = await requireOwnedThread(ctx, args.threadId);
    const anchor = await ctx.db.get(args.messageId);
    if (!anchor || anchor.threadId !== thread._id || (anchor.schoolId && anchor.schoolId !== actor.schoolId)) throw new Error("Message not found");
    const limit = Math.max(1, Math.min(Math.round(Number.isFinite(args.limit) ? args.limit! : MESSAGE_PAGE_LIMIT), 80));
    const older = args.direction === "older";
    // The index orders by (createdAt, _creationTime), so messages written in the same
    // millisecond still sit on one side of the anchor.
    const beyond = (message: Doc<"spectraMessages">) =>
      message.createdAt === anchor.createdAt
        ? older ? message._creationTime < anchor._creationTime : message._creationTime > anchor._creationTime
        : true;
    const ordered = ctx.db
      .query("spectraMessages")
      .withIndex("by_thread_created", (q) => older
        ? q.eq("threadId", thread._id).lte("createdAt", anchor.createdAt)
        : q.eq("threadId", thread._id).gte("createdAt", anchor.createdAt))
      .order(older ? "desc" : "asc");
    const messages: Doc<"spectraMessages">[] = [];
    let more = false;
    for await (const message of ordered) {
      if (message._id === anchor._id || !beyond(message)) continue;
      if (messages.length === limit) {
        more = true;
        break;
      }
      messages.push(message);
    }
    return { messages: older ? messages.reverse() : messages, more };
  },
});

async function messageContentRevision(content: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Exact text chunks preserve message identity and reject a mix of two assistant revisions. */
export const readMessage = query({
  args: { threadId: v.id("spectraThreads"), messageId: v.id("spectraMessages"), offset: v.optional(v.number()), revision: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { actor, thread } = await requireOwnedThread(ctx, args.threadId);
    const message = await ctx.db.get(args.messageId);
    if (!message || message.threadId !== thread._id || (message.schoolId && message.schoolId !== actor.schoolId)) throw new Error("Message not found");
    const revision = await messageContentRevision(message.content);
    if (args.revision && args.revision !== revision) return { ok: false as const, code: "message_changed", messageId: message._id, revision };
    const offset = args.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > message.content.length) throw new Error("MESSAGE_OFFSET_INVALID");
    if (offset > 0 && !args.revision) throw new Error("MESSAGE_REVISION_REQUIRED: Continue with the revision from the previous chunk or search hit.");
    const limit = Math.max(1, Math.min(6_000, Math.round(Number.isFinite(args.limit) ? args.limit! : 3_000)));
    const content = message.content.slice(offset, offset + limit);
    const nextOffset = offset + content.length < message.content.length ? offset + content.length : null;
    return { ok: true as const, messageId: message._id, threadId: thread._id, role: message.role, createdAt: message.createdAt,
      revision, content, offset, nextOffset, totalCharacters: message.content.length, complete: nextOffset === null,
      partial: offset > 0 || nextOffset !== null };
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
    const artifactSummaries =
      family === "operations" && !operationCursor && args.includeArtifacts !== false
      ? await ctx.db
          .query("spectraArtifactSummaries")
          .withIndex("by_ai_run", (q) => q.eq("aiRunId", run._id))
          .order("desc")
          .take(100)
      : [];
    const operations = operationPage ? [...operationPage.page].reverse() : [];
    const cards = cardPage ? [...cardPage.page].reverse() : [];
    const events = eventPage?.page ?? [];
    const artifacts = artifactSummaries
      .filter(
        (artifact) =>
          artifact.ownerAccountId === actor._id &&
          artifact.schoolId === actor.schoolId &&
          artifact.status !== "deleted",
      )
      .map((artifact) => {
        const projection = artifact.projection as {
          title?: string;
          summary?: string;
          tags?: string[];
        };
        return {
          _id: artifact.artifactId,
          blueprintKey: artifact.blueprintKey,
          title: projection.title ?? "Untitled artifact",
          summary: projection.summary,
          tags: projection.tags ?? [],
          status: artifact.status,
          createdAt: artifact.createdAt ?? artifact.updatedAt,
          updatedAt: artifact.updatedAt,
        };
      });
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
      args.title === undefined ? thread.title : ownerTitle(args.title);
    await ctx.db.patch(args.threadId, {
      title,
      ...(args.title === undefined ? {} : { titleSetByOwner: true }),
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

/**
 * The caption writer's title and summary for a thread. The title is written
 * once, from the first exchange with a clear subject, and never replaces a
 * name the owner gave or an earlier generated one: a resumed or later run
 * cannot make it worse. Any state of the run's current attempt may write it
 * (a run paused on a question still names its thread).
 */
export const applyGeneratedMetadata = mutation({
  args: {
    threadId: v.id("spectraThreads"),
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    /** The workspace the title writer filed an unfiled thread in. */
    workspaceId: v.optional(v.id("spectraWorkspaces")),
  },
  handler: async (ctx, args) => {
    const { thread } = await requireOwnedThread(ctx, args.threadId);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.threadId !== args.threadId ||
      run.executionId !== args.executionId
    )
      throw new Error("This title belongs to an older run attempt.");
    const generated = args.title ? generatedTitle(args.title) : "";
    const writeTitle =
      Boolean(generated) && !thread.titleSetByOwner && !thread.titleGeneratedAt;
    const title = writeTitle ? generated : thread.title;
    const summary =
      args.summary?.replace(/\s+/g, " ").trim().slice(0, 320) ||
      thread.summaryShort;
    const now = Date.now();
    // Filing is a suggestion for a thread that has no home yet; once the
    // owner (or an earlier run) placed it, it stays where it is.
    const workspace =
      args.workspaceId && !thread.workspaceId ? await ctx.db.get(args.workspaceId) : null;
    const fileIn =
      workspace &&
      workspace.ownerAccountId === thread.ownerAccountId &&
      workspace.schoolId === thread.schoolId &&
      workspace.status === "active"
        ? workspace._id
        : undefined;
    await ctx.db.patch(args.threadId, {
      title,
      ...(writeTitle ? { titleGeneratedAt: now } : {}),
      ...(fileIn ? { workspaceId: fileIn } : {}),
      summaryShort: summary,
      updatedAt: now,
      readSchemaVersion: THREAD_READ_SCHEMA_VERSION,
    });
    if (fileIn)
      await placeSourceNode(ctx, {
        accountId: thread.ownerAccountId,
        schoolId: thread.schoolId,
        kind: "thread",
        sourceId: args.threadId,
        name: title,
        target: { workspaceId: fileIn },
        relocate: true,
        pinned: thread.pinned,
      });
    else if (title !== thread.title)
      await syncSourceNodes(ctx, "thread", args.threadId, title);
    return { threadId: args.threadId, titled: writeTitle };
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
      const snapshotRefs = new Map<
        string,
        { schoolId: Id<"schools"> | undefined; snapshotRef: string }
      >();
      for (const version of versions) {
        for (const snapshotRef of [version.snapshotRef, version.beforeSnapshotRef]) {
          if (snapshotRef)
            snapshotRefs.set(`${version.schoolId ?? ""}:${snapshotRef}`, {
              schoolId: version.schoolId,
              snapshotRef,
            });
        }
      }
      await purgeSourceNodes(ctx, "work", artifact._id);
      await Promise.all([
        ...versions.map((version) => ctx.db.delete(version._id)),
        ...links.map((link) => ctx.db.delete(link._id)),
      ]);
      for (const { schoolId, snapshotRef } of snapshotRefs.values())
        await releaseSnapshotObject(ctx, schoolId, snapshotRef);
      await ctx.db.delete(artifact._id);
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
