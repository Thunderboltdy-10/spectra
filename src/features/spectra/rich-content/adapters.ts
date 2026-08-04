import type { SpectraRichContentAst } from "./ast";
import { parseSpectraRichContent } from "./parser";

export const RICH_CONTENT_SURFACES = [
  "chat", "stream", "tiptap", "comment", "run_summary", "quiz_explanation",
  "flashcard", "presentation_text", "board_source_card", "agent_skill_evidence",
  "public_share", "export",
] as const;
export type RichContentSurface = (typeof RICH_CONTENT_SURFACES)[number];
export type RichContentAdapter = {
  surface: RichContentSurface;
  fromText(value: string): SpectraRichContentAst;
  toText(value: SpectraRichContentAst): string;
};

function adapter(surface: RichContentSurface): RichContentAdapter {
  return { surface, fromText: parseSpectraRichContent, toText: (value) => value.source };
}

export const RICH_CONTENT_ADAPTERS = Object.fromEntries(
  RICH_CONTENT_SURFACES.map((surface) => [surface, adapter(surface)]),
) as Record<RichContentSurface, RichContentAdapter>;

export function getRichContentAdapter(surface: RichContentSurface) {
  return RICH_CONTENT_ADAPTERS[surface];
}
