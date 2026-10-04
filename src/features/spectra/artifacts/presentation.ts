import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  CalendarCheck2,
  CalendarDays,
  Code2,
  FileText,
  File,
  HelpCircle,
  MessageSquare,
  Presentation,
  Table2,
  Workflow,
} from "lucide-react";
import type { IconName } from "@/components/icons";
import { ARTIFACT_TYPE_KEYS, type ArtifactTypeKey } from "./types";
import { requireArtifactTypeManifest } from "./registry";

export type PresentedWorkType = ArtifactTypeKey | "thread_reference" | "resource";
/** `glyph` is the type's Spectra glyph (ICONS.md); `icon` stays until every page draws glyphs. */
type TypePresentation = { label: string; icon: LucideIcon; glyph: IconName; color: string; soft: string };

const visuals: Record<PresentedWorkType, Omit<TypePresentation, "label">> = {
  document: { glyph: "document", icon: FileText, color: "var(--mode-document)", soft: "color-mix(in oklab, var(--mode-document) 9%, var(--bg-elevated))" },
  thread_reference: { glyph: "conversations", icon: MessageSquare, color: "var(--brand-primary)", soft: "color-mix(in oklab, var(--brand-primary) 10%, var(--bg-elevated))" },
  resource: { glyph: "pdf", icon: File, color: "var(--text-secondary)", soft: "color-mix(in oklab, var(--text-secondary) 9%, var(--bg-elevated))" },
  flashcard_deck: { glyph: "flashcards", icon: BookOpen, color: "var(--mode-document)", soft: "color-mix(in oklab, var(--mode-document) 9%, var(--bg-elevated))" },
  quiz: { glyph: "quiz", icon: HelpCircle, color: "var(--mode-quiz)", soft: "color-mix(in oklab, var(--mode-quiz) 9%, var(--bg-elevated))" },
  planner_task: { glyph: "task", icon: CalendarCheck2, color: "var(--warning)", soft: "color-mix(in oklab, var(--warning) 10%, var(--bg-elevated))" },
  agent: { glyph: "agent", icon: Bot, color: "var(--accent-cyan)", soft: "color-mix(in oklab, var(--accent-cyan) 9%, var(--bg-elevated))" },
  timetable: { glyph: "timetable", icon: CalendarDays, color: "var(--accent-mint)", soft: "color-mix(in oklab, var(--accent-mint) 9%, var(--bg-elevated))" },
  presentation: { glyph: "slides", icon: Presentation, color: "var(--accent-coral)", soft: "color-mix(in oklab, var(--accent-coral) 9%, var(--bg-elevated))" },
  sheets: { glyph: "sheet", icon: Table2, color: "var(--success)", soft: "color-mix(in oklab, var(--success) 9%, var(--bg-elevated))" },
  code: { glyph: "code", icon: Code2, color: "var(--accent-cyan)", soft: "color-mix(in oklab, var(--accent-cyan) 9%, var(--bg-elevated))" },
  whiteboard: { glyph: "whiteboard", icon: Workflow, color: "var(--accent-gold)", soft: "color-mix(in oklab, var(--accent-gold) 9%, var(--bg-elevated))" },
};

export const workTypeMeta = Object.freeze({
  ...Object.fromEntries(ARTIFACT_TYPE_KEYS.map((key) => [
    key,
    { ...visuals[key], label: requireArtifactTypeManifest(key).identity.displayName },
  ])),
  thread_reference: { ...visuals.thread_reference, label: "Chat" },
  resource: { ...visuals.resource, label: "File" },
}) as Record<PresentedWorkType, TypePresentation>;
