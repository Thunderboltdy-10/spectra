import { textHunks } from "./hand/text";

export type WordDiffSegment = { kind: "same" | "added" | "removed"; text: string };

/**
 * Two versions of one text as runs of kept, removed and added words, in
 * reading order: what a person would mark up by hand.
 */
export function wordDiff(before: string, after: string): WordDiffSegment[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  const segments: WordDiffSegment[] = [];
  const push = (kind: WordDiffSegment["kind"], text: string) => {
    if (!text) return;
    const last = segments.at(-1);
    if (last?.kind === kind) last.text += text;
    else segments.push({ kind, text });
  };
  let at = 0;
  for (const hunk of textHunks(before, after)) {
    push("same", before.slice(at, hunk.start));
    push("removed", hunk.removed);
    push("added", hunk.inserted);
    at = hunk.start + hunk.removed.length;
  }
  push("same", before.slice(at));
  return segments;
}

/** Long unchanged stretches folded to their ends, so the changes stay in view. */
export function foldUnchanged(segments: readonly WordDiffSegment[], keep = 80): WordDiffSegment[] {
  return segments.map((segment, index) => {
    if (segment.kind !== "same" || segment.text.length <= keep * 2 + 12) return segment;
    const first = index === 0;
    const last = index === segments.length - 1;
    const head = first ? "" : segment.text.slice(0, keep);
    const tail = last ? "" : segment.text.slice(-keep);
    return { kind: "same", text: `${head}${head || tail ? " … " : "…"}${tail}`.trim() || "…" };
  });
}
