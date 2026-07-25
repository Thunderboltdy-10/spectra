/**
 * Completed progress traces: put the first word into a simple past form.
 * If it ends with "ing", replace that suffix with "ed" (Preparing → Prepared).
 */
export function pastTenseProgressTitle(title: string, completed: boolean): string {
  if (!completed) return title;
  const trimmed = title.trim();
  if (!trimmed) return title;
  const match = trimmed.match(/^(\S+)([\s\S]*)$/);
  if (!match) return title;
  const [, first, rest] = match;
  if (!/ing$/i.test(first)) return title;
  const past = `${first.slice(0, -3)}ed`;
  // Preserve original capitalization of the first letter.
  const cased =
    first[0] === first[0]?.toUpperCase()
      ? past.charAt(0).toUpperCase() + past.slice(1)
      : past.charAt(0).toLowerCase() + past.slice(1);
  return `${cased}${rest}`;
}
