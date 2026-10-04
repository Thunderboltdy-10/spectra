/**
 * Pure chunk builders for the semantic index. Region ids follow the artifact registry
 * (src/features/spectra/artifacts/registry.ts) so a result can open the exact block, slide,
 * sheet range, board frame, card, question or file. Every chunk's embedding text starts with the
 * item title, so a passage is never embedded without knowing what it belongs to.
 */
import { sheetCellEntries } from "./sheet-cells";

export const CHUNK_TARGET_CHARS = 1_200;
export const CHUNK_MAX_CHARS = 2_000;
/** Long items keep their first chunks; the rest stays reachable through the title chunk and full-text. */
export const MAX_CHUNKS_PER_ITEM = 160;
const MAX_THREAD_MESSAGES = 400;
const MAX_SHEET_CELLS = 6_000;

export type ChunkDraft = {
  /** Stable within the item: the first region (or message) the chunk covers. */
  chunkKey: string;
  regionId?: string;
  messageId?: string;
  /** Where in the item, for people: "Slide 3: Results", "Sheet 1 A1:F40", "Heading: Methods". */
  label?: string;
  text: string;
  /** Only the item's owner may find this passage (quiz answers, private timetable details). */
  ownerOnly?: boolean;
};

export type SemanticChunk = ChunkDraft & {
  ordinal: number;
  /** What is embedded: title, label and passage. */
  embedText: string;
  /** What full-text search indexes: the same words, lower-cased and without accents. */
  searchText: string;
  contentHash: string;
};

type Unit = { regionId?: string; messageId?: string; label?: string; text: string; boundary?: boolean };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown) => Array.isArray(value) ? value.map(record) : [];
const str = (value: unknown) => typeof value === "string" ? value : "";

/** Lower-case and strip accents so "fotosíntesis" and "Fotosintesis" match. */
export function foldForSearch(text: string) {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

export function plainText(value: unknown) {
  return str(value)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

const SKIP_KEYS = new Set(["id", "type", "style", "color", "src", "url", "href", "fill", "stroke", "fontFamily",
  "pageId", "layerId", "frameId", "parentId", "storageId", "assetId", "mimeType", "provenance", "regionId"]);

/** Readable strings inside an unknown value (slide object content, board node content). */
export function collectText(value: unknown, budget = 4_000, depth = 0): string {
  if (budget <= 0 || depth > 6) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || /^(https?:|data:|#[0-9a-f]{3,8}$)/i.test(trimmed)) return "";
    return plainText(trimmed).slice(0, budget);
  }
  const parts: string[] = [];
  let remaining = budget;
  const push = (text: string) => { if (text) { parts.push(text); remaining -= text.length + 1; } };
  if (Array.isArray(value)) for (const item of value) { if (remaining <= 0) break; push(collectText(item, remaining, depth + 1)); }
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (remaining <= 0) break;
      if (!SKIP_KEYS.has(key)) push(collectText(item, remaining, depth + 1));
    }
  return parts.join(" ").slice(0, budget);
}

function splitLong(text: string, max = CHUNK_MAX_CHARS) {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf(" "));
    const at = cut > max * 0.5 ? cut + 1 : max;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at);
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

/**
 * Greedy packing in reading order. A boundary unit (heading, slide, frame, sheet) starts a new chunk,
 * so an edit only re-embeds the chunk it lands in; a long unit is split into parts.
 */
function pack(units: Unit[], target = CHUNK_TARGET_CHARS): ChunkDraft[] {
  const drafts: ChunkDraft[] = [];
  let current: { first: Unit; texts: string[]; size: number } | null = null;
  const flush = () => {
    if (current && current.texts.join("").trim())
      drafts.push({ chunkKey: current.first.regionId ?? current.first.messageId ?? `part-${drafts.length + 1}`,
        regionId: current.first.regionId, messageId: current.first.messageId, label: current.first.label,
        text: current.texts.join("\n").trim() });
    current = null;
  };
  for (const unit of units) {
    const text = unit.text.trim();
    if (!text) continue;
    if (text.length > CHUNK_MAX_CHARS) {
      flush();
      splitLong(text).forEach((part, index) => drafts.push({
        chunkKey: `${unit.regionId ?? unit.messageId ?? `part-${drafts.length + 1}`}${index ? `#${index + 1}` : ""}`,
        regionId: unit.regionId, messageId: unit.messageId, label: unit.label, text: part,
      }));
      continue;
    }
    if (current && (unit.boundary || current.size + text.length > target)) flush();
    current ??= { first: unit, texts: [], size: 0 };
    current.texts.push(text);
    current.size += text.length + 1;
  }
  flush();
  return dedupeKeys(drafts);
}

