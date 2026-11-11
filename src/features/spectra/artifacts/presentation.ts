import { BookOpen, CalendarCheck2, Code2, File, HelpCircle, Image, Table2, Bot, CalendarDays, FileText, MessageSquare, Presentation, Workflow, type GlyphIcon } from "@/components/icons/glyph-icons";
import type { IconName } from "@/components/icons";
import { ARTIFACT_TYPE_KEYS, type ArtifactTypeKey } from "./types";
import { requireArtifactTypeManifest } from "./registry";

export type PresentedWorkType = ArtifactTypeKey | "thread_reference" | "resource";
/** `glyph` is the type's Spectra glyph (ICONS.md); `icon` stays until every page draws glyphs. */
type TypePresentation = { label: string; icon: GlyphIcon; glyph: IconName; color: string; soft: string };

/** A type's hue (spectra-app.css, --type-*): the glyph in its ink, on a tile of its tint. */
const hue = (token: string) => ({
  color: `var(--type-${token})`,
  soft: `color-mix(in oklab, var(--type-${token}) var(--type-tint-strength), var(--bg-elevated))`,
});

const visuals: Record<PresentedWorkType, Omit<TypePresentation, "label">> = {
  document: { glyph: "document", icon: FileText, ...hue("document") },
  thread_reference: { glyph: "conversations", icon: MessageSquare, ...hue("chat") },
  resource: { glyph: "pdf", icon: File, ...hue("file") },
  flashcard_deck: { glyph: "flashcards", icon: BookOpen, ...hue("flashcards") },
  quiz: { glyph: "quiz", icon: HelpCircle, ...hue("quiz") },
  planner_task: { glyph: "task", icon: CalendarCheck2, ...hue("task") },
  agent: { glyph: "agent", icon: Bot, ...hue("agent") },
  timetable: { glyph: "timetable", icon: CalendarDays, ...hue("timetable") },
  presentation: { glyph: "slides", icon: Presentation, ...hue("slides") },
  sheets: { glyph: "sheet", icon: Table2, ...hue("sheets") },
  code: { glyph: "code", icon: Code2, ...hue("code") },
  whiteboard: { glyph: "whiteboard", icon: Workflow, ...hue("whiteboard") },
};

export const workTypeMeta = Object.freeze({
  ...Object.fromEntries(ARTIFACT_TYPE_KEYS.map((key) => [
    key,
    { ...visuals[key], label: requireArtifactTypeManifest(key).identity.displayName },
  ])),
  thread_reference: { ...visuals.thread_reference, label: "Thread" },
  resource: { ...visuals.resource, label: "File" },
}) as Record<PresentedWorkType, TypePresentation>;

/**
 * A file is named for what it holds, as the student would: a PDF, a Word
 * document, a spreadsheet. Its extension decides, and a file without a known
 * one stays a file. A file Spectra opens as its own work already is that work
 * wherever it lies. The rest wear the hue of the Spectra type they sit alongside,
 * so a spreadsheet looks like a spreadsheet.
 */
const FILE_KINDS: ReadonlyArray<{ pattern: RegExp; presentation: TypePresentation }> = [
  { pattern: /\.pdf$/i, presentation: { ...visuals.resource, label: "PDF" } },
  { pattern: /\.(docx|docm|dotx|dotm)$/i, presentation: workTypeMeta.document },
  { pattern: /\.(xlsx|xlsm|xltx|xltm|xlam)$/i, presentation: workTypeMeta.sheets },
  { pattern: /\.(pptx|pptm|potx|potm|ppsx|ppsm)$/i, presentation: workTypeMeta.presentation },
  { pattern: /\.(docx?|odt|rtf|pages)$/i, presentation: { ...visuals.document, label: "Word document" } },
  { pattern: /\.(xlsx?|ods|csv|numbers)$/i, presentation: { ...visuals.sheets, label: "Spreadsheet" } },
  { pattern: /\.(pptx?|odp|key)$/i, presentation: { ...visuals.presentation, label: "Slide deck" } },
  { pattern: /\.(png|jpe?g|gif|webp|heic|svg)$/i, presentation: { glyph: "image", icon: Image, ...hue("file"), label: "Image" } },
];

/** A work's type as shown, with a file named by its kind when its name says it. */
export function presentWork(key: PresentedWorkType, name?: string): TypePresentation {
  if (key === "resource" && name) {
    const kind = FILE_KINDS.find(({ pattern }) => pattern.test(name.trim()));
    if (kind) return kind.presentation;
  }
  return workTypeMeta[key];
}
