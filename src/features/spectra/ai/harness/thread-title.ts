import { callSpectraModel, type ModelRequest } from "./model";

/*
 * Names a new thread and, when it is unfiled, picks the workspace it clearly
 * belongs to. One small call at the start of the first run, alongside the run:
 * nothing waits for it, and a thread it cannot name stays as it was.
 */

export type ThreadTitleRequest = {
  prompt: string;
  runtime?: ModelRequest["runtime"];
  /** The user's workspaces, offered for an unfiled thread. */
  places?: Array<{ id: string; title: string }>;
  /** The title of the work in focus when the conversation started. */
  focus?: string;
  /** The titles of the user's other conversations, as the rail shows them. */
  others?: string[];
};

export type ThreadTitle = { title: string; placeId?: string };

export type ThreadTitleWriter = (request: ThreadTitleRequest, signal: AbortSignal) => Promise<ThreadTitle | null>;

const SYSTEM = `You name a conversation in Spectra, a study and teaching workspace.

Reply with JSON only: {"thread_title": "...", "thread_place": "..."}.
- thread_title: a 2-6 word name for the conversation, sentence case, no full stop, no quotes, in the user's language. Lead with the subject, not the kind of request. When an artifact is in focus, start from its name. Differ from the listed titles of their other conversations. For a greeting or small talk with no subject yet, omit it, and a later message names the conversation.
- thread_place: only when the user's workspaces are listed. The id of the one workspace (a class or project) the conversation is clearly about. When it is general or could be several, omit it.`;

function describe(request: ThreadTitleRequest) {
  return [
    `The user's first message: ${request.prompt.slice(0, 1_200)}`,
    request.focus ? `In focus: ${request.focus.slice(0, 200)}` : "",
    request.others?.length
      ? `Their other conversations:\n${request.others.slice(0, 12).map((title) => `- ${title.slice(0, 80)}`).join("\n")}`
      : "",
    request.places?.length
      ? `The user's workspaces (titles are the user's words):\n${request.places.map((place) => `- ${place.title} (id ${place.id})`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function clean(text: unknown, max: number) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\bwx[0-9a-z]{6,}\b/gi, "")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim()
    .slice(0, max);
}

export function parseThreadTitle(raw: string): ThreadTitle | null {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return null;
  try {
    const value = JSON.parse(match[0]) as Record<string, unknown>;
    const title = clean(value.thread_title ?? value.title, 80);
    if (!title) return null;
    const placeId = typeof value.thread_place === "string" ? value.thread_place.trim().slice(0, 200) : "";
    return { title, ...(placeId ? { placeId } : {}) };
  } catch {
    return null;
  }
}

/** The production writer: no reasoning, and the smallest model on a subscription. */
export const modelThreadTitleWriter: ThreadTitleWriter = async (request, signal) => {
  const turn = await callSpectraModel({
    runtime: request.runtime,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: describe(request) },
    ],
    reasoning: "none",
    small: true,
    maxTokens: 200,
    signal,
    title: "Spectra thread title",
  });
  return parseThreadTitle(turn.text);
};
