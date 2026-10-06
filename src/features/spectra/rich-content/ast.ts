/**
 * Spectra's one rich-content model (EDITORS.md, "Shared rich content").
 *
 * Every artifact type stores its text in the format its file needs: a
 * document is ProseMirror JSON (Word fidelity), a slide is DrawingML
 * paragraphs and runs (PowerPoint fidelity), a quiz question or a flashcard
 * face is the HTML its editor writes, and a reply, comment, note or task
 * description is Markdown. The adapters turn each of those into this one
 * model, and one renderer draws it, so a heading, a list or a callout is the
 * same thing wherever it appears.
 */
export const SPECTRA_RICH_CONTENT_VERSION = 2 as const;

/** Character formatting every text surface offers (the shared command subset). */
export type RichMark = "bold" | "italic" | "underline" | "strike";

/**
 * A run's own typeface, size and colour. They belong to the artifact (a
 * slide's run keeps the font its deck uses), never to the renderer.
 */
export type RichTextStyle = { fontFamily?: string; fontSizePt?: number; color?: string };

export type RichAlign = "left" | "center" | "right" | "justify";

/** The callout tones the document editor offers. Markdown alerts map onto them. */
export type RichCalloutTone = "info" | "tip" | "warning";

export type RichInline =
  | { type: "text"; text: string; marks?: RichMark[]; style?: RichTextStyle }
  | { type: "inline_code"; code: string }
  | { type: "inline_math"; math: string; complete: boolean }
  | { type: "link"; href: string; content: RichInline[] }
  | { type: "citation"; sourceId: string; evidenceIds: string[]; label?: string }
  | { type: "reference"; workId: string; label?: string }
  | { type: "footnote_ref"; id: string }
  | { type: "image"; url: string; alt: string }
  | { type: "break" };

/** A list item. `checked` is set on checklist items only. */
export type RichListItem = { checked?: boolean; blocks: RichBlock[] };

type RichBlockBase = { id: string; raw: string; complete: boolean };
export type RichBlock =
  | (RichBlockBase & { type: "paragraph"; content: RichInline[]; align?: RichAlign })
  | (RichBlockBase & { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; content: RichInline[]; align?: RichAlign })
  | (RichBlockBase & { type: "list"; kind: "bullet" | "ordered" | "task"; start?: number; items: RichListItem[] })
  | (RichBlockBase & { type: "quote"; blocks: RichBlock[] })
  | (RichBlockBase & { type: "callout"; tone: RichCalloutTone; blocks: RichBlock[] })
  | (RichBlockBase & { type: "code_block"; language?: string; code: string })
  | (RichBlockBase & { type: "math_block"; math: string })
  | (RichBlockBase & { type: "table"; header: boolean; rows: RichInline[][][] })
  | (RichBlockBase & { type: "media"; url: string; alt: string })
  | (RichBlockBase & { type: "embed"; embedId?: string; workId?: string; label?: string })
  | (RichBlockBase & { type: "rule" })
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

/** Drafts are blocks before the model gives them an identity. */
type Draft<T> = T extends RichBlock ? Omit<T, "id" | "raw" | "complete"> & Partial<Pick<RichBlock, "raw" | "complete">> : never;
export type RichBlockDraft = Draft<RichBlock>;

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

/**
 * Gives each block a stable id from its place and its content, so a block
 * that has not changed keeps its identity while the text around it streams.
 */
export function identifyBlocks(drafts: readonly RichBlockDraft[], prefix = "rich"): RichBlock[] {
  return drafts.map((draft, index) => {
    const raw = draft.raw ?? JSON.stringify(draft);
    const block = { ...draft, raw, complete: draft.complete ?? true, id: `${prefix}:${index}:${hash(raw)}` } as RichBlock;
    // Nested blocks are keyed under their parent.
    if (block.type === "quote" || block.type === "callout") {
      return { ...block, blocks: identifyBlocks(block.blocks as RichBlockDraft[], block.id) };
    }
    if (block.type === "list") {
      return {
        ...block,
        items: block.items.map((item, itemIndex) => ({ ...item, blocks: identifyBlocks(item.blocks as RichBlockDraft[], `${block.id}.${itemIndex}`) })),
      };
    }
    return block;
  });
}

export function richContentAst(blocks: readonly RichBlockDraft[], source = ""): SpectraRichContentAst {
  const identified = identifyBlocks(blocks);
  return { version: SPECTRA_RICH_CONTENT_VERSION, source, blocks: identified, complete: identified.every((block) => block.complete) };
}