function dedupeKeys(drafts: ChunkDraft[]) {
  const seen = new Map<string, number>();
  return drafts.map((draft) => {
    const count = seen.get(draft.chunkKey) ?? 0;
    seen.set(draft.chunkKey, count + 1);
    return count ? { ...draft, chunkKey: `${draft.chunkKey}~${count + 1}` } : draft;
  });
}

const excerpt = (text: string, length = 60) => {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
};

export const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  document: "Document", presentation: "Slides", sheets: "Sheet", whiteboard: "Whiteboard",
  flashcard_deck: "Flashcards", quiz: "Quiz", planner_task: "Task", code: "Code", agent: "Agent",
  timetable: "Timetable",
};

/** A readable label for any artifact type, including ones added after this file. */
export function artifactTypeLabel(blueprintKey: string) {
  return ARTIFACT_TYPE_LABELS[blueprintKey] ??
    (blueprintKey.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase()) || "Item");
}

/**
 * Types whose body other people never read in full: shared quizzes are projected without answers
 * and shared timetables without private details (convex/authority.ts), so only the owner may find
 * their body passages. Title, summary and tags stay findable by everyone who can open the item.
 */
const OWNER_ONLY_BODY = new Set(["quiz", "timetable"]);

/** Any other content shape: each top-level list entry is a unit, so new artifact types are indexed too. */
function genericUnits(content: Record<string, unknown>): Unit[] {
  const units: Unit[] = [];
  for (const [key, value] of Object.entries(content)) {
    if (SKIP_KEYS.has(key)) continue;
    if (Array.isArray(value))
      value.forEach((entry, index) => {
        const id = str(record(entry).id);
        units.push({ regionId: id || undefined, label: id ? undefined : `${key} ${index + 1}`, text: collectText(entry, CHUNK_MAX_CHARS * 2) });
      });
    else units.push({ text: collectText(value, CHUNK_MAX_CHARS * 4), boundary: true });
    if (units.length > MAX_CHUNKS_PER_ITEM * 4) break;
  }
  return units;
}

function columnIndex(letters: string) {
  return letters.split("").reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) - 1;
}
function columnLetters(index: number) {
  let value = index + 1;
  let letters = "";
  while (value > 0) { const rem = (value - 1) % 26; letters = String.fromCharCode(65 + rem) + letters; value = Math.floor((value - 1) / 26); }
  return letters;
}
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  const cell = record(value);
  const shown = cell.value ?? cell.displayValue ?? cell.v;
  return shown === undefined || shown === null ? str(cell.formula) : typeof shown === "object" ? "" : String(shown);
}

