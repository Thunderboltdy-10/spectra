/*
 * The official IB subject guides, as read_syllabus serves them (README.md).
 *
 * Only what a student studies and is marked on is kept: the syllabus chapter
 * with every section and sub-section, and the assessment chapter with its
 * papers, tasks and criteria. Front matter, the introduction, teaching notes,
 * appendices and the IB's generic assessment boilerplate are left out.
 *
 * A guide is stored as an outline (each section's span in the guide's text)
 * and the text cut into segments at section starts. A section is the segments
 * inside its span, so a topic always comes with all of its sub-topics.
 */

export type GuideArea = "syllabus" | "assessment" | "reference";

export type GuideOutlineEntry = {
  start: number;
  end: number;
  code?: string;
  title: string;
  depth: number;
  area: GuideArea;
};

export type GuideSegment = { start: number; text: string };

export type GuidePlan = {
  guideId: string;
  title: string;
  outline: GuideOutlineEntry[];
  segments: GuideSegment[];
};

/** A section of the extractor's index.json (.spectra-local/ib-guides). */
export type ExtractedSection = {
  code: string | null;
  title: string;
  kind: string;
  depth: number;
  areaType: string;
  startChar: number;
  endChar: number;
};

export type ExtractedChapter = { title: string; areaType: string; start: number; end: number };

const normal = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/* ------------------------------------------------------------------ import */

/** The IB's assessment text that is the same in every guide, and says nothing about this course. */
const GENERIC_ASSESSMENT =
  /^(assessment in the (diploma programme|dp)\b.*|assessment-related resources|general|methods of assessment|inclusive (access|assessment) arrangements|responsibilities of the school|acknowledging the ideas or work of another person|academic integrity|assessment access and inclusion|purpose of internal assessment)$/;

const DROPPED_SYLLABUS = /^(syllabus format)$/;

/** Formula lines the extractor took for headings; they belong to the section before. */
const notAHeading = (title: string) => /[∫∑π=′√]/.test(title) || /^[a-z]/.test(title.trim()) || /^examples?:/i.test(title.trim());

/** The appendices students still ask about: command terms, the subject's glossary, formulae and notation. */
const REFERENCE = /command terms|glossary|formula|notation list/i;

function areaOf(areaType: string, chapterTitle: string): GuideArea | null {
  if (areaType === "assessment") return "assessment";
  if (areaType === "syllabus") return "syllabus";
  // Theory of knowledge's own chapter (aims, nature, the course at a glance) is part of what is studied.
  if (areaType === "theory of knowledge" || /^theory of knowledge$/i.test(chapterTitle)) return "syllabus";
  return null;
}

