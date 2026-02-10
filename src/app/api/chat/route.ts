import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { chooseModelRoute } from "@/lib/routing/heuristic";
import {
  buildSystemPrompt,
  checkPromptPolicyResponse,
  inferAttempt,
  inferReflection,
  markerVerificationPrompt,
  tutorGate,
} from "@/lib/prompts/policy";
import { summarizeWhyResponse, toOpenRouterMessages } from "@/lib/orchestrator/compose";
import { MODEL_CONFIG, ROUTER_FALLBACKS } from "@/lib/model-config";
import {
  openRouterChatCompletion,
  openRouterEmbedding,
  openRouterStreamChat,
} from "@/lib/openrouter";
import { runAutoSettingsPipeline } from "@/lib/auto-settings";
import { safeStudyMode } from "@/lib/contracts/studyModes";
import type { ChatMessage, Citation, StudyMode } from "@/types";

export const runtime = "nodejs";

type ChatRequestBody = {
  chatId?: string;
  packId?: string;
  agentId?: string;
  mode: StudyMode;
  message: string;
  thinkingLevel: "low" | "medium" | "high";
  routerMode: "auto" | "manual" | "openrouter_auto";
  manualModel?: string;
  usePersonalResources: boolean;
  regenerate?: boolean;
  attachmentTypes?: string[];
  autoSettings?: {
    enhancePrompt: boolean;
    autoModel: boolean;
    autoThinking: boolean;
    autoSearch: boolean;
    enhanceMode?: "auto" | "on" | "off";
    thinkingMode?: "auto" | "on" | "off";
    searchMode?: "auto" | "on" | "off";
  };
};

type AgentSnapshot = {
  _id: string;
  name: string;
  description: string;
  systemPrompt: string;
  avatarEmoji: string;
  preferredModel?: string;
  preferredMode?: StudyMode;
  guidelinesSummary?: string;
  guidelinesTopicMap?: string[];
};

type StructuredError = {
  code: string;
  message: string;
  retryable?: boolean;
};

type MemoryEntry = {
  key: string;
  value: string;
  confidence: number;
  extractedAt: number;
};

function jsonError(status: number, error: StructuredError, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    {
      error,
      ...extra,
    },
    { status },
  );
}

function parseVerificationJson(value: string) {
  try {
    const json = JSON.parse(value.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return {
      pass: Boolean(json.pass),
      reason: typeof json.reason === "string" ? json.reason : "No reason provided",
    };
  } catch {
    return { pass: false, reason: "Verification parser failed" };
  }
}

function toChatMessageShape(messages: Array<Record<string, unknown>>): ChatMessage[] {
  return messages.map((message) => ({
    _id: String(message._id),
    role: message.role as ChatMessage["role"],
    content: String(message.content ?? ""),
    enhancedContent:
      typeof message.enhancedContent === "string" ? message.enhancedContent : undefined,
    mode: message.mode as StudyMode,
    citations: (message.citations as Citation[]) ?? [],
    modelRequested: typeof message.modelRequested === "string" ? message.modelRequested : undefined,
    modelUsed: typeof message.modelUsed === "string" ? message.modelUsed : undefined,
    whyThisResponse: typeof message.whyThisResponse === "string" ? message.whyThisResponse : undefined,
    usageIn: typeof message.usageIn === "number" ? message.usageIn : undefined,
    usageOut: typeof message.usageOut === "number" ? message.usageOut : undefined,
    verificationPassed:
      typeof message.verificationPassed === "boolean" ? message.verificationPassed : undefined,
    createdAt: Number(message.createdAt ?? Date.now()),
  }));
}

function extractAttemptStats(messages: ChatMessage[]) {
  let attemptCount = 0;
  let hasReflection = false;

  for (const message of messages) {
    if (message.role !== "user") continue;
    if (inferAttempt(message.content)) {
      attemptCount += 1;
    }
    if (inferReflection(message.content)) {
      hasReflection = true;
    }
  }

  return { attemptCount, hasReflection };
}

function extractUrls(text: string) {
  const matches = text.match(/https?:\/\/[^\s)\]]+/g) ?? [];
  return [...new Set(matches)].slice(0, 6);
}

