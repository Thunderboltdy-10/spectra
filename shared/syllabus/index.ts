import { SYLLABUS_BUNDLE } from "./bundle.generated";
import { markdownForLevel } from "./levels";
import type { BundledSyllabus, SyllabusLevel } from "./types";
import { classIdentity } from "../class-identity";

export type { BundledSyllabus, SyllabusLevel } from "./types";
export { markdownForLevel } from "./levels";

/*
 * The syllabi Spectra knows (shared/syllabus/README.md). One copy, read by the
 * AI's read_syllabus tool and by the Syllabus artifact a class's workspace
 * starts with, so both always say the same thing.
 */

const normal = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function listSyllabi(): readonly BundledSyllabus[] {
  return SYLLABUS_BUNDLE;
}

export function syllabusById(id: string | undefined | null) {
  return id ? (SYLLABUS_BUNDLE.find((entry) => entry.id === id) ?? null) : null;
}

/** "HL" or "SL" when the words name one ("Physics HL", "maths sl"). */
export function levelIn(text: string): SyllabusLevel | null {
  const words = ` ${normal(text)} `;
  const hl = / (hl|higher level|higher) /.test(words);
  const sl = / (sl|standard level|standard) /.test(words);
  if (hl !== sl) return hl ? "HL" : "SL";
  return null;
}

/** Explicit exam/cohort years only; never infer a cohort from the current date. */
export function examYearIn(text: string): number | undefined {
  const years = [...text.matchAll(/\b(20[2-9]\d)\b/g)].map((match) => Number(match[1]));
  if (years.length === 1) return years[0];
  if (years.length === 2 && years[1]! > years[0]! && years[1]! - years[0]! <= 3) return years[1];
  // ManageBac compact cohort prefix: 2527HistHL1 means examination in 2027.
  const code = /^(\d{2})(\d{2})(?=[A-Za-z])/.exec(text.trim());
  if (code && Number(code[2]) > Number(code[1]) && Number(code[2]) - Number(code[1]) <= 3)
    return 2000 + Number(code[2]);
  return undefined;
}

/**
 * The syllabus a name points at: its id, its title, or any of its match terms,
 * as whole words. The longest term wins, so "Maths Analysis" beats "Maths".
 */
export function findSyllabus(text: string, examYear = examYearIn(text)): BundledSyllabus | null {
  const words = ` ${normal(text)} ${normal(classIdentity({ providerClassId: "syllabus", title: text }).name)} `;
  if (!words.trim()) return null;
  let best: { entry: BundledSyllabus; length: number } | null = null;
  let ambiguous = false;
  for (const entry of SYLLABUS_BUNDLE) {
    for (const term of [entry.id.replace(/-/g, " "), ...entry.match]) {
      const needle = normal(term);
      if (!needle || !words.includes(` ${needle} `)) continue;
      if (!best || needle.length > best.length) {
        best = { entry, length: needle.length };
        ambiguous = false;
      } else if (needle.length === best.length && entry.id !== best.entry.id) {
        ambiguous = true;
      }
    }
  }
  if (!best || ambiguous) return null;
  const entry = best.entry;
  if (examYear !== undefined && ((entry.firstAssessment && Number(entry.firstAssessment) > examYear) || (entry.lastAssessment && Number(entry.lastAssessment) < examYear))) return null;
  return entry;
}

/** A class's syllabus and level, from the class's name ("Physics HL"). */
export function syllabusForClass(className: string) {
  const entry = findSyllabus(className);
  if (!entry) return null;
  const named = levelIn(className) ?? levelIn(classIdentity({ providerClassId: "syllabus", title: className }).name);
  if (named && entry.levels.length && !entry.levels.includes(named)) return null;
  const level = entry.levels.length === 1 ? entry.levels[0]! : named;
  return { entry, level };
}

/** Unknown/mixed levels keep both clearly labelled, without claiming the class is HL. */
export function syllabusVariant(entry: BundledSyllabus, level?: SyllabusLevel | null) {
  if (!entry.levels.length) return { key: "all" as const, markdown: entry.markdown };
  const key = level && entry.levels.includes(level) ? level : entry.levels.length === 1 ? entry.levels[0]! : "all" as const;
  if (key === "all") return { key, markdown: entry.markdown };
  return { key, markdown: markdownForLevel(entry.markdown, key) };
}

