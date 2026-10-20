"use client";

import { BookOpen, CalendarCheck2, Code2, HelpCircle, Table2, Bot, FileText, Presentation, Workflow, type GlyphIcon } from "@/components/icons/glyph-icons";
import { workTypeMeta } from "./artifact-card";
import { requireBlueprint, requireArtifactTypeManifest } from "../artifacts/blueprint-catalog";
import type { ArtifactTypeKey } from "../artifacts/types";
import { normalizeWhiteboardContent } from "../whiteboard/model";
import { normalizePresentationContent } from "../presentation/model";

// The blueprint choices and the default payload each new work starts from.
// (The old full-screen blueprint editor sheet that lived here had not been
// rendered anywhere for a long time; every type now opens in its own studio.)

type EditableBlueprintKey = ArtifactTypeKey;

export type ArtifactPayload = {
  blueprintKey: EditableBlueprintKey;
  title: string;
  summary?: string;
  content: unknown;
  tags?: string[];
};


export const blueprintChoices: Array<{ key: EditableBlueprintKey; label: string; icon: GlyphIcon; description: string }> = [
  { key: "document", label: "Document", icon: FileText, description: "Notes, essay plans, and structured writing." },
  { key: "flashcard_deck", label: "Flashcard deck", icon: BookOpen, description: "A real deck with editable cards." },
  { key: "quiz", label: "Quiz", icon: HelpCircle, description: "Questions, answers, and review notes." },
  { key: "planner_task", label: "Task", icon: CalendarCheck2, description: "One thing to do, and when." },
  { key: "agent", label: "Agent", icon: Bot, description: "A specialist with a purpose, skills, and sources." },
  { key: "presentation", label: "Presentation", icon: Presentation, description: "Slides for a talk or explanation." },
  { key: "sheets", label: "Sheets", icon: Table2, description: "A workbook with cells, formulas, and charts." },
  { key: "code", label: "Code", icon: Code2, description: "Source and a preview you can run." },
  { key: "whiteboard", label: "Whiteboard", icon: Workflow, description: "A spatial board for notes and diagrams." },
];

export function defaultArtifactSummary(blueprintKey: EditableBlueprintKey) {
  return requireArtifactTypeManifest(blueprintKey).identity.description;
}

export function defaultArtifactTitle(blueprintKey: EditableBlueprintKey) {
  return `New ${workTypeMeta[blueprintKey].label}`;
}

export function createDefaultArtifactPayload(blueprintKey: EditableBlueprintKey): ArtifactPayload {
  const content = structuredClone(requireBlueprint(blueprintKey).defaultContent);
  return {
    blueprintKey,
    title: defaultArtifactTitle(blueprintKey),
    summary: defaultArtifactSummary(blueprintKey),
    content:
      blueprintKey === "whiteboard"
        ? normalizeWhiteboardContent(content)
        : blueprintKey === "presentation"
          ? normalizePresentationContent(content)
          : content,
    tags: [],
  };
}
