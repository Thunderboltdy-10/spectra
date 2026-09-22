import type { WordNoteContent } from "../lenses/docx-academic-schema";

/** Preserve surviving run formatting through a textarea replacement. New text
 * inherits the format at the edit point; paragraph boundaries stay explicit. */
export function editNoteText(previous: string, next: string, content?: WordNoteContent | null): WordNoteContent {
  const characters: Array<{ text: string; bold?: boolean; italic?: boolean; underline?: boolean }> = [];
  (content ?? previous.split("\n").map((text) => [{ text }])).forEach((runs, index) => {
    if (index) characters.push({ text: "\n" });
    for (const { text, ...format } of runs) for (let at = 0; at < text.length; at++) characters.push({ ...format, text: text[at]! });
  });
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let end = 0;
  while (end < previous.length - start && end < next.length - start && previous[previous.length - end - 1] === next[next.length - end - 1]) end++;
  const { text: _text, ...format } = characters[start] ?? characters[start - 1] ?? { text: "" };
  const inserted = next.slice(start, next.length - end).split("").map((text) => ({ ...format, text }));
  const edited = [...characters.slice(0, start), ...inserted, ...(end ? characters.slice(-end) : [])];
  const result: WordNoteContent = [[]];
  for (const character of edited) {
    if (character.text === "\n") { result.push([]); continue; }
    const runs = result.at(-1)!;
    const prior = runs.at(-1);
    if (prior && prior.bold === character.bold && prior.italic === character.italic && prior.underline === character.underline) prior.text += character.text;
    else runs.push({ ...character });
  }
  return result;
}
