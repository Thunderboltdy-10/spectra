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
    const result = await convexMutation<
      {
        actorClerkId: string;
        title: string;
        content: Record<string, unknown>;
        contentPlaintext: string;
        editorMode: string;
        workstreamId?: string;
      },
      { noteId: string }
    >("notes:create", {
      actorClerkId: context.actorClerkId,
      title,
      content: noteDocFromText(content),
      contentPlaintext: content,
      editorMode: noteEditorModeForTool(args.editorMode),
      workstreamId,
    });

    return {
      name: params.name,
      summary: `Created note: ${title}.`,
      modelPayload: { noteId: result.noteId, title, workstreamId },
      eventPayload: { noteId: result.noteId, title, workstreamId },
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
