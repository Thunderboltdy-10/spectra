/*
 * Tool labels and questions name work in light Markdown emphasis, for example
 * "Creating *Photosynthesis*" or "Remove everything in *Old notes*?". Views
 * that render text show that emphasis as italics; plain-text places (card
 * summaries, notifications, captions) drop the markers. Raw asterisks never
 * reach the user.
 */

export type EmphasisSegment = { text: string; emphasis: boolean };

const EMPHASIS = /(\*\*|\*|_)(?=\S)((?:(?!\1)[^\n])*?\S)\1/g;

export function emphasisSegments(value: string): EmphasisSegment[] {
  const segments: EmphasisSegment[] = [];
  let last = 0;
  for (const match of value.matchAll(EMPHASIS)) {
    const start = match.index ?? 0;
    // Snake_case words are not emphasis: "_" only counts at a word boundary.
    if (match[1] === "_" && (/\w/.test(value[start - 1] ?? "") || /\w/.test(value[start + match[0].length] ?? ""))) continue;
    if (start > last) segments.push({ text: value.slice(last, start), emphasis: false });
    segments.push({ text: match[2]!, emphasis: true });
    last = start + match[0].length;
  }
  if (last < value.length) segments.push({ text: value.slice(last), emphasis: false });
  // An unpaired "*" is ordinary text (a question may be about 3 * 4).
  return segments;
}

/** The same text without emphasis markers. */
export function plainEmphasis(value: string) {
  return emphasisSegments(value)
    .map((segment) => segment.text)
    .join("");
}
