/*
 * How a class is recognised at a glance: its name in words, two letters for
 * its tile, and one ink of its own that follows it everywhere School shows
 * it. ManageBac names IB classes with a code ("2527PhysHL1": the cohort, the
 * subject, the level, the group); the subject and level are spelled out when
 * the code is one Spectra can read, and the code stays beside it. Shared:
 * Convex names a class's workspace with it, and School and Home draw with it.
 */

const SUBJECTS: ReadonlyArray<readonly [string, string]> = [
  ["tok", "Theory of Knowledge"],
  ["ee", "Extended Essay"],
  ["cas", "CAS"],
  ["cs", "Computer Science"],
  ["comp", "Computer Science"],
  ["econ", "Economics"],
  ["bm", "Business Management"],
  ["bus", "Business Management"],
  ["psych", "Psychology"],
  ["hist", "History"],
  ["geo", "Geography"],
  ["phil", "Philosophy"],
  ["gp", "Global Politics"],
  ["ess", "Environmental Systems"],
  ["phys", "Physics"],
  ["chem", "Chemistry"],
  ["bio", "Biology"],
  ["sehs", "Sports Science"],
  ["maa", "Maths Analysis"],
  ["mai", "Maths Applications"],
  ["math", "Mathematics"],
  ["va", "Visual Arts"],
  ["art", "Visual Arts"],
  ["mus", "Music"],
  ["film", "Film"],
  ["thea", "Theatre"],
  ["dance", "Dance"],
  ["enga", "English A"],
  ["engb", "English B"],
  ["eng", "English"],
  ["frea", "French A"],
  ["freb", "French B"],
  ["fre", "French"],
  ["spaa", "Spanish A"],
  ["spab", "Spanish B"],
  ["spa", "Spanish"],
  ["gera", "German A"],
  ["gerb", "German B"],
  ["ger", "German"],
  ["chia", "Chinese A"],
  ["chib", "Chinese B"],
  ["man", "Mandarin"],
  ["ita", "Italian"],
  ["lat", "Latin"],
];

/** The inks a class can take, in the order they are handed out. */
const INKS = ["--ink-blue", "--ink-green", "--ink-orange", "--ink-violet", "--ink-red", "--ink-yellow"] as const;

export type ClassIdentity = {
  /** The class in words: "Physics HL". */
  name: string;
  /** ManageBac's own name for it, when the words above differ. */
  code: string | null;
  /** Two letters for its tile: "Ph". */
  initials: string;
  /** Its ink, as a CSS colour. */
  ink: string;
  /** A subject taught for a grade, as against a group (mentoring, registration, a drop-in). */
  subject: boolean;
};

/** What follows the subject: a level ("HL", "SL", "HSL" for a class taught at both) and a group number. */
const TAIL = /^(hsl|hl|sl)?\d*$/;
const LEVEL: Record<string, string> = { hl: "HL", sl: "SL", hsl: "HL and SL" };

/** What a school puts around a class's name: "IB DP 2-", "HS ", a year group in brackets. */
const PREFIX = /^(?:IB\s*DP\s*\d?|IB|DP\s*\d?|MYP\s*\d?|HS)\s*-?\s*/i;
const YEAR_GROUP = /\s*\(([^)]*)\)\s*$/;
const unwrap = (title: string) => title.replace(YEAR_GROUP, "").replace(/^\d{2,4}(?=[A-Za-z])/, "").replace(PREFIX, "").replace(/^\d\s*-\s*/, "");

/** The name without the school's wrapping: "HS Mentor Time (IBDP 1)" → "Mentor Time". */
function bareName(title: string) {
  const bare = unwrap(title).trim() || title.trim();
  // A shouted word reads as a word: "REGISTRATION" → "Registration"; short ones ("TOP", "CAS") stay.
  return bare.replace(/\b[A-Z]{6,}\b/g, (word) => word[0]! + word.slice(1).toLowerCase());
}