/** The lines a guide repeats at the top of its pages ("Syllabus content"), so they can be taken out. */
export function runningHeadersOf(fullText: string) {
  const counts = new Map<string, number>();
  for (const page of fullText.replace(/\r/g, "").split("\f").slice(1)) {
    const lines = page.replace(/^\n+/, "").split("\n").slice(0, 2);
    for (const [index, line] of lines.entries()) {
      const key = `${index}:${line.trim()}`;
      // A bullet or a number on its own is content, however often a page starts with one.
      if (/[a-z]{3}/i.test(line)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count >= 3).map(([key]) => key));
}

/**
 * The guide's text as a reader wants it: no page footers or running headers,
 * bullets on their item's line, and lines the PDF wrapped joined again.
 */
export function cleanGuideText(text: string, runningHeaders: ReadonlySet<string> = new Set()) {
  let out = text.replace(/\r/g, "");
  // Page footer ("35\nPhysics guide" or "History guide\n31"), the page break, then the running header.
  out = out.replace(/\n?(?:\d{1,3}\n[^\n]*\bguide|[^\n]*\bguide\n\d{1,3})\n*\f\n*((?:[^\n]*\n?){0,2})/g, (_match, after: string) => {
    const lines = after.split("\n");
    let skip = 0;
    if (runningHeaders.has(`0:${lines[0]?.trim()}`)) {
      skip = 1;
      if (runningHeaders.has(`1:${lines[1]?.trim()}`)) skip = 2;
    }
    return `\n${lines.slice(skip).join("\n")}`;
  });
  out = out
    .replace(/\f/g, "\n")
    .replace(/(^|\n)[•▪●][ \t]*\n/g, "$1- ")
    .replace(/(^|\n)[◦○–][ \t]*\n/g, "$1  - ")
    .replace(/(^|\n)[•▪●][ \t]+/g, "$1- ")
    .replace(/^Download connections template$/gm, "")
    // A line the PDF wrapped ends in a space: join it to the next.
    .replace(/[ \t]+\n(?=[^\n])/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/** What to store for one guide, from its extracted text and index. */
export function planGuide(input: {
  guideId: string;
  title: string;
  fullText: string;
  sections: readonly ExtractedSection[];
  chapters: readonly ExtractedChapter[];
}): GuidePlan {
  const chapterOf = (at: number) => input.chapters.find((chapter) => at >= chapter.start && at < chapter.end);
  const headers = runningHeadersOf(input.fullText);
  // Pages also repeat the chapter or top heading they are in. Inside a segment, a page never starts with a new one.
  for (const title of [...input.chapters.map((chapter) => chapter.title), ...input.sections.filter((section) => section.depth <= 1).map((section) => section.title)]) {
    headers.add(`0:${title.trim()}`);
    headers.add(`1:${title.trim()}`);
  }
  const candidates = input.sections
    .filter((section) => section.kind !== "bookmark" && section.endChar > section.startChar && !notAHeading(section.title))
    .sort((a, b) => a.startChar - b.startChar || a.depth - b.depth);

  const dropped: Array<{ start: number; end: number }> = [];
  const kept: GuideOutlineEntry[] = [];
  for (const section of candidates) {
    const chapter = chapterOf(section.startChar);
    const title = section.title.replace(/\s+/g, " ").trim();
    const inReference = kept.some((entry) => entry.area === "reference" && section.startChar >= entry.start && section.startChar < entry.end);
    const area = !chapter ? null : (areaOf(section.areaType, chapter.title) ?? (inReference || REFERENCE.test(title) ? "reference" : null));
    const inside = dropped.some((span) => section.startChar >= span.start && section.startChar < span.end);
    const plain = title.toLowerCase();
    const generic = !section.code && ((area === "assessment" && GENERIC_ASSESSMENT.test(plain)) || (area === "syllabus" && DROPPED_SYLLABUS.test(plain)));
    if (!area || inside || generic) {
      dropped.push({ start: section.startChar, end: section.endChar });
      continue;
    }
    kept.push({
      start: section.startChar,
      end: Math.min(section.endChar, chapter!.end),
      ...(section.code ? { code: section.code.trim() } : {}),
      title,
      depth: section.depth,
      area,
    });
  }

  // Every section start, kept or not, ends the segment before it.
  const cuts = [...new Set([...candidates.map((section) => section.startChar), ...input.chapters.map((chapter) => chapter.end)])].sort((a, b) => a - b);

  // A theme heading ("Theme A: Concepts of computer science", "Structure") spans only its own line in
  // the extractor's index; it covers the numbered topics after it, up to the next heading like it.
  kept.forEach((entry, index) => {
    const next = kept[index + 1];
    const ownText = (cuts.find((cut) => cut > entry.start) ?? entry.end) - entry.start;
    // "Glossary of command terms" is a bare heading; the list follows as "Command terms for physics".
    if (entry.area === "reference" && next?.area === "reference" && ownText <= 200 && entry.end <= next.start) {
      entry.end = next.end;
      return;
    }
    if (entry.code || !next?.code || next.area !== entry.area || ownText > 200 || entry.end > next.start) return;
    const chapterEnd = chapterOf(entry.start)!.end;
    const following = kept.slice(index + 1).find((other) => !other.code && other.area === entry.area && other.depth <= entry.depth);
    entry.end = Math.min(following?.start ?? chapterEnd, chapterEnd);
  });
  const segments: GuideSegment[] = [];
  const starts = [...new Set(kept.map((entry) => entry.start))];
  for (const start of starts) {
    const next = cuts.find((cut) => cut > start) ?? input.fullText.length;
    const text = cleanGuideText(input.fullText.slice(start, next), headers);
    if (text) segments.push({ start, text });
  }
  return { guideId: input.guideId, title: input.title, outline: kept, segments };
}

/* ------------------------------------------------------------------ lookup */

/** "A.2" and "A2", "SL 2.6" and "sl2.6" are the same code. */
export function codeKey(code: string) {
  return code
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^([a-z]+)\.(?=\d)/, "$1");
}

const NUMBERED_PREFIXES = ["", "sl", "ahl", "hl", "topic", "unit", "theme"];

const OTHER_LEVEL = { SL: /(—|-|\b)\s*HL( only)?$|\bHL only\b/i, HL: /(—|-|\b)\s*SL( only)?$|\bSL only\b/i } as const;

/** The deepest section a position in the guide falls in. */
export function sectionAt(outline: readonly GuideOutlineEntry[], at: number) {
  let found = -1;
  outline.forEach((entry, index) => {
    if (at >= entry.start && at < entry.end && (found === -1 || entry.end - entry.start <= outline[found]!.end - outline[found]!.start)) found = index;
  });
  return found;
}

/** Sections named by a code or heading. Several when a heading repeats (Paper 1 at SL and HL). */
export function findGuideSections(outline: readonly GuideOutlineEntry[], query: string, level?: "SL" | "HL" | null) {
  const wanted = query.trim();
  if (!wanted) return [];
  const key = codeKey(wanted);
  let found = outline.flatMap((entry, index) => {
    if (!entry.code) return [];
    const code = codeKey(entry.code);
    return NUMBERED_PREFIXES.some((prefix) => code === `${prefix}${key}`) ? [index] : [];
  });
  if (!found.length) {
    // "A1.2.5" printed as "A.1.2.5" in one guide: compare the digits too.
    const bare = key.replace(/\./g, "");
    if (/^[a-z]+\d{2,}$/.test(bare)) found = outline.flatMap((entry, index) => (entry.code && codeKey(entry.code).replace(/\./g, "") === bare ? [index] : []));
  }
  if (!found.length) {
    const want = normal(wanted);
    const titleOf = (entry: GuideOutlineEntry) => normal(entry.title.replace(entry.code ?? "", ""));
    found = outline.flatMap((entry, index) => (normal(entry.title) === want || titleOf(entry) === want ? [index] : []));
    if (!found.length && want.length >= 4) {
      found = outline.flatMap((entry, index) => (` ${normal(entry.title)} `.includes(` ${want} `) ? [index] : []));
      // The broadest match covers the rest.
      found = found.filter((index) => !found.some((other) => other !== index && contains(outline[other]!, outline[index]!)));
    }
  }
  if (level && found.length > 1) {
    const sameLevel = found.filter((index) => !ancestors(outline, index).some((entry) => OTHER_LEVEL[level].test(entry.title)) && !OTHER_LEVEL[level].test(outline[index]!.title));
    if (sameLevel.length) found = sameLevel;
  }
  return found.slice(0, 4);
}

const contains = (outer: GuideOutlineEntry, inner: GuideOutlineEntry) =>
  outer !== inner && outer.start <= inner.start && outer.end >= inner.end && outer.end - outer.start > inner.end - inner.start;

function ancestors(outline: readonly GuideOutlineEntry[], index: number) {
  const entry = outline[index]!;
  return outline.filter((other) => contains(other, entry));
}

/** Its sections one level down, to read separately when a section is too long to give whole. */
function childrenOf(outline: readonly GuideOutlineEntry[], index: number, after = -1) {
  const parent = outline[index]!;
  const inside = outline.filter((entry) => contains(parent, entry) && entry.start > after);
  return inside.filter((entry) => !inside.some((other) => contains(other, entry)));
}

const label = (entry: GuideOutlineEntry) => (entry.code && !entry.title.startsWith(entry.code) ? `${entry.code} ${entry.title}` : entry.title);

/** One section with everything under it, from its segments; cut at a segment edge with what is left to read. */
export function renderGuideSection(outline: readonly GuideOutlineEntry[], index: number, segments: readonly GuideSegment[], limit: number) {
  const entry = outline[index]!;
  const parts = segments.filter((segment) => segment.start >= entry.start && segment.start < entry.end).sort((a, b) => a.start - b.start);
  let text = "";
  let cutAt = -1;
  for (const part of parts) {
    if (text && text.length + part.text.length + 2 > limit) {
      cutAt = part.start - 1;
      break;
    }
    text += `${text ? "\n\n" : ""}${part.text}`;
  }
  if (!text && parts[0]) {
    text = parts[0].text.slice(0, limit);
    cutAt = parts[0].start;
  }
  const where = ancestors(outline, index)
    .sort((a, b) => a.start - b.start)
    .map(label)
    .slice(-2);
  const heading = `[${AREA_LABEL[entry.area]}${where.length ? ` > ${where.join(" > ")}` : ""} > ${label(entry)}]`;
  if (cutAt === -1) return `${heading}\n${text}`;
  const rest = childrenOf(outline, index, cutAt);
  const names = rest.map((item) => item.code ?? item.title);
  return `${heading}\n${text}\n\n[Cut for length. Read the rest by section: ${names.length ? names.join(", ") : "ask for a narrower section"}.]`;
}

const AREA_LABEL: Record<GuideArea, string> = { syllabus: "Syllabus", assessment: "Assessment", reference: "Reference" };

/** The guide's sections a student would ask for, by code and heading. */
export function guideOutlineText(outline: readonly GuideOutlineEntry[], maxLines = 140) {
  const lines: string[] = [];
  for (const area of ["syllabus", "assessment", "reference"] as const) {
    const entries = outline.filter((entry) => entry.area === area);
    if (!entries.length) continue;
    const depthOf = new Map<GuideOutlineEntry, number>();
    for (const entry of entries) depthOf.set(entry, entries.filter((other) => contains(other, entry)).length);
    const budget = area === "syllabus" ? maxLines : Math.round(maxLines / 2);
    let deepest = 0;
    while (deepest < 4 && entries.filter((entry) => depthOf.get(entry)! <= deepest + 1).length <= budget) deepest += 1;
    lines.push(`${AREA_LABEL[area]}:`);
    for (const entry of entries) {
      const depth = depthOf.get(entry)!;
      if (depth > deepest) continue;
      lines.push(`${"  ".repeat(depth)}- ${label(entry)}`);
    }
  }
  return lines.join("\n");
}

export const GUIDE_SECTION_LIMIT = 12_000;
export const GUIDE_TOTAL_LIMIT = 18_000;

/** Several sections: ";" always separates them, "," only between codes ("A.1, A.2"), so a heading keeps its commas. */
export function sectionQueries(section: string) {
  const isCode = (part: string) => /^(?:[a-z]{1,6}\.?\s?)?\d+(?:\.\d+)*$|^[a-z]$/i.test(part);
  return section
    .split(";")
    .map((group) => group.trim())
    .filter(Boolean)
    .flatMap((group) => {
      const parts = group
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      return parts.length > 1 && parts.every(isCode) ? parts : [group];
    })
    .slice(0, 4);
}
