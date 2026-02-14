import { convexMutation } from "@/lib/convex-server";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { extractCitationsFromText } from "@/lib/orchestrator/compose";
import { withTimeout, type MemoryEntry } from "@/lib/orchestrator/history";
import type { Citation } from "@/types";

function formatMemory(entries: MemoryEntry[]) {
  if (entries.length === 0) return "";
  return entries
    .slice(0, 8)
    .map((entry) => `- ${entry.key}: ${entry.value}`)
    .join("\n");
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

export function shouldInjectMemory(message: string) {
  const normalized = message.toLowerCase();
  return /(i\b|my\b|me\b|struggle|goal|preference|prefer|weakness|improve|last time|again|remember)/i.test(
    normalized,
  );
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
  searchUrls: string[],
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
  for (const url of searchUrls) {
    merged.push({
      filename: url.replace(/^https?:\/\//, "").split("/")[0] ?? "web",
      sourceType: "search",
      url,
    });
  }

  const unique = new Map<string, Citation>();
  for (const item of merged) {
    const key = `${item.sourceType}:${item.resourceId ?? ""}:${item.url ?? ""}:${item.filename}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, item);
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

export function rewriteCitationMarkers(response: string, citations: Citation[]) {
  if (!response || citations.length === 0) return response;

  return response.replace(/\[([^\]\n]{3,90})\]/g, (match, rawToken) => {
    const token = String(rawToken ?? "").trim();
    if (!token || /^\d+$/.test(token)) return match;

    const normalizedToken = normalizeCitationToken(token);
    if (!normalizedToken) return match;

    const idx = citations.findIndex((citation) =>
      normalizeCitationToken(citation.filename).includes(normalizedToken),
    );
    if (idx >= 0) {
      return `[${idx + 1}]`;
    }

    if (token.includes("§")) {
      return "";
    }
    return match;
  });
}

export async function maybeGenerateTitle(params: {
  chatId: string;
  actorClerkId: string;
  userMessage: string;
  assistantMessage: string;
}): Promise<string | undefined> {
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
    if (!raw) return undefined;

    const title = raw
      .replace(/[\n\r]+/g, " ")
      .replace(/^['\"`\s]+|['\"`\s]+$/g, "")
      .slice(0, 80);

    if (!title) return undefined;

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
