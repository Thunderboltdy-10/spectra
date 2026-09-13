import { normalizeArtifactContent } from "../ai/content-normalization";
import type { ArtifactTypeKey } from "../artifacts/types";

export type HollowContentIntent = "create" | "update";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stripHtml(source: string) {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasMeaningfulSvg(source: string) {
  return (
    /<svg[\s>]/i.test(source) &&
    /<(?:path|circle|rect|line|polyline|polygon|ellipse|text|g|use|image)\b/i.test(
      source,
    )
  );
}

function hasMeaningfulScript(source: string) {
  const bodies = [
    ...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
  ].map((match) => (match[1] ?? "").trim());
  return bodies.some(
    (body) =>
      body.length >= 40 &&
      !/^(?:\/\/.*\n|\s)*$/.test(body) &&
      /[A-Za-z_$][\w$]*\s*[=(:]|function\b|=>|const\b|let\b|var\b|document\.|window\./.test(
        body,
      ),
  );
}

function isTrivialHtmlSource(source: string) {
  const trimmed = source.trim();
  if (!trimmed) return true;
  if (/^<main>\s*<\/main>$/i.test(trimmed)) return true;
  if (/^<(?:html|body|main|div)[^>]*>\s*<\/(?:html|body|main|div)>$/i.test(trimmed))
    return true;
  if (hasMeaningfulSvg(trimmed) || hasMeaningfulScript(trimmed)) return false;
  if (/<canvas\b/i.test(trimmed)) return false;
  const text = stripHtml(trimmed);
  if (text.length >= 40) return false;
  const body = trimmed.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? trimmed;
  const bodyText = stripHtml(body);
  if (bodyText.length >= 20) return false;
  // Nested markup without text/SVG/JS is still a hollow shell.
  return !hasMeaningfulSvg(body) && !hasMeaningfulScript(body);
}

function isMeaningfulCodeFile(file: Record<string, unknown>) {
  const path = typeof file.path === "string" ? file.path : "";
  const language = typeof file.language === "string" ? file.language : "";
  const source = typeof file.source === "string" ? file.source : "";
  const trimmed = source.trim();
  if (!trimmed) return false;
  if (
    /\.(html?|xhtml)$/i.test(path) ||
    language === "html" ||
    /<html\b|<body\b|<main\b|<svg\b/i.test(trimmed)
  )
    return !isTrivialHtmlSource(trimmed);
  if (/\.svg$/i.test(path) || language === "svg") return hasMeaningfulSvg(trimmed);
  if (
    /\.(js|jsx|mjs|cjs|ts|tsx)$/i.test(path) ||
    /^(?:java|type)?script/.test(language)
  )
    return (
      trimmed.length >= 40 &&
      /[A-Za-z_$][\w$]*\s*[=(:]|function\b|=>|const\b|let\b|var\b/.test(trimmed)
    );
  if (/\.py$/i.test(path) || language === "python")
    return (
      trimmed.length >= 30 &&
      /(?:def|class|import|from|print|for|while|if)\b/.test(trimmed)
    );
  if (/\.css$/i.test(path) || language === "css")
    return trimmed.length >= 24 && /[{;]/.test(trimmed);
  return trimmed.length >= 40;
}

function isHollowCodeContent(content: unknown) {
  const normalized = asRecord(normalizeArtifactContent("code", content));
  const files = Array.isArray(normalized.files) ? normalized.files : [];
  if (files.length === 0) return true;
  return !files.some(
    (file) =>
      file &&
      typeof file === "object" &&
      !Array.isArray(file) &&
      isMeaningfulCodeFile(file as Record<string, unknown>),
  );
}

function isHollowTimetableContent(content: unknown) {
  const normalized = asRecord(normalizeArtifactContent("timetable", content));
  const events = Array.isArray(normalized.events) ? normalized.events : [];
  return events.length === 0;
}

function isHollowDocumentContent(content: unknown) {
  const normalized = asRecord(normalizeArtifactContent("document", content));
  const blocks = Array.isArray(normalized.blocks) ? normalized.blocks : [];
  return !blocks.some((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return false;
    const text = (block as Record<string, unknown>).text;
    const latex = (block as Record<string, unknown>).latex;
    return (
      (typeof text === "string" && text.trim().length >= 8) ||
      (typeof latex === "string" && latex.trim().length >= 4)
    );
  });
}

function isHollowDeckContent(content: unknown) {
  const normalized = asRecord(
    normalizeArtifactContent("flashcard_deck", content),
  );
  const cards = Array.isArray(normalized.cards) ? normalized.cards : [];
  return !cards.some((card) => {
    if (!card || typeof card !== "object" || Array.isArray(card)) return false;
    const row = card as Record<string, unknown>;
    return (
      typeof row.front === "string" &&
      row.front.trim().length > 0 &&
      typeof row.back === "string" &&
      row.back.trim().length > 0
    );
  });
}

function isHollowQuizContent(content: unknown) {
  const normalized = asRecord(normalizeArtifactContent("quiz", content));
  const questions = Array.isArray(normalized.questions)
    ? normalized.questions
    : [];
  return !questions.some((question) => {
    if (!question || typeof question !== "object" || Array.isArray(question))
      return false;
    const prompt = (question as Record<string, unknown>).prompt;
    const stem = (question as Record<string, unknown>).stem;
    return (
      (typeof prompt === "string" && prompt.trim().length > 0) ||
      (typeof stem === "string" && stem.trim().length > 0)
    );
  });
}

function isHollowPlannerContent(content: unknown) {
  const normalized = asRecord(
    normalizeArtifactContent("planner_task", content),
  );
  const description =
    typeof normalized.description === "string"
      ? normalized.description.trim()
      : "";
  const subtasks = Array.isArray(normalized.subtasks)
    ? normalized.subtasks
    : [];
  const titled = subtasks.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { title?: unknown }).title === "string" &&
      String((item as { title: string }).title).trim(),
  );
  return description.length < 8 && titled.length === 0;
}

function isHollowPresentationContent(content: unknown) {
  const normalized = asRecord(
    normalizeArtifactContent("presentation", content),
  );
  const slides = Array.isArray(normalized.slides) ? normalized.slides : [];
  const placeholder =
    /^(?:add a clear idea|click to edit|title|subtitle|new slide)\s*$/i;
  return !slides.some((slide) => {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) return false;
    const objects = Array.isArray((slide as Record<string, unknown>).objects)
      ? ((slide as Record<string, unknown>).objects as unknown[])
      : [];
    return objects.some((object) => {
      if (!object || typeof object !== "object" || Array.isArray(object))
        return false;
      const text = (object as Record<string, unknown>).text;
      const contentText = asRecord((object as Record<string, unknown>).content)
        .text;
      const value =
        typeof text === "string"
          ? text.trim()
          : typeof contentText === "string"
            ? contentText.trim()
            : "";
      return value.length >= 8 && !placeholder.test(value);
    });
  });
}

function isHollowSheetsContent(content: unknown) {
  const normalized = asRecord(normalizeArtifactContent("sheets", content));
  const sheets = Array.isArray(normalized.sheets) ? normalized.sheets : [];
  return !sheets.some((sheet) => {
    if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) return false;
    const cells = asRecord((sheet as Record<string, unknown>).cells);
    return Object.values(cells).some((cell) => {
      if (cell == null) return false;
      if (typeof cell === "string" || typeof cell === "number")
        return String(cell).trim().length > 0;
      if (typeof cell !== "object" || Array.isArray(cell)) return false;
      const row = cell as Record<string, unknown>;
      const value = row.value ?? row.input ?? row.text ?? row.formula;
      return value != null && String(value).trim().length > 0;
    });
  });
}

