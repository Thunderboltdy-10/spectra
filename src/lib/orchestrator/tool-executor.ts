import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterEmbeddingRequest } from "@/lib/openrouter";
import { maybeSearchWeb } from "@/lib/orchestrator/retrieval";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";
import type { AiToolName, StudyMode } from "@/types";

type ToolCallContext = {
  actorClerkId: string;
  chatId?: string;
  activeWorkstreamId?: string;
  mode: StudyMode;
  spendingTier?: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
  onModelCall?: (call: {
    model: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
    durationMs?: number;
  }) => void;
};

export type ExecutedToolResult = {
  name: AiToolName;
  summary: string;
  modelPayload: Record<string, unknown>;
  eventPayload: Record<string, unknown>;
  modeSwitch?: StudyMode;
  threadFork?: { chatId: string; workstreamId?: string };
};

type ListedMemoryEntry = {
  _id: string;
  key: string;
  text: string;
  category: string;
  scope?: "global" | "workstream";
  sourceWorkstreamId?: string;
};

type RetrievedMemoryEntry = {
  _id: string;
  key: string;
  text: string;
  category: string;
  confidence: number;
  freshness: number;
  scope?: "global" | "workstream";
  sourceWorkstreamId?: string;
};

function clampLimit(value: unknown, fallback = 4, max = 8) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(max, Math.round(numeric)));
}

function compactText(value: unknown, max = 700) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function lexicalScore(query: string, text: string) {
  const queryTokens = compactText(query, 2_000)
    .toLowerCase()
    .split(" ")
    .filter((token) => token.length >= 3);
  if (queryTokens.length === 0) return 0;
  const haystack = new Set(
    compactText(text, 2_000)
      .toLowerCase()
      .split(" ")
      .filter((token) => token.length >= 3),
  );
  if (haystack.size === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) overlap += 1;
  }
  return overlap / queryTokens.length;
}

function noteDocFromText(value: string) {
  const text = compactText(value, 8_000);
  return {
    type: "doc",
    content: text
      ? [{
          type: "paragraph",
          content: [{ type: "text", text }],
        }]
      : [],
  };
}

async function embeddingForQuery(context: ToolCallContext, query: string) {
  const startedAt = Date.now();
  const embedding = await openRouterEmbeddingRequest(query.slice(0, 3_000), MODEL_CONFIG.embedding);
  await recordOpenRouterUsage({
    actorClerkId: context.actorClerkId,
    chatId: context.chatId,
    model: embedding.model ?? MODEL_CONFIG.embedding,
    usage: embedding.usage,
    skipIfZeroTokens: false,
  }).catch(() => {});
  context.onModelCall?.({
    model: embedding.model ?? MODEL_CONFIG.embedding,
    usage: embedding.usage,
    durationMs: Date.now() - startedAt,
  });
  return embedding.embedding;
}

function noteEditorModeForTool(value: unknown) {
  if (value === "ai_enhanced") return "agentic";
  return "notion";
}

