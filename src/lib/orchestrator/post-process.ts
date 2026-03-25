import { convexAction, convexMutation, convexQuery } from "@/lib/convex-server";
import { MODEL_CONFIG } from "@/lib/model-config";
import { resolveRoleModelBundle } from "@/lib/model-role-resolver";
import { buildRuntimeStatMap, pickModelAndFallbacks } from "@/lib/model-selection";
import { getLiveCatalogSnapshot } from "@/lib/openrouter-catalog-cache";
import { openRouterChatCompletion, openRouterEmbeddingRequest } from "@/lib/openrouter";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";
import { extractCitationsFromText } from "@/lib/orchestrator/compose";
import type { WebSearchSource } from "@/lib/orchestrator/retrieval";
import { withTimeout, type MemoryEntry } from "@/lib/orchestrator/history";
import {
  coerceLearningContext,
  deriveLearningContextFallback,
  type LearningContext,
} from "@/lib/orchestrator/learning-context";
import type { Citation } from "@/types";

const TITLE_MIN_WORDS = 2;
const TITLE_MAX_WORDS = 6;
const MEMORY_MAX_ENTRIES = 80;
const MEMORY_MAX_RAW_CHARS = 1500;
const MEMORY_PROFILE_MAX_ENTRIES = 8;
const MEMORY_PROFILE_MIN_SCORE = 0.08;
const MEMORY_TOPIC_SIMILARITY_MIN = 0.52;
const MEMORY_TOPIC_MAX_ENTRIES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

type UtilityModelSelection = {
  model: string;
  fallbackModels: string[];
};

type MemoryEntryCategory = "identity" | "academic" | "preference" | "topic" | "artifact" | "correction";
type MemoryEntrySourceType = "extraction" | "user_explicit" | "correction";

type RoutedMemoryEntry = {
  key: string;
  text: string;
  confidence: number;
  category: MemoryEntryCategory;
  sourceType: MemoryEntrySourceType;
  status?: "pending" | "confirmed";
  relatedArtifacts?: string[];
  negativeTopicLinks?: string[];
};

type MemoryDirectiveEntry = {
  key: string;
  text: string;
  category: "identity" | "academic" | "preference";
};

const MEMORY_RETENTION_WINDOWS_MS: Record<MemoryEntryCategory, number | null> = {
  identity: null,
  academic: 180 * DAY_MS,
  preference: 90 * DAY_MS,
  topic: 45 * DAY_MS,
  artifact: 45 * DAY_MS,
  correction: 180 * DAY_MS,
};

export type PlannedMemoryProfile = {
  profileText: string;
  layer2Text: string;
  layer3Text: string;
  layer2Count: number;
  layer3Count: number;
  retrievedTopicEntries: Array<{
    key: string;
    text: string;
    category: "topic" | "artifact" | "correction";
    confidence: number;
    score: number;
    sourceChatId?: string;
  }>;
  embeddingCall?: {
    model?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
    durationMs?: number;
  };
};

async function selectUtilityModel(params: {
  actorClerkId: string;
  requiredCapabilities?: Array<"reasoning" | "vision" | "code" | "search" | "image_generation">;
  preferredCapabilities?: Array<"reasoning" | "vision" | "code" | "search" | "image_generation">;
  preferFast?: boolean;
  preferCheap?: boolean;
  preferFree?: boolean;
}): Promise<UtilityModelSelection> {
  const [dbCatalog, runtimeStats, budget] = await Promise.all([
    convexQuery("models:listModels", {
      actorClerkId: params.actorClerkId,
    }).catch(() => [] as Array<Record<string, unknown>>),
    convexQuery("models:listRuntimeStats", {
      actorClerkId: params.actorClerkId,
    }).catch(() => [] as Array<{ modelId: string; successCount: number; failureCount: number; avgLatencyMs?: number }>),
    convexQuery("usage:checkUserBudget", {
      actorClerkId: params.actorClerkId,
    }).catch(() => ({ tier: "normal" as const })),
  ]);
  const liveCatalog = await getLiveCatalogSnapshot({
    fallbackCatalog: dbCatalog as Array<{
      modelId: string;
      name?: string;
      provider?: string;
      description?: string;
      contextLength?: number;
      inputCostPerM?: number;
      outputCostPerM?: number;
      tags?: string[];
      isFree?: boolean;
      costRating?: "low" | "medium" | "high";
      speedRating?: "low" | "medium" | "high";
      reasoningRating?: "low" | "medium" | "high";
      multimodalRating?: "none" | "basic" | "strong";
      capabilities?: {
        reasoning?: number;
        creative?: number;
        code?: number;
        vision?: number;
        speed?: number;
      };
    }>,
  });
  const catalog = liveCatalog.models.length > 0
    ? liveCatalog.models
    : (dbCatalog as Array<{
        modelId: string;
        name?: string;
        provider?: string;
        description?: string;
        contextLength?: number;
        inputCostPerM?: number;
        outputCostPerM?: number;
        tags?: string[];
        isFree?: boolean;
        costRating?: "low" | "medium" | "high";
        speedRating?: "low" | "medium" | "high";
        reasoningRating?: "low" | "medium" | "high";
        multimodalRating?: "none" | "basic" | "strong";
        capabilities?: {
          reasoning?: number;
          creative?: number;
          code?: number;
          vision?: number;
          speed?: number;
        };
      }>);
  const spendingTier = (budget as { tier?: "normal" | "expensive_blocked" | "cheap_only" | "free_only" })?.tier ?? "normal";
  const catalogWithoutAuto = catalog.filter((model) => model.modelId !== "openrouter/auto");
  const runtimeStatMap = buildRuntimeStatMap(
    runtimeStats as Array<{ modelId: string; successCount: number; failureCount: number; avgLatencyMs?: number }>,
  );

  const picked = pickModelAndFallbacks({
    catalog: catalogWithoutAuto,
    tier: spendingTier,
    requiredCapabilities: params.requiredCapabilities,
    preferredCapabilities: params.preferredCapabilities,
    preferFast: params.preferFast ?? true,
    preferCheap: params.preferCheap ?? true,
    preferFree: params.preferFree ?? false,
    runtimeStats: runtimeStatMap,
    maxFallbacks: 3,
  });

  let model = picked.selected?.modelId;
  let fallbackModels = picked.fallbacks.filter((candidate) => candidate !== model);

  if (!model) {
    const relaxed = pickModelAndFallbacks({
      catalog: catalogWithoutAuto,
      tier: spendingTier,
      preferFast: params.preferFast ?? true,
      preferCheap: params.preferCheap ?? true,
      preferFree: spendingTier === "free_only" || Boolean(params.preferFree),
      runtimeStats: runtimeStatMap,
      maxFallbacks: 3,
    });
    model = relaxed.selected?.modelId;
    fallbackModels = relaxed.fallbacks.filter((candidate) => candidate !== model);
  }

  if (!model) {
    model = spendingTier === "free_only" ? MODEL_CONFIG.tutorFast : MODEL_CONFIG.smartCheap;
  }

  return {
    model,
    fallbackModels: [...new Set(fallbackModels)].filter((candidate) => candidate !== model),
  };
}