function sheetUnits(content: Record<string, unknown>): Unit[] {
  const units: Unit[] = [];
  for (const [sheetIndex, sheet] of rows(content.sheets).entries()) {
    const sheetId = str(sheet.id) || `sheet-${sheetIndex + 1}`;
    const name = str(sheet.name) || `Sheet ${sheetIndex + 1}`;
    const rowIdentities = record(sheet.rowIdentities);
    const byRow = new Map<number, Array<[number, string]>>();
    for (const [address, value] of sheetCellEntries(sheet.cells, MAX_SHEET_CELLS)) {
      const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(address);
      const text = cellText(value).trim();
      if (!match || !text) continue;
      const row = Number(match[2]) - 1;
      const list = byRow.get(row) ?? [];
      list.push([columnIndex(match[1]!), text.slice(0, 300)]);
      byRow.set(row, list);
    }
    const ordered = [...byRow.entries()].sort((a, b) => a[0] - b[0]);
    if (!ordered.length) { units.push({ regionId: sheetId, label: name, text: name, boundary: true }); continue; }
    // A range chunk repeats the header row so numbers keep their meaning.
    const header = ordered[0]![1].sort((a, b) => a[0] - b[0]).map(([, text]) => text).join(" · ");
    let start = 0;
    while (start < ordered.length) {
      let size = 0;
      let end = start;
      const lines: string[] = [];
      let maxColumn = 0;
      while (end < ordered.length && (size < CHUNK_TARGET_CHARS || end === start)) {
        const cells = ordered[end]![1].sort((a, b) => a[0] - b[0]);
        maxColumn = Math.max(maxColumn, ...cells.map(([column]) => column));
        const line = cells.map(([, text]) => text).join(" · ");
        lines.push(line);
        size += line.length + 1;
        end += 1;
      }
      const firstRow = ordered[start]![0];
      const lastRow = ordered[end - 1]![0];
      const range = `A${firstRow + 1}:${columnLetters(maxColumn)}${lastRow + 1}`;
      const regionId = str(rowIdentities[String(firstRow)]) || `${sheetId}:row:${firstRow + 1}`;
      const text = (start > 0 ? `${header}\n` : "") + lines.join("\n");
      units.push({ regionId: start === 0 ? sheetId : regionId, label: `${name} ${range}`, text, boundary: true });
      start = end;
    }
  }
  return units;
}

function whiteboardUnits(content: Record<string, unknown>): Unit[] {
  const nodes = rows(content.nodes).filter((node) => node.hidden !== true);
  const frames = new Map(nodes.filter((node) => node.type === "frame").map((node) => [str(node.id), node]));
  const groups = new Map<string, Unit[]>();
  const frameLabel = (frame: Record<string, unknown>) =>
    str(frame.semanticLabel) || collectText(frame.content, 120) || "Frame";
  for (const node of nodes) {
    const id = str(node.id);
    const frameId = node.type === "frame" ? id : str(node.frameId) || "";
    const frame = frames.get(frameId);
    const text = [str(node.semanticLabel), node.type === "frame" ? "" : collectText(node.content, 1_500)]
      .filter(Boolean).join(": ");
    if (!text) continue;
    const key = frame ? frameId : `page:${str(node.pageId)}`;
    const list = groups.get(key) ?? [];
    list.push({ regionId: frame ? frameId : id, label: frame ? `Frame: ${excerpt(frameLabel(frame), 48)}` : undefined, text });
    groups.set(key, list);
  }
  for (const frame of frames.values()) if (!groups.has(str(frame.id))) {
    const label = frameLabel(frame);
    if (label !== "Frame") groups.set(str(frame.id), [{ regionId: str(frame.id), label: `Frame: ${excerpt(label, 48)}`, text: label }]);
  }
  const units: Unit[] = [];
  for (const list of groups.values()) list.forEach((unit, index) => units.push({ ...unit, boundary: index === 0 }));
  const edgeLabels = rows(content.edges).map((edge) => collectText(edge.label ?? edge.content, 200)).filter(Boolean);
  if (edgeLabels.length) units.push({ regionId: str(rows(content.edges)[0]?.id) || undefined, label: "Connectors", text: edgeLabels.join(" · "), boundary: true });
  return units;
}