/**
 * The subject and level in a class code, whichever way the school writes it:
 * "2527PhysHL1", "IB DP 2-Phys-HL-1 HL (IBDP 2)", "Fre-B-SL-1". Null when the
 * name is not a code Spectra reads.
 */
function readCode(title: string): { subject: string; level: string | null } | null {
  const bare = unwrap(title);
  // The level is often said twice ("Phys-HL-1 HL"); the code before it is enough.
  const body = bare.replace(/\s+(HL|SL)$/i, "").replace(/[\s-]+/g, "").toLowerCase();
  if (!/^[a-z][a-z0-9]*$/.test(body)) return null;
  // The longest subject that leaves a well-formed tail: "freb" before "fre".
  let best: { subject: string; level: string | null; length: number } | null = null;
  for (const [key, subject] of SUBJECTS) {
    if (!body.startsWith(key) || (best && best.length >= key.length)) continue;
    const tail = TAIL.exec(body.slice(key.length));
    if (tail) best = { subject, level: tail[1] ? LEVEL[tail[1]]! : null, length: key.length };
  }
  return best ? { subject: best.subject, level: best.level } : null;
}

function initialsOf(name: string) {
  // The words that carry the name: "Theory of Knowledge" is TK, "English A" is En.
  const words = name.split(/\s+/).filter((word) => /^[A-Za-z]/.test(word) && word.length > 2);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (words[0] ?? name).slice(0, 2).replace(/^./, (letter) => letter.toUpperCase());
}

/** A stable small number from a class id, so a class keeps its ink. */
function seat(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return hash;
}

/** The school's own section a class sits in, when it is not the IB Diploma: "HS". */
function section(title: string) {
  const prefix = PREFIX.exec(title.replace(YEAR_GROUP, "").replace(/^\d{2,4}(?=[A-Za-z])/, ""))?.[0]?.replace(/[\s-]+$/, "");
  return prefix && !/^(IB|DP)/i.test(prefix) ? prefix : null;
}

export function classIdentity(cls: { providerClassId: string; title: string }): ClassIdentity {
  const read = readCode(cls.title);
  // A subject taught again in another section ("HS 2-MAA-HL-2") keeps that section in its name.
  const qualifier = read ? section(cls.title) : null;
  const name = read ? [read.subject, read.level, qualifier && `(${qualifier})`].filter(Boolean).join(" ") : bareName(cls.title);
  return {
    name,
    code: name === cls.title ? null : cls.title,
    initials: initialsOf(read?.subject ?? name),
    subject: Boolean(read),
    ink: `var(${INKS[seat(cls.providerClassId) % INKS.length]})`,
  };
}

/**
 * Identities for a whole list at once: classes take the inks in turn, so no
 * two of a student's classes share one until every ink is used.
 */
export function classIdentities(classes: ReadonlyArray<{ providerClassId: string; title: string }>) {
  const sorted = [...classes].sort((a, b) => seat(a.providerClassId) - seat(b.providerClassId));
  const identities = new Map<string, ClassIdentity>();
  sorted.forEach((cls, index) => identities.set(cls.providerClassId, { ...classIdentity(cls), ink: `var(${INKS[index % INKS.length]})` }));
  // Two classes that read the same ("IB DP 2-MAA-HL-2" and "HS 2-MAA-HL-2") are told apart by what the school put before them.
  const named = new Map<string, string[]>();
  for (const cls of classes) {
    const name = identities.get(cls.providerClassId)!.name;
    named.set(name, [...(named.get(name) ?? []), cls.providerClassId]);
  }
  for (const ids of named.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const identity = identities.get(id)!;
      const prefix = PREFIX.exec(classes.find((cls) => cls.providerClassId === id)!.title.replace(/^\d{2,4}(?=[A-Za-z])/, ""))?.[0]?.replace(/[\s-]+$/, "");
      if (prefix) identities.set(id, { ...identity, name: `${identity.name} (${prefix})` });
    }
  }
  return identities;
}