function canonicalMemoryKey(rawKey: string) {
  const normalized = rawKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return "general_note";
  if (/(learning|study)_style|preferred_style/.test(normalized)) return "learning_style";
  if (/weakness|struggle|difficulty/.test(normalized)) return "struggles";
  if (/goal|objective|target/.test(normalized)) return "goals";
  if (/subject.*prefer|favorite_subject|subject_interest/.test(normalized)) return "subject_preferences";
  return normalized;
}

function normalizeMemoryLine(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 700);
}

function inferMemoryCategory(params: {
  key: string;
  value: string;
  sourceType: MemoryEntrySourceType;
}): MemoryEntryCategory {
  const key = params.key.toLowerCase();
  const value = params.value.toLowerCase();
  if (params.sourceType === "correction") return "correction";
  if (/(name|grade|year|school|timezone|country|location|language|identity|role)/.test(key)) return "identity";
  if (/(learning_style|communication|difficulty|preference|tone|study_habit)/.test(key)) return "preference";
  if (/(prefer|preference|concise|detailed|step by step|visual|communication style)/.test(value)) return "preference";
  if (/(subject|strength|weakness|struggle|goal|academic|exam|curriculum)/.test(key)) return "academic";
  if (/(flashcard|deck|quiz|artifact|worksheet|notes?)/.test(key) || /(flashcard|quiz|deck|worksheet)/.test(value)) {
    return "artifact";
  }
  return "topic";
}

function isMemoryExpired(params: {
  category: MemoryEntryCategory;
  extractedAt: number;
  now: number;
}) {
  const retentionWindow = MEMORY_RETENTION_WINDOWS_MS[params.category];
  if (retentionWindow === null) return false;
  return params.now - params.extractedAt > retentionWindow;
}

function isOneOffMemoryCandidate(value: string) {
  return /\b(today|tomorrow|tonight|this week|next week|submit|deadline|due by|assignment due|homework due)\b/i.test(
    value,
  );
}

function toLayer2Label(category: string) {
  if (category === "identity") return "Identity";
  if (category === "academic") return "Academic Profile";
  if (category === "preference") return "Learning Preferences";
  return "Profile";
}

function dedupeProfileLines(lines: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(line);
  }
  return output;
}

function trimMemoryText(value: string) {
  if (value.length <= MEMORY_MAX_RAW_CHARS) return value;
  return value.slice(0, MEMORY_MAX_RAW_CHARS).trimEnd();
}

export function formatMemory(entries: MemoryEntry[]) {
  if (entries.length === 0) return "";
  const lines: string[] = [];
  let size = 0;
  for (const entry of entries) {
    const line = `- ${entry.key}: ${entry.value}`.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const nextSize = size + line.length + (lines.length > 0 ? 1 : 0);
    if (nextSize > MEMORY_MAX_RAW_CHARS) break;
    lines.push(line);
    size = nextSize;
  }
  return trimMemoryText(lines.join("\n"));
}

