export const SPECTRA_RICH_CONTENT_VERSION = 1 as const;

export type RichInline =
  | { type: "text"; text: string }
  | { type: "inline_code"; code: string }
  | { type: "inline_math"; math: string; complete: boolean }
  | { type: "citation"; sourceId: string; evidenceIds: string[]; label?: string }
  | { type: "reference"; workId: string; label?: string }
  | { type: "footnote_ref"; id: string };

type RichBlockBase = { id: string; raw: string; complete: boolean };
export type RichBlock =
  | (RichBlockBase & { type: "paragraph"; content: RichInline[] })
  | (RichBlockBase & { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; content: RichInline[] })
  | (RichBlockBase & { type: "list"; ordered: boolean; items: RichInline[][] })
  | (RichBlockBase & { type: "table"; rows: RichInline[][][] })
  | (RichBlockBase & { type: "code_block"; language?: string; code: string })
  | (RichBlockBase & { type: "math_block"; math: string })
  | (RichBlockBase & { type: "callout"; tone: string; content: RichInline[] })
  | (RichBlockBase & { type: "media"; url: string; alt: string })
  | (RichBlockBase & { type: "source_note"; content: RichInline[] })
  | (RichBlockBase & { type: "footnote"; footnoteId: string; content: RichInline[] });

export type SpectraRichContentAst = {
  version: typeof SPECTRA_RICH_CONTENT_VERSION;
  source: string;
  complete: boolean;
  blocks: RichBlock[];
};

export function richBlockSemanticKey(block: RichBlock) {
  return `${block.type}:${block.raw}`;
}
