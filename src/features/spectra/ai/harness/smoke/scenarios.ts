import { authorNew, authoredShape, isAuthoredType, readAuthored } from "../authoring";
import type { InputAnswer, HarnessMessage } from "../types";
import type { MemoryBackend, MemoryBackendOptions } from "../memory-backend";
import type { HarnessEvent, HarnessRunResult } from "../run";

/*
 * Smoke scenarios for the real loop against the real model. Each one sets up
 * an in-memory Spectra, sends one message (and answers once if the run
 * pauses), then checks the outcome. Add a scenario by appending to the list.
 */

export type SmokeContext = {
  backend: MemoryBackend;
  result: HarnessRunResult;
  events: HarnessEvent[];
  /** Results of earlier passes when the scenario answered a pause. */
  passes: HarnessRunResult[];
};

export type SmokeScenario = {
  name: string;
  prompt: string;
  backend?: MemoryBackendOptions;
  history?: HarnessMessage[];
  /** Id of a seeded artifact to put in focus. */
  focus?: string;
  /** Force a small context window so compaction runs. */
  contextWindow?: number;
  /** The answer to give when the run pauses (once). */
  answer?: (pending: NonNullable<Extract<HarnessRunResult, { status: "paused" }>["pending"]>) => InputAnswer;
  expectPause?: "question" | "approval";
  /** Returns problems; empty means pass. */
  check: (context: SmokeContext) => string[];
};

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

function created(context: SmokeContext, type: string) {
  return [...context.backend.artifacts.values()].filter((artifact) => artifact.createdBy === "ai" && artifact.type === type);
}

function count(type: string, content: unknown) {
  if (!isAuthoredType(type)) return 0;
  const match = /(\d+)/.exec(authoredShape(type, content));
  return match ? Number(match[1]) : 0;
}

