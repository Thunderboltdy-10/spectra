import { AuthoringError } from "./shared";

/*
 * Finding where an edit lands. A model reads a document, then quotes it back:
 * it drops a bold mark, straightens a quote, or joins two lines. None of that
 * should cost a round trip, so a quote that is not exact is tried again with
 * those differences set aside. When nothing matches, the error shows the
 * closest text in the document, so the next attempt needs no fresh read.
 */

export type TextRange = { start: number; end: number };
/** Prose ignores formatting marks and typography; code only ignores spacing. */
export type LocateMode = "prose" | "code";

const FOLDED: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201A": "'", "\u201B": "'", "\u2032": "'",
  "\u201C": '"', "\u201D": '"', "\u201E": '"', "\u201F": '"', "\u2033": '"',
  "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u00A0": " ", "\u2026": "...",
};

function fold(value: string, mode: LocateMode) {
  const chars: string[] = [];
  const origin: number[] = [];
  let inSpace = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (/\s/.test(char)) {
      if (!inSpace && chars.length) {
        chars.push(" ");
        origin.push(index);
      }
      inSpace = true;
      continue;
    }
    if (mode === "prose" && /[*_~=`]/.test(char)) continue;
    inSpace = false;
    const folded = mode === "prose" ? FOLDED[char] ?? char : char;
    for (const part of folded) {
      chars.push(part);
      origin.push(index);
    }
  }
  if (chars.at(-1) === " ") {
    chars.pop();
    origin.pop();
  }
  return { text: chars.join(""), origin };
}

function occurrences(haystack: string, needle: string) {
  const found: number[] = [];
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    found.push(index);
    index = haystack.indexOf(needle, index + needle.length);
  }
  return found;
}

const MARK_RUN = /\*{1,3}|~~|==|`+/g;

/** Whether a slice of Markdown opens or closes a mark it does not also hold. */
function cutsThroughMarks(slice: string) {
  const open: string[] = [];
  for (const found of slice.matchAll(MARK_RUN)) {
    const run = found[0];
    const before = slice[found.index - 1];
    const after = slice[found.index + run.length];
    if (open.at(-1) === run) open.pop();
    else if (before && !/\s/.test(before) && (!after || /\s/.test(after))) return true;
    else open.push(run);
  }
  return open.length > 0;
}

/** Widens a range to take in the marks it cut through, so none is left dangling. */
function wholeMarks(haystack: string, range: TextRange): TextRange {
  if (!cutsThroughMarks(haystack.slice(range.start, range.end))) return range;
  let { start, end } = range;
  while (start > 0 && /[*~=`]/.test(haystack[start - 1]!)) start -= 1;
  while (end < haystack.length && /[*~=`]/.test(haystack[end]!)) end += 1;
  return { start, end };
}

/** Every place `needle` occurs: exact matches, or failing that, loose ones. */
export function locateAll(haystack: string, needle: string, mode: LocateMode): TextRange[] {
  const exact = occurrences(haystack, needle);
  if (exact.length) return exact.map((start) => ({ start, end: start + needle.length }));
  const wanted = fold(needle, mode).text;
  if (!wanted) return [];
  const folded = fold(haystack, mode);
  return occurrences(folded.text, wanted).map((start) => {
    const range = { start: folded.origin[start]!, end: folded.origin[start + wanted.length - 1]! + 1 };
    return mode === "prose" ? wholeMarks(haystack, range) : range;
  });
}

function snippet(haystack: string, at: number) {
  const start = Math.max(0, at - 30);
  const end = Math.min(haystack.length, at + 50);
  return `${start ? "…" : ""}${haystack.slice(start, end).replace(/\s+/g, " ").trim()}${end < haystack.length ? "…" : ""}`;
}

const wordsOf = (value: string) => new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/** The line sharing the most words with what was quoted. */
export function closestText(haystack: string, needle: string): string | null {
  const wanted = wordsOf(needle);
  if (!wanted.size) return null;
  let best: { line: string; score: number } | null = null;
  for (const line of haystack.split("\n")) {
    if (!line.trim()) continue;
    const have = wordsOf(line);
    let shared = 0;
    for (const word of wanted) if (have.has(word)) shared += 1;
    const score = shared / wanted.size;
    if (score > (best?.score ?? 0)) best = { line, score };
  }
  if (!best || best.score < 0.34) return null;
  return best.line.trim().slice(0, 200);
}

export function notFoundMessage(label: string, field: string, needle: string, haystack: string, where: string) {
  const closest = closestText(haystack, needle);
  const quoted = needle.length > 80 ? `${needle.slice(0, 80)}…` : needle;
  return `${label}: \`${field}\` text "${quoted}" is not in ${where}.${closest ? ` The closest text is: "${closest}".` : " Read it to see the current text."}`;
}

function ambiguousMessage(label: string, field: string, ranges: TextRange[], haystack: string, allowAll: boolean) {
  const places = ranges.slice(0, 3).map((range) => `"${snippet(haystack, range.start)}"`).join(", ");
  return `${label}: \`${field}\` text appears ${ranges.length} times (${places}${ranges.length > 3 ? ", …" : ""}). Quote more of the text around the one you mean${allowAll ? ', or set "all": true to change every one' : ""}.`;
}

export type RangeQuote = { find?: unknown; from?: unknown; to?: unknown; all?: unknown };

const quoted = (value: unknown, field: string, label: string) => {
  if (typeof value !== "string" || !value)
    throw new AuthoringError(`${label}: \`${field}\` must be non-empty text.`);
  return value;
};

/**
 * Where a replace or delete applies: `find` quotes the text itself; `from` and
 * `to` quote only where it starts and where it ends, so a long passage can be
 * replaced without being written out.
 */
export function resolveRanges(haystack: string, quote: RangeQuote, label: string, mode: LocateMode, where: string): TextRange[] {
  if (quote.from !== undefined || quote.to !== undefined) {
    if (quote.find !== undefined) throw new AuthoringError(`${label}: use \`find\`, or \`from\` and \`to\`, not both.`);
    const from = quoted(quote.from, "from", label);
    const to = quoted(quote.to, "to", label);
    const starts = locateAll(haystack, from, mode);
    if (!starts.length) throw new AuthoringError(notFoundMessage(label, "from", from, haystack, where));
    if (starts.length > 1) throw new AuthoringError(ambiguousMessage(label, "from", starts, haystack, false));
    const start = starts[0]!;
    const end = locateAll(haystack, to, mode).find((range) => range.end > start.start && range.start >= start.start);
    if (!end) throw new AuthoringError(notFoundMessage(label, "to", to, haystack.slice(start.start), `${where} after \`from\``));
    const range = { start: start.start, end: end.end };
    return [mode === "prose" ? wholeMarks(haystack, range) : range];
  }
  const find = quoted(quote.find, "find", label);
  const ranges = locateAll(haystack, find, mode);
  if (!ranges.length) throw new AuthoringError(notFoundMessage(label, "find", find, haystack, where));
  if (ranges.length > 1 && !quote.all) throw new AuthoringError(ambiguousMessage(label, "find", ranges, haystack, true));
  return ranges;
}

/** Applies a replacement to ranges, last first so earlier offsets stay true. */
export function spliceRanges(haystack: string, ranges: TextRange[], replacement: string) {
  return [...ranges]
    .sort((left, right) => right.start - left.start)
    .reduce((text, range) => `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`, haystack);
}

const MATH_SPAN = /\$\$?[^$]*\$\$?/g;

/**
 * JSON turns the `\f` of `\frac` into a form feed, `\b` of `\beta` into a
 * backspace, and inside math, `\t`, `\r` and `\n` of `\times`, `\rho` and
 * `\neq` into white space. A model that forgets to double its backslash means
 * the command, never the control character, so put the command back.
 */
export function healLatexEscapes(value: string) {
  let next = value.replace(/\f/g, "\\f").replace(/[\b]/g, "\\b");
  if (next.includes("$") && /[\t\r\n]/.test(next))
    next = next.replace(MATH_SPAN, (span) =>
      span
        .replace(/\t(?=(?:imes|heta|au|ext|an|o|op|ilde|riangle|frac)\b)/g, "\\t")
        .replace(/\r(?=(?:ho|ight\w*|angle|m|oot|e)\b)/g, "\\r")
        .replace(/\n(?=(?:eq|u|abla|ot|otin|i|eg|ewline|ormalsize|mid|leq|geq)\b)/g, "\\n"));
  return next;
}

/** Heals every string in a value the model wrote. */
export function healStrings<T>(value: T): T {
  if (typeof value === "string") return healLatexEscapes(value) as T;
  if (Array.isArray(value)) return value.map(healStrings) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, healStrings(child)])) as T;
  return value;
}