export function mergeMemoryEntries(existing: MemoryEntry[], incoming: MemoryEntry[]) {
  const now = Date.now();
  const map = new Map<string, MemoryEntry>();

  const normalizedExisting = existing
    .map((entry) => ({
      key: canonicalMemoryKey(entry.key),
      value: entry.value.replace(/\s+/g, " ").trim(),
      confidence: Math.max(0, Math.min(1, Number(entry.confidence ?? 0.6))),
      extractedAt: Number.isFinite(entry.extractedAt) ? Number(entry.extractedAt) : now,
    }))
    .filter((entry) => entry.value.length > 0)
    .filter((entry) => {
      const category = inferMemoryCategory({
        key: entry.key,
        value: entry.value,
        sourceType: "extraction",
      });
      return !isMemoryExpired({
        category,
        extractedAt: entry.extractedAt,
        now,
      });
    });

  for (const entry of normalizedExisting) {
    map.set(entry.key, entry);
  }

  for (const rawEntry of incoming) {
    const key = canonicalMemoryKey(rawEntry.key);
    const value = rawEntry.value.replace(/\s+/g, " ").trim();
    if (!value) continue;
    const category = inferMemoryCategory({
      key,
      value,
      sourceType: "extraction",
    });
    const entry: MemoryEntry = {
      key,
      value,
      confidence: Math.max(0, Math.min(1, Number(rawEntry.confidence ?? 0.6))),
      extractedAt: Number.isFinite(rawEntry.extractedAt) ? Number(rawEntry.extractedAt) : now,
    };
    if (isMemoryExpired({ category, extractedAt: entry.extractedAt, now })) {
      continue;
    }
    const previous = map.get(key);
    if (!previous) {
      map.set(key, entry);
      continue;
    }

    const newer = entry.extractedAt >= previous.extractedAt;
    map.set(key, {
      key,
      value: newer ? entry.value : previous.value,
      confidence: Math.max(previous.confidence, entry.confidence),
      extractedAt: Math.max(previous.extractedAt, entry.extractedAt),
    });
  }

  return [...map.values()]
    .sort((a, b) => b.confidence - a.confidence || b.extractedAt - a.extractedAt)
    .slice(0, MEMORY_MAX_ENTRIES);
}

