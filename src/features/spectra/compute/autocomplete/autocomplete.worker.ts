/// <reference lib="webworker" />

import type { AutocompleteContext } from "./autocomplete";

declare const self: DedicatedWorkerGlobalScope;

const PHRASE_ENDINGS: Record<string, string> = {
  "i think": " the clearest approach is to start with the evidence",
  "we should": " verify the current state before making the change",
  "the evidence": " suggests a more precise conclusion",
  "in this section": ", explain the decision and its supporting evidence",
  "next": ", connect this result to the wider objective",
};

self.onmessage = (event: MessageEvent<AutocompleteContext & { tier: 1 | 2 }>) => {
  const before = event.data.value.slice(0, event.data.cursor).trimEnd().toLowerCase();
  const ending = Object.entries(PHRASE_ENDINGS).find(([prefix]) => before.endsWith(prefix));
  const terms = [...(event.data.workspaceTerms ?? []), ...(event.data.recentPhrases ?? [])]
    .map((value) => value.trim())
    .filter((value) => value.length > 3 && value.length < 100);
  const token = before.match(/[\p{L}\p{N}'’-]{3,}$/u)?.[0] ?? "";
  const matchingTerm = token
    ? terms.find((term) => term.toLowerCase().startsWith(token) && term.toLowerCase() !== token)
    : undefined;
  const common: Array<[string, string]> = [
    ["in order to", " clarify the expected outcome"],
    ["for example", ", the strongest evidence should be cited directly"],
    ["the next step is", " to verify the result and record any limitation"],
    ["this means", " the final decision remains easy to understand"],
    ["because", " the available evidence supports that conclusion"],
  ];
  const deterministic = common.find(([prefix]) => before.endsWith(prefix))?.[1] ?? (matchingTerm ? matchingTerm.slice(token.length) : null);
  self.postMessage({ suggestion: deterministic ?? (event.data.tier === 2 ? ending?.[1] ?? null : null) });
};

export {};