function isHollowWhiteboardContent(content: unknown) {
  const normalized = asRecord(
    normalizeArtifactContent("whiteboard", content),
  );
  const nodes = Array.isArray(normalized.nodes) ? normalized.nodes : [];
  return nodes.length === 0;
}

function isHollowAgentContent(content: unknown) {
  const normalized = asRecord(normalizeArtifactContent("agent", content));
  const instructions = asRecord(normalized.instructions);
  const text =
    typeof instructions.text === "string" ? instructions.text.trim() : "";
  return text.length < 40;
}

export function hollowCreateFailureMessage(
  blueprintKey: ArtifactTypeKey,
): string {
  switch (blueprintKey) {
    case "code":
      return "The generated code artifact is hollow/incomplete — files are missing or only contain an empty <main></main> shell with no meaningful SVG or script.";
    case "timetable":
      return "The generated timetable is hollow/incomplete — content.events must include at least one scheduled event.";
    case "document":
      return "The generated document is hollow/incomplete — it has no meaningful blocks.";
    case "flashcard_deck":
      return "The generated flashcard deck is hollow/incomplete — it has no usable cards.";
    case "quiz":
      return "The generated quiz is hollow/incomplete — it has no usable questions.";
    case "planner_task":
      return "The generated planner task is hollow/incomplete — it has no description or subtasks.";
    case "presentation":
      return "The generated presentation is hollow/incomplete — slides have no meaningful content.";
    case "sheets":
      return "The generated workbook is hollow/incomplete — sheets have no cell values.";
    case "whiteboard":
      return "The generated whiteboard is hollow/incomplete — it has no nodes.";
    case "agent":
      return "The generated agent is hollow/incomplete — instructions are missing or too short.";
    default:
      return "The generated artifact is hollow/incomplete — it has no meaningful content.";
  }
}