function artifactUnits(blueprintKey: string, content: Record<string, unknown>): Unit[] | null {
  switch (blueprintKey) {
    case "document": {
      let heading: string | undefined;
      return rows(content.blocks).map((block, index) => {
        const id = str(block.id) || `block-${index + 1}`;
        const isHeading = block.type === "heading";
        const tableText = block.type === "table"
          ? rows(block.rows).map((row) => rows(row.cells).map((cell) => plainText(cell.text)).join(" · ")).join("\n") : "";
        const text = [plainText(block.text), tableText].filter(Boolean).join("\n");
        if (isHeading && text) heading = excerpt(text, 60);
        return { regionId: id, label: heading ? `Heading: ${heading}` : undefined, text, boundary: isHeading };
      });
    }
    case "presentation":
      return rows(content.slides).map((slide, index) => {
        const title = str(slide.title);
        const objects = rows(slide.objects).map((object) => collectText(object.content, 1_500)).filter(Boolean);
        const notes = plainText(slide.speakerNotes);
        return { regionId: str(slide.id) || `slide-${index + 1}`,
          label: `Slide ${index + 1}${title ? `: ${excerpt(title, 48)}` : ""}`,
          text: [title, ...objects, notes ? `Speaker notes: ${notes}` : ""].filter(Boolean).join("\n"), boundary: true };
      });
    case "sheets": return sheetUnits(content);
    case "whiteboard": return whiteboardUnits(content);
    case "flashcard_deck":
      return rows(content.cards).map((card, index) => ({ regionId: str(card.id) || `card-${index + 1}`,
        label: `Card ${index + 1}`,
        text: [plainText(card.front), plainText(card.back), plainText(card.hint), plainText(card.explanation)].filter(Boolean).join(" — ") }));
    case "quiz":
      return [
        { regionId: "quiz-setting:instructions", label: "Instructions", text: plainText(record(content.settings).instructions) },
        ...rows(content.questions).map((question, index) => ({ regionId: str(question.id) || `question-${index + 1}`,
          label: `Question ${index + 1}`,
          text: [plainText(question.prompt), (Array.isArray(question.options) ? question.options : []).map(str).filter(Boolean).join(" · "),
            plainText(question.explanation)].filter(Boolean).join("\n") })),
      ];
    case "planner_task":
      return [
        { regionId: "task:taskTitle", label: "Task", text: str(content.taskTitle) },
        { regionId: "task:description", label: "Description", text: plainText(content.description) },
        { regionId: "task:progressNote", label: "Progress", text: plainText(content.progressNote) },
        ...rows(content.subtasks).map((subtask, index) => ({
          regionId: `task:subtask:${str(subtask.id) || `subtask-${index + 1}`}:title`, label: "Subtasks", text: str(subtask.title) })),
      ];
    case "code":
      return rows(content.files).map((file, index) => ({ regionId: str(file.id) || `file-${index + 1}`,
        label: str(file.path) || `File ${index + 1}`, text: `${str(file.path)}\n${str(file.source)}`.slice(0, CHUNK_MAX_CHARS * 6), boundary: true }));
    case "agent": {
      const profile = record(content.profile);
      const routing = record(content.routing);
      return [
        { regionId: "agent:profile", label: "Purpose", text: [str(profile.purpose), ...(Array.isArray(profile.outcomes) ? profile.outcomes.map(str) : [])].filter(Boolean).join("\n") },
        { regionId: "agent-instructions", label: "Instructions", text: plainText(record(content.instructions).text), boundary: true },
        { regionId: "agent:routing", label: "When to use", text: [str(routing.description), ...(Array.isArray(routing.examples) ? routing.examples.map((example) => collectText(example)) : [])].filter(Boolean).join("\n"), boundary: true },
      ];
    }
    case "timetable":
      return rows(content.events).map((event, index) => ({ regionId: str(event.id) || `event-${index + 1}`,
        label: str(event.title) || `Event ${index + 1}`,
        text: [str(event.title), str(event.location), str(event.teacher), plainText(event.notes)].filter(Boolean).join(" · ") }));
    default:
      return null;
  }
}

export type ArtifactChunkSource = {
  blueprintKey: string;
  title: string;
  summary?: string;
  tags?: string[];
  /** Inline content, already resolved from a durable ref by the caller, or undefined. */
  content?: unknown;
  /** Fallback text when the content shape is unknown or could not be loaded. */
  textIndex?: string;
};

