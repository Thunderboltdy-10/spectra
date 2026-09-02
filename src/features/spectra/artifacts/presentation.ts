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
  thread_reference: { icon: MessageSquare, color: "var(--brand-primary)", soft: "color-mix(in oklab, var(--brand-primary) 10%, var(--bg-elevated))" },
  resource: { icon: File, color: "var(--text-secondary)", soft: "color-mix(in oklab, var(--text-secondary) 9%, var(--bg-elevated))" },
  flashcard_deck: { icon: BookOpen, color: "var(--mode-document)", soft: "color-mix(in oklab, var(--mode-document) 9%, var(--bg-elevated))" },
  quiz: { icon: HelpCircle, color: "var(--mode-quiz)", soft: "color-mix(in oklab, var(--mode-quiz) 9%, var(--bg-elevated))" },
  planner_task: { icon: CalendarCheck2, color: "var(--warning)", soft: "color-mix(in oklab, var(--warning) 10%, var(--bg-elevated))" },
  agent: { icon: Bot, color: "var(--accent-cyan)", soft: "color-mix(in oklab, var(--accent-cyan) 9%, var(--bg-elevated))" },
  timetable: { icon: CalendarDays, color: "var(--accent-mint)", soft: "color-mix(in oklab, var(--accent-mint) 9%, var(--bg-elevated))" },
  presentation: { icon: Presentation, color: "var(--accent-coral)", soft: "color-mix(in oklab, var(--accent-coral) 9%, var(--bg-elevated))" },
  sheets: { icon: Table2, color: "var(--success)", soft: "color-mix(in oklab, var(--success) 9%, var(--bg-elevated))" },
  code: { icon: Code2, color: "var(--accent-cyan)", soft: "color-mix(in oklab, var(--accent-cyan) 9%, var(--bg-elevated))" },
  whiteboard: { icon: Workflow, color: "var(--accent-gold)", soft: "color-mix(in oklab, var(--accent-gold) 9%, var(--bg-elevated))" },
};

export const workTypeMeta = Object.freeze({
  ...Object.fromEntries(ARTIFACT_TYPE_KEYS.map((key) => [
    key,
    { ...visuals[key], label: requireArtifactTypeManifest(key).identity.displayName },
  ])),
  thread_reference: { ...visuals.thread_reference, label: "Thread" },
  resource: { ...visuals.resource, label: "File" },
}) as Record<PresentedWorkType, TypePresentation>;
