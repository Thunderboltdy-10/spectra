import type { Random } from "./random";

/**
 * How a hand types. Keys come in bursts with log-normal gaps, a little slower
 * after a space, clearly slower after a comma, and with a breath after a
 * sentence or a line. The whole run is paced to a budget that grows with the
 * length of the text but ever more slowly, so a word takes about as long as a
 * quick typist and a paragraph never becomes a crawl.
 */

export type TypedChunk = {
  /** Characters this frame adds. */
  text: string;
  /** Milliseconds before this frame shows. */
  delayMs: number;
};

/** The typing budget for `length` characters at tempo 1. */
export function typingBudgetMs(length: number) {
  if (length <= 0) return 0;
  if (length <= 40) return length * 46;
  return Math.round(600 + 2_400 * Math.log2(1 + length / 60));
}

/** No frame comes sooner than this; the editor cannot paint faster anyway. */
const MIN_FRAME_MS = 34;

function pauseAfter(character: string) {
  if (character === "\n") return 4.5;
  if (/[.!?]/.test(character)) return 3.4;
  if (/[,;:)]/.test(character)) return 2.1;
  if (character === " ") return 1.25;
  return 1;
}

/**
 * Split `text` into typed frames. `tempo` below 1 compresses (a backlog of
 * work waiting), above 1 relaxes. `wholeWords` keeps every frame on a word
 * boundary, for values where a half-word must never show (code, labels).
 */
export function typingRhythm(
  text: string,
  random: Random,
  options: { tempo?: number; wholeWords?: boolean } = {},
): TypedChunk[] {
  if (!text) return [];
  const tempo = Math.max(0.15, options.tempo ?? 1);
  const perChar = (typingBudgetMs(text.length) * tempo) / text.length;
  // Per-character gaps, before pacing.
  const gaps: number[] = [];
  let sentenceStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    let gap = random.around(perChar, 0.32) * (index > 0 ? pauseAfter(text[index - 1]!) : 1);
    // Now and then a person stops to think before a new sentence.
    if (sentenceStart && index > 0 && random.chance(0.18)) gap += random.around(240, 0.35) * tempo;
    sentenceStart = /[.!?\n]/.test(character);
    gaps.push(gap);
  }
  const chunks: TypedChunk[] = [];
  let pending = "";
  let waited = 0;
  // When characters come faster than a frame, frames carry whole words.
  const byWord = options.wholeWords || perChar < 16;
  for (let index = 0; index < text.length; index += 1) {
    pending += text[index]!;
    waited += gaps[index]!;
    const nextCharacter = text[index + 1];
    const atBoundary = nextCharacter === undefined || /\s/.test(nextCharacter) || /[\s,.;:!?)\]]/.test(text[index]!);
    if (waited < MIN_FRAME_MS && nextCharacter !== undefined) continue;
    if (byWord && !atBoundary) continue;
    chunks.push({ text: pending, delayMs: Math.round(waited) });
    pending = "";
    waited = 0;
  }
  if (pending) chunks.push({ text: pending, delayMs: Math.round(Math.max(MIN_FRAME_MS, waited)) });
  return chunks;
}

/** Backspacing a short run, one key at a time, a touch quicker than typing. */
export function backspaceRhythm(count: number, random: Random, tempo = 1) {
  return Array.from({ length: count }, (_, index) =>
    Math.round(Math.max(MIN_FRAME_MS, random.around((index === 0 ? 120 : 62) * tempo, 0.22))),
  );
}