/** Title chunk first, then the content in reading order. */
export function artifactChunkDrafts(source: ArtifactChunkSource): ChunkDraft[] {
  const typeLabel = artifactTypeLabel(source.blueprintKey);
  const titleChunk: ChunkDraft = { chunkKey: "title", text: [
    `${typeLabel}.`, source.summary?.trim(), source.tags?.length ? `Tags: ${source.tags.join(", ")}` : "",
  ].filter(Boolean).join(" ") };
  let units: Unit[] | null = null;
  try {
    const content = source.content && typeof source.content === "object" ? record(source.content) : null;
    units = content ? artifactUnits(source.blueprintKey, content) ?? genericUnits(content) : null;
  } catch {
    units = null;
  }
  let body = units ? pack(units) : [];
  if (!body.length && source.textIndex?.trim())
    body = pack(splitLong(source.textIndex).map((text, index) => ({ text, boundary: index > 0 })));
  const ownerOnly = OWNER_ONLY_BODY.has(source.blueprintKey);
  return [titleChunk, ...body.filter((draft) => draft.chunkKey !== "title").map((draft) => ownerOnly ? { ...draft, ownerOnly } : draft)]
    .slice(0, MAX_CHUNKS_PER_ITEM);
}

export type ThreadChunkSource = {
  title: string;
  summaryShort?: string;
  summaryLong?: string;
  /** In conversation order. Tool and system messages are skipped. */
  messages: Array<{ id: string; role: string; content: string }>;
};

