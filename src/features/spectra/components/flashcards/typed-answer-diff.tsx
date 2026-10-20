import { plainTextFromStored } from "../../rich-content";

export type DiffPart = { kind: "same" | "extra" | "missing"; text: string };

/** Longer answers are compared as typed; the table would cost more than it tells. */
const DIFF_LIMIT = 400;
/** Below this share of letters in common, a typed answer is read as a different answer. */
const MISSPELLING_OVERLAP = 0.45;

/** Case, accents and spacing never make an answer wrong. */
export function foldForComparison(value: string) {
  return plainTextFromStored(value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** One character as the comparison sees it. */
function foldChar(char: string) {
  return char
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase();
}

/**
 * What the learner typed against what the card says, character by character:
 * the longest run they share stays, what they typed beyond it is extra, what
 * they left out is missing. The same reading Anki gives a typed answer.
 */
export function diffCharacters(typed: string, expected: string): DiffPart[] {
  const a = Array.from(typed.slice(0, DIFF_LIMIT));
  const b = Array.from(expected.slice(0, DIFF_LIMIT));
  const fa = a.map(foldChar);
  const fb = b.map(foldChar);
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        fa[i] === fb[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (fa[i] === fb[j]) {
      push("same", b[j]!);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      push("extra", a[i]!);
      i += 1;
    } else {
      push("missing", b[j]!);
      j += 1;
    }
  }
  for (; i < a.length; i += 1) push("extra", a[i]!);
  for (; j < b.length; j += 1) push("missing", b[j]!);
  return parts;
}

/** How much of the answer the typing got, for choosing among alternatives. */
function sharedLength(parts: DiffPart[]) {
  return parts.reduce(
    (total, part) => total + (part.kind === "same" ? part.text.length : 0),
    0,
  );
}

/**
 * The typed answer marked up against the closest accepted answer: kept
 * letters in the right colour, extra ones struck through, missing ones shown
 * where they belong. Shown on reveal when the deck asks for typed answers.
 */
export function TypedAnswerDiff({
  typed,
  accepted,
}: {
  typed: string;
  accepted: ReadonlyArray<string>;
}) {
  const answer = typed.trim();
  const candidates = accepted
    .map((value) => plainTextFromStored(value).trim())
    .filter(Boolean);
  if (!answer || !candidates.length) return null;
  const closest = candidates
    .map((candidate) => ({ candidate, parts: diffCharacters(answer, candidate) }))
    .reduce((best, next) =>
      sharedLength(next.parts) > sharedLength(best.parts) ? next : best,
    );
  // An answer that shares little with the card is a different answer, not a
  // misspelling; marking it letter by letter would only be noise.
  const overlap =
    sharedLength(closest.parts) / Math.max(answer.length, closest.candidate.length);
  const parts: DiffPart[] =
    overlap < MISSPELLING_OVERLAP ? [{ kind: "extra", text: answer }] : closest.parts;
  return (
    <p className="typed-answer-diff" aria-label={`You typed: ${answer}`}>
      {parts.map((part, index) => (
        <span key={index} data-kind={part.kind} aria-hidden>
          {part.text}
        </span>
      ))}
    </p>
  );
}