function placeholderProblems(type: string, content: unknown) {
  if (!isAuthoredType(type)) return [];
  const text = readAuthored(type, content);
  return /lorem ipsum|\bTBD\b|\[insert|placeholder/i.test(text) ? ["the content has placeholder text"] : [];
}

function oneCreated(context: SmokeContext, type: string, expected?: number) {
  const made = created(context, type);
  const problems: string[] = [];
  if (made.length !== 1) problems.push(`expected one ${type}, found ${made.length}`);
  const artifact = made[0];
  if (artifact) {
    if (expected !== undefined && count(type, artifact.content) !== expected)
      problems.push(`expected ${expected}, found "${authoredShape(type as never, artifact.content)}"`);
    problems.push(...placeholderProblems(type, artifact.content));
  }
  if (context.result.state.artifacts.filter((touch) => touch.action === "created").length !== made.length)
    problems.push("artifact cards do not match what was created");
  return problems;
}

function completed(context: SmokeContext) {
  return context.result.status === "completed" ? [] : [`run ended ${context.result.status}`];
}

function replyMentions(context: SmokeContext, pattern: RegExp) {
  return pattern.test(context.result.state.text) ? [] : [`reply does not match ${pattern}`];
}

const MITOSIS_NOTES = authorNew(
  "document",
  {
    markdown:
      "# Mitosys\n\nMitosis is how one cell divides into two identical cells.\n\n## Phases\n\n- Prophase\n- Metaphase\n- Anaphase\n- Telophase\n\n## Why it matters\n\nGrowth and repair of tissues depend on it.",
  },
  { timeZone: "Europe/Madrid" },
).content;

export const SMOKE_SCENARIOS: SmokeScenario[] = [
  {
    name: "hello",
    prompt: "hello",
    check: (context) => [
      ...completed(context),
      ...(context.result.state.text.trim() ? [] : ["empty reply"]),
      ...(context.backend.artifacts.size ? ["created something"] : []),
      ...(words(context.result.state.text) > 60 ? ["reply is long for a greeting"] : []),
    ],
  },
  {
    name: "factual question",
    prompt: "Why does ice float on water?",
    check: (context) => [
      ...completed(context),
      ...replyMentions(context, /dens/i),
      ...(context.backend.artifacts.size ? ["created an artifact for a question"] : []),
    ],
  },
  {
    name: "create a document",
    prompt: "Write me a one-page study guide on the causes of the First World War.",
    check: (context) => {
      const problems = [...completed(context), ...oneCreated(context, "document")];
      const doc = created(context, "document")[0];
      if (doc && count("document", doc.content) < 200) problems.push("the guide is very short");
      return problems;
    },
  },
  {
    name: "6-slide presentation",
    prompt: "Make a 6-slide presentation on photosynthesis for Year 9.",
    check: (context) => [...completed(context), ...oneCreated(context, "presentation", 6)],
  },
  {
    name: "8-card flashcard deck",
    prompt: "Make me 8 flashcards on French irregular verbs in the passé composé.",
    check: (context) => [...completed(context), ...oneCreated(context, "flashcard_deck", 8)],
  },
  {
    name: "water-cycle whiteboard",
    prompt: "Draw the water cycle on a whiteboard.",
    check: (context) => {
      const problems = [...completed(context), ...oneCreated(context, "whiteboard")];
      const board = created(context, "whiteboard")[0];
      const content = board?.content as { nodes?: unknown[]; edges?: unknown[] } | undefined;
      if (board && (content?.nodes?.length ?? 0) < 4) problems.push("fewer than 4 nodes");
      if (board && (content?.edges?.length ?? 0) < 3) problems.push("fewer than 3 connectors");
      return problems;
    },
  },
  {
    name: "small document edit",
    prompt: "Fix the typo in the title of my notes.",
    backend: { artifacts: [{ id: "wxnotes", type: "document", title: "Mitosis notes", content: MITOSIS_NOTES }] },
    focus: "wxnotes",
    check: (context) => {
      const doc = context.backend.artifacts.get("wxnotes")!;
      const text = readAuthored("document", doc.content);
      const problems = [...completed(context)];
      if (/Mitosys/.test(text)) problems.push("typo still there");
      if (!/# Mitosis/.test(text)) problems.push("title not fixed");
      if (!/Telophase/.test(text) || !/Growth and repair/.test(text)) problems.push("other content changed");
      if (context.backend.artifacts.size !== 1) problems.push("created a new artifact instead of editing");
      if (!context.result.state.artifacts.some((touch) => touch.id === "wxnotes" && touch.action === "edited"))
        problems.push("no edited card");
      return problems;
    },
  },
  {
    name: "settings approval",
    prompt: "Switch Spectra to dark mode.",
    expectPause: "approval",
    answer: () => ({ kind: "approval", allowed: true }),
    check: (context) => {
      const problems = [...completed(context)];
      const first = context.passes[0];
      if (!first || first.status !== "paused" || first.pending.kind !== "approval") problems.push("did not pause for approval");
      else if (/[a-z]+_[a-z]+|wx\d/.test(first.pending.question)) problems.push(`raw words in the question: ${first.pending.question}`);
      if (context.backend.settings.appearance?.theme !== "dark") problems.push("theme not changed after approval");
      return problems;
    },
  },
  {
    name: "ask_user round trip",
    prompt:
      "Before you make anything, ask me whether I want the quiz on cells or on genetics. Then make a 5-question quiz on my choice.",
    expectPause: "question",
    answer: (pending) => {
      const genetics = pending.options?.find((option) => /genetic/i.test(option.label));
      return genetics ? { kind: "question", choiceKey: genetics.key } : { kind: "question", text: "Genetics" };
    },
    check: (context) => {
      const problems = [...completed(context), ...oneCreated(context, "quiz", 5)];
      const first = context.passes[0];
      if (!first || first.status !== "paused" || first.pending.kind !== "question") problems.push("did not ask");
      const quiz = created(context, "quiz")[0];
      if (quiz && !/gene|allele|dna|chromosom|inherit/i.test(readAuthored("quiz", quiz.content))) problems.push("quiz is not on genetics");
      return problems;
    },
  },
  {
    name: "compaction",
    prompt: "What did I say my dog is called, and which essay topic did we settle on?",
    contextWindow: 6_000,
    history: [
      { role: "user", content: "Quick context: my dog is called Biscuit and I am in Year 11." },
      { role: "assistant", content: "Got it, Biscuit it is. What are you working on?" },
      ...Array.from({ length: 8 }, (_, index): HarnessMessage[] => [
        {
          role: "user",
          content: `Draft paragraph ${index + 1} for my history essay. ${"Context about the Treaty of Versailles and its effects on Germany. ".repeat(12)}`,
        },
        {
          role: "assistant",
          content: `Here is paragraph ${index + 1}. ${"The treaty imposed reparations, territorial losses and military limits, which fuelled resentment. ".repeat(14)}`,
        },
      ]).flat(),
      { role: "user", content: "Let's settle the essay topic: the Treaty of Versailles as a cause of WW2." },
      { role: "assistant", content: "Agreed: the essay argues the Treaty of Versailles was a cause of WW2." },
    ],
    check: (context) => [
      ...completed(context),
      ...(context.events.some((event) => event.type === "compacted") ? [] : ["no compaction happened"]),
      ...replyMentions(context, /Biscuit/),
      ...replyMentions(context, /Versailles/i),
    ],
  },
];
