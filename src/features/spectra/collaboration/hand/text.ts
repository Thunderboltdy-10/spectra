import { backspaceRhythm, typingRhythm } from "./keystrokes";
import type { Random } from "./random";
import { strokeDuration } from "./stroke";

/**
 * Editing one text value the way a person does.
 *
 * The change is split into the places that actually differ (a word here, a
 * clause there), and each is done with the gesture a person would pick: a few
 * backspaces for a short tail, a double-click for one word, a drag across a
 * phrase. The new words are then typed over the selection with a real rhythm.
 * Untouched text never moves, and every frame is a whole, valid value.
 */

export type HandTextStep = {
  /** The complete value this frame shows. */
  value: string;
  delayMs: number;
  gesture: "pointer" | "selecting" | "typing" | "erasing";
  /** Caret, a flat offset into `value`. */
  caret: number;
  /** A visible selection, flat offsets into `value`. */
  selection?: { start: number; end: number };
};

type Hunk = { start: number; removed: string; inserted: string };

/** Words, the spaces after them and punctuation, as separate tokens. */
function tokens(value: string) {
  return value.match(/\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_'’-]/gu) ?? [];
}

const MAX_DIFF_TOKENS = 700;

/**
 * Token-level differences, merged when only a space or two separates them,
 * so a sentence edited in two nearby words reads as one gesture.
 */
export function textHunks(
  before: string,
  after: string,
  /** The hand rewrites a sentence whole where a reader's diff marks each word. */
  { wholeRewrites = false }: { wholeRewrites?: boolean } = {},
): Hunk[] {
  if (before === after) return [];
  const a = tokens(before);
  const b = tokens(after);
  // Shared head and tail first: most edits touch one place.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const offsetOf = (list: string[], count: number) => list.slice(0, count).join("").length;
  const startOffset = offsetOf(a, head);
  if (midA.length * midB.length > MAX_DIFF_TOKENS * MAX_DIFF_TOKENS || !midA.length || !midB.length)
    return [{ start: startOffset, removed: midA.join(""), inserted: midB.join("") }];
  // LCS table over the middle.
  const rows = midA.length + 1;
  const cols = midB.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = midA.length - 1; i >= 0; i -= 1)
    for (let j = midB.length - 1; j >= 0; j -= 1)
      table[i * cols + j] =
        midA[i] === midB[j] ? table[(i + 1) * cols + j + 1]! + 1 : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
  const raw: Array<{ aFrom: number; aTo: number; bFrom: number; bTo: number }> = [];
  let i = 0;
  let j = 0;
  let open: { aFrom: number; bFrom: number } | null = null;
  const close = () => {
    if (open) raw.push({ aFrom: open.aFrom, aTo: i, bFrom: open.bFrom, bTo: j });
    open = null;
  };
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      close();
      i += 1;
      j += 1;
    } else {
      open ??= { aFrom: i, bFrom: j };
      if (j < midB.length && (i >= midA.length || table[i * cols + j + 1]! >= table[(i + 1) * cols + j]!)) j += 1;
      else i += 1;
    }
  }
  close();
  // Merge hunks separated by only whitespace or a single short token.
  const merged: typeof raw = [];
  for (const hunk of raw) {
    const last = merged.at(-1);
    const gap = last ? midA.slice(last.aTo, hunk.aFrom) : [];
    if (last && (gap.every((token) => /^\s+$/.test(token)) || (gap.length <= 2 && gap.join("").length <= 3))) {
      last.aTo = hunk.aTo;
      last.bTo = hunk.bTo;
    } else merged.push({ ...hunk });
  }
  // Too scattered to read as separate touches, or a rewrite that keeps only
  // stray words: select the old text whole and write the new.
  const visible = (list: string[]) => list.join("").replace(/\s+/g, "").length;
  const removedVisible = merged.reduce((sum, hunk) => sum + visible(midA.slice(hunk.aFrom, hunk.aTo)), 0);
  const rewrite = wholeRewrites && merged.length > 1 && visible(midA) - removedVisible < visible(midA) * 0.4;
  if (merged.length > 8 || rewrite)
    return [{ start: startOffset, removed: midA.join(""), inserted: midB.join("") }];
  return merged.map((hunk) => ({
    start: startOffset + offsetOf(midA, hunk.aFrom),
    removed: midA.slice(hunk.aFrom, hunk.aTo).join(""),
    inserted: midB.slice(hunk.bFrom, hunk.bTo).join(""),
  }));
}

/** Roughly how far a pointer travels across `characters` of text. */
const textWidth = (characters: number) => Math.min(640, characters * 7.2);