/**
 * Detects default/empty shells that must never be finalized as successful
 * AI creates. Updates are not treated as hollow here — only creates.
 */
export function isHollowCreateContent(
  blueprintKey: ArtifactTypeKey,
  content: unknown,
  intent: HollowContentIntent = "create",
) {
  if (intent !== "create") return false;
  switch (blueprintKey) {
    case "code":
      return isHollowCodeContent(content);
    case "timetable":
      return isHollowTimetableContent(content);
    case "document":
      return isHollowDocumentContent(content);
    case "flashcard_deck":
      return isHollowDeckContent(content);
    case "quiz":
      return isHollowQuizContent(content);
    case "planner_task":
      return isHollowPlannerContent(content);
    case "presentation":
      return isHollowPresentationContent(content);
    case "sheets":
      return isHollowSheetsContent(content);
    case "whiteboard":
      return isHollowWhiteboardContent(content);
    case "agent":
      return isHollowAgentContent(content);
    default:
      return false;
  }
}

export function assertCreateContentNotHollow(
  blueprintKey: ArtifactTypeKey,
  content: unknown,
  intent: HollowContentIntent = "create",
) {
  if (isHollowCreateContent(blueprintKey, content, intent))
    throw new Error(hollowCreateFailureMessage(blueprintKey));
}

/** Provisional createPending / failed-shell summaries that must not survive finalize. */
export function isPlaceholderArtifactSummary(summary: unknown) {
  const clean = typeof summary === "string" ? summary.trim() : "";
  if (!clean) return true;
  if (/^Spectra is building\b/i.test(clean)) return true;
  if (/\b(?:building|creating|generating)\s+this\s+artifact\b/i.test(clean))
    return true;
  if (
    /^(?:Draft (?:paused|shell)|Proposed artifact awaiting|Incomplete draft preserved)\b/i.test(
      clean,
    )
  )
    return true;
  if (/^(?:quiz|document|deck|task)\s+artifact\b/i.test(clean)) return true;
  if (/^New (?:document|deck|quiz|task|agent|timetable|presentation|sheets|code|whiteboard)\.?$/i.test(clean))
    return true;
  return false;
}

/**
 * These summaries are a projection of artifact content, not user-authored
 * copy. They must follow the content when an AI or human edit changes the
 * artifact cardinality, otherwise the editor and Library describe different
 * saved work.
 */
export function isGeneratedArtifactSummary(
  summary: unknown,
  blueprintKey: ArtifactTypeKey,
) {
  const clean = typeof summary === "string" ? summary.trim() : "";
  if (!clean) return false;
  const patterns: Partial<Record<ArtifactTypeKey, RegExp>> = {
    document: /^\d+-block document about .+\.$/i,
    flashcard_deck: /^\d+-card deck about .+\.$/i,
    quiz: /^\d+-question quiz about .+\.$/i,
    planner_task: /^(?:Study task|Task) about .+\.$/i,
    presentation: /^\d+-slide (?:presentation|deck) about .+\.$/i,
    timetable: /^\d+-event timetable about .+\.$/i,
    code: /^\d+-file code artifact about .+\.$/i,
    whiteboard: /^\d+-node whiteboard about .+\.$/i,
    sheets: /^Workbook with \d+ filled cells? about .+\.$/i,
  };
  return patterns[blueprintKey]?.test(clean) ?? false;
}

