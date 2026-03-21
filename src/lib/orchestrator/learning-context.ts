import type { StudyMode } from "@/lib/contracts/studyModes";

export type LearningFactSource = "model" | "search" | "rag" | "user";

export type LearningContextKeyFact = {
  fact: string;
  source: LearningFactSource;
  confidence: number;
};

export type LearningContextFlashcardCandidate = {
  front: string;
  back: string;
};

export type LearningContext = {
  topics: string[];
  keyFacts: LearningContextKeyFact[];
  misconceptions: string[];
  quizableFacts: string[];
  flashcardCandidates: LearningContextFlashcardCandidate[];
  difficultyLevel: number;
  uncertaintyGaps: string[];
  nextSteps: string[];
};

export type ModeSuggestion = {
  mode: StudyMode;
  label: string;
  prompt: string;
};

const MAX_TOPICS = 10;
const MAX_KEY_FACTS = 8;
const MAX_MISCONCEPTIONS = 6;
const MAX_QUIZABLE_FACTS = 8;
const MAX_FLASHCARD_CANDIDATES = 12;
const MAX_UNCERTAINTY_GAPS = 6;
const MAX_NEXT_STEPS = 6;

function cleanLine(value: string, max = 220) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function uniqueStrings(values: string[], max: number) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = cleanLine(value);
    if (!clean) continue;
    const normalized = clean.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

function clampConfidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.65;
  return Math.max(0, Math.min(1, numeric));
}

function clampDifficulty(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 3;
  return Math.max(1, Math.min(5, Math.round(numeric)));
}

function normalizeSource(value: unknown): LearningFactSource {
  if (value === "search" || value === "rag" || value === "user" || value === "model") {
    return value;
  }
  return "model";
}

function normalizeKeyFacts(value: unknown) {
  if (!Array.isArray(value)) return [];
  const byFact = new Map<string, LearningContextKeyFact>();

  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const fact = cleanLine(String((row as { fact?: unknown }).fact ?? ""), 260);
    if (!fact) continue;
    const normalized = fact.toLowerCase();
    const next: LearningContextKeyFact = {
      fact,
      source: normalizeSource((row as { source?: unknown }).source),
      confidence: clampConfidence((row as { confidence?: unknown }).confidence),
    };
    const existing = byFact.get(normalized);
    if (!existing || next.confidence > existing.confidence) {
      byFact.set(normalized, next);
    }
  }

  return [...byFact.values()].slice(0, MAX_KEY_FACTS);
}