/** One chunk per message; very short messages join the next one so "yes, do that" keeps its context. */
export function threadChunkDrafts(source: ThreadChunkSource): ChunkDraft[] {
  const titleChunk: ChunkDraft = { chunkKey: "title",
    text: [source.summaryShort, source.summaryLong].map((text) => text?.trim()).filter(Boolean).join("\n") || "Conversation." };
  const messages = source.messages.filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MAX_THREAD_MESSAGES);
  const drafts: ChunkDraft[] = [];
  let carry: { id: string; text: string } | null = null;
  for (const message of messages) {
    const text = plainText(message.content).slice(0, CHUNK_MAX_CHARS * 4);
    if (!text) continue;
    const who = message.role === "user" ? "You" : "Spectra";
    const combined: string = carry ? `${carry.text}\n${who}: ${text}` : `${who}: ${text}`;
    const id: string = carry?.id ?? message.id;
    if (combined.length < 160) { carry = { id, text: combined }; continue; }
    carry = null;
    splitLong(combined).forEach((part, index) => drafts.push({
      chunkKey: `m:${id}${index ? `#${index + 1}` : ""}`, messageId: id, text: part }));
  }
  if (carry) drafts.push({ chunkKey: `m:${carry.id}`, messageId: carry.id, text: carry.text });
  // The newest conversation matters most when a thread is longer than the chunk cap.
  return [titleChunk, ...drafts.slice(-(MAX_CHUNKS_PER_ITEM - 1))];
}

export type EventChunkSource = {
  title: string; kind: string; startAt?: number; endAt?: number; allDay?: boolean;
  location?: string; teacher?: string; notes?: string;
};

export function eventChunkDrafts(source: EventChunkSource): ChunkDraft[] {
  const date = typeof source.startAt === "number" && Number.isFinite(source.startAt)
    ? new Date(source.startAt).toISOString().slice(0, 10) : "";
  const kind = source.kind.replaceAll("_", " ");
  return [{ chunkKey: "title", text: [
    `Calendar ${kind}${date ? ` on ${date}` : ""}.`,
    source.location ? `Location: ${source.location}.` : "", source.teacher ? `Teacher: ${source.teacher}.` : "",
    plainText(source.notes).slice(0, CHUNK_MAX_CHARS),
  ].filter(Boolean).join(" ") }];
}

/**
 * School data is indexed by default, so new record types (CAS entries, announcements) are
 * searchable once they sync. These are not useful to search: people, enrolment rows and
 * attendance marks.
 */
const SCHOOL_RECORD_NOT_INDEXED = new Set(["person", "membership", "attendance", "identity", "enrollment", "enrolment"]);
export const schoolRecordTypeIndexed = (recordType: string) => !SCHOOL_RECORD_NOT_INDEXED.has(recordType);

const SCHOOL_RECORD_LABELS: Record<string, string> = {
  class: "Class", course: "Class", class_resource: "Class resource", school_resource: "School resource", resource: "Resource",
  file: "File", task: "Task", assignment: "Assignment", deadline: "Deadline", assessment: "Assessment",
  grade: "Grade", feedback: "Feedback", announcement: "Announcement", discussion: "Discussion", message: "Message",
  timetable: "Timetable", timetable_event: "Lesson", lesson: "Lesson", class_event: "Class event", calendar_event: "School event",
  cas_experience: "CAS experience", cas_reflection: "CAS reflection", cas_evidence: "CAS evidence",
  submission: "Submission", task_result: "Grade",
};
export function schoolRecordTypeLabel(recordType: string) {
  return SCHOOL_RECORD_LABELS[recordType] ?? (recordType.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase()) || "School item");
}

export function schoolRecordTitle(normalized: unknown, recordType: string) {
  const value = record(normalized);
  return (str(value.title) || str(value.name) || str(value.subject) || schoolRecordTypeLabel(recordType)).slice(0, 240);
}

/** Due date or start of a school item, when it has one. */
export function schoolRecordTimeAt(normalized: unknown) {
  const value = record(normalized);
  for (const field of ["dueAt", "deadlineAt", "startAt", "startsAt", "date"]) {
    const raw = value[field];
    const time = typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : Number.NaN;
    if (Number.isFinite(time)) return time;
  }
  return undefined;
}

const SCHOOL_HEAD_FIELDS = new Set(["title", "name", "subject", "className", "description", "notes", "body", "dueAt", "deadlineAt",
  "startAt", "startsAt", "endAt", "date"]);

export function schoolRecordChunkDrafts(recordType: string, normalized: unknown): ChunkDraft[] {
  const value = record(normalized);
  const time = schoolRecordTimeAt(value);
  const head = [`School ${schoolRecordTypeLabel(recordType).toLowerCase()}.`, str(value.className) || str(value.subject),
    time !== undefined ? `Due ${new Date(time).toISOString().slice(0, 10)}.` : ""].filter(Boolean).join(" ");
  const extra = Object.fromEntries(Object.entries(value).filter(([key]) => !SCHOOL_HEAD_FIELDS.has(key)));
  const body = [plainText(value.description ?? value.notes ?? value.body), collectText(extra, CHUNK_MAX_CHARS)].filter(Boolean).join("\n");
  const parts = splitLong(body);
  return [{ chunkKey: "title", text: [head, parts[0] ?? ""].filter(Boolean).join("\n") },
    ...parts.slice(1, 8).map((text, index) => ({ chunkKey: `body#${index + 2}`, text }))];
}

/** What the indexer chunks, per builder. A new source kind adds a builder here or reuses one. */
export type ChunkInput =
  | ({ builder: "artifact" } & ArtifactChunkSource)
  | ({ builder: "thread" } & ThreadChunkSource)
  | ({ builder: "event" } & EventChunkSource)
  | { builder: "school"; recordType: string; normalized: unknown };

export function chunkDrafts(input: ChunkInput): ChunkDraft[] {
  switch (input.builder) {
    case "artifact": return artifactChunkDrafts(input);
    case "thread": return threadChunkDrafts(input);
    case "event": return eventChunkDrafts(input);
    case "school": return schoolRecordChunkDrafts(input.recordType, input.normalized);
  }
}

/** Under the provider's input bound (convex/embeddingProvider.ts) with room to spare. */
export const EMBED_TEXT_MAX_BYTES = 7_600;

export function fitBytes(text: string, maxBytes: number) {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maxBytes) return text;
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && encoder.encode(text.slice(0, end)).byteLength > maxBytes) end = Math.floor(end * 0.9);
  return text.slice(0, end);
}

export async function sha256Hex(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Adds the title context, the folded search text and a content hash to each draft. */
export async function finalizeChunks(title: string, drafts: ChunkDraft[]): Promise<SemanticChunk[]> {
  const cleanTitle = title.trim() || "Untitled";
  return Promise.all(drafts.map(async (draft, ordinal) => {
    const embedText = fitBytes([cleanTitle.slice(0, 300), draft.label, draft.text].filter(Boolean).join("\n"), EMBED_TEXT_MAX_BYTES);
    return { ...draft, ordinal, embedText, searchText: foldForSearch(embedText), contentHash: (await sha256Hex(embedText)).slice(0, 32) };
  }));
}
