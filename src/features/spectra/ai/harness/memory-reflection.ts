import { MEMORY_CAPS, type MemoryChange, type MemoryHead } from "../../../../../shared/memory-files";
import { callSpectraModel, type ModelRequest } from "./model";

/*
 * Notes keep themselves current. After a run one small call reads the exchange
 * against what is already written and returns the few changes worth keeping,
 * usually none. It happens after the reply has gone out, so nothing waits on it,
 * and a failure costs nothing.
 */

export type ReflectionRequest = {
  prompt: string;
  runtime?: ModelRequest["runtime"];
  reply: string;
  /** Where this happened, for scoping a preference. */
  context?: string;
  head: MemoryHead;
};

export type MemoryReflector = (request: ReflectionRequest, signal: AbortSignal) => Promise<MemoryChange[]>;

const SYSTEM = `You keep the notes Spectra, a study and teaching workspace, has about one user. You read one exchange and decide if the notes should change. Usually they should not.

Reply with JSON only: {"changes": [...]}. Most of the time that is {"changes": []}.

The files:
- about (limit ${MEMORY_CAPS.about} characters): who they are, what they study or teach, their exams and goals, the projects they are in the middle of. Short lines of plain fact.
- preferences (limit ${MEMORY_CAPS.preferences} characters): how they want Spectra to work. Every line starts with where it applies: "Everywhere: ...", "Word documents: ...", "Biology notes: ...".
- topics: a longer note on one matter that will come up again (an application, an exam, a long project). Only its summary is always visible.

Keep something only if it would still matter in a month, and a good assistant would be embarrassed to forget it.
- Keep: who they are, stable facts about their life at school or work, goals and dates, standing likes and dislikes.
- Keep corrections of how Spectra behaved, at the narrowest scope the user meant. A complaint about one document or class is scoped to that document or class. It becomes "Everywhere" only if they said always, or the same complaint is already noted for another context.
- Do not keep: the task itself, things that are already in their work, what you inferred from a single request, anything said in passing, one-off wording choices.
- Never keep passwords, health, money, or anything about other people's private lives unless the user plainly asked you to remember it.
- If what they said replaces a line, change that line. Do not add a second one that disagrees with it.

A change is one of:
{"file": "about" | "preferences", "add": "new line"}
{"file": "about" | "preferences", "find": "exact text", "replace": "new text"}
{"file": "about" | "preferences", "rewrite": "the whole file, shorter"} — only when a file is close to its limit
{"file": "topic", "slug": "short-slug", "title": "Title", "summary": "One line that says when to open it", "add": "new line"}

Write in the user's language. Write notes, not sentences about the conversation.`;

function describe(request: ReflectionRequest) {
  const { head } = request;
  return [
    `Notes now:\n<about chars="${head.about.length}">\n${head.about || "(empty)"}\n</about>\n<preferences chars="${head.preferences.length}">\n${head.preferences || "(empty)"}\n</preferences>`,
    head.topics.length
      ? `Topics:\n${head.topics.map((topic) => `- ${topic.slug}: ${topic.summary}`).join("\n")}`
      : "",
    request.context ? `Where this happened: ${request.context}` : "",
    `The user wrote:\n${request.prompt.slice(0, 3_000)}`,
    `Spectra replied (cut short):\n${request.reply.slice(0, 1_200)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseReflection(raw: string): MemoryChange[] {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return [];
  try {
    const changes = (JSON.parse(match[0]) as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) return [];
    return changes
      .filter((change): change is MemoryChange => {
        const file = (change as MemoryChange | null)?.file;
        return file === "about" || file === "preferences" || file === "topic";
      })
      .slice(0, 4);
  } catch {
    return [];
  }
}

/** Small talk and bare confirmations carry nothing worth a call. */
export function worthReflecting(prompt: string) {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  return words.length >= 4;
}

export const modelMemoryReflector: MemoryReflector = async (request, signal) => {
  const turn = await callSpectraModel({
    runtime: request.runtime,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: describe(request) },
    ],
    reasoning: "none",
    maxTokens: 500,
    signal,
    title: "Spectra memory",
  });
  return parseReflection(turn.text);
};