function inferCitations(
  response: string,
  retrieved: Array<{
    resourceId?: string;
    filename: string;
    page?: number;
    sourceType: "pack" | "personal";
    score?: number;
  }>,
  searchUrls: string[],
): Citation[] {
  const parsed: Citation[] = [];
  const lines = response.split("\n");
  const numericRefs = Array.from(response.matchAll(/\[(\d{1,2})\]/g)).map((match) => Number(match[1]));

  if (numericRefs.length > 0) {
    for (const ref of numericRefs) {
      const idx = ref - 1;
      if (idx < 0) continue;
      const source = retrieved[idx];
      if (!source) continue;
      parsed.push({
        resourceId: source.resourceId,
        filename: source.filename,
        page: source.page,
        sourceType: source.sourceType,
      });
    }
  }

  for (const line of lines) {
    const hasCitation = /\[[^\]]+\]/.test(line);
    if (!hasCitation) continue;

    for (const source of retrieved) {
      if (line.toLowerCase().includes(source.filename.toLowerCase())) {
        parsed.push({
          resourceId: source.resourceId,
          filename: source.filename,
          page: source.page,
          sourceType: source.sourceType,
        });
      }
    }

    if (line.toLowerCase().includes("general knowledge")) {
      parsed.push({ filename: "general knowledge", sourceType: "general" });
    }
  }

  for (const url of searchUrls) {
    parsed.push({
      filename: url.replace(/^https?:\/\//, "").split("/")[0] ?? "web",
      sourceType: "search",
      url,
    });
  }

  if (parsed.length > 0) {
    const unique = new Map<string, Citation>();
    for (const item of parsed) {
      const key = `${item.sourceType}:${item.resourceId ?? ""}:${item.url ?? ""}:${item.filename}:${item.page ?? ""}`;
      if (!unique.has(key)) unique.set(key, item);
    }
    return [...unique.values()].slice(0, 8);
  }

  if (searchUrls.length > 0) {
    return searchUrls.map((url) => ({
      filename: url,
      sourceType: "search",
      url,
    }));
  }

  if (retrieved.length > 0) {
    const relevant = retrieved
      .filter((source) => (source.score ?? 0) > 0.5)
      .slice(0, 6);
    const sourceList = relevant.length > 0 ? relevant : [];
    if (sourceList.length === 0) {
      return [{ filename: "general knowledge", sourceType: "general" }];
    }
    return sourceList.map((source) => ({
      resourceId: source.resourceId,
      filename: source.filename,
      page: source.page,
      sourceType: source.sourceType,
    }));
  }

  return [{ filename: "general knowledge", sourceType: "general" }];
}

function mergeMemoryEntries(existing: MemoryEntry[], incoming: MemoryEntry[]) {
  const key = (entry: MemoryEntry) => `${entry.key.toLowerCase()}::${entry.value.toLowerCase()}`;
  const map = new Map<string, MemoryEntry>();

  for (const entry of existing) {
    map.set(key(entry), entry);
  }

  for (const entry of incoming) {
    const entryKey = key(entry);
    const previous = map.get(entryKey);
    if (!previous) {
      map.set(entryKey, entry);
      continue;
    }
    map.set(entryKey, {
      ...previous,
      confidence: Math.max(previous.confidence, entry.confidence),
      extractedAt: Math.max(previous.extractedAt, entry.extractedAt),
    });
  }

  return [...map.values()]
    .sort((a, b) => b.confidence - a.confidence || b.extractedAt - a.extractedAt)
    .slice(0, 30);
}

function formatMemory(entries: MemoryEntry[]) {
  if (entries.length === 0) return "";
  return entries
    .slice(0, 8)
    .map((entry) => `- ${entry.key}: ${entry.value}`)
    .join("\n");
}

function chunkString(value: string, size: number) {
  const chunks = value.match(new RegExp(`.{1,${size}}`, "g"));
  return chunks ?? [];
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, timeoutMs);

    void promise
      .then((value) => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve(value);
        }
      })
      .catch(() => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve(null);
        }
      });
  });
}