/**
 * Keep a generated summary truthful while allowing an explicit natural
 * language summary edit to win. `currentSummary` is the authority signal: a
 * newly generated-looking string alone must not unexpectedly rewrite a
 * hand-authored summary.
 */
export function refreshGeneratedArtifactSummary(params: {
  blueprintKey: ArtifactTypeKey;
  title: string;
  content: unknown;
  currentSummary?: unknown;
  nextSummary?: unknown;
}) {
  const currentSummary =
    typeof params.currentSummary === "string"
      ? params.currentSummary.trim()
      : "";
  const nextSummary =
    typeof params.nextSummary === "string" ? params.nextSummary.trim() : "";
  if (!isGeneratedArtifactSummary(currentSummary, params.blueprintKey))
    return nextSummary || undefined;
  if (
    nextSummary &&
    nextSummary !== currentSummary &&
    !isGeneratedArtifactSummary(nextSummary, params.blueprintKey)
  )
    return nextSummary.slice(0, 320);
  return deriveCreateArtifactSummary({
    blueprintKey: params.blueprintKey,
    title: params.title,
    content: params.content,
  });
}

export function deriveCreateArtifactSummary(params: {
  blueprintKey: ArtifactTypeKey;
  title: string;
  content: unknown;
  prompt?: string;
  summary?: unknown;
}) {
  const clean =
    typeof params.summary === "string" ? params.summary.trim() : "";
  if (clean && !isPlaceholderArtifactSummary(clean)) return clean.slice(0, 320);
  const record = asRecord(
    normalizeArtifactContent(params.blueprintKey, params.content),
  );
  const about = (params.prompt ?? "")
    .match(
      /\babout\s+(.+?)(?:\.\s*(?:Give|Include|Use|Make|Add)\b|[.!?]|$)/i,
    )?.[1]
    ?.trim();
  const topic = (about || params.title || "this topic").trim();
  switch (params.blueprintKey) {
    case "quiz": {
      const count = Array.isArray(record.questions) ? record.questions.length : 0;
      return `${count || "Practice"}-question quiz about ${topic}.`.slice(0, 320);
    }
    case "flashcard_deck": {
      const count = Array.isArray(record.cards) ? record.cards.length : 0;
      return `${count || "Study"}-card deck about ${topic}.`.slice(0, 320);
    }
    case "document": {
      const blocks = Array.isArray(record.blocks) ? record.blocks.length : 0;
      return `${blocks ? `${blocks}-block` : "Structured"} document about ${topic}.`.slice(
        0,
        320,
      );
    }
    case "planner_task": {
      const description =
        typeof record.description === "string" ? record.description.trim() : "";
      return (description || `Planner task for ${topic}.`).slice(0, 320);
    }
    case "sheets": {
      const sheets = Array.isArray(record.sheets) ? record.sheets : [];
      const cells = sheets.reduce((total, sheet) => {
        if (!sheet || typeof sheet !== "object" || Array.isArray(sheet))
          return total;
        const cellMap = asRecord((sheet as Record<string, unknown>).cells);
        return total + Object.keys(cellMap).length;
      }, 0);
      return (
        cells > 0
          ? `Workbook with ${cells} filled cell${cells === 1 ? "" : "s"} about ${topic}.`
          : `Workbook about ${topic}.`
      ).slice(0, 320);
    }
    case "presentation": {
      const slides = Array.isArray(record.slides) ? record.slides.length : 0;
      return `${slides || "Presentation"}-slide deck about ${topic}.`.slice(0, 320);
    }
    case "timetable": {
      const events = Array.isArray(record.events) ? record.events.length : 0;
      return `${events || "Scheduled"}-event timetable about ${topic}.`.slice(0, 320);
    }
    case "code": {
      const files = Array.isArray(record.files) ? record.files.length : 0;
      return `${files || "Interactive"}-file code artifact about ${topic}.`.slice(
        0,
        320,
      );
    }
    case "whiteboard": {
      const nodes = Array.isArray(record.nodes) ? record.nodes.length : 0;
      return `${nodes || "Spatial"}-node whiteboard about ${topic}.`.slice(0, 320);
    }
    case "agent":
      return `Specialist agent for ${topic}.`.slice(0, 320);
    default:
      return `Created ${topic}.`.slice(0, 320);
  }
}

