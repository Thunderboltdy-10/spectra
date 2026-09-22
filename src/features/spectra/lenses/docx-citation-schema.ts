import { z } from "zod";
import { wordTextAnchorSchema } from "./docx-academic-schema";

export const wordSourceSchema = z.object({
  tag: z.string().regex(/^[^\s"\\]{1,64}$/u),
  sourceType: z.enum(["Book", "JournalArticle", "DocumentFromInternetSite", "Report", "Misc"]),
  title: z.string().max(2_000),
  authors: z.array(z.object({ first: z.string().max(400).optional(), middle: z.string().max(400).optional(), last: z.string().max(400) }).strict()).max(50).optional(),
  corporate: z.string().max(400).optional(),
  year: z.string().max(20).optional(),
  city: z.string().max(400).optional(),
  publisher: z.string().max(400).optional(),
  journal: z.string().max(400).optional(),
  volume: z.string().max(80).optional(),
  issue: z.string().max(80).optional(),
  pages: z.string().max(100).optional(),
  url: z.string().max(4_000).optional(),
  doi: z.string().max(400).optional(),
}).strict();

export const wordSourceReferenceSchema = z.object({
  sourceId: z.string().min(1).max(300),
  evidenceIds: z.array(z.string().min(1).max(300)).max(100),
  passages: z.array(z.object({ id: z.string().min(1).max(300), page: z.number().int().positive().optional(), startOffset: z.number().int().nonnegative().optional(), endOffset: z.number().int().nonnegative().optional(), excerpt: z.string().max(8_000), excerptHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(100),
}).strict();

export const wordCitationInlineSchema = z.object({
  kind: z.literal("citation"),
  citationId: z.string().min(1).max(300),
  source: wordSourceSchema,
  pages: z.string().max(100).optional(),
  text: z.string().max(10_000),
  instruction: z.string().max(2_000).optional(),
  sourceRef: wordSourceReferenceSchema.optional(),
}).strict();

export const wordBibliographyInlineSchema = z.object({
  kind: z.literal("bibliography"),
  sources: z.array(wordSourceSchema).max(500),
  text: z.string().max(100_000),
}).strict();

export const wordCitationOperationSchemas = [
  z.object({ kind: z.literal("insert-word-citation"), anchor: wordTextAnchorSchema, citationId: z.string().min(1).max(300), source: wordSourceSchema, sourceHandle: z.object({ sourceId: z.string().min(1), evidenceIds: z.array(z.string().min(1)).min(1).max(100) }).strict().optional(), pages: z.string().max(100).optional() }).strict(),
  z.object({ kind: z.literal("edit-word-citation"), citationId: z.string().min(1).max(300), expectedText: z.string().max(10_000), source: wordSourceSchema, pages: z.string().max(100).optional() }).strict(),
  z.object({ kind: z.literal("remove-word-citation"), citationId: z.string().min(1).max(300), expectedText: z.string().max(10_000) }).strict(),
  z.object({ kind: z.literal("regenerate-word-bibliography"), regionId: z.string().min(1).max(300).optional(), expectedText: z.string().max(100_000).optional(), afterRegionId: z.string().min(1).max(300).optional() }).strict(),
] as const;

export type WordSource = z.infer<typeof wordSourceSchema>;
export type WordCitationInline = z.infer<typeof wordCitationInlineSchema>;

export function wordCitationLabel(source: WordSource, pages?: string) {
  const author = source.corporate || source.authors?.map((person) => person.last).join("; ") || source.title;
  return `(${[author, source.year, pages ? `p. ${pages}` : undefined].filter(Boolean).join(", ")})`;
}

export function wordBibliographyText(sources: WordSource[]) {
  return sources.map((source) => [source.corporate || source.authors?.map((person) => [person.last, person.first, person.middle].filter(Boolean).join(", ")).join("; "), source.year ? `(${source.year})` : undefined, source.title, source.journal, source.publisher, source.city, source.volume, source.issue, source.pages, source.doi, source.url].filter(Boolean).join(". ")).join("\n");
}