export function shouldInjectMemory(message: string) {
  const normalized = message.toLowerCase();
  return /(i\b|my\b|me\b|struggle|goal|preference|prefer|weakness|improve|last time|again|remember)/i.test(
    normalized,
  );
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function overlapScore(queryTokens: string[], entryTokens: Set<string>) {
  if (queryTokens.length === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (entryTokens.has(token)) overlap += 1;
  }
  return overlap / queryTokens.length;
}

function recencyScore(extractedAt: number) {
  const age = Math.max(0, Date.now() - extractedAt);
  if (age <= 7 * 24 * 60 * 60 * 1000) return 1;
  if (age <= 30 * 24 * 60 * 60 * 1000) return 0.7;
  if (age <= 90 * 24 * 60 * 60 * 1000) return 0.45;
  return 0.2;
}

export function buildRelevantMemoryProfile(params: {
  message: string;
  entries: MemoryEntry[];
  rawMemoryText?: string;
}) {
  const queryTokens = tokenize(params.message);
  if (params.entries.length === 0) {
    return params.rawMemoryText ? params.rawMemoryText.slice(0, MEMORY_MAX_RAW_CHARS) : "";
  }

  const ranked = params.entries
    .map((entry) => {
      const entryTokens = new Set(tokenize(`${entry.key} ${entry.value}`));
      const lexical = overlapScore(queryTokens, entryTokens);
      const confidence = Math.max(0, Math.min(1, Number(entry.confidence ?? 0.5)));
      const recency = recencyScore(entry.extractedAt);
      const score = lexical * 0.58 + confidence * 0.26 + recency * 0.16;
      return { ...entry, score };
    })
    .sort((a, b) => b.score - a.score || b.extractedAt - a.extractedAt);

  const shortlisted = ranked
    .filter((entry, index) => index < 2 || entry.score >= MEMORY_PROFILE_MIN_SCORE)
    .slice(0, MEMORY_PROFILE_MAX_ENTRIES)
    .map((entry) => ({
      key: entry.key,
      value: entry.value,
      confidence: entry.confidence,
      extractedAt: entry.extractedAt,
    }));

  const profile = formatMemory(shortlisted);
  if (profile) return profile;
  return params.rawMemoryText ? params.rawMemoryText.slice(0, MEMORY_MAX_RAW_CHARS) : "";
}

function normalizeDirectiveStatement(rawValue: string) {
  return normalizeMemoryLine(
    rawValue
      .replace(/^remember\s+(that\s+)?/i, "")
      .replace(/^update\s+my\s+profile\s*:?\s*/i, "")
      .replace(/^i\s+/i, "I "),
  );
}

function directiveKeyFromStatement(statement: string) {
  const slug = statement
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (!slug) return "explicit_memory";
  return `remember_${slug}`;
}

export function buildDirectiveMemoryEntries(params: {
  statement: string;
  directiveType: "remember" | "update_profile";
}): MemoryDirectiveEntry[] {
  const statement = normalizeDirectiveStatement(params.statement);
  if (!statement) return [];
  const key = params.directiveType === "update_profile" ? "profile_update" : directiveKeyFromStatement(statement);
  const lower = statement.toLowerCase();
  const category = inferMemoryCategory({
    key,
    value: lower,
    sourceType: "user_explicit",
  });
  const layer2Category = (category === "topic" || category === "artifact" || category === "correction")
    ? "academic"
    : category;

  return [{
    key,
    text: statement,
    category: layer2Category,
  }];
}

function coerceRoutedMemoryEntries(params: {
  entries: Array<MemoryEntry | MemoryDirectiveEntry>;
  sourceType: MemoryEntrySourceType;
}): RoutedMemoryEntry[] {
  const routed: RoutedMemoryEntry[] = [];

  for (const rawEntry of params.entries) {
    const key = canonicalMemoryKey(rawEntry.key);
    const text = normalizeMemoryLine("value" in rawEntry ? rawEntry.value : rawEntry.text);
    if (!text || isOneOffMemoryCandidate(text)) continue;

    const category = "category" in rawEntry
      ? rawEntry.category
      : inferMemoryCategory({
          key,
          value: text,
          sourceType: params.sourceType,
        });
    const confidence = Math.max(
      0,
      Math.min(
        1,
        Number("confidence" in rawEntry ? rawEntry.confidence : 0.95),
      ),
    );
    const confirmedByDefault =
      params.sourceType !== "extraction"
      || category === "identity"
      || category === "academic"
      || category === "preference";

    routed.push({
      key,
      text,
      confidence,
      category,
      sourceType: params.sourceType,
      status: confirmedByDefault ? "confirmed" : undefined,
    });
  }

  return routed;
}

export async function routeMemoryWrite(params: {
  actorClerkId: string;
  chatId?: string;
  spendingTier?: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
  entries: Array<MemoryEntry | MemoryDirectiveEntry>;
  sourceType?: MemoryEntrySourceType;
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
}): Promise<{ written: number; promoted: number }> {
  const sourceType = params.sourceType ?? "extraction";
  const routedEntries = coerceRoutedMemoryEntries({
    entries: params.entries,
    sourceType,
  });
  if (routedEntries.length === 0) {
    return { written: 0, promoted: 0 };
  }
  const freeOnlyMode = params.spendingTier === "free_only";
  const allowZeroCostMemoryWrite = sourceType === "user_explicit" || sourceType === "correction";
  if (freeOnlyMode && !allowZeroCostMemoryWrite) {
    return { written: 0, promoted: 0 };
  }

  const payloadEntries: Array<{
    key: string;
    text: string;
    embedding?: number[];
    confidence: number;
    category: MemoryEntryCategory;
    sourceType: MemoryEntrySourceType;
    status?: "pending" | "confirmed";
    relatedArtifacts?: string[];
    negativeTopicLinks?: string[];
  }> = [];

  for (const entry of routedEntries.slice(0, 12)) {
    if (freeOnlyMode) {
      payloadEntries.push({
        key: entry.key,
        text: entry.text,
        confidence: entry.confidence,
        category: entry.category,
        sourceType: entry.sourceType,
        status: entry.status,
        relatedArtifacts: entry.relatedArtifacts,
        negativeTopicLinks: entry.negativeTopicLinks,
      });
      continue;
    }

    try {
      const startedAt = Date.now();
      const embeddingResult = await openRouterEmbeddingRequest(
        `${entry.key}: ${entry.text}`,
        MODEL_CONFIG.embedding,
      );
      await recordOpenRouterUsage({
        actorClerkId: params.actorClerkId,
        chatId: params.chatId,
        model: embeddingResult.model ?? MODEL_CONFIG.embedding,
        usage: embeddingResult.usage,
        skipIfZeroTokens: false,
      }).catch(() => {});
      params.onModelCall?.({
        model: embeddingResult.model ?? MODEL_CONFIG.embedding,
        usage: embeddingResult.usage,
        durationMs: Date.now() - startedAt,
      });
      payloadEntries.push({
        key: entry.key,
        text: entry.text,
        embedding: embeddingResult.embedding,
        confidence: entry.confidence,
        category: entry.category,
        sourceType: entry.sourceType,
        status: entry.status,
        relatedArtifacts: entry.relatedArtifacts,
        negativeTopicLinks: entry.negativeTopicLinks,
      });
    } catch {
      // Skip entries whose embedding request fails.
    }
  }

  if (payloadEntries.length === 0) {
    return { written: 0, promoted: 0 };
  }

  const result = await convexMutation<
    {
      actorClerkId: string;
      sourceChatId?: string;
      entries: typeof payloadEntries;
    },
    { inserted: number; updated: number; promoted: number }
  >("memory:routeMemoryWrite", {
    actorClerkId: params.actorClerkId,
    sourceChatId: params.chatId,
    entries: payloadEntries,
  }).catch(() => ({ inserted: 0, updated: 0, promoted: 0 }));

  return {
    written: (result.inserted ?? 0) + (result.updated ?? 0),
    promoted: result.promoted ?? 0,
  };
}

export async function planMemoryRead(params: {
  actorClerkId: string;
  chatId?: string;
  spendingTier?: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
  message: string;
  includeTopicMemory: boolean;
  personalSoulPreferences?: {
    learningStyle?: string;
    preferredDifficulty?: string;
    interests?: string[];
    weakAreas?: string[];
    preferredModes?: string[];
    communicationStyle?: string;
    customGuidance?: string;
  } | null;
  rawMemoryText?: string;
  existingEmbedding?: {
    embedding: number[];
    model?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
    durationMs?: number;
  };
  onEmbeddingCall?: (call: {
    model: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    };
    durationMs?: number;
  }) => void;
}): Promise<PlannedMemoryProfile> {
  const [globalEntries] = await Promise.all([
    convexQuery<
      { actorClerkId: string },
      Array<{ key: string; text: string; category: "identity" | "academic" | "preference"; confidence: number }>
    >("memory:getGlobalProfileEntries", {
      actorClerkId: params.actorClerkId,
    }).catch(() => []),
  ]);

  const layer2Lines: string[] = [];
  for (const entry of globalEntries.slice(0, 12)) {
    const key = normalizeMemoryLine(entry.key.replace(/_/g, " "));
    const text = normalizeMemoryLine(entry.text);
    if (!text) continue;
    layer2Lines.push(`${toLayer2Label(entry.category)} - ${key}: ${text}`);
  }

  const prefs = params.personalSoulPreferences;
  if (prefs?.learningStyle) layer2Lines.push(`Learning Preferences - style: ${normalizeMemoryLine(prefs.learningStyle)}`);
  if (prefs?.preferredDifficulty) {
    layer2Lines.push(`Learning Preferences - difficulty: ${normalizeMemoryLine(prefs.preferredDifficulty)}`);
  }
  if (prefs?.communicationStyle) {
    layer2Lines.push(`Learning Preferences - communication: ${normalizeMemoryLine(prefs.communicationStyle)}`);
  }
  if (prefs?.interests?.length) {
    layer2Lines.push(`Academic Profile - interests: ${prefs.interests.slice(0, 6).map(normalizeMemoryLine).join(", ")}`);
  }
  if (prefs?.weakAreas?.length) {
    layer2Lines.push(`Academic Profile - weak areas: ${prefs.weakAreas.slice(0, 6).map(normalizeMemoryLine).join(", ")}`);
  }
  if (prefs?.preferredModes?.length) {
    layer2Lines.push(`Learning Preferences - preferred modes: ${prefs.preferredModes.slice(0, 5).join(", ")}`);
  }
  if (prefs?.customGuidance) {
    layer2Lines.push(`Learning Preferences - guidance: ${normalizeMemoryLine(prefs.customGuidance)}`);
  }

  const dedupedLayer2 = dedupeProfileLines(layer2Lines).slice(0, 16);
  const layer2Text = dedupedLayer2.map((line) => `- ${line}`).join("\n");

  let embeddingCall: PlannedMemoryProfile["embeddingCall"];
  let queryEmbedding = params.existingEmbedding?.embedding;
  const allowEmbeddingCall = params.spendingTier !== "free_only";
  if (!queryEmbedding && params.includeTopicMemory && params.message.trim() && allowEmbeddingCall) {
    try {
      const startedAt = Date.now();
      const embeddingResult = await openRouterEmbeddingRequest(
        params.message.slice(0, 3000),
        MODEL_CONFIG.embedding,
      );
      queryEmbedding = embeddingResult.embedding;
      embeddingCall = {
        model: embeddingResult.model ?? MODEL_CONFIG.embedding,
        usage: embeddingResult.usage,
        durationMs: Date.now() - startedAt,
      };
      await recordOpenRouterUsage({
        actorClerkId: params.actorClerkId,
        chatId: params.chatId,
        model: embeddingResult.model ?? MODEL_CONFIG.embedding,
        usage: embeddingResult.usage,
        skipIfZeroTokens: false,
      }).catch(() => {});
      params.onEmbeddingCall?.({
        model: embeddingResult.model ?? MODEL_CONFIG.embedding,
        usage: embeddingResult.usage,
        durationMs: Date.now() - startedAt,
      });
    } catch {
      queryEmbedding = undefined;
    }
  }

  const retrievedTopicEntries = params.includeTopicMemory && queryEmbedding
    ? await convexAction<
      { actorClerkId: string; embedding: number[]; message: string; topK: number; minScore: number },
      Array<{
        key: string;
        text: string;
        category: "topic" | "artifact" | "correction";
        confidence: number;
        score: number;
        sourceChatId?: string;
      }>
    >("memory:retrieveRelevantEntries", {
      actorClerkId: params.actorClerkId,
      embedding: queryEmbedding,
      message: params.message,
      topK: MEMORY_TOPIC_MAX_ENTRIES,
      minScore: MEMORY_TOPIC_SIMILARITY_MIN,
    }).catch(() => [])
    : [];

  const layer3Lines = retrievedTopicEntries
    .slice(0, MEMORY_TOPIC_MAX_ENTRIES)
    .map((entry) => `- ${entry.key.replace(/_/g, " ")}: ${normalizeMemoryLine(entry.text)}`);
  const layer3Text = layer3Lines.join("\n");

  const sections: string[] = [];
  if (layer2Text.trim()) {
    sections.push(`Global profile facts:\n${layer2Text}`);
  }
  if (layer3Text.trim()) {
    sections.push(`Topic memory relevant to this prompt:\n${layer3Text}`);
  }
  if (sections.length === 0 && params.rawMemoryText?.trim()) {
    sections.push(params.rawMemoryText.trim().slice(0, MEMORY_MAX_RAW_CHARS));
  }

  return {
    profileText: sections.join("\n\n").trim(),
    layer2Text,
    layer3Text,
    layer2Count: dedupedLayer2.length,
    layer3Count: retrievedTopicEntries.length,
    retrievedTopicEntries,
    embeddingCall,
  };
}