export function planTextHand(
  before: string,
  after: string,
  random: Random,
  options: {
    tempo?: number;
    code?: boolean;
    /** Where the caret already is in this value, if the hand is in it. */
    caretAt?: number;
  } = {},
): HandTextStep[] {
  const tempo = options.tempo ?? 1;
  const steps: HandTextStep[] = [];
  let current = before;
  // `before` offsets shift by what earlier hunks changed.
  let shift = 0;
  for (const [index, hunk] of textHunks(before, after, { wholeRewrites: true }).entries()) {
    const start = hunk.start + shift;
    const removedEnd = start + hunk.removed.length;
    const reach = Math.round(random.around(index === 0 ? 120 : 170, 0.3) * tempo);
    if (hunk.removed) {
      const shortTail = hunk.removed.length <= 3 && !/\n/.test(hunk.removed);
      if (shortTail) {
        // Click just after the old characters and backspace them.
        steps.push({ value: current, delayMs: reach, gesture: "pointer", caret: removedEnd });
        const keys = backspaceRhythm(hunk.removed.length, random, tempo);
        for (const [count, delayMs] of keys.entries()) {
          const at = removedEnd - count - 1;
          current = current.slice(0, at) + current.slice(at + 1);
          steps.push({ value: current, delayMs, gesture: "erasing", caret: at });
        }
      } else {
        const oneWord = /^[\p{L}\p{N}_'’-]+$/u.test(hunk.removed);
        const wholeLine =
          (start === 0 || current[start - 1] === "\n") &&
          (removedEnd === current.length || current[removedEnd] === "\n");
        steps.push({ value: current, delayMs: reach, gesture: "pointer", caret: start });
        if (oneWord || (wholeLine && hunk.removed.length > 60)) {
          // Double-click a word, triple-click a whole line: the selection lands at once.
          steps.push({
            value: current,
            delayMs: Math.round(random.around(oneWord ? 120 : 170, 0.2) * tempo),
            gesture: "selecting",
            caret: removedEnd,
            selection: { start, end: removedEnd },
          });
        } else {
          // Drag across: the selection grows with the hand.
          const dragMs = strokeDuration(textWidth(hunk.removed.length), 10, 0.36) * tempo;
          const frames = Math.max(2, Math.min(6, Math.ceil(hunk.removed.length / 14)));
          for (let frame = 1; frame <= frames; frame += 1) {
            const t = frame / frames;
            const eased = t * t * (3 - 2 * t);
            const end = frame === frames ? removedEnd : start + Math.max(1, Math.round(hunk.removed.length * eased));
            steps.push({
              value: current,
              delayMs: Math.round((dragMs / frames) * random.around(1, 0.15)),
              gesture: "selecting",
              caret: end,
              selection: { start, end },
            });
          }
        }
        // A beat to read what is selected before replacing it.
        const read = Math.round(random.around(110 + Math.min(170, hunk.removed.length * 2), 0.25) * tempo);
        if (!hunk.inserted) {
          current = current.slice(0, start) + current.slice(removedEnd);
          steps.push({ value: current, delayMs: read, gesture: "erasing", caret: start });
        } else {
          // A word is typed straight over; a longer selection is deleted
          // first, so the old words visibly go before the new ones come.
          const typeOver = oneWord;
          if (!typeOver) {
            current = current.slice(0, start) + current.slice(removedEnd);
            steps.push({ value: current, delayMs: read, gesture: "erasing", caret: start });
          }
          const tail = typeOver ? removedEnd : start;
          const chunks = typingRhythm(hunk.inserted, random, { tempo, wholeWords: options.code });
          let typed = "";
          const pause = Math.round(random.around(typeOver ? read : 100, 0.25) * tempo);
          for (const [chunkIndex, chunk] of chunks.entries()) {
            typed += chunk.text;
            const value = current.slice(0, start) + typed + current.slice(tail);
            steps.push({ value, delayMs: chunkIndex === 0 ? pause + chunk.delayMs : chunk.delayMs, gesture: "typing", caret: start + typed.length });
          }
          current = current.slice(0, start) + hunk.inserted + current.slice(tail);
        }
        shift += hunk.inserted.length - hunk.removed.length;
        continue;
      }
      // After backspacing, type the new text at the same place.
      const caretAt = start;
      let typed = "";
      for (const chunk of typingRhythm(hunk.inserted, random, { tempo, wholeWords: options.code })) {
        typed += chunk.text;
        steps.push({
          value: current.slice(0, caretAt) + typed + current.slice(caretAt),
          delayMs: chunk.delayMs,
          gesture: "typing",
          caret: caretAt + typed.length,
        });
      }
      current = current.slice(0, caretAt) + hunk.inserted + current.slice(caretAt);
      shift += hunk.inserted.length - hunk.removed.length;
      continue;
    }
    // A pure insertion: click where it goes, unless the caret is there, and type.
    if (index > 0 || options.caretAt !== start)
      steps.push({ value: current, delayMs: reach, gesture: "pointer", caret: start });
    let typed = "";
    for (const chunk of typingRhythm(hunk.inserted, random, { tempo, wholeWords: options.code })) {
      typed += chunk.text;
      steps.push({
        value: current.slice(0, start) + typed + current.slice(start),
        delayMs: chunk.delayMs,
        gesture: "typing",
        caret: start + typed.length,
      });
    }
    current = current.slice(0, start) + hunk.inserted + current.slice(start);
    shift += hunk.inserted.length;
  }
  // Whatever the hunks could not express lands exactly.
  if (current !== after) steps.push({ value: after, delayMs: 60, gesture: "typing", caret: after.length });
  return steps;
}