function normalizeFlashcardCandidates(value: unknown) {
  if (!Array.isArray(value)) return [];
  const out: LearningContextFlashcardCandidate[] = [];
  const seen = new Set<string>();

  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const front = cleanLine(String((row as { front?: unknown }).front ?? ""), 120);
    const back = cleanLine(String((row as { back?: unknown }).back ?? ""), 220);
    if (!front || !back) continue;
    const key = `${front.toLowerCase()}::${back.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ front, back });
    if (out.length >= MAX_FLASHCARD_CANDIDATES) break;
  }

  return out;
}

export function coerceLearningContext(value: unknown): LearningContext | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    topics?: unknown;
    keyFacts?: unknown;
    misconceptions?: unknown;
    quizableFacts?: unknown;
    flashcardCandidates?: unknown;
    difficultyLevel?: unknown;
    uncertaintyGaps?: unknown;
    nextSteps?: unknown;
  };

  const keyFacts = normalizeKeyFacts(row.keyFacts);
  const quizableFacts = uniqueStrings(
    [
      ...(Array.isArray(row.quizableFacts) ? row.quizableFacts.map((item) => String(item ?? "")) : []),
      ...keyFacts.map((fact) => fact.fact),
    ],
    MAX_QUIZABLE_FACTS,
  );

  const flashcardCandidates = normalizeFlashcardCandidates(row.flashcardCandidates);

  return {
    topics: uniqueStrings(Array.isArray(row.topics) ? row.topics.map((item) => String(item ?? "")) : [], MAX_TOPICS),
    keyFacts,
    misconceptions: uniqueStrings(
      Array.isArray(row.misconceptions) ? row.misconceptions.map((item) => String(item ?? "")) : [],
      MAX_MISCONCEPTIONS,
    ),
    quizableFacts,
    flashcardCandidates,
    difficultyLevel: clampDifficulty(row.difficultyLevel),
    uncertaintyGaps: uniqueStrings(
      Array.isArray(row.uncertaintyGaps) ? row.uncertaintyGaps.map((item) => String(item ?? "")) : [],
      MAX_UNCERTAINTY_GAPS,
    ),
    nextSteps: uniqueStrings(
      Array.isArray(row.nextSteps) ? row.nextSteps.map((item) => String(item ?? "")) : [],
      MAX_NEXT_STEPS,
    ),
  };
}

export function parseLearningContext(value: unknown): LearningContext | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return coerceLearningContext(parsed);
    } catch {
      return null;
    }
  }
  return coerceLearningContext(value);
}

export function mergeLearningContexts(base: LearningContext | null, incoming: LearningContext | null): LearningContext | null {
  if (!base && !incoming) return null;
  if (!base) return incoming;
  if (!incoming) return base;

  const keyFacts = normalizeKeyFacts([
    ...base.keyFacts,
    ...incoming.keyFacts,
  ]);

  const flashcardCandidates = normalizeFlashcardCandidates([
    ...base.flashcardCandidates,
    ...incoming.flashcardCandidates,
  ]);

  const difficultyLevel = clampDifficulty(
    Math.round((base.difficultyLevel + incoming.difficultyLevel) / 2),
  );

  return {
    topics: uniqueStrings([...base.topics, ...incoming.topics], MAX_TOPICS),
    keyFacts,
    misconceptions: uniqueStrings([...base.misconceptions, ...incoming.misconceptions], MAX_MISCONCEPTIONS),
    quizableFacts: uniqueStrings(
      [...base.quizableFacts, ...incoming.quizableFacts, ...keyFacts.map((item) => item.fact)],
      MAX_QUIZABLE_FACTS,
    ),
    flashcardCandidates,
    difficultyLevel,
    uncertaintyGaps: uniqueStrings([...base.uncertaintyGaps, ...incoming.uncertaintyGaps], MAX_UNCERTAINTY_GAPS),
    nextSteps: uniqueStrings([...base.nextSteps, ...incoming.nextSteps], MAX_NEXT_STEPS),
  };
}

export function serializeLearningContext(value: LearningContext | null) {
  if (!value) return undefined;
  return JSON.stringify(value);
}

export function formatLearningContextForPrompt(value: LearningContext | null) {
  if (!value) return "";

  const sections: string[] = [];
  if (value.topics.length > 0) {
    sections.push(`Topics: ${value.topics.join(", ")}`);
  }
  if (value.keyFacts.length > 0) {
    sections.push(`Key facts:\n${value.keyFacts.slice(0, 5).map((fact) => `- ${fact.fact} (source: ${fact.source}, confidence: ${fact.confidence.toFixed(2)})`).join("\n")}`);
  }
  if (value.quizableFacts.length > 0) {
    sections.push(`Quiz-target facts:\n${value.quizableFacts.slice(0, 6).map((fact) => `- ${fact}`).join("\n")}`);
  }
  if (value.flashcardCandidates.length > 0) {
    sections.push(
      `Flashcard candidates:\n${value.flashcardCandidates.slice(0, 6).map((pair) => `- FRONT: ${pair.front} | BACK: ${pair.back}`).join("\n")}`,
    );
  }
  if (value.misconceptions.length > 0) {
    sections.push(`Known misconceptions:\n${value.misconceptions.slice(0, 5).map((entry) => `- ${entry}`).join("\n")}`);
  }
  if (value.uncertaintyGaps.length > 0) {
    sections.push(`Uncertainty gaps:\n${value.uncertaintyGaps.slice(0, 5).map((entry) => `- ${entry}`).join("\n")}`);
  }
  if (value.nextSteps.length > 0) {
    sections.push(`Suggested next steps:\n${value.nextSteps.slice(0, 4).map((entry) => `- ${entry}`).join("\n")}`);
  }
  sections.push(`Difficulty level (1-5): ${clampDifficulty(value.difficultyLevel)}`);

  return sections.join("\n\n").trim();
}

function isSubstantiveTutorResponse(response: string) {
  return cleanLine(response, 8000).length >= 260;
}

export function isFlashcardAppendIntent(message: string) {
  return /\b(add|append|more|extra|another|new)\b[\s\S]{0,40}\b(card|cards|flashcard|flashcards|deck)\b/i.test(message)
    || /\bcontinue\b[\s\S]{0,20}\b(deck|flashcards?)\b/i.test(message);
}

export function buildModeSuggestions(params: {
  mode: StudyMode;
  response: string;
  learningContext: LearningContext | null;
}): ModeSuggestion[] {
  if (!params.learningContext) return [];
  if (!(params.mode === "tutor" || params.mode === "explain")) return [];
  if (!isSubstantiveTutorResponse(params.response)) return [];

  const context = params.learningContext;
  const eligible = context.quizableFacts.length >= 5 || context.flashcardCandidates.length >= 5;
  if (!eligible) return [];

  const quizSeed = context.quizableFacts.slice(0, 5).map((fact) => `"${fact}"`).join(", ");
  const flashSeed = context.flashcardCandidates.slice(0, 5).map((pair) => `"${pair.front}"`).join(", ");
  const researchSeed = context.uncertaintyGaps.slice(0, 3).join("; ")
    || context.topics.slice(0, 2).join(" and ")
    || context.keyFacts.slice(0, 2).map((fact) => fact.fact).join("; ");

  return [
    {
      mode: "quiz",
      label: "Quiz yourself",
      prompt: quizSeed
        ? `Quiz me on these key facts: ${quizSeed}. Include concise explanations for each answer.`
        : "Quiz me on the key ideas from what you just explained.",
    },
    {
      mode: "flashcard",
      label: "Make flashcards",
      prompt: flashSeed
        ? `Create a flashcard deck from these concepts: ${flashSeed}. Keep cards concise and non-duplicative.`
        : "Create flashcards from the key concepts you just explained.",
    },
    {
      mode: "research",
      label: "Research deeper",
      prompt: researchSeed
        ? `Research this topic deeper, focusing especially on: ${researchSeed}. Provide evidence-backed sources.`
        : "Research this topic in more depth and include evidence-backed sources.",
    },
  ];
}

export function buildModeTransformGuidance(params: {
  mode: StudyMode;
  message: string;
  learningContext: LearningContext | null;
  existingFlashcardFronts?: string[];
}): string {
  const context = params.learningContext;
  if (!context) return "";

  const lines: string[] = [];

  if ((params.mode === "quiz" || params.mode === "exam") && context.quizableFacts.length > 0) {
    lines.push("Quiz transform guidance:");
    lines.push("- Target these specific facts from prior learning context.");
    for (const fact of context.quizableFacts.slice(0, 6)) {
      lines.push(`  - ${fact}`);
    }
    lines.push(`- Calibrate difficulty around level ${context.difficultyLevel} (1=easy, 5=hard).`);
  }

  if (params.mode === "flashcard") {
    const appendIntent = isFlashcardAppendIntent(params.message);
    const existingFronts = uniqueStrings(params.existingFlashcardFronts ?? [], 18);

    lines.push("Flashcard transform guidance:");
    if (appendIntent) {
      lines.push("- This is an ADD-MORE request. Generate only NEW cards and avoid duplicates.");
      if (existingFronts.length > 0) {
        lines.push("- Existing card fronts to avoid:");
        for (const front of existingFronts.slice(0, 12)) {
          lines.push(`  - ${front}`);
        }
      }
    }

    if (context.flashcardCandidates.length > 0) {
      lines.push("- Prioritize these candidate cards:");
      for (const pair of context.flashcardCandidates.slice(0, 8)) {
        lines.push(`  - FRONT: ${pair.front} | BACK: ${pair.back}`);
      }
    }
  }

  if (params.mode === "research" && context.uncertaintyGaps.length > 0) {
    lines.push("Research transform guidance:");
    lines.push("- Use these uncertainty gaps as priority research angles:");
    for (const gap of context.uncertaintyGaps.slice(0, 5)) {
      lines.push(`  - ${gap}`);
    }
  }

  if (params.mode === "explain" && context.misconceptions.length > 0) {
    lines.push("Explain transform guidance:");
    lines.push("- Address these misconceptions explicitly:");
    for (const misconception of context.misconceptions.slice(0, 5)) {
      lines.push(`  - ${misconception}`);
    }
  }

  return lines.join("\n").trim();
}

export function deriveLearningContextFallback(params: {
  userMessage: string;
  assistantResponse: string;
}): LearningContext | null {
  const message = cleanLine(params.userMessage, 800);
  const response = params.assistantResponse.replace(/\s+/g, " ").trim();
  if (!message && !response) return null;

  const sentenceCandidates = response
    .split(/(?<=[.!?])\s+/)
    .map((line) => cleanLine(line, 240))
    .filter((line) => line.length >= 24)
    .filter((line) => !/^sources?:/i.test(line))
    .filter((line) => !/^https?:\/\//i.test(line));

  const keyFacts = uniqueStrings(sentenceCandidates.slice(0, 5), 5).map((fact) => ({
    fact,
    source: "model" as const,
    confidence: 0.55,
  }));

  const topicHints = uniqueStrings(
    [
      message,
      ...keyFacts.map((fact) => fact.fact),
    ].flatMap((line) => line.split(/[,;:-]/).map((part) => part.trim())),
    4,
  );

  const quizableFacts = uniqueStrings(keyFacts.map((fact) => fact.fact), 5);
  const flashcardCandidates = quizableFacts.slice(0, 5).map((fact) => ({
    front: fact.length > 90 ? `${fact.slice(0, 87)}...` : fact,
    back: "Explain this concept in one concise sentence.",
  }));

  const context: LearningContext = {
    topics: topicHints,
    keyFacts,
    misconceptions: [],
    quizableFacts,
    flashcardCandidates,
    difficultyLevel: 3,
    uncertaintyGaps: [],
    nextSteps: [],
  };

  return context.keyFacts.length > 0 ? context : null;
}
