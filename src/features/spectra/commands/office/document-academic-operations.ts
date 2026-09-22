import { z } from "zod";
import { wordNoteOperationSchemas, wordReviewOperationSchemas, type WordTextAnchor } from "../../lenses/docx-academic-schema";
import { docxProjectionBlockSchema, type DocxRichInline, type DocxProjectionBlock } from "../../lenses/projection-contracts";
import { documentContentToProseMirrorJson, documentBlocksFromJson } from "../../lenses/document-projection";
import { wordCitationOperationSchemas, wordCitationLabel, wordBibliographyText, type WordSource, type WordCitationInline } from "../../lenses/docx-citation-schema";
import { authoredSemanticValue } from "../../../../../shared/document-projection.mjs";

export const documentAcademicOperationSchema = z.discriminatedUnion("kind", [...wordNoteOperationSchemas, ...wordReviewOperationSchemas, ...wordCitationOperationSchemas]);
export const documentAcademicOperationsSchema = z.array(documentAcademicOperationSchema).min(1).max(100);
export type DocumentAcademicOperation = z.infer<typeof documentAcademicOperationSchema>;

function academicSemanticBlocks(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return documentBlocksFromJson(documentContentToProseMirrorJson(source)).map((block) => docxProjectionBlockSchema.parse(block));
}

/** Compare every authored effect in changed blocks, including rich content,
 * author labels and evidence passages. Disjoint paragraphs may still change. */
export function documentAcademicEffectsLanded(before: unknown, desired: unknown, saved: unknown) {
  const meaning = (value: unknown) => JSON.stringify(authoredSemanticValue(value));
  const prior = new Map(academicSemanticBlocks(before).map((block) => [block.id, meaning(block)]));
  const next = new Map(academicSemanticBlocks(desired).map((block) => [block.id, meaning(block)]));
  const actual = new Map(academicSemanticBlocks(saved).map((block) => [block.id, meaning(block)]));
  return [...new Set([...prior.keys(), ...next.keys()])].every((id) => prior.get(id) === next.get(id) || next.get(id) === actual.get(id));
}

function visible(item: DocxRichInline): string {
  if (item.kind === "text") return item.text;
  if (item.kind === "revision") return item.revisionKind === "ins" ? item.text : "";
  if (item.kind === "equation") return item.latex;
  if (item.kind === "image") return item.altText;
  if (item.kind === "citation" || item.kind === "bibliography") return item.text;
  return "";
}

function body(block: DocxProjectionBlock): DocxRichInline[] {
  return block.inlineContent ?? [{ kind: "text", text: block.text }];
}

function nativeNewParagraphId(seed: string) {
  let hash = 0x811c9dc5;
  for (const character of `spectra-docx-insert:${seed}`) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 0x01000193); }
  return `docx:paragraph:${((hash >>> 0) & 0x7fffffff).toString(16).padStart(8, "0")}`;
}

function split(content: DocxRichInline[], offset: number): [DocxRichInline[], DocxRichInline[]] {
  let at = 0;
  for (let index = 0; index < content.length; index++) {
    const item = content[index]!;
    if (at === offset) return [content.slice(0, index), content.slice(index)];
    const text = visible(item);
    if (at + text.length > offset) {
      if (item.kind !== "text") throw new Error("Select a boundary outside this revision, equation, citation, or image.");
      const point = offset - at;
      if (/[\uD800-\uDBFF]/u.test(text[point - 1] ?? "") && /[\uDC00-\uDFFF]/u.test(text[point] ?? "")) throw new Error("Select a whole Unicode character.");
      return [[...content.slice(0, index), { ...item, text: text.slice(0, point) }], [{ ...item, text: text.slice(point) }, ...content.slice(index + 1)]];
    }
    at += text.length;
  }
  if (at !== offset) throw new Error("The selected range is outside this paragraph. Select it again.");
  return [content, []];
}

function anchored(blocks: DocxProjectionBlock[], anchor: WordTextAnchor) {
  const found = blocks.filter((block) => block.id === anchor.regionId);
  const block = found[0];
  if (found.length !== 1 || !block || block.type === "table" || block.attrs?.nativeReadOnly) throw new Error("Select an editable paragraph with a stable identity.");
  if (body(block).map(visible).join("") !== anchor.expectedText || anchor.end > anchor.expectedText.length) throw new Error("The paragraph changed. Reload it and select the range again.");
  return block;
}

function replaceBody(block: DocxProjectionBlock, content: DocxRichInline[]) {
  if (JSON.stringify(body(block)) === JSON.stringify(content)) return;
  block.inlineContent = content;
  block.text = content.map(visible).join("");
  if (!content.length || content.every((item) => item.kind === "text" && !item.text)) delete block.inlineContent;
}