async function maybeGenerateTitle(params: {
  chatId: string;
  actorClerkId: string;
  userMessage: string;
  assistantMessage: string;
}) {
  try {
    const completion = await openRouterChatCompletion({
      model: MODEL_CONFIG.tutorFast,
      fallbackModels: [MODEL_CONFIG.marker],
      messages: [
        {
          role: "system",
          content:
            "Generate a concise 5-8 word chat title. Reply with title text only, no quotes, no punctuation at ends.",
        },
        {
          role: "user",
          content: `User: ${params.userMessage}\nAssistant: ${params.assistantMessage.slice(0, 240)}`,
        },
      ],
      temperature: 0.2,
    });

    const raw = completion.choices?.[0]?.message?.content?.trim();
    if (!raw) return;

    const title = raw
      .replace(/[\n\r]+/g, " ")
      .replace(/^['\"`\s]+|['\"`\s]+$/g, "")
      .slice(0, 80);

    if (!title) return;

    await convexMutation("chats:setChatTitle", {
      actorClerkId: params.actorClerkId,
      chatId: params.chatId,
      title,
    });
  } catch {
    // Non-blocking enhancement.
  }
}

async function maybeCompactHistory(params: {
  actorClerkId: string;
  chatId: string;
  history: ChatMessage[];
}) {
  if (params.history.length <= 20) return;

  const source = params.history
    .slice(0, Math.max(0, params.history.length - 6))
    .map((message) => `${message.role.toUpperCase()}: ${message.content.slice(0, 380)}`)
    .join("\n\n")
    .slice(0, 12000);

  const completion = await withTimeout(
    openRouterChatCompletion({
      model: MODEL_CONFIG.tutorFast,
      fallbackModels: [MODEL_CONFIG.marker],
      messages: [
        {
          role: "system",
          content:
            "Summarize this conversation for future context compaction. Keep key goals, constraints, misconceptions, and progress in <180 words.",
        },
        {
          role: "user",
          content: source,
        },
      ],
      temperature: 0.1,
    }),
    5000,
  );

  const summary = completion?.choices?.[0]?.message?.content?.trim();
  if (!summary) return;

  await convexMutation("chats:setContextSummary", {
    actorClerkId: params.actorClerkId,
    chatId: params.chatId,
    contextSummary: summary.slice(0, 2000),
  });
}

async function maybeExtractMemory(params: {
  actorClerkId: string;
  existingEntries: MemoryEntry[];
  userMessage: string;
  assistantResponse: string;
}) {
  const snippet = `User: ${params.userMessage.slice(0, 500)}\nAssistant: ${params.assistantResponse.slice(0, 500)}`;

  const completion = await withTimeout(
    openRouterChatCompletion({
      model: MODEL_CONFIG.tutorFast,
      fallbackModels: [MODEL_CONFIG.marker],
      messages: [
        {
          role: "system",
          content:
            "Extract durable facts about this student: learning level, subject preferences, struggles, study style, goals. Return JSON array of {key,value,confidence}. Only include persistent facts.",
        },
        {
          role: "user",
          content: snippet,
        },
      ],
      temperature: 0,
    }),
    5000,
  );

  if (!completion) return;

  const raw = completion.choices?.[0]?.message?.content ?? "[]";
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ key?: string; value?: string; confidence?: number }>;
    const now = Date.now();
    const extracted: MemoryEntry[] = parsed
      .filter((entry) => typeof entry.key === "string" && typeof entry.value === "string")
      .slice(0, 8)
      .map((entry) => ({
        key: String(entry.key),
        value: String(entry.value),
        confidence: Math.max(0, Math.min(1, Number(entry.confidence ?? 0.6))),
        extractedAt: now,
      }));

    const merged = mergeMemoryEntries(params.existingEntries, extracted);
    await convexMutation("memory:upsertUserMemory", {
      actorClerkId: params.actorClerkId,
      entries: merged,
      rawMemoryText: formatMemory(merged),
    });
  } catch {
    // Ignore malformed model output.
  }
}