/** Higher = more populated; used to prefer real duplicates over hollow shells. */
export function artifactPopulationScore(
  blueprintKey: ArtifactTypeKey,
  content: unknown,
) {
  if (isHollowCreateContent(blueprintKey, content, "create")) return 0;
  const record = asRecord(normalizeArtifactContent(blueprintKey, content));
  switch (blueprintKey) {
    case "sheets": {
      const sheets = Array.isArray(record.sheets) ? record.sheets : [];
      return sheets.reduce((total, sheet) => {
        if (!sheet || typeof sheet !== "object" || Array.isArray(sheet))
          return total;
        const cells = asRecord((sheet as Record<string, unknown>).cells);
        const charts = Array.isArray((sheet as Record<string, unknown>).charts)
          ? ((sheet as Record<string, unknown>).charts as unknown[]).length
          : 0;
        return total + Object.keys(cells).length * 2 + charts;
      }, 0);
    }
    case "presentation": {
      const slides = Array.isArray(record.slides) ? record.slides : [];
      return slides.reduce((total, slide) => {
        if (!slide || typeof slide !== "object" || Array.isArray(slide))
          return total;
        const objects = Array.isArray((slide as Record<string, unknown>).objects)
          ? ((slide as Record<string, unknown>).objects as unknown[])
          : [];
        return total + Math.max(1, objects.length);
      }, 0);
    }
    case "document":
      return Array.isArray(record.blocks) ? record.blocks.length : 0;
    case "flashcard_deck":
      return Array.isArray(record.cards) ? record.cards.length : 0;
    case "quiz":
      return Array.isArray(record.questions) ? record.questions.length : 0;
    case "timetable":
      return Array.isArray(record.events) ? record.events.length : 0;
    case "whiteboard":
      return Array.isArray(record.nodes) ? record.nodes.length : 0;
    case "code":
      return Array.isArray(record.files) ? record.files.length : 0;
    case "planner_task": {
      const description =
        typeof record.description === "string" ? record.description.trim() : "";
      const subtasks = Array.isArray(record.subtasks) ? record.subtasks.length : 0;
      return (description ? 2 : 0) + subtasks;
    }
    case "agent": {
      const text = asRecord(record.instructions).text;
      return typeof text === "string" ? text.trim().length : 0;
    }
    default:
      return 1;
  }
}

export type TitleFocusCandidate = {
  id: string;
  title: string;
  blueprintKey?: ArtifactTypeKey | string;
  content?: unknown;
  summary?: unknown;
  updatedAt?: number;
};

/**
 * When several artifacts share a title, prefer the populated one. Returns all
 * top-scoring matches when they tie so callers can surface disambiguation.
 */
export function resolveFocusCandidatesByTitle(
  candidates: TitleFocusCandidate[],
  requestedTitle: string,
  options?: { blueprintKey?: ArtifactTypeKey | string },
) {
  const needle = requestedTitle.trim().toLocaleLowerCase();
  if (!needle) return [] as TitleFocusCandidate[];
  const matches = candidates.filter((candidate) => {
    if (candidate.title.trim().toLocaleLowerCase() !== needle) return false;
    if (
      options?.blueprintKey &&
      candidate.blueprintKey &&
      candidate.blueprintKey !== options.blueprintKey
    )
      return false;
    return true;
  });
  if (matches.length <= 1) return matches;
  const scored = matches.map((candidate) => {
    const key = (candidate.blueprintKey ?? "document") as ArtifactTypeKey;
    const population = artifactPopulationScore(key, candidate.content);
    const placeholder = isPlaceholderArtifactSummary(candidate.summary) ? 0 : 1;
    return {
      candidate,
      score: population * 10 + placeholder,
      updatedAt: candidate.updatedAt ?? 0,
    };
  });
  scored.sort(
    (a, b) => b.score - a.score || b.updatedAt - a.updatedAt,
  );
  const best = scored[0]!.score;
  return scored
    .filter((row) => row.score === best)
    .map((row) => row.candidate);
}
