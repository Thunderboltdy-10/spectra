import { z } from "zod";

/** Native author labels are provenance, never Spectra account identifiers. */
export const wordAuthorSchema = z.object({
  author: z.string().min(1).max(400),
  initials: z.string().max(40).optional(),
  date: z.string().datetime({ offset: true }).optional(),
}).strict();

export const wordNoteContentSchema = z.array(z.array(z.object({
  text: z.string().max(100_000),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
}).strict()).max(1_000)).min(1).max(1_000);

export const MAX_WORD_NOTE_ID = 32_767;
const MAX_LEGACY_WORD_NOTE_ID = 2_147_483_647;

export const wordNoteIdSchema = z.string().regex(/^[1-9][0-9]{0,4}$/).refine(
  (value) => Number(value) <= MAX_WORD_NOTE_ID,
  "Word note identifiers must be positive Word-compatible IDs (1–32767); separators are reserved.",
);

/** Existing imported IDs may exceed Word's range; allow deleting them so a
 * damaged legacy note can be cleaned up without creating or moving another. */
export const existingWordNoteIdSchema = z.string().regex(/^[1-9][0-9]{0,9}$/).refine(
  (value) => Number(value) <= MAX_LEGACY_WORD_NOTE_ID,
  "An imported Word note identifier is outside the supported decimal range.",
);

/** Pick an unused positive ID within Word's ST_DecimalNumber bound. */
export function nextWordNoteId(usedIds: readonly string[], entropy: number) {
  const used = new Set(usedIds);
  if (used.size >= MAX_WORD_NOTE_ID)
    throw new Error("This document has no free Word footnote or endnote identifiers.");
  const start = (Math.trunc(Number.isFinite(entropy) ? entropy : 0) >>> 0) % MAX_WORD_NOTE_ID;
  for (let offset = 0; offset < MAX_WORD_NOTE_ID; offset += 1) {
    const candidate = String(((start + offset) % MAX_WORD_NOTE_ID) + 1);
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("This document has no free Word footnote or endnote identifiers.");
}

/** UTF-16 offsets, matching ProseMirror. expectedText fences anchor rebasing. */
export const wordTextAnchorSchema = z.object({
  regionId: z.string().min(1).max(300),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  expectedText: z.string().max(2_000_000),
}).strict().refine((value) => value.end >= value.start, "The range ends before it starts.");

export const wordNoteOperationSchemas = [
  z.object({ kind: z.literal("insert-note"), anchor: wordTextAnchorSchema, noteType: z.enum(["footnote", "endnote"]), noteId: wordNoteIdSchema, content: wordNoteContentSchema }).strict(),
  z.object({ kind: z.literal("edit-note"), noteType: z.enum(["footnote", "endnote"]), noteId: wordNoteIdSchema, expectedText: z.string().max(100_000), content: wordNoteContentSchema }).strict(),
  z.object({ kind: z.literal("move-note"), noteType: z.enum(["footnote", "endnote"]), noteId: wordNoteIdSchema, anchor: wordTextAnchorSchema }).strict(),
  z.object({ kind: z.literal("delete-note"), noteType: z.enum(["footnote", "endnote"]), noteId: existingWordNoteIdSchema, expectedText: z.string().max(100_000) }).strict(),
] as const;

export type WordNoteContent = z.infer<typeof wordNoteContentSchema>;
export type WordTextAnchor = z.infer<typeof wordTextAnchorSchema>;

export const wordCommentDataSchema = wordAuthorSchema.extend({
  text: z.string().max(100_000),
  readOnlyReason: z.string().max(2_000).optional(),
}).strict();

export const wordCommentBoundarySchema = z.object({
  kind: z.literal("commentBoundary"),
  commentId: z.string().regex(/^[0-9]{1,10}$/),
  boundary: z.enum(["start", "end", "reference"]),
  comment: wordCommentDataSchema.optional(),
}).strict();

export const wordRevisionInlineSchema = z.object({
  kind: z.literal("revision"),
  revisionId: z.string().regex(/^[0-9]{1,10}$/),
  revisionKind: z.enum(["ins", "del"]),
  author: z.string().max(400),
  date: z.string().max(80).optional(),
  text: z.string().max(100_000),
  content: wordNoteContentSchema.element.optional(),
}).strict();

export const wordReviewOperationSchemas = [
  z.object({ kind: z.literal("add-word-comment"), anchor: wordTextAnchorSchema, commentId: z.string().regex(/^[0-9]{1,10}$/), comment: wordCommentDataSchema }).strict(),
  z.object({ kind: z.literal("edit-word-comment"), commentId: z.string().regex(/^[0-9]{1,10}$/), expectedText: z.string().max(100_000), text: z.string().max(100_000) }).strict(),
  z.object({ kind: z.literal("delete-word-comment"), commentId: z.string().regex(/^[0-9]{1,10}$/), expectedText: z.string().max(100_000) }).strict(),
  z.object({ kind: z.literal("track-text"), anchor: wordTextAnchorSchema, revisionId: z.string().regex(/^[0-9]{1,10}$/), replacement: z.string().max(100_000), provenance: wordAuthorSchema }).strict(),
  z.object({ kind: z.literal("review-revision"), regionId: z.string().min(1).max(300), revisionId: z.string().regex(/^[0-9]{1,10}$/), revisionKind: z.enum(["ins", "del"]), expectedText: z.string().max(100_000), decision: z.enum(["accept", "reject"]) }).strict(),
] as const;

export type WordCommentData = z.infer<typeof wordCommentDataSchema>;
export type WordRevisionInline = z.infer<typeof wordRevisionInlineSchema>;
