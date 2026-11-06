/*
 * Spectra's memory of a user is a few short files, not a pile of facts.
 *
 * - about: who they are and what they are working on. Always loaded.
 * - preferences: how they like Spectra to work, each line in the context it
 *   applies to. Always loaded, so changing model never changes the behaviour.
 * - topics: longer notes on one matter (a project, an exam, a goal). Only their
 *   one-line summaries are always loaded; read_memory opens one when it matters.
 *
 * Every file has a cap, so what is always loaded stays small and the agent has
 * to keep it sharp rather than let it grow. The number of topics can grow.
 */

export const MEMORY_CAPS = {
  about: 2_400,
  preferences: 1_600,
  topic: 4_000,
  topicTitle: 60,
  topicSummary: 140,
  topics: 80,
} as const;

export type MemoryFileName = "about" | "preferences" | "topic";

export type MemoryChange = {
  file: MemoryFileName;
  /** Which topic; a new slug starts a new one. */
  slug?: string;
  title?: string;
  summary?: string;
  /** A new line at the end. */
  add?: string;
  /** Replace this exact text with `replace`; an empty `replace` removes it. */
  find?: string;
  replace?: string;
  /** The whole file, written again. */
  rewrite?: string;
  /** Erase the topic. */
  remove?: boolean;
};

export type MemoryChangeResult = { ok: true; message: string } | { ok: false; message: string };

export type MemoryTopicEntry = { slug: string; title: string; summary: string; chars: number; updatedAt: number };

export type MemoryHead = {
  enabled: boolean;
  about: string;
  preferences: string;
  topics: MemoryTopicEntry[];
};

export function memorySlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const closeTo = (text: string, wanted: string) => {
  const words = wanted.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
  const line = text
    .split("\n")
    .map((candidate) => ({ candidate, hits: words.filter((word) => candidate.toLowerCase().includes(word)).length }))
    .sort((left, right) => right.hits - left.hits)[0];
  return line?.hits ? ` The closest line is: "${line.candidate.trim().slice(0, 160)}".` : "";
};

/** The file after a change, or why it cannot be made, in words the model can act on. */
export function applyMemoryText(
  current: string,
  change: Pick<MemoryChange, "add" | "find" | "replace" | "rewrite">,
  cap: number,
  label: string,
): { ok: true; text: string } | { ok: false; message: string } {
  let next = current;
  if (change.rewrite !== undefined) next = change.rewrite.trim();
  else if (change.find !== undefined) {
    const at = current.indexOf(change.find);
    if (!change.find || at < 0)
      return { ok: false, message: `${label} does not contain that text, so nothing changed.${closeTo(current, change.find)}` };
    if (current.indexOf(change.find, at + 1) >= 0)
      return { ok: false, message: `That text appears more than once in ${label}, so nothing changed. Quote more of the line.` };
    next = `${current.slice(0, at)}${change.replace ?? ""}${current.slice(at + change.find.length)}`
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else if (change.add !== undefined) {
    const added = change.add.trim();
    if (!added) return { ok: false, message: "There was nothing to add." };
    if (current.toLowerCase().includes(added.toLowerCase()))
      return { ok: true, text: current };
    next = current ? `${current}\n${added}` : added;
  } else return { ok: false, message: "Say what to change: add, find with replace, or rewrite." };
  if (next.length > cap)
    return {
      ok: false,
      message: `${label} would be ${next.length} characters and its limit is ${cap}, so nothing changed. Rewrite it shorter: merge what overlaps and drop what no longer matters, or move a longer matter into a topic of its own.`,
    };
  return { ok: true, text: next };
}
