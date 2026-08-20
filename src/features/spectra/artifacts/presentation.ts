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
import { ARTIFACT_TYPE_KEYS, type ArtifactTypeKey } from "./types";
import { requireArtifactTypeManifest } from "./registry";

export type PresentedWorkType = ArtifactTypeKey | "thread_reference" | "resource";
type TypePresentation = { label: string; icon: LucideIcon; color: string; soft: string };

const visuals: Record<PresentedWorkType, Omit<TypePresentation, "label">> = {
  document: { icon: FileText, color: "var(--mode-document)", soft: "color-mix(in oklab, var(--mode-document) 9%, var(--bg-elevated))" },
  thread_reference: { icon: MessageSquare, color: "#8b6ff0", soft: "color-mix(in oklab, #8b6ff0 10%, var(--bg-elevated))" },
  resource: { icon: File, color: "#516173", soft: "color-mix(in oklab, #516173 9%, var(--bg-elevated))" },
  flashcard_deck: { icon: BookOpen, color: "var(--mode-document)", soft: "color-mix(in oklab, var(--mode-document) 9%, var(--bg-elevated))" },
  quiz: { icon: HelpCircle, color: "var(--mode-quiz)", soft: "color-mix(in oklab, var(--mode-quiz) 9%, var(--bg-elevated))" },
  planner_task: { icon: CalendarCheck2, color: "#d47a16", soft: "color-mix(in oklab, #d47a16 10%, var(--bg-elevated))" },
  agent: { icon: Bot, color: "#1785a5", soft: "color-mix(in oklab, #1785a5 9%, var(--bg-elevated))" },
  timetable: { icon: CalendarDays, color: "#16735d", soft: "color-mix(in oklab, #16735d 9%, var(--bg-elevated))" },
  presentation: { icon: Presentation, color: "#cf6d48", soft: "color-mix(in oklab, #cf6d48 9%, var(--bg-elevated))" },
  sheets: { icon: Table2, color: "#2f855a", soft: "color-mix(in oklab, #2f855a 9%, var(--bg-elevated))" },
  code: { icon: Code2, color: "#5166a8", soft: "color-mix(in oklab, #5166a8 9%, var(--bg-elevated))" },
  whiteboard: { icon: Workflow, color: "#9a6a39", soft: "color-mix(in oklab, #9a6a39 9%, var(--bg-elevated))" },
};

export const workTypeMeta = Object.freeze({
  ...Object.fromEntries(ARTIFACT_TYPE_KEYS.map((key) => [
    key,
    { ...visuals[key], label: requireArtifactTypeManifest(key).identity.displayName },
  ])),
  thread_reference: { ...visuals.thread_reference, label: "Thread" },
  resource: { ...visuals.resource, label: "File" },
}) as Record<PresentedWorkType, TypePresentation>;
