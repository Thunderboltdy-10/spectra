/**
 * Safe text transitions.
 *
 * Animating a text change naively produces exactly the defects Spectra has been
 * carrying: overlapping text, momentarily missing content, broken word
 * fragments ("colr" while "colour" becomes "color"), and invalid intermediate
 * punctuation or syntax.
 *
 * This module makes those states unrepresentable. A change is reduced to one
 * contiguous span, that span is widened to *whole-token* boundaries, and the
 * transition is emitted as a small number of frames that are each a valid whole
 * value: select the old span, remove it cleanly, then enter the replacement in
 * token-sized chunks. No frame ever contains a half-typed word, and the text
 * outside the span is byte-identical in every frame.
 */

export type TextTransitionPhase =
  | "select"
  | "delete"
  | "insert"
  | "type"
  | "settle";

export type TextTransitionFrame = {
  phase: TextTransitionPhase;
  /** The complete, valid value at this frame. */
  value: string;
  /** Character offset where the change is happening, for caret placement. */
  caret: number;
  /** Span being selected/removed, in offsets into `value`. */
  span?: { start: number; end: number };
  /** Suggested milliseconds to hold this frame. */
  hold: number;
};

export type TextTransitionPlan = {
  frames: TextTransitionFrame[];
  /** Offsets of the changed region in the final value, for trace marking. */
  changed: { start: number; end: number };
  totalMs: number;
};

/** Characters that may never be left dangling at a frame boundary. */
const WORD_CHARACTER = /[\p{L}\p{N}_$'’-]/u;

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && WORD_CHARACTER.test(value);
}

/**
 * Longest common prefix length, then snapped backwards to a token boundary so a
 * frame can never split a word.
 */
function commonPrefixLength(before: string, after: string): number {
  const limit = Math.min(before.length, after.length);
  let index = 0;
  while (index < limit && before[index] === after[index]) index += 1;
  // Retreat to the start of the token we landed inside.
  while (
    index > 0 &&
    (isWordCharacter(before[index]) || isWordCharacter(after[index])) &&
    isWordCharacter(before[index - 1])
  )
    index -= 1;
  return index;
}

/**
 * Longest common suffix length, bounded so it cannot overlap the prefix, then
 * snapped forwards to a token boundary.
 */
function commonSuffixLength(
  before: string,
  after: string,
  prefixLength: number,
): number {
  const limit = Math.min(before.length, after.length) - prefixLength;
  let index = 0;
  while (
    index < limit &&
    before[before.length - 1 - index] === after[after.length - 1 - index]
  )
    index += 1;
  while (
    index > 0 &&
    (isWordCharacter(before[before.length - index]) ||
      isWordCharacter(after[after.length - index])) &&
    isWordCharacter(before[before.length - index - 1])
  )
    index -= 1;
  return index;
}

/**
 * Split a replacement into chunks that are each safe to reveal. Words stay
 * intact; code splits on line boundaries so a frame never shows an unbalanced
 * statement.
 */
function chunkReplacement(text: string, maxChunks: number, byLine: boolean): string[] {
  if (!text) return [];
  if (maxChunks <= 1) return [text];

  const units = byLine
    ? text.split(/(?<=\n)/)
    : text.split(/(?<=\s)|(?<=[,;:.!?])(?=\s*\S)/);

  const usable = units.filter((unit) => unit.length > 0);
  if (usable.length <= 1) return [text];

  // Merge units into at most `maxChunks` groups of roughly equal length so long
  // values do not become a keystroke-by-keystroke crawl.
  const perChunk = Math.max(1, Math.ceil(usable.length / maxChunks));
  const chunks: string[] = [];
  for (let index = 0; index < usable.length; index += perChunk) {
    chunks.push(usable.slice(index, index + perChunk).join(""));
  }
  return chunks;
}

export type TextTransitionOptions = {
  /** Treat the value as code and split on lines. */
  code?: boolean;
  /**
   * Total animation budget. The plan compresses to fit: fast model output
   * becomes a readable rhythm, and a long rewrite never turns into a crawl.
   */
  budgetMs?: number;
  /** Upper bound on typing frames. */
  maxChunks?: number;
};

/**
 * Build a transition plan between two values.
 *
 * Returns null when the values are equal — callers must not emit an animation
 * for a no-op, which is what previously produced phantom "AI is working" states.
 */