export function inferCitations(
  response: string,
  retrieved: Array<{
    resourceId?: string;
    filename: string;
    page?: number;
    sourceType: "pack" | "personal";
    score?: number;
  }>,
  searchSources: WebSearchSource[],
  attachmentFallback: Citation[] = [],
): Citation[] {
  const fallback = retrieved.map((source) => ({
    resourceId: source.resourceId,
    filename: source.filename,
    page: source.page,
    sourceType: source.sourceType,
    snippet: (source as { text?: string }).text?.slice(0, 220),
  }));

  const inferred = extractCitationsFromText(response, fallback);
  const merged = [...inferred];
  for (const source of searchSources) {
    merged.push({
      filename: source.title || source.domain || source.url,
      sourceType: "search",
      url: source.url,
      title: source.title,
      domain: source.domain,
      snippet: source.snippet,
    });
  }

  const unique = new Map<string, Citation>();
  for (const item of merged) {
    const key = item.sourceType === "search"
      ? `search:${item.url ?? item.filename}`
      : `${item.sourceType}:${item.resourceId ?? ""}:${item.url ?? ""}:${item.filename}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, item);
      continue;
    }
    if (item.sourceType === "search") {
      const next: Citation = { ...existing };
      if (!next.url && item.url) next.url = item.url;
      if (!next.domain && item.domain) next.domain = item.domain;
      if (!next.snippet && item.snippet) next.snippet = item.snippet;
      const existingTitle = next.title || "";
      const incomingTitle = item.title || "";
      if (incomingTitle && incomingTitle.length > existingTitle.length) {
        next.title = incomingTitle;
        next.filename = incomingTitle;
      }
      unique.set(key, next);
      continue;
    }
    if (typeof existing.page !== "number" && typeof item.page === "number") {
      unique.set(key, { ...existing, page: item.page });
    }
  }

  if (unique.size === 0 && attachmentFallback.length > 0) {
    for (const attachment of attachmentFallback) {
      const key = `${attachment.sourceType}:${attachment.resourceId ?? ""}:${attachment.url ?? ""}:${attachment.filename}`;
      if (!unique.has(key)) {
        unique.set(key, attachment);
      }
    }
  }

  return [...unique.values()].slice(0, 8);
}

function normalizeCitationToken(value: string) {
  return value
    .toLowerCase()
    .replace(/§\s*\d+(\.\d+)*/g, " ")
    .replace(/\.[a-z0-9]{2,5}$/i, " ")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove citation markers [N] that do not correspond to any citation in the
 * provided array. Numeric markers whose index (1-based) is out of range are
 * stripped entirely, preventing orphan footnote references in the UI.
 */
export function stripOrphanCitations(text: string, citations: Citation[]): string {
  if (!text) return text;
  if (citations.length === 0) {
    return text.replace(/\[(\d+)\]/g, "");
  }
  const validNums = new Set(citations.map((_, i) => i + 1));
  return text.replace(/\[(\d+)\]/g, (match, numStr) => {
    const num = parseInt(numStr, 10);
    return validNums.has(num) ? match : "";
  });
}

export function rewriteCitationMarkers(response: string, citations: Citation[]) {
  if (!response) return response;

  const rewritten = response
    .replace(/\[([^\]\n]{1,90})\](?!\()/g, (match, rawToken) => {
      const token = String(rawToken ?? "").trim();
      if (!token) return match;
      if (/^\d+(?:\s*,\s*\d+)*$/.test(token)) return "";

      const normalizedToken = normalizeCitationToken(token);
      if (!normalizedToken) return match;

      const matchedCitation = citations.some((citation) => {
        const filename = normalizeCitationToken(citation.filename);
        const title = normalizeCitationToken(citation.title ?? "");
        const domain = normalizeCitationToken(citation.domain ?? "");
        return filename.includes(normalizedToken) || title.includes(normalizedToken) || domain.includes(normalizedToken);
      });

      if (matchedCitation || token.includes("§")) {
        return "";
      }
      return match;
    })
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return rewritten;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function tokenizeWords(value: string) {
  return compactText(value)
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 1 || /\d/.test(word));
}

function looksCodeHeavy(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const codeMarkers = (trimmed.match(/[{}()[\];=<>`]/g) ?? []).length;
  const lines = trimmed.split("\n");
  const fenced = /```/.test(trimmed);
  return fenced || codeMarkers >= 8 || lines.filter((line) => /\b(const|let|function|class|import|return)\b/.test(line)).length >= 2;
}

function heuristicTitle(source: string) {
  if (!source.trim()) return "General Study Session";
  if (looksCodeHeavy(source)) return "Code Debugging Session";

  const words = tokenizeWords(source);
  if (words.length >= TITLE_MIN_WORDS) {
    return words.slice(0, TITLE_MAX_WORDS).join(" ");
  }
  if (words.length === 1) {
    return `${words[0]} session`;
  }
  return "General Study";
}

function normalizeTitle(candidate: string, fallbackSource: string) {
  const cleaned = compactText(
    candidate
      .replace(/^title\s*:\s*/i, "")
      .replace(/[\n\r]+/g, " ")
      .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "")
      .replace(/["'`*#_]/g, ""),
  );

  const words = tokenizeWords(cleaned).slice(0, TITLE_MAX_WORDS);
  const fallbackWords = tokenizeWords(fallbackSource);
  while (words.length < TITLE_MIN_WORDS && fallbackWords.length > 0) {
    const next = fallbackWords.shift();
    if (next) words.push(next);
  }
  while (words.length < TITLE_MIN_WORDS) {
    words.push(["study", "chat", "topic"][words.length % 3]);
  }

  const title = words.slice(0, TITLE_MAX_WORDS).join(" ").slice(0, 80);
  return title || heuristicTitle(fallbackSource);
}

