const IRREGULAR_PROGRESS_VERBS: Record<string, string> = {
  beginning: "began",
  building: "built",
  doing: "did",
  making: "made",
  reading: "read",
  rewriting: "rewrote",
  running: "ran",
  taking: "took",
  writing: "wrote",
};

/**
 * Completed progress traces use a human past-tense title. Keep this bounded to
 * leading progress verbs so synthetic words like "Readed" never reach the UI.
 */
export function pastTenseProgressTitle(
  title: string,
  completed: boolean,
): string {
  const trimmed = title
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!completed) return trimmed;
  if (!trimmed) return trimmed;
  const match = trimmed.match(/^(\S+)([\s\S]*)$/);
  if (!match) return trimmed;
  const [, first, rest] = match;
  if (!/ing$/i.test(first)) return trimmed;
  const lower = first.toLowerCase();
  let past = IRREGULAR_PROGRESS_VERBS[lower];
  if (!past) {
    const stem = first.slice(0, -3);
    if (/ying$/i.test(first)) past = `${first.slice(0, -4)}ied`;
    else past = `${stem}ed`;
  }
  // Preserve original capitalization of the first letter.
  const cased =
    first[0] === first[0]?.toUpperCase()
      ? past.charAt(0).toUpperCase() + past.slice(1)
      : past.charAt(0).toLowerCase() + past.slice(1);
  return `${cased}${rest}`;
}