export function planTextTransition(
  before: string,
  after: string,
  options: TextTransitionOptions = {},
): TextTransitionPlan | null {
  if (before === after) return null;

  const code = options.code ?? false;
  const prefixLength = commonPrefixLength(before, after);
  const suffixLength = commonSuffixLength(before, after, prefixLength);

  const prefix = after.slice(0, prefixLength);
  const suffix = suffixLength > 0 ? after.slice(after.length - suffixLength) : "";
  const removed = before.slice(prefixLength, before.length - suffixLength);
  const added = after.slice(prefixLength, after.length - suffixLength);

  const cleared = `${prefix}${suffix}`;
  const maxChunks = Math.max(1, options.maxChunks ?? (code ? 8 : 6));
  const chunks = chunkReplacement(added, maxChunks, code);

  const frames: TextTransitionFrame[] = [];

  if (removed) {
    // Show the old content selected before it disappears, so the change reads as
    // a deliberate replacement rather than content vanishing.
    frames.push({
      phase: "select",
      value: before,
      caret: prefixLength + removed.length,
      span: { start: prefixLength, end: prefixLength + removed.length },
      hold: 1,
    });
    frames.push({
      phase: "delete",
      value: cleared,
      caret: prefixLength,
      span: { start: prefixLength, end: prefixLength },
      hold: 1,
    });
  }

  let typed = "";
  for (const chunk of chunks) {
    typed += chunk;
    frames.push({
      phase: removed ? "type" : "insert",
      value: `${prefix}${typed}${suffix}`,
      caret: prefixLength + typed.length,
      hold: 1,
    });
  }

  if (!frames.length) {
    // Pure deletion with nothing to type back.
    frames.push({
      phase: "delete",
      value: after,
      caret: prefixLength,
      hold: 1,
    });
  }

  frames.push({
    phase: "settle",
    value: after,
    caret: prefixLength + added.length,
    hold: 1,
  });

  const totalMs = distributeTiming(frames, options.budgetMs ?? defaultBudget(added, removed));

  return {
    frames,
    changed: { start: prefixLength, end: prefixLength + added.length },
    totalMs,
  };
}

/**
 * Budget scaled to the size of the change: small edits stay snappy, large
 * rewrites stay readable, and neither becomes an artificial delay.
 */
function defaultBudget(added: string, removed: string): number {
  const size = Math.max(added.length, removed.length);
  return Math.round(Math.min(1600, 260 + size * 7));
}

/**
 * Weight frames so the meaningful moments read clearly: the selection registers,
 * the removal lands, and typing carries the remaining time.
 */
function distributeTiming(
  frames: TextTransitionFrame[],
  budgetMs: number,
): number {
  const weights = frames.map((frame) => {
    switch (frame.phase) {
      case "select":
        return 1.6;
      case "delete":
        return 1.1;
      case "settle":
        return 0.8;
      default:
        return 1;
    }
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let assigned = 0;
  frames.forEach((frame, index) => {
    const hold = Math.max(28, Math.round((weights[index]! / total) * budgetMs));
    frame.hold = hold;
    assigned += hold;
  });
  return assigned;
}

/** The token-aligned difference between two values. */
export type TextDelta = {
  /** Offset in both values where they begin to differ. */
  start: number;
  /** Text present in `before` but not `after`, starting at `start`. */
  removed: string;
  /** Text present in `after` but not `before`, starting at `start`. */
  inserted: string;
};

/**
 * Token-aligned delta between two values. Snapping to word (or line, for code)
 * boundaries is what keeps a derived caret or selection off the middle of a
 * word, so a peer never sees an act pointing at half a token.
 */
export function describeTextDelta(
  before: string,
  after: string,
): TextDelta | null {
  if (before === after) return null;
  const start = commonPrefixLength(before, after);
  const suffix = commonSuffixLength(before, after, start);
  return {
    start,
    removed: before.slice(start, before.length - suffix),
    inserted: after.slice(start, after.length - suffix),
  };
}

/**
 * Line-scoped view of a change: which lines differ between two values. Used to
 * anchor carets and traces to the specific line rather than the whole block, and
 * to keep code edits from highlighting an entire file.
 */
export function changedLineRange(
  before: string,
  after: string,
): { start: number; end: number } | null {
  if (before === after) return null;
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  )
    start += 1;
  let fromEnd = 0;
  while (
    fromEnd < beforeLines.length - start &&
    fromEnd < afterLines.length - start &&
    beforeLines[beforeLines.length - 1 - fromEnd] ===
      afterLines[afterLines.length - 1 - fromEnd]
  )
    fromEnd += 1;
  return { start, end: Math.max(start, afterLines.length - fromEnd - 1) };
}

/** Convert a flat character offset into a line/column point. */
export function pointForOffset(
  value: string,
  offset: number,
): { line: number; offset: number } {
  const clamped = Math.max(0, Math.min(offset, value.length));
  const upto = value.slice(0, clamped);
  const lineBreaks = upto.split("\n");
  return {
    line: lineBreaks.length - 1,
    offset: lineBreaks[lineBreaks.length - 1]!.length,
  };
}