async function generateTitleFromSnippet(
  source: string,
  fallbackSource: string,
  actorClerkId: string,
  options?: {
    chatId?: string;
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
  },
) {
  const utility = await resolveRoleModelBundle({
    actorClerkId,
    role: "utilityFree",
    fallbackModel: MODEL_CONFIG.utilityFree,
    maxFallbacks: 3,
  }).catch(() => ({
    model: MODEL_CONFIG.utilityFree,
    fallbackModels: [MODEL_CONFIG.marker, MODEL_CONFIG.gptOss],
  }));
  const buildRequest = (model: string, fallbackModels: string[]) =>
    openRouterChatCompletion({
      model,
      fallbackModels,
      messages: [
        {
          role: "system",
          content:
            "Generate a conversation title in 2 to 6 words. Keep the same language as the user when possible. Return plain title text only with no quotes.",
        },
        {
          role: "user",
          content: source.slice(0, 700),
        },
      ],
      temperature: 0.1,
      maxTokens: 24,
    });

  const runAttempt = async (attempt: { model: string; fallbackModels: string[] }) => {
    const startedAt = Date.now();
    const completionPromise = buildRequest(attempt.model, attempt.fallbackModels);
    let usageRecorded = false;
    const recordUsage = async (completion: Awaited<typeof completionPromise>) => {
      if (usageRecorded) return;
      usageRecorded = true;
      const model = completion.model ?? attempt.model;
      const usage = completion.usage;
      const durationMs = Date.now() - startedAt;
      await recordOpenRouterUsage({
        actorClerkId,
        chatId: options?.chatId,
        model,
        usage,
      }).catch(() => {});
      options?.onModelCall?.({
        model,
        usage,
        durationMs,
      });
    };
    void completionPromise.then((completion) => {
      void recordUsage(completion);
    }).catch(() => {});

    const completion = await withTimeout(completionPromise, 4500);
    if (completion) {
      await recordUsage(completion);
    }
    return completion;
  };

  const primaryAttempt = await runAttempt({
    model: utility.model,
    fallbackModels: utility.fallbackModels,
  });
  const primaryRaw = primaryAttempt?.choices?.[0]?.message?.content?.trim() ?? "";
  if (primaryRaw) {
    return normalizeTitle(primaryRaw, fallbackSource);
  }

  const retryModel = utility.fallbackModels[0];
  if (retryModel) {
    const retryFallbacks = utility.fallbackModels.filter((candidate) => candidate !== retryModel);
    const retryAttempt = await runAttempt({
      model: retryModel,
      fallbackModels: retryFallbacks,
    });
    const retryRaw = retryAttempt?.choices?.[0]?.message?.content?.trim() ?? "";
    if (retryRaw) {
      return normalizeTitle(retryRaw, fallbackSource);
    }
  }

  return normalizeTitle("", fallbackSource);
}

