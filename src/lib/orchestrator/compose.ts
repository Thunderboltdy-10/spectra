import type { OpenRouterMessageContentPart } from "@/lib/openrouter";
import type { ChatMessage, Citation } from "@/types";

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

export function toOpenRouterMessages(
  messages: ChatMessage[],
  imageBlocks?: Array<{ type: "image_url"; image_url: { url: string; detail?: "low" | "auto" } }>,
) {
  return messages.map((message, index) => {
    const isLastUser = message.role === "user" && index === messages.length - 1;

    if (isLastUser && imageBlocks && imageBlocks.length > 0) {
      const content: OpenRouterMessageContentPart[] = [
        { type: "text", text: message.content },
        ...imageBlocks,
      ];
      return {
        role: message.role,
        content,
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}

export function extractCitationsFromText(text: string, fallback: Citation[]): Citation[] {
  const refs: Citation[] = [];

  const numericRefs = Array.from(text.matchAll(/\[(\d{1,2})\]/g));
  for (const match of numericRefs) {
    const index = Number(match[1]) - 1;
    if (Number.isNaN(index) || index < 0) continue;
    const citation = fallback[index];
    if (citation) refs.push(citation);
  }

  const verboseRefs = Array.from(text.matchAll(/\[([^\]\n]+?)\s+p\.\s*(\d+)\]/gi));
  for (const match of verboseRefs) {
    const filename = normalizeCitationToken((match[1] ?? "").trim().toLowerCase());
    const page = Number(match[2]);
    if (!filename) continue;

    const citation = fallback.find(
      (item) =>
        normalizeCitationToken(item.filename).includes(filename) &&
        (item.page === page || typeof item.page !== "number"),
    );

    if (citation) {
      refs.push({
        ...citation,
        page: citation.page ?? page,
      });
    }
  }

  const nameRefs = Array.from(text.matchAll(/\[([^\]\n]{3,80})\]/g));
  for (const match of nameRefs) {
    const token = (match[1] ?? "").trim();
    if (!token) continue;
    if (/^\d+$/.test(token)) continue;
    const normalizedToken = normalizeCitationToken(token);

    const citation = fallback.find((item) =>
      normalizeCitationToken(item.filename).includes(normalizedToken),
    );

    if (citation) refs.push(citation);
  }

  const urls = Array.from(new Set(text.match(/https?:\/\/[^\s)\]]+/g) ?? []));
  for (const url of urls) {
    refs.push({
      filename: url.replace(/^https?:\/\//, "").split("/")[0] ?? "web",
      sourceType: "search",
      url,
    });
  }

  const deduped = new Map<string, Citation>();
  for (const item of refs) {
    const key = `${item.sourceType}:${item.resourceId ?? ""}:${item.url ?? ""}:${item.filename}:${item.page ?? ""}`;
    if (!deduped.has(key)) deduped.set(key, item);
  }

  return [...deduped.values()].slice(0, 8);
}

export function summarizeWhyResponse(mode: string, routeReason: string) {
  const normalizedMode = mode.replace(/_/g, " ");
  if (/manual model lock|manual selection/i.test(routeReason)) {
    return "Model was fixed by your manual selection. The system still adapted tools and response behavior around that locked model.";
  }
  if (/search/i.test(routeReason)) {
    return "Used a web-aware route because the prompt looks time-sensitive and benefits from live source retrieval.";
  }
  if (/cheap_only|free_only|tier/i.test(routeReason)) {
    return "Adjusted model choice to stay within active usage constraints while preserving answer quality.";
  }
  if (/marker/i.test(normalizedMode)) {
    return "Selected a stricter grading route to maximize rubric alignment and verification reliability.";
  }
  if (/research/i.test(normalizedMode)) {
    return "Selected a deeper reasoning model for synthesis, evidence comparison, and higher-context analysis.";
  }
  if (/tutor|learn/i.test(normalizedMode)) {
    return "Selected a teaching-focused model to balance clarity, reasoning depth, and stepwise guidance.";
  }
  return `Routed by mode, complexity, and capability fit: ${routeReason}.`;
}
