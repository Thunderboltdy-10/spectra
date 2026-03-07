import type { StudyMode } from "@/types";

export type StarterPrompt = {
  mode: StudyMode;
  prompt: string;
};

type StarterPromptOptions = {
  limit?: number;
  topics?: string[];
};

const TOPIC_FALLBACKS = ["Biology", "Algebra", "World History"];

const MODE_STARTER_PROMPTS: Record<StudyMode, readonly string[]> = {
  auto: [
    "Teach me {topic} step by step and check my understanding.",
    "Quiz me on {topic2} with mixed difficulty.",
    "Create flashcards for {topic3}.",
    "Research recent evidence about {topic}.",
  ],
  tutor: [
    "Explain quantum entanglement simply",
    "Help me understand photosynthesis",
    "Break down the Pythagorean theorem",
    "Teach me {topic} from first principles and use examples.",
    "Build a 20-minute study session for {topic2}.",
  ],
  marker: [
    "Review this paragraph against IB criteria and suggest improvements.",
    "Mark my response with a rubric and explain each deduction.",
    "Give criterion-based feedback on this essay draft.",
  ],
  exam: [
    "Generate a timed exam practice set on {topic}.",
    "Create 4 exam-style questions on {topic2} with markscheme guidance.",
    "Run a 15-minute retrieval drill and grade my answers.",
  ],
  draft_coach: [
    "Coach me through revising this introduction for clarity and structure.",
    "Help me improve argument flow and transitions in this draft.",
    "Rewrite this paragraph with stronger evidence and analysis.",
  ],
  quiz: [
    "Test me on World War 2 causes",
    "Quiz me on cell biology",
    "Create a quiz on French verbs",
    "Give me a quick checkpoint quiz on {topic} with feedback after each answer.",
  ],
  flashcard: [
    "Make flashcards for Spanish vocabulary",
    "Create flashcards on chemistry elements",
    "Flashcards for history dates",
    "Generate high-yield flashcards for {topic} with concise definitions.",
  ],
  research: [
    "Find recent studies on climate change effects",
    "Research the latest developments in AI",
    "What does current evidence say about sleep and memory?",
    "Compare 3 reliable sources about {topic} and summarize consensus.",
  ],
  explain: [
    "Explain how vaccines work",
    "Explain the concept of inflation",
    "Explain recursion",
    "Explain {topic} using an everyday analogy and one worked example.",
  ],
  general: [
    "Help me make a study plan for {topic}.",
    "Summarize this chapter into key points and quick checks.",
    "Teach me this concept like I am preparing for tomorrow's test.",
  ],
  image: [
    "Create a study infographic about {topic}.",
    "Generate a clean diagram of {topic2} with labels.",
    "Make a visual mind map for {topic3}.",
  ],
  document: [
    "Create a presentation about {topic} for a classroom lesson.",
    "Write a study guide on {topic2} with key terms and summaries.",
    "Build a comparison table for {topic3} with pros, cons, and examples.",
  ],
};

function fillTopicPlaceholders(template: string, topics: string[]) {
  const [topic = TOPIC_FALLBACKS[0], topic2 = TOPIC_FALLBACKS[1], topic3 = TOPIC_FALLBACKS[2]] = topics;
  return template
    .replace(/\{topic\}/gi, topic)
    .replace(/\{topic2\}/gi, topic2)
    .replace(/\{topic3\}/gi, topic3);
}

export function getStarterPromptsForMode(
  mode: StudyMode,
  options: StarterPromptOptions = {},
): StarterPrompt[] {
  const limit = options.limit ?? 6;
  const prompts = MODE_STARTER_PROMPTS[mode] ?? MODE_STARTER_PROMPTS.general;
  const topics = options.topics ?? TOPIC_FALLBACKS;
  return prompts.slice(0, limit).map((prompt) => ({
    mode,
    prompt: fillTopicPlaceholders(prompt, topics),
  }));
}

export function getStarterPromptsForModes(
  modes: StudyMode[],
  options: StarterPromptOptions = {},
): StarterPrompt[] {
  const limit = options.limit ?? 6;
  const topics = options.topics ?? TOPIC_FALLBACKS;
  const rows = modes.flatMap((mode) =>
    getStarterPromptsForMode(mode, {
      limit: 2,
      topics,
    }),
  );
  return rows.slice(0, limit);
}