export function syllabusTitle(entry: BundledSyllabus, level?: SyllabusLevel | null) {
  return `${entry.title}${level ? ` ${level}` : ""} syllabus`;
}

/** One section of a syllabus's Markdown: its heading and everything under it. */
function sectionOf(markdown: string, query: string) {
  const lines = markdown.split("\n");
  const want = normal(query);
  let start = -1;
  let depth = 0;
  for (let at = 0; at < lines.length; at += 1) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(lines[at]!);
    if (!heading) continue;
    if (start === -1) {
      const text = normal(heading[2]!);
      if (text === want || text.startsWith(`${want} `) || text.includes(want)) {
        start = at;
        depth = heading[1]!.length;
      }
    } else if (heading[1]!.length <= depth) {
      return lines.slice(start, at).join("\n").trim();
    }
  }
  return start === -1 ? null : lines.slice(start).join("\n").trim();
}

const LIMIT = 6_000;

/** What read_syllabus answers, in plain text for the model. */
export function readSyllabus(input: { subject?: string; level?: SyllabusLevel; section?: string; examYear?: number }) {
  if (!SYLLABUS_BUNDLE.length) return "No syllabi are loaded in Spectra yet. Work from what the user or their class resources say.";
  if (!input.subject) {
    return [
      "Syllabi Spectra has (id: title, levels):",
      ...SYLLABUS_BUNDLE.map(
        (entry) =>
          `- ${entry.id}: ${entry.title}${entry.levels.length ? ` (${entry.levels.join(", ")})` : ""}${entry.firstAssessment ? `, first assessment ${entry.firstAssessment}` : ""}${entry.lastAssessment ? `, through ${entry.lastAssessment}` : ""}`,
      ),
      "Call read_syllabus with subject (and level, and section for one part).",
    ].join("\n");
  }
  const entry = findSyllabus(input.subject, input.examYear ?? examYearIn(input.subject));
  if (!entry) {
    return `No syllabus matches "${input.subject}" unambiguously within its assessment window. Specify the course (AA/AI, language A literature/language and literature/B/ab initio) and verify examYear. Spectra has: ${SYLLABUS_BUNDLE.map((item) => item.id).join(", ")}.`;
  }
  const level = input.level ?? syllabusForClass(input.subject)?.level ?? levelIn(input.subject);
  if (level && entry.levels.length && !entry.levels.includes(level)) return `${entry.title} is only available at ${entry.levels.join("/")}.`;
  const variant = syllabusVariant(entry, level);
  const head = [
    `${entry.title} (${entry.programme}${variant.key !== "all" ? `, ${variant.key}` : ""}${entry.firstAssessment ? `, first assessment ${entry.firstAssessment}` : ""})`,
    entry.source ? `Source: ${entry.source}` : null,
    "Compact, sourced course reference; not the complete IB guide. Check the linked guide/class instructions for exact assessment requirements.",
    variant.key === "all" && entry.levels.length > 1 ? "Level unknown or mixed: confirm SL/HL before assigning level-specific work." : null,
    variant.key === "HL" ? "Sections marked (HL) are for HL students only." : null,
  ]
    .filter(Boolean)
    .join("\n");
  if (input.section) {
    const part = input.section.toLowerCase() === "all" ? variant.markdown : sectionOf(variant.markdown, input.section);
    if (!part) {
      return `${head}\nNo section matches "${input.section}". Sections: ${entry.sections
        .filter((item) => item.depth <= 2 && (variant.key !== "SL" || !item.hlOnly) && (variant.key !== "HL" || !item.slOnly))
        .map((item) => item.heading)
        .join("; ")}`;
    }
    return `${head}\n\n${part.length > LIMIT ? `${part.slice(0, LIMIT)}\n[cut: ask for a smaller section]` : part}`;
  }
  const overview = variant.markdown.split(/^#/m)[0]!.trim();
  return `${head}\n\n${overview}\n\nSections (read only the relevant section, or section: "all" for the complete reference):\n${entry.sections
    .filter((item) => item.depth <= 2 && (variant.key !== "SL" || !item.hlOnly) && (variant.key !== "HL" || !item.slOnly))
    .map((item) => `${"  ".repeat(item.depth - 1)}- ${item.heading}`)
    .join("\n")}`;
}
