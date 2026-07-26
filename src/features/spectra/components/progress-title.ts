const IRREGULAR_PROGRESS_VERBS: Record<string, string> = {
  beginning: "began",
  building: "built",
  doing: "did",
  making: "made",
  reading: "read",
  running: "ran",
  taking: "took",
  writing: "wrote",
};

/**
 * Completed progress traces use a human past-tense title. Keep this bounded to
 * leading progress verbs so synthetic words like "Readed" never reach the UI.
 */
export function pastTenseProgressTitle(title: string, completed: boolean): string {
  if (!completed) return title;
  const trimmed = title.trim();
  if (!trimmed) return title;
  const match = trimmed.match(/^(\S+)([\s\S]*)$/);
  if (!match) return title;
  const [, first, rest] = match;
  if (!/ing$/i.test(first)) return title;
  const lower = first.toLowerCase();
  let past = IRREGULAR_PROGRESS_VERBS[lower];
  if (!past) {
    const stem = first.slice(0, -3);
    if (/ying$/i.test(first))
      past = `${first.slice(0, -4)}ied`;
    else
      past = `${stem}ed`;
  }
  // Preserve original capitalization of the first letter.
  const cased =
    first[0] === first[0]?.toUpperCase()
      ? past.charAt(0).toUpperCase() + past.slice(1)
      : past.charAt(0).toLowerCase() + past.slice(1);
  return `${cased}${rest}`;
}