export async function maybeGenerateTitle(params: {
  chatId: string;
  actorClerkId: string;
  userMessage: string;
  assistantMessage: string;
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
}): Promise<string | undefined> {
  try {
    const source = `User: ${params.userMessage}\nAssistant: ${params.assistantMessage.slice(0, 260)}`;
    const fallbackSource = compactText(`${params.userMessage} ${params.assistantMessage.slice(0, 180)}`);
    const title = await generateTitleFromSnippet(
      source,
      fallbackSource || params.userMessage,
      params.actorClerkId,
      {
        chatId: params.chatId,
        onModelCall: params.onModelCall,
      },
    );

    await convexMutation("chats:setChatTitle", {
      actorClerkId: params.actorClerkId,
      chatId: params.chatId,
      title,
    });
    return title;
  } catch {
    return undefined;
  }
}

export async function maybeGenerateTitleFromUserPrompt(params: {
  chatId: string;
  actorClerkId: string;
  userMessage: string;
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
}): Promise<string | undefined> {
  try {
    const fallbackSource = compactText(params.userMessage);
    const title = await generateTitleFromSnippet(
      params.userMessage,
      fallbackSource || heuristicTitle(params.userMessage),
      params.actorClerkId,
      {
        chatId: params.chatId,
        onModelCall: params.onModelCall,
      },
    );

    await convexMutation("chats:setChatTitle", {
      actorClerkId: params.actorClerkId,
      chatId: params.chatId,
      title,
    });
    return title;
  } catch {
    return undefined;
  }
}

