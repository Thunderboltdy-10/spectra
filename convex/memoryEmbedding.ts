export const MEMORY_EMBEDDING_DIMENSIONS = 256;

const conceptGroups = [
  ["deadline", "due", "assignment", "homework", "task", "deliverable"],
  ["calendar", "schedule", "timetable", "event", "appointment", "lesson"],
  ["prefer", "preference", "like", "enjoy", "favourite", "favorite"],
  ["avoid", "dislike", "never", "mistake", "wrong"],
  ["concise", "brief", "short", "compact"],
  ["detailed", "thorough", "deep", "comprehensive"],
  ["explain", "teach", "clarify", "understand", "learn"],
  ["quiz", "practice", "question", "test", "revision"],
  ["document", "essay", "report", "writing", "notes"],
  ["presentation", "slides", "deck", "speaker"],
  ["spreadsheet", "sheets", "table", "formula", "chart", "data"],
  ["code", "programming", "script", "visualisation", "visualization"],
  ["workspace", "project", "class", "course", "subject"],
  ["remember", "memory", "recall", "retain"],
] as const;

const concepts = new Map<string, string>();
for (const group of conceptGroups)
  for (const value of group) concepts.set(value, group[0]);

function normalizedWords(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ""))
    .filter((word) => word.length > 1)
    .slice(0, 240);
}

function stem(value: string) {
  if (value.length <= 5) return value;
  return value
    .replace(/(?:ingly|edly|ments|ation|ations|ness|ingly)$/u, "")
    .replace(/(?:ing|ed|es|s)$/u, "");
}

function hash(value: string) {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1)
    result = Math.imul(result ^ value.charCodeAt(index), 0x01000193);
  return result >>> 0;
}

function add(vector: number[], feature: string, weight: number) {
  const primary = hash(feature);
  const secondary = hash(`semantic:${feature}`);
  vector[primary % MEMORY_EMBEDDING_DIMENSIONS] +=
    (primary & 1 ? -1 : 1) * weight;
  vector[secondary % MEMORY_EMBEDDING_DIMENSIONS] +=
    (secondary & 1 ? -1 : 1) * weight * 0.55;
}

/**
 * A private, deterministic semantic fingerprint. It keeps memory retrieval
 * local, cheap, and reproducible while still blending stems, concepts,
 * phrases, and fuzzy character features. It is ranking evidence only; hard
 * permission and source-evidence checks always run after candidate retrieval.
 */
export function memoryEmbedding(value: string) {
  const words = normalizedWords(value);
  const vector = Array.from<number>({
    length: MEMORY_EMBEDDING_DIMENSIONS,
  }).fill(0);
  for (let index = 0; index < words.length; index += 1) {
    const raw = words[index]!;
    const word = stem(raw);
    add(vector, `word:${word}`, 1.8);
    const concept = concepts.get(raw) ?? concepts.get(word);
    if (concept) add(vector, `concept:${concept}`, 2.4);
    if (index > 0) add(vector, `pair:${stem(words[index - 1]!)}:${word}`, 1.1);
    const padded = `^${word}$`;
    for (let cursor = 0; cursor + 2 < padded.length; cursor += 1)
      add(vector, `tri:${padded.slice(cursor, cursor + 3)}`, 0.22);
  }
  const magnitude = Math.sqrt(
    vector.reduce((sum, component) => sum + component * component, 0),
  );
  if (!magnitude) return vector;
  return vector.map((component) => component / magnitude);
}