export async function executeOrchestratorTool(params: {
  name: AiToolName;
  rawArguments: string;
  context: ToolCallContext;
}): Promise<ExecutedToolResult> {
  const args = params.rawArguments.trim() ? JSON.parse(params.rawArguments) as Record<string, unknown> : {};
  const context = params.context;

  if (params.name === "recall_memory") {
    const query = compactText(args.query, 500);
    const scope = args.scope === "workstream" || args.scope === "cross_workstream" ? args.scope : "global";
    const limit = clampLimit(args.limit, 4, 8);

    if (!query) {
      return {
        name: params.name,
        summary: "Memory recall skipped because no query was provided.",
        modelPayload: { entries: [], scope, query },
        eventPayload: { entries: [], scope, query },
      };
    }

    if (scope === "cross_workstream") {
      const entries = await convexQuery<
        { actorClerkId: string },
        ListedMemoryEntry[]
      >("memory:listMemoryEntries", {
        actorClerkId: context.actorClerkId,
      }).catch(() => [] as ListedMemoryEntry[]);
      const filtered = entries
        .filter((entry) => entry.scope === "workstream")
        .filter((entry) => entry.sourceWorkstreamId !== context.activeWorkstreamId)
        .map((entry) => ({
          id: String(entry._id),
          memoryKind: "global" as const,
          key: String(entry.key ?? ""),
          text: String(entry.text ?? ""),
          category: String(entry.category ?? ""),
          scope: "cross_workstream" as const,
          workstreamId: typeof entry.sourceWorkstreamId === "string" ? entry.sourceWorkstreamId : undefined,
          score: lexicalScore(query, `${String(entry.key ?? "")} ${String(entry.text ?? "")}`),
        }))
        .filter((entry) => entry.score >= 0.2)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return {
        name: params.name,
        summary: filtered.length > 0 ? `Recalled ${filtered.length} cross-workstream memory entr${filtered.length === 1 ? "y" : "ies"}.` : "No relevant cross-workstream memory found.",
        modelPayload: { query, scope, entries: filtered },
        eventPayload: { query, scope, entries: filtered },
      };
    }

    const embedding = await embeddingForQuery(context, query);
    if (scope === "workstream") {
      const workstreamId = compactText(args.workstreamId, 128) || context.activeWorkstreamId;
      if (!workstreamId) {
        return {
          name: params.name,
          summary: "Workstream recall skipped because no workstream was available.",
          modelPayload: { query, scope, entries: [] },
          eventPayload: { query, scope, entries: [] },
        };
      }

      const entries = await convexAction<
        { actorClerkId: string; workstreamId: string; embedding: number[]; message: string; topK: number; minScore: number },
        RetrievedMemoryEntry[]
      >("workstreamMemory:retrieveRelevantForPrompt", {
        actorClerkId: context.actorClerkId,
        workstreamId,
        embedding,
        message: query,
        topK: limit,
        minScore: 0.28,
      }).catch(() => [] as RetrievedMemoryEntry[]);

      const normalized = entries.map((entry) => ({
        id: String(entry._id),
        memoryKind: "workstream" as const,
        key: String(entry.key ?? ""),
        text: String(entry.text ?? ""),
        category: String(entry.category ?? ""),
        confidence: Number(entry.confidence ?? 0),
        freshness: Number(entry.freshness ?? 0),
      }));

      return {
        name: params.name,
        summary: normalized.length > 0 ? `Recalled ${normalized.length} workstream memory entr${normalized.length === 1 ? "y" : "ies"}.` : "No relevant workstream memory found.",
        modelPayload: { query, scope, workstreamId, entries: normalized },
        eventPayload: { query, scope, workstreamId, entries: normalized },
      };
    }

    const entries = await convexAction<
      { actorClerkId: string; embedding: number[]; message: string; topK: number; minScore: number },
      RetrievedMemoryEntry[]
    >("memory:retrieveRelevantEntries", {
      actorClerkId: context.actorClerkId,
      embedding,
      message: query,
      topK: limit,
      minScore: 0.28,
    }).catch(() => [] as RetrievedMemoryEntry[]);

    const normalized = entries.map((entry) => ({
      id: String(entry._id),
      memoryKind: "global" as const,
      key: String(entry.key ?? ""),
      text: String(entry.text ?? ""),
      category: String(entry.category ?? ""),
      confidence: Number(entry.confidence ?? 0),
      freshness: Number(entry.freshness ?? 0),
      scope: String(entry.scope ?? "global"),
      workstreamId: typeof entry.sourceWorkstreamId === "string" ? entry.sourceWorkstreamId : undefined,
    }));

    return {
      name: params.name,
      summary: normalized.length > 0 ? `Recalled ${normalized.length} global memory entr${normalized.length === 1 ? "y" : "ies"}.` : "No relevant global memory found.",
      modelPayload: { query, scope, entries: normalized },
      eventPayload: { query, scope, entries: normalized },
    };
  }

  if (params.name === "save_memory") {
    const key = compactText(args.key, 120);
    const text = compactText(args.text, 700);
    const scope = args.scope === "workstream" ? "workstream" : "global";
    const category = compactText(args.category, 32) || undefined;
    const workstreamId = compactText(args.workstreamId, 128) || context.activeWorkstreamId;
    const confidence = typeof args.confidence === "number" ? Math.max(0, Math.min(1, args.confidence)) : 0.9;
    const embedding = context.spendingTier === "free_only" ? undefined : await embeddingForQuery(context, `${key}: ${text}`);

    const writeResult = await convexMutation<
      {
        actorClerkId: string;
        sourceChatId?: string;
        sourceWorkstreamId?: string;
        entries: Array<{
          key: string;
          text: string;
          embedding?: number[];
          confidence: number;
          freshness: number;
          category?: string;
          sourceType: "user_explicit";
          status: "confirmed";
          scope: "global" | "workstream";
        }>;
      },
      { inserted: number; updated: number; promoted: number; writtenIds: string[] }
    >("memory:routeMemoryWrite", {
      actorClerkId: context.actorClerkId,
      sourceChatId: context.chatId,
      sourceWorkstreamId: scope === "workstream" ? workstreamId : undefined,
      entries: [{
        key,
        text,
        embedding,
        confidence,
        freshness: 1,
        category,
        sourceType: "user_explicit",
        status: "confirmed",
        scope,
      }],
    }).catch(() => ({ inserted: 0, updated: 0, promoted: 0, writtenIds: [] as string[] }));

    let workstreamWrite: { inserted: number; updated: number; superseded: number } | undefined;
    if (scope === "workstream" && workstreamId) {
      workstreamWrite = await convexMutation<
        {
          actorClerkId: string;
          workstreamId: string;
          sourceChatId?: string;
          entries: Array<{
            key: string;
            text: string;
            embedding?: number[];
            confidence: number;
            freshness: number;
            category: "concept" | "progress" | "preference" | "deadline" | "correction" | "resource_link";
            sourceType: "user_explicit";
          }>;
        },
        { inserted: number; updated: number; superseded: number }
      >("workstreamMemory:upsertEntries", {
        actorClerkId: context.actorClerkId,
        workstreamId,
        sourceChatId: context.chatId,
        entries: [{
          key,
          text,
          embedding,
          confidence,
          freshness: 1,
          category:
            category === "preference"
              ? "preference"
              : category === "correction"
                ? "correction"
                : category === "artifact"
                  ? "resource_link"
                  : category === "academic"
                    ? "progress"
                    : "concept",
          sourceType: "user_explicit",
        }],
      }).catch(() => ({ inserted: 0, updated: 0, superseded: 0 }));
    }

    return {
      name: params.name,
      summary: scope === "workstream" ? "Saved memory to the workstream and personal memory layers." : "Saved memory.",
      modelPayload: {
        scope,
        key,
        text,
        ids: writeResult.writtenIds ?? [],
        written: (writeResult.inserted ?? 0) + (writeResult.updated ?? 0),
        workstreamWrite,
      },
      eventPayload: {
        scope,
        key,
        text,
        ids: writeResult.writtenIds ?? [],
        written: (writeResult.inserted ?? 0) + (writeResult.updated ?? 0),
        workstreamWrite,
      },
    };
  }

  if (params.name === "update_memory") {
    const memoryKind = args.memoryKind === "workstream" ? "workstream" : "global";
    const entryId = compactText(args.entryId, 128);
    const nextText = args.text !== undefined ? compactText(args.text, 700) : undefined;
    const embedding = nextText && context.spendingTier !== "free_only"
      ? await embeddingForQuery(context, `${compactText(args.key, 120)}: ${nextText}`)
      : undefined;

    if (memoryKind === "workstream") {
      await convexMutation("workstreamMemory:updateEntry", {
        actorClerkId: context.actorClerkId,
        entryId,
        key: args.key,
        text: nextText,
        embedding,
        category: args.category,
        confidence: args.confidence,
        freshness: args.freshness,
        sourceType: undefined,
      });
    } else {
      await convexMutation("memory:updateMemoryEntry", {
        actorClerkId: context.actorClerkId,
        entryId,
        key: args.key,
        text: nextText,
        embedding,
        confidence: args.confidence,
        freshness: args.freshness,
        category: args.category,
        status: undefined,
        scope: undefined,
        sourceWorkstreamId: undefined,
      });
    }

    return {
      name: params.name,
      summary: "Updated memory entry.",
      modelPayload: { memoryKind, entryId, updated: true },
      eventPayload: { memoryKind, entryId, updated: true },
    };
  }

  if (params.name === "dismiss_memory") {
    const memoryKind = args.memoryKind === "workstream" ? "workstream" : "global";
    const entryId = compactText(args.entryId, 128);
    if (memoryKind === "workstream") {
      await convexMutation("workstreamMemory:dismissEntry", {
        actorClerkId: context.actorClerkId,
        entryId,
      });
    } else {
      await convexMutation("memory:dismissMemoryEntry", {
        actorClerkId: context.actorClerkId,
        entryId,
      });
    }

    return {
      name: params.name,
      summary: "Dismissed memory entry.",
      modelPayload: { memoryKind, entryId, dismissed: true },
      eventPayload: { memoryKind, entryId, dismissed: true },
    };
  }

  if (params.name === "get_workstream_context") {
    const workstreamId = compactText(args.workstreamId, 128) || context.activeWorkstreamId;
    if (!workstreamId) {
      return {
        name: params.name,
        summary: "Workstream context skipped because no workstream was available.",
        modelPayload: { workstream: null },
        eventPayload: { workstream: null },
      };
    }

    const [workstream, chats, notes, plannerItems] = await Promise.all([
      convexQuery<{ actorClerkId: string; workstreamId: string }, { title?: string; description?: string; linkedAgentId?: string }>("workstreams:get", {
        actorClerkId: context.actorClerkId,
        workstreamId,
      }),
      convexQuery<{ actorClerkId: string; workstreamId: string; limit: number }, Array<{ _id: string; title: string }>>("chats:listChats", {
        actorClerkId: context.actorClerkId,
        workstreamId,
        limit: 6,
      }).catch(() => []),
      convexQuery<{ actorClerkId: string; workstreamId: string; limit: number }, Array<{ _id: string; title: string }>>("notes:list", {
        actorClerkId: context.actorClerkId,
        workstreamId,
        limit: 6,
      }).catch(() => []),
      convexQuery<{ actorClerkId: string; workstreamId: string; limit: number }, Array<{ _id: string; title: string; status: string; dueAt?: number }>>("plannerItems:list", {
        actorClerkId: context.actorClerkId,
        workstreamId,
        limit: 6,
      }).catch(() => []),
    ]);

    const payload = {
      workstream: {
        id: workstreamId,
        title: String((workstream as { title?: unknown })?.title ?? "Workstream"),
        description: typeof (workstream as { description?: unknown })?.description === "string" ? (workstream as { description?: string }).description : undefined,
        linkedAgentId: typeof (workstream as { linkedAgentId?: unknown })?.linkedAgentId === "string" ? (workstream as { linkedAgentId?: string }).linkedAgentId : undefined,
      },
      recentThreads: (Array.isArray(chats) ? chats : []).slice(0, 5).map((chat) => ({
        id: String((chat as { _id?: unknown })._id ?? ""),
        title: String((chat as { title?: unknown }).title ?? "Untitled"),
      })),
      notes: (Array.isArray(notes) ? notes : []).slice(0, 5).map((note) => ({
        id: String((note as { _id?: unknown })._id ?? ""),
        title: String((note as { title?: unknown }).title ?? "Untitled"),
      })),
      plannerItems: (Array.isArray(plannerItems) ? plannerItems : []).slice(0, 5).map((item) => ({
        id: String((item as { _id?: unknown })._id ?? ""),
        title: String((item as { title?: unknown }).title ?? "Untitled"),
        status: String((item as { status?: unknown }).status ?? "pending"),
        dueAt: typeof (item as { dueAt?: unknown }).dueAt === "number" ? (item as { dueAt: number }).dueAt : undefined,
      })),
    };

    return {
      name: params.name,
      summary: "Fetched workstream context.",
      modelPayload: payload,
      eventPayload: payload,
    };
  }

  if (params.name === "create_note") {
    const title = compactText(args.title, 120) || "Untitled note";
    const content = compactText(args.content, 8_000);
    const workstreamId = compactText(args.workstreamId, 128) || context.activeWorkstreamId;
    const artifactId = await convexMutation<
      {
        actorClerkId: string;
        type: string;
        title: string;
        content: Record<string, unknown>;
        contentPlaintext: string;
        editorMode: string;
        workstreamId?: string;
        sourceType?: string;
      },
      string
    >("artifacts:create", {
      actorClerkId: context.actorClerkId,
      type: "document",
      title,
      content: noteDocFromText(content),
      contentPlaintext: content,
      editorMode: noteEditorModeForTool(args.editorMode),
      workstreamId,
      sourceType: "ai_generated",
    });

    return {
      name: params.name,
      summary: `Created note: ${title}.`,
      modelPayload: { noteId: artifactId, artifactId, title, workstreamId },
      eventPayload: { noteId: artifactId, artifactId, title, workstreamId },
    };
  }

  if (params.name === "surface_result") {
    const workstreamId = compactText(args.workstreamId, 128) || context.activeWorkstreamId;
    const title = compactText(args.title, 160) || "Workspace result";
    const summary = compactText(args.summary, 320) || title;
    if (!workstreamId) {
      return {
        name: params.name,
        summary: "Workspace result was skipped because no workstream was active.",
        modelPayload: { created: false },
        eventPayload: { created: false },
      };
    }

    const result = await convexMutation<
      {
        actorClerkId: string;
        workstreamId: string;
        sourceChatId?: string;
        intent: "note" | "planner" | "thread" | "result" | "widget";
        status: "processing" | "completed" | "dismissed";
        title: string;
        summary: string;
        detail?: string;
        variant?: "summary" | "answer" | "artifact" | "planner" | "thread";
        targetKind?: "artifact" | "plannerItem" | "chat" | "workspaceItem" | "result";
        targetId?: string;
        metadata?: Record<string, unknown>;
      },
      { resultId: string }
    >("workspaceCommandResults:create", {
      actorClerkId: context.actorClerkId,
      workstreamId,
      sourceChatId: context.chatId,
      intent:
        args.intent === "note" || args.intent === "planner" || args.intent === "thread" || args.intent === "widget"
          ? args.intent
          : "result",
      status: args.status === "completed" || args.status === "dismissed" ? args.status : "processing",
      title,
      summary,
      detail: compactText(args.detail, 1_000) || undefined,
      variant:
        args.variant === "answer" || args.variant === "artifact" || args.variant === "planner" || args.variant === "thread"
          ? args.variant
          : "summary",
      targetKind:
        args.targetKind === "artifact" || args.targetKind === "plannerItem" || args.targetKind === "chat" || args.targetKind === "workspaceItem"
          ? args.targetKind
          : "result",
      targetId: compactText(args.targetId, 160) || undefined,
      metadata: typeof args.metadata === "object" && args.metadata ? args.metadata as Record<string, unknown> : undefined,
    });

    return {
      name: params.name,
      summary: `Surfaced workspace result: ${title}.`,
      modelPayload: { resultId: result.resultId, title, summary, workstreamId },
      eventPayload: { resultId: result.resultId, title, summary, workstreamId },
    };
  }

  if (params.name === "update_planner") {
    const plannerItemId = compactText(args.plannerItemId, 128);
    const title = compactText(args.title, 160);
    const payload = {
      actorClerkId: context.actorClerkId,
      title,
      description: args.description,
      workstreamId: compactText(args.workstreamId, 128) || context.activeWorkstreamId,
      type: args.type,
      priority: args.priority,
      status: args.status,
      dueAt: typeof args.dueAt === "number" ? args.dueAt : undefined,
      sourceType: "ai_suggested" as const,
      sourceChatId: context.chatId,
    };

    if (plannerItemId) {
      await convexMutation("plannerItems:update", {
        ...payload,
        plannerItemId,
      });
      return {
        name: params.name,
        summary: "Updated planner item.",
        modelPayload: { plannerItemId, updated: true },
        eventPayload: { plannerItemId, updated: true },
      };
    }

    const result = await convexMutation<typeof payload, { plannerItemId: string }>("plannerItems:create", payload);
    return {
      name: params.name,
      summary: `Created planner item: ${title || "Untitled task"}.`,
      modelPayload: { plannerItemId: result.plannerItemId, title },
      eventPayload: { plannerItemId: result.plannerItemId, title },
    };
  }

  if (params.name === "create_workstream") {
    const title = compactText(args.title, 160);
    if (!title) {
      return {
        name: params.name,
        summary: "Workspace creation skipped because no title was provided.",
        modelPayload: { created: false },
        eventPayload: { created: false },
      };
    }

    const result = await convexMutation<
      {
        actorClerkId: string;
        title: string;
        description?: string;
        emoji?: string;
        color?: string;
        type?: "subject" | "project" | "general";
        provenanceSource: "ai";
        mutationSummary?: string;
      },
      { workstreamId: string; mutationId: string }
    >("workspaceOrchestration:createWorkstream", {
      actorClerkId: context.actorClerkId,
      title,
      description: compactText(args.description, 400) || undefined,
      emoji: compactText(args.emoji, 16) || undefined,
      color: compactText(args.color, 40) || undefined,
      type:
        args.type === "subject" || args.type === "project" || args.type === "general"
          ? args.type
          : undefined,
      provenanceSource: "ai",
      mutationSummary: `AI created workspace ${title}`,
    });

    return {
      name: params.name,
      summary: `Created workspace: ${title}.`,
      modelPayload: { workstreamId: result.workstreamId, mutationId: result.mutationId, title },
      eventPayload: { workstreamId: result.workstreamId, mutationId: result.mutationId, title },
    };
  }

  if (params.name === "create_widget") {
    const title = compactText(args.title, 160);
    const workstreamId = compactText(args.workstreamId, 128) || context.activeWorkstreamId;
    const type = compactText(args.type, 40);
    if (!title || !type || !workstreamId) {
      return {
        name: params.name,
        summary: "Widget creation skipped because the title, type, or workstream was missing.",
        modelPayload: { created: false },
        eventPayload: { created: false },
      };
    }

    const result = await convexMutation<
      {
        actorClerkId: string;
        workstreamId: string;
        type: string;
        itemType?: "thread" | "artifact" | "planner" | "utility" | "custom";
        renderMode?: string;
        sourceChatId?: string;
        sourceArtifactId?: string;
        sourcePlannerItemId?: string;
        title: string;
        contentSummary?: string;
        x: number;
        y: number;
        width?: number;
        height?: number;
        category?: string;
        provenanceSource: "ai";
        provenanceAction: string;
        mutationSummary?: string;
      },
      { itemId: string; mutationId: string }
    >("workspaceItems:createWidget", {
      actorClerkId: context.actorClerkId,
      workstreamId,
      type,
      itemType:
        args.itemType === "thread" || args.itemType === "artifact" || args.itemType === "planner" || args.itemType === "utility" || args.itemType === "custom"
          ? args.itemType
          : undefined,
      renderMode: compactText(args.renderMode, 80) || undefined,
      sourceChatId: compactText(args.sourceChatId, 128) || undefined,
      sourceArtifactId: compactText(args.sourceArtifactId, 128) || undefined,
      sourcePlannerItemId: compactText(args.sourcePlannerItemId, 128) || undefined,
      title,
      contentSummary: compactText(args.contentSummary, 300) || undefined,
      x: typeof args.x === "number" ? args.x : 80,
      y: typeof args.y === "number" ? args.y : 220,
      width: typeof args.width === "number" ? args.width : undefined,
      height: typeof args.height === "number" ? args.height : undefined,
      category: compactText(args.category, 40) || undefined,
      provenanceSource: "ai",
      provenanceAction: "created",
      mutationSummary: `AI created widget ${title}`,
    });

    return {
      name: params.name,
      summary: `Created widget: ${title}.`,
      modelPayload: { itemId: result.itemId, mutationId: result.mutationId, title, workstreamId },
      eventPayload: { itemId: result.itemId, mutationId: result.mutationId, title, workstreamId },
    };
  }

  if (params.name === "update_widget") {
    const itemId = compactText(args.itemId, 128);
    if (!itemId) {
      return {
        name: params.name,
        summary: "Widget update skipped because no widget id was provided.",
        modelPayload: { updated: false },
        eventPayload: { updated: false },
      };
    }

    const result = await convexMutation("workspaceItems:updateWidget", {
      actorClerkId: context.actorClerkId,
      itemId,
      x: typeof args.x === "number" ? args.x : undefined,
      y: typeof args.y === "number" ? args.y : undefined,
      width: typeof args.width === "number" ? args.width : undefined,
      height: typeof args.height === "number" ? args.height : undefined,
      zIndex: typeof args.zIndex === "number" ? args.zIndex : undefined,
      title: compactText(args.title, 160) || undefined,
      contentSummary: compactText(args.contentSummary, 300) || undefined,
      category: compactText(args.category, 40) || undefined,
      renderMode: compactText(args.renderMode, 80) || undefined,
      hidden: typeof args.hidden === "boolean" ? args.hidden : undefined,
      collapsed: typeof args.collapsed === "boolean" ? args.collapsed : undefined,
      pinned: typeof args.pinned === "boolean" ? args.pinned : undefined,
      provenanceSource: "ai",
      provenanceAction: "updated",
      mutationSummary: compactText(args.title, 160)
        ? `AI updated widget ${compactText(args.title, 160)}`
        : "AI updated a widget",
    }) as { success: boolean; mutationId?: string };

    return {
      name: params.name,
      summary: "Updated widget.",
      modelPayload: { itemId, mutationId: result.mutationId, updated: true },
      eventPayload: { itemId, mutationId: result.mutationId, updated: true },
    };
  }

  if (params.name === "move_widget") {
    const itemId = compactText(args.itemId, 128);
    const workstreamId = compactText(args.workstreamId, 128) || context.activeWorkstreamId;
    if (!itemId || !workstreamId) {
      return {
        name: params.name,
        summary: "Widget move skipped because the widget id or destination workstream was missing.",
        modelPayload: { moved: false },
        eventPayload: { moved: false },
      };
    }

    const result = await convexMutation("workspaceItems:moveWidget", {
      actorClerkId: context.actorClerkId,
      itemId,
      workstreamId,
      x: typeof args.x === "number" ? args.x : undefined,
      y: typeof args.y === "number" ? args.y : undefined,
      provenanceSource: "ai",
      mutationSummary: "AI moved a widget",
    }) as { success: boolean; mutationId?: string };

    return {
      name: params.name,
      summary: "Moved widget.",
      modelPayload: { itemId, workstreamId, mutationId: result.mutationId, moved: true },
      eventPayload: { itemId, workstreamId, mutationId: result.mutationId, moved: true },
    };
  }

  if (params.name === "attach_items_to_workstream") {
    const workstreamId = compactText(args.workstreamId, 128) || context.activeWorkstreamId;
    const rawItems = Array.isArray(args.items) ? args.items : [];
    if (!workstreamId || rawItems.length === 0) {
      return {
        name: params.name,
        summary: "Attach flow skipped because the workstream or items were missing.",
        modelPayload: { attached: false },
        eventPayload: { attached: false },
      };
    }

    const items = rawItems
      .map((entry) => (typeof entry === "object" && entry ? entry as Record<string, unknown> : null))
      .filter((entry): entry is Record<string, unknown> => !!entry)
      .map((entry) => ({
        type: compactText(entry.type, 40) || undefined,
        itemType: compactText(entry.itemType, 40) || undefined,
        sourceChatId: compactText(entry.sourceChatId, 128) || undefined,
        sourceArtifactId: compactText(entry.sourceArtifactId, 128) || undefined,
        sourcePlannerItemId: compactText(entry.sourcePlannerItemId, 128) || undefined,
        title: compactText(entry.title, 160) || undefined,
        contentSummary: compactText(entry.contentSummary, 300) || undefined,
        renderMode: compactText(entry.renderMode, 80) || undefined,
        category: compactText(entry.category, 40) || undefined,
      }));

    const result = await convexMutation("workspaceItems:attachItemsToWorkstream", {
      actorClerkId: context.actorClerkId,
      workstreamId,
      items,
      provenanceSource: "ai",
      mutationSummary: `AI attached ${items.length} item${items.length === 1 ? "" : "s"}`,
    }) as { success: boolean; createdItemIds?: string[]; mutationId?: string };

    return {
      name: params.name,
      summary: `Attached ${result.createdItemIds?.length ?? 0} item${result.createdItemIds?.length === 1 ? "" : "s"} to the workspace.`,
      modelPayload: { workstreamId, createdItemIds: result.createdItemIds ?? [], mutationId: result.mutationId },
      eventPayload: { workstreamId, createdItemIds: result.createdItemIds ?? [], mutationId: result.mutationId },
    };
  }

  if (params.name === "list_merge_candidates") {
    const workstreamId = compactText(args.workstreamId, 128) || context.activeWorkstreamId;
    const topic = compactText(args.topic, 160) || undefined;
    const limit = clampLimit(args.limit, 8, 20);
    const result = await convexQuery("workspaceItems:listMergeCandidates", {
      actorClerkId: context.actorClerkId,
      workstreamId,
      topic,
      limit,
    }) as { candidates?: Array<Record<string, unknown>> };

    return {
      name: params.name,
      summary: `Found ${result.candidates?.length ?? 0} merge candidate${result.candidates?.length === 1 ? "" : "s"}.`,
      modelPayload: { workstreamId, topic, candidates: result.candidates ?? [] },
      eventPayload: { workstreamId, topic, candidates: result.candidates ?? [] },
    };
  }

  if (params.name === "update_workstream_layout") {
    const workstreamId = compactText(args.workstreamId, 128) || context.activeWorkstreamId;
    const rawWidgets = Array.isArray(args.widgets) ? args.widgets : [];
    if (!workstreamId || rawWidgets.length === 0) {
      return {
        name: params.name,
        summary: "Layout update skipped because the workstream or widget positions were missing.",
        modelPayload: { updated: false },
        eventPayload: { updated: false },
      };
    }

    const widgets = rawWidgets
      .map((entry) => (typeof entry === "object" && entry ? entry as Record<string, unknown> : null))
      .filter((entry): entry is Record<string, unknown> => !!entry)
      .map((entry) => ({
        itemId: compactText(entry.itemId, 128),
        x: typeof entry.x === "number" ? entry.x : 0,
        y: typeof entry.y === "number" ? entry.y : 0,
        width: typeof entry.width === "number" ? entry.width : undefined,
        height: typeof entry.height === "number" ? entry.height : undefined,
        zIndex: typeof entry.zIndex === "number" ? entry.zIndex : undefined,
      }))
      .filter((entry) => entry.itemId.length > 0);

    const result = await convexMutation("workspaceItems:updateWorkstreamLayout", {
      actorClerkId: context.actorClerkId,
      workstreamId,
      widgets,
      provenanceSource: "ai",
      mutationSummary: "AI reorganized the workspace layout",
    }) as { success: boolean; mutationId?: string };

    return {
      name: params.name,
      summary: "Updated workspace layout.",
      modelPayload: { workstreamId, widgetCount: widgets.length, mutationId: result.mutationId },
      eventPayload: { workstreamId, widgetCount: widgets.length, mutationId: result.mutationId },
    };
  }

  if (params.name === "suggest_workspace_from_topic") {
    const topic = compactText(args.topic, 160);
    if (!topic) {
      return {
        name: params.name,
        summary: "Workspace suggestion skipped because no topic was provided.",
        modelPayload: { topic: "", shouldSuggest: false },
        eventPayload: { topic: "", shouldSuggest: false },
      };
    }

    const result = await convexQuery("workspaceOrchestration:suggestWorkspaceFromTopic", {
      actorClerkId: context.actorClerkId,
      topic,
      limit: clampLimit(args.limit, 8, 20),
    });

    return {
      name: params.name,
      summary: "Scored whether this topic should become a workspace.",
      modelPayload: result as Record<string, unknown>,
      eventPayload: result as Record<string, unknown>,
    };
  }

  if (params.name === "fork_thread") {
    const workstreamId = compactText(args.workstreamId, 128) || context.activeWorkstreamId;
    const title = compactText(args.title, 120) || `Thread fork: ${compactText(args.reason, 80)}`;
    const createResult = await convexMutation<
      {
        actorClerkId: string;
        workstreamId?: string;
        mode: StudyMode;
        thinkingLevel: "medium";
        routerMode: "auto";
        manualModel?: string;
        usePersonalResources: true;
        title: string;
      },
      { chatId: string }
    >("chats:createChat", {
      actorClerkId: context.actorClerkId,
      workstreamId,
      mode: context.mode,
      thinkingLevel: "medium",
      routerMode: "auto",
      manualModel: compactText(args.preferredModel, 160) || undefined,
      usePersonalResources: true,
      title,
    });

    const setupContent = [
      `Forked from chat ${context.chatId ?? "unknown"}.`,
      `Reason: ${compactText(args.reason, 240)}`,
      compactText(args.setupMessage, 3_000),
    ].filter(Boolean).join("\n\n");

    if (setupContent) {
      await convexMutation("chats:appendMessage", {
        actorClerkId: context.actorClerkId,
        chatId: createResult.chatId,
        role: "system",
        content: setupContent,
        mode: context.mode,
        citations: [],
        routeTrace: {
          phases: [],
          toolchain: ["fork_thread"],
          candidateModels: [],
          whyThisResponse: "Forked thread setup",
          warnings: [],
          fallbackUsed: false,
          budgetTier: context.spendingTier ?? "normal",
        },
      });
    }

    return {
      name: params.name,
      summary: `Forked a new thread: ${title}.`,
      modelPayload: {
        chatId: createResult.chatId,
        title,
        workstreamId,
        threadUrl: `/chat?chatId=${createResult.chatId}${workstreamId ? `&from=workspace&ws=${workstreamId}` : ""}`,
      },
      eventPayload: {
        chatId: createResult.chatId,
        title,
        workstreamId,
        threadUrl: `/chat?chatId=${createResult.chatId}${workstreamId ? `&from=workspace&ws=${workstreamId}` : ""}`,
      },
      threadFork: { chatId: createResult.chatId, workstreamId },
    };
  }

  if (params.name === "search_web") {
    const query = compactText(args.query, 500);
    const strategy =
      args.strategy === "search_extract" || args.strategy === "extract_url" || args.strategy === "crawl" || args.strategy === "research"
        ? args.strategy
        : "search";
    const result = await maybeSearchWeb(query, "medium", {
      actorClerkId: context.actorClerkId,
      chatId: context.chatId,
      searchPlan: {
        strategy,
        trigger: "explicit_search",
        query,
        targetUrl: compactText(args.targetUrl, 500) || undefined,
        maxResults: strategy === "research" ? 8 : 5,
        maxExtractResults: strategy === "search_extract" ? 2 : 1,
      },
    });

    return {
      name: params.name,
      summary: result.sources.length > 0 ? `Searched the web and found ${result.sources.length} source${result.sources.length === 1 ? "" : "s"}.` : "Web search returned no useful sources.",
      modelPayload: {
        provider: result.provider,
        strategy: result.strategy,
        sources: result.sources.slice(0, 8),
        text: result.text,
        costCredits: result.costCredits,
      },
      eventPayload: {
        provider: result.provider,
        strategy: result.strategy,
        sourceCount: result.sources.length,
        costCredits: result.costCredits,
        sources: result.sources.slice(0, 8),
      },
    };
  }

  if (params.name === "switch_mode") {
    const mode = compactText(args.mode, 40) as StudyMode;
    return {
      name: params.name,
      summary: `Switched to ${mode} mode.`,
      modelPayload: {
        mode,
        reason: compactText(args.reason, 240),
        systemInstruction: `Switch to ${mode} mode for the rest of this response. ${compactText(args.reason, 240)}`.trim(),
      },
      eventPayload: {
        mode,
        reason: compactText(args.reason, 240),
      },
      modeSwitch: mode,
    };
  }

  throw new Error(`Unsupported tool: ${params.name}`);
}
