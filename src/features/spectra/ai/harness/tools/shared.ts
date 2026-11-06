import type { HarnessBackend } from "../backend";
import { ToolInputError, type TodoItem } from "../types";

/** State the tools share within one run. */
export type HarnessSession = {
  backend: HarnessBackend;
  /** The run's original request; the AI content policy reads it. */
  prompt: string;
  /** The workspace new work lands in, when the user is inside one. */
  workspaceId?: string;
  /** Titles seen this run, so labels never show ids. */
  titles: Map<string, { title: string; type: string }>;
  todos: TodoItem[];
  /** The user's agents, when they have any and none is active yet. */
  agents: Array<{ id: string; title: string }>;
  /** Web searches this run has made; each one is a paid provider call. */
  webSearches: number;
  /** The workspaces offered to the model; only these can be filed into. */
  places?: Array<{ id: string }>;
  /** What this run has created, so a repeat never makes a second copy. */
  created: Map<string, string>;
  /** A student, whose own quizzes are for answering rather than for handing out. */
  learner?: boolean;
  /** The agent changed its notes itself, so they need no second look after the run. */
  memoryWritten?: boolean;
};

export function createSession(input: {
  backend: HarnessBackend;
  prompt: string;
  workspaceId?: string;
  known?: Array<{ id: string; title: string; type: string }>;
  agents?: Array<{ id: string; title: string }>;
  places?: Array<{ id: string }>;
  learner?: boolean;
}): HarnessSession {
  return {
    backend: input.backend,
    prompt: input.prompt,
    workspaceId: input.workspaceId,
    titles: new Map((input.known ?? []).map((entry) => [entry.id, { title: entry.title, type: entry.type }])),
    todos: [],
    agents: input.agents ?? [],
    webSearches: 0,
    ...(input.places ? { places: input.places } : {}),
    ...(input.learner ? { learner: true } : {}),
    created: new Map(),
  };
}

export function rememberTitle(session: HarnessSession, id: string, title: string, type: string) {
  if (id && title) session.titles.set(id, { title, type });
}

/** "*Photosynthesis*", or a plain fallback when the title is unknown. */
export function titled(session: HarnessSession, id: unknown, fallback = "an item") {
  const known = typeof id === "string" ? session.titles.get(id) : undefined;
  return known ? `*${known.title}*` : fallback;
}

export function requireString(raw: Record<string, unknown>, key: string, max = 20_000) {
  const value = raw[key];
  if (typeof value !== "string" || !value.trim()) throw new ToolInputError(`${key} is required.`);
  if (value.length > max) throw new ToolInputError(`${key} is longer than ${max} characters.`);
  return value.trim();
}

export function optionalString(raw: Record<string, unknown>, key: string, max = 20_000) {
  const value = raw[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ToolInputError(`${key} must be text.`);
  if (value.length > max) throw new ToolInputError(`${key} is longer than ${max} characters.`);
  return value.trim();
}

export function optionalNumber(raw: Record<string, unknown>, key: string) {
  const value = raw[key];
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) throw new ToolInputError(`${key} must be a number.`);
  return number;
}

export function oneOf<T extends string>(raw: Record<string, unknown>, key: string, values: readonly T[], fallback?: T): T {
  const value = raw[key] ?? fallback;
  if (typeof value !== "string" || !values.includes(value as T))
    throw new ToolInputError(`${key} must be one of ${values.join(", ")}.`);
  return value as T;
}

export function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^AI_ARTIFACT_SCHEMA_INVALID:\s*/, "");
}

export function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : /(s|x|ch|sh)$/.test(noun) ? "es" : "s"}`;
}
