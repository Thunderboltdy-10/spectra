import type { ChatMessage, Citation } from "@/types";
import { enforceCitationFallback } from "@/lib/prompts/policy";

export function toOpenRouterMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export function extractCitationsFromText(text: string, fallback: Citation[]): Citation[] {
  const lines = text.split("\n");
  const refs: Citation[] = [];

  for (const line of lines) {
    const match = line.match(/\[([^\]]+)\]/g);
    if (!match) continue;
    for (const token of match) {
      if (token.toLowerCase().includes("general knowledge")) {
        refs.push({ filename: "general knowledge", sourceType: "general" });
      }
    }
  }

  return enforceCitationFallback(refs.length > 0 ? refs : fallback);
}

export function summarizeWhyResponse(mode: string, routeReason: string) {
  const normalizedMode = mode.replace(/_/g, " ");
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