/** Shared semantic command path for human controls, K-bar and unmounted AI.
 * Pure and atomic: every fence validates on a private copy before canonical commit.
 * Native provenance stays in the document, never in membership or invitations.
 */
export function applyDocumentAcademicOperations(value: unknown, input: unknown) {
  const operations = documentAcademicOperationsSchema.parse(input);
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const blocks = (!source.tiptap && Array.isArray(source.blocks) ? source.blocks : documentBlocksFromJson(documentContentToProseMirrorJson(source))).map((block) => docxProjectionBlockSchema.parse(block));
  const binding = (source.nativeBinding ?? {}) as { wordNotes?: Array<{ id: string; type: string }>; wordComments?: Array<{ id: string }>; wordRevisions?: Array<{ id: string }> };
  const refs = () => blocks.flatMap((block) => body(block).map((item) => ({ block, item })));
  for (const operation of operations) {
    if (operation.kind === "insert-note" || operation.kind === "edit-note" || operation.kind === "move-note" || operation.kind === "delete-note") {
      const matches = refs().filter(({ item }) => item.kind === "noteRef" && item.noteType === operation.noteType && item.noteId === operation.noteId);
      if (operation.kind === "insert-note" && binding.wordNotes?.some((note) => note.type === operation.noteType && note.id === operation.noteId)) throw new Error("This native note identity already exists, including an unreferenced story. Choose a new note ID.");
      if (operation.kind === "insert-note" ? matches.length !== 0 : matches.length !== 1) throw new Error("The note identity is missing, duplicated, or already used.");
      const previous = matches[0]?.item;
      if ((operation.kind === "edit-note" || operation.kind === "delete-note") && (previous?.kind !== "noteRef" || previous.text !== operation.expectedText)) throw new Error("The note changed. Reload it before editing.");
      if (previous?.kind === "noteRef" && previous.readOnlyReason && operation.kind === "edit-note") throw new Error(previous.readOnlyReason);
      let note: DocxRichInline = previous ?? { kind: "noteRef", noteType: operation.noteType, noteId: operation.noteId, text: "" };
      if (operation.kind === "insert-note" || operation.kind === "edit-note") note = { ...note, kind: "noteRef", noteType: operation.noteType, noteId: operation.noteId, text: operation.content.map((runs) => runs.map((run) => run.text).join("")).join("\n"), content: operation.content };
      if (operation.kind === "edit-note") replaceBody(matches[0]!.block, body(matches[0]!.block).map((item) => item === previous ? note : item));
      if (operation.kind === "move-note" || operation.kind === "delete-note") replaceBody(matches[0]!.block, body(matches[0]!.block).filter((item) => item !== previous));
      if (operation.kind === "insert-note" || operation.kind === "move-note") {
        const block = anchored(blocks, operation.anchor);
        const [left, right] = split(body(block), operation.anchor.end);
        replaceBody(block, [...left, note, ...right]);
      }
    } else if (operation.kind === "add-word-comment") {
      if (binding.wordComments?.some((comment) => comment.id === operation.commentId)) throw new Error("This native comment identity already exists, including an unreferenced annotation. Choose a new comment ID.");
      if (refs().some(({ item }) => item.kind === "commentBoundary" && item.commentId === operation.commentId)) throw new Error("This native comment ID already exists.");
      const block = anchored(blocks, operation.anchor);
      const [through, right] = split(body(block), operation.anchor.end);
      const [left, middle] = split(through, operation.anchor.start);
      replaceBody(block, [...left, { kind: "commentBoundary", commentId: operation.commentId, boundary: "start", comment: operation.comment }, ...middle, { kind: "commentBoundary", commentId: operation.commentId, boundary: "end" }, { kind: "commentBoundary", commentId: operation.commentId, boundary: "reference" }, ...right]);
    } else if (operation.kind === "edit-word-comment" || operation.kind === "delete-word-comment") {
      const starts = refs().filter(({ item }) => item.kind === "commentBoundary" && item.commentId === operation.commentId && item.boundary === "start");
      const start = starts[0]?.item;
      if (starts.length !== 1 || start?.kind !== "commentBoundary" || start.comment?.text !== operation.expectedText) throw new Error("The native comment changed or its anchor is ambiguous. Reload the thread.");
      if (start.comment.readOnlyReason) throw new Error(start.comment.readOnlyReason);
      for (const block of blocks) replaceBody(block, body(block).flatMap((item) => {
        if (item.kind !== "commentBoundary" || item.commentId !== operation.commentId) return [item];
        if (operation.kind === "delete-word-comment") return [];
        return [{ ...item, ...(item.comment ? { comment: { ...item.comment, text: operation.text } } : {}) }];
      }));
    } else if (operation.kind === "track-text") {
      const block = anchored(blocks, operation.anchor);
      if (binding.wordRevisions?.some((revision) => revision.id.endsWith(`:${operation.revisionId}`))) throw new Error("This native revision ID is already in use.");
      if (refs().some(({ item }) => item.kind === "revision" && item.revisionId === operation.revisionId)) throw new Error("This revision ID already exists.");
      const [through, right] = split(body(block), operation.anchor.end);
      const [left, middle] = split(through, operation.anchor.start);
      if (middle.some((item) => item.kind !== "text" || item.href || Object.entries(item.format ?? {}).some(([key, value]) => !["bold", "italic", "underline"].includes(key) && value !== false && value != null && !(key === "fontFamily" && value === "Calibri") && !(key === "fontSizePoints" && value === 11)))) throw new Error("Select ordinary text with bold, italic or single underline formatting. Review other native formatting in Word.");
      const original = middle.map(visible).join("");
      const revisions: DocxRichInline[] = [];
      const common = { kind: "revision" as const, revisionId: operation.revisionId, author: operation.provenance.author, ...(operation.provenance.date ? { date: operation.provenance.date } : {}) };
      if (original) revisions.push({ ...common, revisionKind: "del", text: original, content: middle.flatMap((item) => item.kind === "text" ? [{ text: item.text, ...(item.format?.bold ? { bold: true } : {}), ...(item.format?.italic ? { italic: true } : {}), ...(item.format?.underline ? { underline: true } : {}) }] : []) });
      if (operation.replacement) revisions.push({ ...common, revisionKind: "ins", text: operation.replacement });
      replaceBody(block, [...left, ...revisions, ...right]);
    } else if (operation.kind === "review-revision") {
      const block = blocks.find((block) => block.id === operation.regionId);
      const matches = block && body(block).filter((item) => item.kind === "revision" && item.revisionKind === operation.revisionKind && item.revisionId === operation.revisionId);
      const revision = matches?.[0];
      if (!block || matches?.length !== 1 || revision?.kind !== "revision" || revision.text !== operation.expectedText) throw new Error("The revision changed. Reload it before reviewing.");
      const keep = revision.revisionKind === "ins" ? operation.decision === "accept" : operation.decision === "reject";
      replaceBody(block, body(block).flatMap((item) => item !== revision ? [item] : keep ? (revision.content ?? [{ text: revision.text }]).map(({ text, ...format }) => ({ kind: "text" as const, text, ...(Object.keys(format).length ? { format } : {}) })) : []));
    } else if (operation.kind === "insert-word-citation") {
      if (refs().some(({ item }) => item.kind === "citation" && item.citationId === operation.citationId)) throw new Error("This citation identity already exists.");
      const block = anchored(blocks, operation.anchor);
      let metadata = operation.source;
      let sourceRef: WordCitationInline["sourceRef"];
      if (operation.sourceHandle) {
        const bundle = (source.sourceBundle ?? source) as Record<string, unknown>;
        const records = (Array.isArray(bundle.sources) ? bundle.sources : []) as Array<Record<string, unknown>>;
        const evidence = (Array.isArray(bundle.evidence) ? bundle.evidence : []) as Array<Record<string, unknown>>;
        const verified = records.find((entry) => entry.id === operation.sourceHandle!.sourceId && entry.verified === true);
        if (!verified) throw new Error("The citation needs an existing verified source handle. A model-supplied URL is not verification.");
        const passages = operation.sourceHandle.evidenceIds.map((id) => {
          const span = evidence.find((entry) => entry.id === id && entry.sourceId === verified.id);
          if (!span || typeof span.excerpt !== "string" || typeof span.excerptHash !== "string" || (span.startOffset !== undefined && Number(span.endOffset) !== Number(span.startOffset) + span.excerpt.length)) throw new Error("The evidence handle is missing or does not belong to this source.");
          return { id, excerpt: span.excerpt, excerptHash: span.excerptHash, ...(typeof span.page === "number" ? { page: span.page } : {}), ...(typeof span.startOffset === "number" ? { startOffset: span.startOffset, endOffset: Number(span.endOffset) } : {}) };
        });
        sourceRef = { sourceId: operation.sourceHandle.sourceId, evidenceIds: operation.sourceHandle.evidenceIds, passages };
        metadata = { tag: operation.source.tag, sourceType: verified.sourceType === "book" ? "Book" : verified.sourceType === "paper" ? "JournalArticle" : "DocumentFromInternetSite", title: String(verified.title ?? ""), ...(Array.isArray(verified.authors) && verified.authors.length ? { authors: verified.authors.map((name) => ({ last: String(name) })) } : {}), ...(typeof verified.publishedAt === "string" && /^\d{4}/.test(verified.publishedAt) ? { year: verified.publishedAt.slice(0, 4) } : {}), ...(typeof verified.canonicalUrl === "string" ? { url: verified.canonicalUrl } : {}) };
      }
      const item: WordCitationInline = { kind: "citation", citationId: operation.citationId, source: metadata, ...(operation.pages ? { pages: operation.pages } : {}), text: wordCitationLabel(metadata, operation.pages), ...(sourceRef ? { sourceRef } : {}) };
      const priorSource = refs().find(({ item }) => item.kind === "citation" && item.source.tag === metadata.tag)?.item;
      if (priorSource?.kind === "citation" && JSON.stringify(priorSource.source) !== JSON.stringify(metadata)) throw new Error("This source tag already has different metadata. Edit an existing citation to update that source, or use a new tag.");
      const [left, right] = split(body(block), operation.anchor.end);
      replaceBody(block, [...left, item, ...right]);
    } else if (operation.kind === "edit-word-citation" || operation.kind === "remove-word-citation") {
      const matches = refs().filter(({ item }) => item.kind === "citation" && item.citationId === operation.citationId);
      const item = matches[0]?.item;
      if (matches.length !== 1 || item?.kind !== "citation" || item.text !== operation.expectedText) throw new Error("The citation changed or its identity is ambiguous. Reload it.");
      if (operation.kind === "remove-word-citation") replaceBody(matches[0]!.block, body(matches[0]!.block).filter((candidate) => candidate !== item));
      else {
        if (operation.source.tag !== item.source.tag && refs().some(({ item: other }) => other.kind === "citation" && other.source.tag === operation.source.tag)) throw new Error("Another source owns that tag. Keep this source's tag or choose an unused tag.");
        for (const block of blocks) replaceBody(block, body(block).map((candidate) => {
          if (candidate.kind !== "citation" || candidate.source.tag !== item.source.tag) return candidate;
          const pages = candidate === item ? operation.pages : candidate.pages;
          const instruction = candidate.instruction?.replace(/(CITATION\s+)(?:"[^"\\]+"|[^\s\\]+)/i, `$1"${operation.source.tag}"`).replace(/\s+\\p\s+(?:"[^"]*"|[^\s\\]+)/i, "");
          return { kind: "citation", citationId: candidate.citationId, source: operation.source, text: wordCitationLabel(operation.source, pages), ...(pages ? { pages } : {}), ...(instruction ? { instruction: `${instruction.trimEnd()}${pages ? ` \\p "${pages.replace(/["\\]/g, "")}"` : ""} ` } : {}), ...(JSON.stringify(candidate.source) === JSON.stringify(operation.source) && candidate.sourceRef ? { sourceRef: candidate.sourceRef } : {}) };
        }));
      }
    } else if (operation.kind === "regenerate-word-bibliography") {
      const used = new Map<string, WordSource>();
      for (const { item } of refs()) if (item.kind === "citation") {
        if (used.has(item.source.tag) && JSON.stringify(used.get(item.source.tag)) !== JSON.stringify(item.source)) throw new Error("Two citations disagree about one source tag. Reconcile that source before updating References.");
        used.set(item.source.tag, item.source);
      }
      const matches = blocks.filter((block) => body(block).some((item) => item.kind === "bibliography") && (!operation.regionId || block.id === operation.regionId));
      if (matches.length > 1) throw new Error("Choose which bibliography to update.");
      if (operation.regionId && !matches.length) throw new Error("The selected bibliography no longer exists.");
      const existing = matches[0];
      if (existing && operation.expectedText !== existing.text) throw new Error("The bibliography changed. Reload it before regenerating.");
      const sources = [...used.values()];
      const item: DocxRichInline = { kind: "bibliography", sources, text: wordBibliographyText(sources) };
      if (existing) replaceBody(existing, [item]);
      else {
        const after = operation.afterRegionId ? blocks.findIndex((block) => block.id === operation.afterRegionId) : blocks.length - 1;
        if (operation.afterRegionId && after < 0) throw new Error("The bibliography insertion anchor no longer exists.");
        let seed = "bibliography"; while (blocks.some((block) => block.id === nativeNewParagraphId(seed))) seed += "-new";
        const id = source.nativeBinding ? nativeNewParagraphId(seed) : seed;
        blocks.splice(after + 1, 0, { id, type: "paragraph", text: item.text, inlineContent: [item], attrs: { paragraphFormat: { alignment: "left", lineSpacing: 1, spacingAfterPoints: 0, indentLevel: 0, border: null, shading: null } } });
      }
    }
  }
  // Cached bibliography text updates only on explicit regeneration. Its source
  // inventory always describes the currently used native source identities.
  const used = new Map<string, WordSource>();
  for (const { item } of refs()) if (item.kind === "citation") used.set(item.source.tag, item.source);
  for (const block of blocks) if (body(block).some((item) => item.kind === "bibliography")) replaceBody(block, body(block).map((item) => item.kind === "bibliography" ? { ...item, sources: [...used.values()] } : item));
  const { tiptap: _tiptap, ...rest } = source;
  return { ...rest, blocks, ...(source.nativeBinding ? { nativeProjectionComplete: true } : {}) };
}