export async function maybeExtractMemory(params: {
  actorClerkId: string;
  chatId?: string;
  existingEntries: MemoryEntry[];
  userMessage: string;
  assistantResponse: string;
  persistMemory?: boolean;
  onLearningContextExtracted?: (context: LearningContext) => void;
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
}): Promise<MemoryEntry[]> {
  const snippet = `User: ${params.userMessage.slice(0, 500)}\nAssistant: ${params.assistantResponse.slice(0, 500)}`;
  const utility = await selectUtilityModel({
    actorClerkId: params.actorClerkId,
    preferredCapabilities: ["reasoning"],
    preferFast: true,
    preferCheap: true,
    preferFree: false,
  });

  const startedAt = Date.now();
  const completionPromise = openRouterChatCompletion({
    model: utility.model,
    fallbackModels: utility.fallbackModels,
    messages: [
      {
        role: "system",
        content:
          "Extract durable student facts and lesson continuity context. Return JSON only in this shape: {\"memory\":[{\"key\":\"...\",\"value\":\"...\",\"confidence\":0.0}],\"learningContext\":{\"topics\":string[],\"keyFacts\":[{\"fact\":\"...\",\"source\":\"model|search|rag|user\",\"confidence\":0.0}],\"misconceptions\":string[],\"quizableFacts\":string[],\"flashcardCandidates\":[{\"front\":\"...\",\"back\":\"...\"}],\"difficultyLevel\":1-5,\"uncertaintyGaps\":string[],\"nextSteps\":string[]}}. For memory: include only durable student facts useful across future tutoring.",
      },
      {
        role: "user",
        content: snippet,
      },
    ],
    temperature: 0,
  });
  let usageRecorded = false;
  const recordUsage = async (completion: Awaited<typeof completionPromise>) => {
    if (usageRecorded) return;
    usageRecorded = true;
    const model = completion.model ?? utility.model;
    const usage = completion.usage;
    const durationMs = Date.now() - startedAt;
    await recordOpenRouterUsage({
      actorClerkId: params.actorClerkId,
      chatId: params.chatId,
      model,
      usage,
    }).catch(() => {});
    params.onModelCall?.({
      model,
      usage,
      durationMs,
    });
  };
  void completionPromise.then((completion) => {
    void recordUsage(completion);
  }).catch(() => {});

  const completion = await withTimeout(
    completionPromise,
    5000,
  );

  const now = Date.now();
  const extracted: MemoryEntry[] = [];

  const heuristics = (() => {
    const text = params.userMessage.replace(/\s+/g, " ").trim();
    if (!text) return [] as MemoryEntry[];

    const inferred: MemoryEntry[] = [];
    const seen = new Set<string>();
    const pushInference = (key: string, value: string, confidence: number) => {
      const normalized = normalizeMemoryLine(value).slice(0, 220);
      if (!normalized) return;
      const fingerprint = `${canonicalMemoryKey(key)}:${normalized.toLowerCase()}`;
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);
      inferred.push({
        key,
        value: normalized,
        confidence,
        extractedAt: now,
      });
    };

    const capture = (
      key: string,
      regex: RegExp,
      confidence: number,
      format?: (captured: string) => string,
    ) => {
      const match = text.match(regex);
      const captured = match?.[1]?.trim();
      if (!captured) return;
      pushInference(key, format ? format(captured) : captured, confidence);
    };

    capture("goals", /\b(?:my goal is|i want to|i need to|i am trying to|i'm trying to)\s+([^.!?\n]{4,140})/i, 0.78, (value) => `Goal: ${value}`);
    capture("subject_preferences", /\b(?:favorite subject is|i (?:love|like|enjoy)|interested in)\s+([^.!?\n]{2,100})/i, 0.67);
    capture("struggles", /\b(?:i struggle with|i find|i'm stuck on|i am stuck on|confused about|i get confused by)\s+([^.!?\n]{2,140})/i, 0.76);
    capture("learning_style", /\b(?:i prefer|please|can you)\s+(step by step|simple terms|visual examples?|concise answers?|detailed answers?|short answers?)\b/i, 0.66);
    capture("communication_style", /\b(?:be|keep|use)\s+(concise|brief|detailed|step[- ]by[- ]step|simple)\b/i, 0.64, (value) => `Prefer ${value} explanations`);
    capture("timezone", /\b(?:my timezone is|i am in|i'm in|based in)\s+([a-z0-9_\/:+\- ]{2,40})/i, 0.7, (value) => value.toUpperCase().replace(/\s+/g, " ").trim());
    capture("language", /\b(?:i speak|my language is|please answer in|respond in)\s+([a-z][a-z\s-]{1,30})/i, 0.69, (value) => value.toLowerCase());
    capture("identity", /\b(?:i am|i'm)\s+(a\s+)?(student|teacher|tutor|parent|in grade\s+\d+|in year\s+\d+)\b/i, 0.68, (value) => value.toLowerCase());
    capture("exam_context", /\b(?:preparing for|studying for|taking)\s+([^.!?\n]{3,120}\b(?:exam|gcse|a-level|ib|sat|act|ap)\b[^.!?\n]*)/i, 0.74);
    capture("study_habit", /\b(?:i can study|i usually study|i study)\s+([^.!?\n]{3,120})/i, 0.63);

    if (/\b(update my memory|remember this|remember that|save this|from now on|always|never)\b/i.test(text)) {
      pushInference("memory_updates", text, 0.8);
    }

    return inferred.slice(0, 8);
  })();
  extracted.push(...heuristics);
  let extractedLearningContext: LearningContext | null = null;

  if (completion) {
    await recordUsage(completion);
    const raw = completion.choices?.[0]?.message?.content ?? "[]";
    const jsonMatch = raw.match(/\[[\s\S]*\]/) ?? raw.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as
          | Array<{ key?: string; value?: string; confidence?: number }>
          | {
              key?: string;
              value?: string;
              confidence?: number;
              memory?: Array<{ key?: string; value?: string; confidence?: number }>;
              learningContext?: unknown;
            };
        const entries = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.memory)
            ? parsed.memory
            : [parsed];
        extracted.push(
          ...entries
            .filter((entry) => typeof entry.key === "string" && typeof entry.value === "string")
            .slice(0, 8)
            .map((entry) => ({
              key: String(entry.key),
              value: String(entry.value),
              confidence: Math.max(0, Math.min(1, Number(entry.confidence ?? 0.6))),
              extractedAt: now,
            })),
        );
        if (!Array.isArray(parsed)) {
          extractedLearningContext = coerceLearningContext(parsed.learningContext);
        }
      } catch {
        // Fallback to heuristic extraction only.
      }
    }
  }

  if (!extractedLearningContext) {
    extractedLearningContext = deriveLearningContextFallback({
      userMessage: params.userMessage,
      assistantResponse: params.assistantResponse,
    });
  }
  if (extractedLearningContext) {
    params.onLearningContextExtracted?.(extractedLearningContext);
  }

  if (params.persistMemory === false) {
    return extracted;
  }

  if (extracted.length === 0) return [];

  const merged = mergeMemoryEntries(params.existingEntries, extracted);
  const rawSnippet = trimMemoryText(
    [
      "Recent conversation snippet:",
      snippet,
      "",
      "Merged memory:",
      formatMemory(merged),
    ].join("\n"),
  );
  await convexMutation("memory:upsertUserMemory", {
    actorClerkId: params.actorClerkId,
    entries: merged,
    rawMemoryText: rawSnippet,
  });

  return extracted;
}