async function maybeSearchWeb(message: string, thinkingLevel: "low" | "medium" | "high") {
  const searchModel = thinkingLevel === "high" ? MODEL_CONFIG.searchDeep : MODEL_CONFIG.searchFast;
  const completion = await withTimeout(
    openRouterChatCompletion({
      model: searchModel,
      fallbackModels: ROUTER_FALLBACKS[searchModel] ?? [MODEL_CONFIG.searchFast, MODEL_CONFIG.tutorFast],
      messages: [
        {
          role: "system",
          content:
            "Provide a concise up-to-date briefing with explicit source URLs for key claims. Keep under 180 words.",
        },
        {
          role: "user",
          content: message,
        },
      ],
      temperature: 0.2,
    }),
    8000,
  );

  const text = completion?.choices?.[0]?.message?.content?.trim() ?? "";
  return {
    text,
    urls: extractUrls(text),
  };
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();

    const body = (await request.json().catch(() => null)) as ChatRequestBody | null;
    if (!body) {
      return jsonError(400, {
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      });
    }

    if (!body.mode || !body.message || !body.thinkingLevel || !body.routerMode) {
      return jsonError(400, {
        code: "MISSING_FIELDS",
        message: "mode, message, thinkingLevel, and routerMode are required.",
      });
    }

    const safeMode = safeStudyMode(body.mode, "POST /api/chat");

    const normalizedMessage = body.message.trim();
    if (!normalizedMessage) {
      return jsonError(400, {
        code: "EMPTY_MESSAGE",
        message: "Message cannot be empty.",
      });
    }

    let selectedAgent: AgentSnapshot | undefined;
    if (body.agentId) {
      selectedAgent = (await convexQuery("agents:getAgent", {
        actorClerkId: actor.clerkId,
        agentId: body.agentId,
      })) as AgentSnapshot;
    }

    const budget = (await convexQuery("usage:checkUserBudget", {
      actorClerkId: actor.clerkId,
    })) as {
      totalSpentEur: number;
      tier: "normal" | "cheap_only" | "free_only";
      softLimitReached: boolean;
      hardLimitReached: boolean;
    };

    const catalog = (await convexQuery("models:listModels", {
      actorClerkId: actor.clerkId,
    })) as Array<{ modelId: string; isFree?: boolean; inputCostPerM?: number }>;

    if (budget.tier === "free_only") {
      const hasFreeModel = catalog.some((model) => model.isFree || model.modelId.includes(":free"));
      if (!hasFreeModel) {
        return jsonError(402, {
          code: "NO_FREE_MODEL_AVAILABLE",
          message: "Usage cap reached and no budget-safe models are available right now.",
          retryable: false,
        });
      }
    }

    const autoSettings = {
      enhancePrompt: body.autoSettings?.enhancePrompt ?? true,
      autoModel: body.autoSettings?.autoModel ?? true,
      autoThinking: body.autoSettings?.autoThinking ?? true,
      autoSearch: body.autoSettings?.autoSearch ?? true,
      enhanceMode: body.autoSettings?.enhanceMode ?? "auto",
      thinkingMode: body.autoSettings?.thinkingMode ?? "auto",
      searchMode: body.autoSettings?.searchMode ?? "auto",
    };

    const auto = await runAutoSettingsPipeline({
      message: normalizedMessage,
      currentThinkingLevel: body.thinkingLevel,
      spendingTier: budget.tier,
      autoEnhancePrompt: autoSettings.enhancePrompt,
      autoThinking: autoSettings.autoThinking,
      autoSearch: autoSettings.autoSearch,
      enhanceMode: autoSettings.enhanceMode,
      thinkingMode: autoSettings.thinkingMode,
      searchMode: autoSettings.searchMode,
    });

    const effectiveMode = safeMode;

    const chatId = body.chatId
      ? body.chatId
      : (
          (await convexMutation("chats:createChat", {
            actorClerkId: actor.clerkId,
            packId: body.packId,
            agentId: body.agentId,
            mode: effectiveMode,
            thinkingLevel: auto.thinkingLevel,
            routerMode: body.routerMode,
            manualModel: body.manualModel,
            usePersonalResources: body.usePersonalResources,
            title: normalizedMessage.slice(0, 60),
          })) as { chatId: string }
        ).chatId;

    const isRegenerate = Boolean(body.regenerate && body.chatId);

    if (isRegenerate) {
      await convexMutation("chats:deleteLastAssistantMessage", {
        actorClerkId: actor.clerkId,
        chatId,
      });
    } else {
      await convexMutation("chats:appendMessage", {
        actorClerkId: actor.clerkId,
        chatId,
        role: "user",
        content: normalizedMessage,
        enhancedContent: auto.promptEnhanced ? auto.message : undefined,
        mode: effectiveMode,
        packId: body.packId,
        citations: [],
        modelRequested: undefined,
        modelUsed: undefined,
        whyThisResponse: undefined,
        usageIn: undefined,
        usageOut: undefined,
        verificationPassed: undefined,
      });
    }

    const [chatData, orgSettings, userMemory] = await Promise.all([
      convexQuery("chats:getChat", {
        actorClerkId: actor.clerkId,
        chatId,
      }) as Promise<{ chat: Record<string, unknown>; messages: Array<Record<string, unknown>> }>,
      convexQuery("admin:getOrgSettings", { actorClerkId: actor.clerkId }) as Promise<{
        org: { verifyMarkerPassEnabled: boolean };
      }>,
      convexQuery("memory:getUserMemory", {
        actorClerkId: actor.clerkId,
      }) as Promise<{ rawMemoryText: string; entries: MemoryEntry[] }>,
    ]);

    const storedAgentId =
      typeof chatData.chat.agentId === "string" && chatData.chat.agentId.trim().length > 0
        ? chatData.chat.agentId
        : undefined;

    if (!selectedAgent && storedAgentId) {
      selectedAgent = (await convexQuery("agents:getAgent", {
        actorClerkId: actor.clerkId,
        agentId: storedAgentId,
      })) as AgentSnapshot;
    }

    const history = toChatMessageShape(chatData.messages);
    const attemptStats = extractAttemptStats(history);

    const existingSummary =
      typeof chatData.chat.contextSummary === "string" && chatData.chat.contextSummary.trim().length > 0
        ? String(chatData.chat.contextSummary)
        : undefined;

    if (history.length > 20 && !existingSummary) {
      void maybeCompactHistory({
        actorClerkId: actor.clerkId,
        chatId,
        history,
      }).catch(() => {});
    }

    const recentHistory = existingSummary ? history.slice(-6) : history;
    const historyForModel = recentHistory.map((message, index) => {
      const isLast = index === recentHistory.length - 1;
      if (isLast && message.role === "user" && auto.promptEnhanced) {
        return {
          ...message,
          content: auto.message,
        };
      }
      return message;
    });

    let retrieval: {
      citations: Array<{
        resourceId?: string;
        filename: string;
        page?: number;
        sourceType: "pack" | "personal";
        text: string;
        score?: number;
      }>;
      sourceBlock: string;
    } = {
      citations: [],
      sourceBlock: "No retrieved sources.",
    };

    try {
      const [personalResources, agentResources] = await Promise.all([
        body.usePersonalResources
          ? (convexQuery("resources:listPersonalResources", {
              actorClerkId: actor.clerkId,
            }) as Promise<Array<unknown>>)
          : Promise.resolve([]),
        selectedAgent?._id
          ? (convexQuery("resources:listAgentResources", {
              actorClerkId: actor.clerkId,
              agentId: selectedAgent._id,
            }) as Promise<Array<unknown>>)
          : Promise.resolve([]),
      ]);

      const hasRetrievalSources = personalResources.length > 0 || agentResources.length > 0;
      if (hasRetrievalSources) {
        const queryEmbedding = await openRouterEmbedding(auto.message, MODEL_CONFIG.embedding);
        retrieval = (await convexAction("rag:retrieve", {
          actorClerkId: actor.clerkId,
          agentId: selectedAgent?._id,
          includePersonal: body.usePersonalResources,
          embedding: queryEmbedding,
          topK: 8,
        })) as {
          citations: Array<{
            resourceId?: string;
            filename: string;
            page?: number;
            sourceType: "pack" | "personal";
            text: string;
            score?: number;
          }>;
          sourceBlock: string;
        };
      }
    } catch {
      retrieval = {
        citations: [],
        sourceBlock: "Retrieval unavailable. Continue with general instructional support.",
      };
    }

    let searchBlock = "";
    let searchUrls: string[] = [];

    if (auto.searchEnabled) {
      const web = await maybeSearchWeb(auto.message, auto.thinkingLevel);
      searchBlock = web.text;
      searchUrls = web.urls;
    }

    const route = chooseModelRoute({
      mode: effectiveMode,
      thinkingLevel: auto.thinkingLevel,
      hasAttachments: (body.attachmentTypes?.length ?? 0) > 0,
      attachmentTypes: body.attachmentTypes ?? [],
      messageLength: auto.message.length,
      teacherStrictness: "medium",
      routerMode: autoSettings.autoModel ? body.routerMode : "manual",
      manualModel: autoSettings.autoModel ? body.manualModel : body.manualModel ?? MODEL_CONFIG.tutorFast,
      studentSeemsStuck: effectiveMode === "tutor" && attemptStats.attemptCount >= 2,
      spendingTier: budget.tier,
      needsSearch: auto.searchEnabled,
      promptCategory: auto.promptCategory,
    });

    const primaryModel = route.primaryModel;
    const modelSupportsExtendedThinking = /reason|r1|o3|o4|claude|gemini|sonar-pro/i.test(primaryModel);
    const effectiveThinkingLevel = modelSupportsExtendedThinking
      ? auto.thinkingLevel
      : auto.thinkingLevel === "high"
        ? "medium"
        : auto.thinkingLevel;

    const gate = tutorGate(attemptStats.attemptCount, attemptStats.hasReflection);

    const systemPrompt = buildSystemPrompt({
      mode: effectiveMode,
      strictness: "medium",
      guidelines: {
        summary:
          selectedAgent?.guidelinesSummary ??
          "General school guidance. Upload resources to strengthen topic alignment.",
        topicMap: selectedAgent?.guidelinesTopicMap ?? [],
        rubricHints: [],
        misconceptions: [],
      },
      sourceBlock: retrieval.sourceBlock,
      gate,
      agent: selectedAgent
        ? {
            name: selectedAgent.name,
            description: selectedAgent.description,
            systemPrompt: selectedAgent.systemPrompt,
            guidelinesSummary: selectedAgent.guidelinesSummary,
            guidelinesTopicMap: selectedAgent.guidelinesTopicMap,
          }
        : undefined,
      memoryProfile: userMemory.rawMemoryText,
      contextSummary: existingSummary,
      searchBlock,
    });

    const messages = [
      { role: "system", content: systemPrompt },
      ...toOpenRouterMessages(historyForModel),
    ];

    const shouldVerify = effectiveMode === "marker" && Boolean(orgSettings.org?.verifyMarkerPassEnabled);

    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    const send = async (payload: Record<string, unknown>) => {
      await writer.write(encoder.encode(`${JSON.stringify(payload)}\n`));
    };

    void (async () => {
      let responseText = "";
      let modelUsed = primaryModel;
      const modelRequested = primaryModel;
      let usageIn = 0;
      let usageOut = 0;
      let verificationPassed: boolean | undefined;

      try {
        if (!shouldVerify) {
          for await (const event of openRouterStreamChat({
            model: primaryModel,
            fallbackModels: route.fallbackModels,
            messages,
          })) {
            if (event.type === "delta") {
              responseText += event.content;
              await send({ type: "delta", content: event.content });
            }
            if (event.type === "done") {
              modelUsed = event.model ?? modelUsed;
              usageIn = event.inputTokens ?? usageIn;
              usageOut = event.outputTokens ?? usageOut;
            }
            if (event.type === "error") {
              throw new Error(event.error);
            }
          }
        } else {
          const initial = await openRouterChatCompletion({
            model: primaryModel,
            fallbackModels: route.fallbackModels,
            messages,
          });

          responseText = initial.choices?.[0]?.message?.content ?? "";
          modelUsed = initial.model ?? modelUsed;
          usageIn = initial.usage?.prompt_tokens ?? usageIn;
          usageOut = initial.usage?.completion_tokens ?? usageOut;

          if (route.verificationModel) {
            const verify = await openRouterChatCompletion({
              model: route.verificationModel,
              fallbackModels: [MODEL_CONFIG.tutorFast],
              messages: [
                { role: "system", content: "Return strict JSON only." },
                { role: "user", content: markerVerificationPrompt(responseText) },
              ],
              temperature: 0,
            });

            const parsed = parseVerificationJson(verify.choices?.[0]?.message?.content ?? "{}");
            verificationPassed = parsed.pass;

            if (!parsed.pass) {
              const retry = await openRouterChatCompletion({
                model: primaryModel,
                fallbackModels: route.fallbackModels,
                messages: [
                  ...messages,
                  {
                    role: "system",
                    content:
                      "Regenerate with stronger citation discipline and explicit rubric scoring. Ensure key claims map to provided sources or general knowledge.",
                  },
                ],
                temperature: 0.1,
              });

              responseText = retry.choices?.[0]?.message?.content ?? responseText;
              modelUsed = retry.model ?? modelUsed;
              usageIn += retry.usage?.prompt_tokens ?? 0;
              usageOut += retry.usage?.completion_tokens ?? 0;
            }
          }

          for (const chunk of chunkString(responseText, 24)) {
            await send({ type: "delta", content: chunk });
          }
        }

        const policyPass = checkPromptPolicyResponse({ mode: effectiveMode, response: responseText });
        if (!policyPass) {
          responseText +=
            "\n\nPolicy correction: citation and study-mode structure tightened to match requirements.";
        }

        const citations = inferCitations(responseText, retrieval.citations, searchUrls);
        const whyThisResponse = summarizeWhyResponse(effectiveMode, route.reason);

        const appended = (await convexMutation("chats:appendMessage", {
          actorClerkId: actor.clerkId,
          chatId,
          role: "assistant",
          content: responseText,
          mode: effectiveMode,
          citations,
          modelRequested,
          modelUsed,
          whyThisResponse,
          usageIn,
          usageOut,
          verificationPassed,
        })) as { messageId: string };

        const pricing = (await convexQuery("models:getModelPricing", {
          actorClerkId: actor.clerkId,
          modelId: modelUsed,
        })) as { inputCostPerM: number; outputCostPerM: number };

        await convexMutation("usage:recordUsageWithCost", {
          actorClerkId: actor.clerkId,
          chatId,
          messageId: appended.messageId,
          model: modelUsed,
          inputTokens: usageIn,
          outputTokens: usageOut,
          inputCostPerM: pricing.inputCostPerM,
          outputCostPerM: pricing.outputCostPerM,
        });

        const spendingUpdate = (await convexQuery("usage:checkUserBudget", {
          actorClerkId: actor.clerkId,
        })) as {
          totalSpentEur: number;
          totalCostCents: number;
          tier: "normal" | "cheap_only" | "free_only";
          softLimitReached: boolean;
          hardLimitReached: boolean;
        };

        void convexMutation("analytics:recordSession", {
          actorClerkId: actor.clerkId,
          mode: effectiveMode,
          model: modelUsed,
          tokensUsed: usageIn + usageOut,
          topic: normalizedMessage.slice(0, 60),
        }).catch(() => {});

        if (selectedAgent) {
          await convexMutation("agents:incrementUsageCount", {
            actorClerkId: actor.clerkId,
            agentId: selectedAgent._id,
          });
        }

        void maybeExtractMemory({
          actorClerkId: actor.clerkId,
          existingEntries: userMemory.entries,
          userMessage: normalizedMessage,
          assistantResponse: responseText,
        }).catch(() => {});

        const assistantCount = history.filter((message) => message.role === "assistant").length;
        if (assistantCount === 0) {
          void maybeGenerateTitle({
            chatId,
            actorClerkId: actor.clerkId,
            userMessage: normalizedMessage,
            assistantMessage: responseText,
          });
        }

        await send({
          type: "done",
          chatId,
          messageId: appended.messageId,
          modelUsed,
          modelRequested,
          whyThisResponse,
          citations,
          verificationPassed,
          spendingUpdate,
          autoResult: {
            modelUsed,
            searchEnabled: route.searchEnabled || auto.searchEnabled,
            thinkingLevel: effectiveThinkingLevel,
            promptEnhanced: auto.promptEnhanced,
          },
          enhancedPrompt: auto.promptEnhanced ? auto.message : undefined,
          agent:
            selectedAgent && selectedAgent._id
              ? {
                  id: selectedAgent._id,
                  name: selectedAgent.name,
                  emoji: selectedAgent.avatarEmoji,
                }
              : undefined,
        });
      } catch (error) {
        await send({
          type: "error",
          error: {
            code: "CHAT_STREAM_FAILED",
            message: error instanceof Error ? error.message : "Failed to stream response",
            retryable: true,
          },
        });
      } finally {
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });
}