/** Verify saved semantic effects, not merely dispatch or a nonempty document. */
export function documentAcademicOperationsLanded(value: unknown, input: unknown): boolean {
  try {
    const operations = documentAcademicOperationsSchema.parse(input);
    const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const blocks = documentBlocksFromJson(documentContentToProseMirrorJson(source)).map((block) => docxProjectionBlockSchema.parse(block));
    const refs = blocks.flatMap((block) => body(block).map((item) => ({ block, item })));
    const key = (operation: DocumentAcademicOperation) => "noteId" in operation ? `note:${operation.noteType}:${operation.noteId}` : "commentId" in operation ? `comment:${operation.commentId}` : "citationId" in operation ? `citation:${operation.citationId}` : "revisionId" in operation ? `revision:${operation.revisionId}:${"revisionKind" in operation ? operation.revisionKind : "both"}` : "bibliography";
    return operations.every((operation, index) => {
      if (operations.slice(index + 1).some((later) => key(later) === key(operation))) return true;
      if ("noteId" in operation) {
        const found = refs.filter(({ item }) => item.kind === "noteRef" && item.noteType === operation.noteType && item.noteId === operation.noteId);
        if (operation.kind === "delete-note") return !found.length;
        if (found.length !== 1 || found[0]!.item.kind !== "noteRef") return false;
        if (operation.kind === "move-note") return found[0]!.block.id === operation.anchor.regionId;
        return found[0]!.item.text === operation.content.map((runs) => runs.map((run) => run.text).join("")).join("\n");
      }
      if ("commentId" in operation) {
        const found = refs.filter(({ item }) => item.kind === "commentBoundary" && item.commentId === operation.commentId);
        if (operation.kind === "delete-word-comment") return !found.length;
        const start = found.find(({ item }) => item.kind === "commentBoundary" && item.boundary === "start")?.item;
        return found.length === 3 && start?.kind === "commentBoundary" && start.comment?.text === (operation.kind === "add-word-comment" ? operation.comment.text : operation.text);
      }
      if (operation.kind === "track-text") {
        if (operations.slice(index + 1).some((later) => later.kind === "review-revision" && later.revisionId === operation.revisionId)) return true;
        const marks = refs.flatMap(({ item }) => item.kind === "revision" && item.revisionId === operation.revisionId ? [item] : []);
        const old = operation.anchor.expectedText.slice(operation.anchor.start, operation.anchor.end);
        return (!old || marks.some((item) => item.revisionKind === "del" && item.text === old)) && (!operation.replacement || marks.some((item) => item.revisionKind === "ins" && item.text === operation.replacement));
      }
      if (operation.kind === "review-revision") return !refs.some(({ item }) => item.kind === "revision" && item.revisionKind === operation.revisionKind && item.revisionId === operation.revisionId);
      if ("citationId" in operation) {
        const found = refs.flatMap(({ item }) => item.kind === "citation" && item.citationId === operation.citationId ? [item] : []);
        if (operation.kind === "remove-word-citation") return !found.length;
        return found.length === 1 && found[0]!.source.tag === operation.source.tag && (operation.kind !== "insert-word-citation" || !operation.sourceHandle || (found[0]!.sourceRef?.sourceId === operation.sourceHandle.sourceId && operation.sourceHandle.evidenceIds.every((id) => found[0]!.sourceRef?.evidenceIds.includes(id))));
      }
      const found = refs.flatMap(({ item }) => item.kind === "bibliography" ? [item] : []);
      return found.length > 0 && found.some((item) => item.text === wordBibliographyText(item.sources));
    });
  } catch { return false; }
}
