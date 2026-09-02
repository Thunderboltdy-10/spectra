import {
  BookOpen,
  Calendar,
  ChartColumn,
  ClipboardList,
  Code2,
  FileText,
  Image,
  Bookmark,
  FolderOpen,
  KanbanSquare,
  PenLine,
  Shapes,
  Spline,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";

export const ARTIFACT_TYPES = [
  "study_plan",
  "timetable",
  "note",
  "flashcard_deck",
  "document",
  "code_project",
  "diagram",
  "image",
  "bookmark",
  "collection",
  "whiteboard",
  "visualization",
  "quiz",
  "concept_map",
  "code_output",
  "custom",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

type ArtifactTypeMeta = {
  label: string;
  icon: LucideIcon;
  color: string;
  description: string;
  section: string;
};

export const ARTIFACT_TYPE_META: Record<ArtifactType, ArtifactTypeMeta> = {
  study_plan: {
    label: "Study Plan",
    icon: ClipboardList,
    color: "var(--accent-cyan)",
    description: "Structured plan with timeline, milestones, and tasks",
    section: "Study Plans & Timetables",
  },
  timetable: {
    label: "Timetable",
    icon: Calendar,
    color: "var(--accent-mint)",
    description: "Weekly or daily schedule with time slots",
    section: "Study Plans & Timetables",
  },
  note: {
    label: "Note",
    icon: PenLine,
    color: "var(--accent-gold)",
    description: "Rich text note with formatting",
    section: "Notes & Documents",
  },
  flashcard_deck: {
    label: "Flashcard Deck",
    icon: BookOpen,
    color: "var(--accent-cyan)",
    description: "Collection of flashcards with spaced repetition",
    section: "Flashcard Decks",
  },
  document: {
    label: "Document",
    icon: FileText,
    color: "var(--accent-mint)",
    description: "Generated or uploaded document",
    section: "Notes & Documents",
  },
  code_project: {
    label: "Code Project",
    icon: Code2,
    color: "var(--accent-orange)",
    description: "Code with preview capability",
    section: "Generated Media",
  },
  diagram: {
    label: "Diagram",
    icon: Shapes,
    color: "var(--accent-cyan)",
    description: "Visual diagram or canvas",
    section: "Generated Media",
  },
  image: {
    label: "Image",
    icon: Image,
    color: "var(--accent-coral)",
    description: "Generated or uploaded image",
    section: "Generated Media",
  },
  bookmark: {
    label: "Bookmark",
    icon: Bookmark,
    color: "var(--text-secondary)",
    description: "Saved message or external link",
    section: "Saved Items",
  },
  collection: {
    label: "Collection",
    icon: FolderOpen,
    color: "var(--text-secondary)",
    description: "Container grouping other artifacts",
    section: "Collections",
  },
  whiteboard: {
    label: "Whiteboard",
    icon: KanbanSquare,
    color: "var(--accent-cyan)",
    description: "Open visual canvas for sketching, mapping, and iteration",
    section: "Generated Media",
  },
  visualization: {
    label: "Visualization",
    icon: ChartColumn,
    color: "var(--accent-cyan)",
    description: "Chart, graph, or other structured visual output",
    section: "Generated Media",
  },
  quiz: {
    label: "Quiz",
    icon: BookOpen,
    color: "var(--brand-primary)",
    description: "Question set with answer state and review flow",
    section: "Study Plans & Timetables",
  },
  concept_map: {
    label: "Concept Map",
    icon: Spline,
    color: "var(--accent-mint)",
    description: "Node-link map for concepts and relationships",
    section: "Generated Media",
  },
  code_output: {
    label: "Code Output",
    icon: Code2,
    color: "var(--accent-orange)",
    description: "Rendered code-backed output with fix-with-AI support",
    section: "Generated Media",
  },
  custom: {
    label: "Custom Widget",
    icon: Shapes,
    color: "var(--text-secondary)",
    description: "Sandboxed custom widget or renderer-backed output",
    section: "Collections",
  },
};

export const ARTIFACT_SECTIONS = [
  "Study Plans & Timetables",
  "Flashcard Decks",
  "Notes & Documents",
  "Generated Media",
  "Saved Items",
  "Collections",
] as const;

/* ─── Canonical Workspace-Facing Types ──────────────────── */

/**
 * The seven canonical workspace-facing types that determine how an item
 * is rendered on the workspace canvas. Each maps to a distinct display
 * representation (icon, tint, card layout).
 *
 * VAL-W1-001: No item should fall back to a generic "artifact" card
 * when a specific canonical type exists.
 */
export const CANONICAL_WORKSPACE_TYPES = [
  "note",
  "visual",
  "code",
  "export",
  "board",
  "flashcard_deck",
  "quiz",
  "thread",
  "planner",
] as const;

export type CanonicalWorkspaceType = (typeof CANONICAL_WORKSPACE_TYPES)[number];

type CanonicalWorkspaceTypeMeta = {
  label: string;
  color: string;
  icon: LucideIcon;
};

/**
 * Metadata for each canonical workspace-facing type.
 * Used by the canvas to render type-specific cards with appropriate
 * icons, tint colours, and labels.
 */
export const CANONICAL_WORKSPACE_TYPE_META: Record<
  CanonicalWorkspaceType,
  CanonicalWorkspaceTypeMeta
> = {
  note: {
    label: "Note",
    color: "var(--accent-gold)",
    icon: PenLine,
  },
  visual: {
    label: "Visual",
    color: "var(--accent-cyan)",
    icon: ChartColumn,
  },
  code: {
    label: "Code",
    color: "var(--accent-orange)",
    icon: Code2,
  },
  export: {
    label: "Export",
    color: "var(--text-secondary)",
    icon: Bookmark,
  },
  board: {
    label: "Board",
    color: "var(--accent-cyan)",
    icon: KanbanSquare,
  },
  flashcard_deck: {
    label: "Flashcard Deck",
    color: "var(--accent-cyan)",
    icon: BookOpen,
  },
  quiz: {
    label: "Quiz",
    color: "var(--brand-primary)",
    icon: BookOpen,
  },
  thread: {
    label: "Thread",
    color: "var(--accent-cyan)",
    icon: MessageSquare,
  },
  planner: {
    label: "Planner",
    color: "var(--accent-mint)",
    icon: Calendar,
  },
};

/**
 * Maps an artifact type (renderMode) to its canonical workspace-facing type.
 * This determines the high-level display category on the workspace canvas.
 *
 * VAL-W1-002: Every legacy artifact type must map to a valid canonical type
 * without producing undefined.
 */
export const ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE: Record<
  ArtifactType,
  CanonicalWorkspaceType
> = {
  study_plan: "note",
  timetable: "planner",
  note: "note",
  flashcard_deck: "flashcard_deck",
  document: "export",
  code_project: "code",
  diagram: "visual",
  image: "visual",
  bookmark: "export",
  collection: "export",
  whiteboard: "board",
  visualization: "visual",
  quiz: "quiz",
  concept_map: "visual",
  code_output: "code",
  custom: "export",
};

/**
 * Maps a legacy `type` field value to a canonical workspace-facing type.
 * Used during dual-read migration when `itemType` is absent.
 *
 * VAL-W1-003: Items created before the `itemType` field was added must
 * display identically to items created after.
 */
export const LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE: Record<
  string,
  CanonicalWorkspaceType
> = {
  thread: "thread",
  document: "export",
  planner: "planner",
  board: "board",
  visualization: "visual",
  media: "visual",
  reference: "export",
  custom: "export",
  utility: "export",
};

/**
 * Resolves the canonical workspace-facing type for a given artifact type.
 * Falls back to "export" for unknown types.
 */
export function canonicalWorkspaceTypeForArtifactType(
  artifactType: string,
): CanonicalWorkspaceType {
  return (
    ARTIFACT_TO_CANONICAL_WORKSPACE_TYPE[artifactType as ArtifactType]
    ?? "export"
  );
}

/**
 * Resolves the canonical workspace-facing type for a legacy `type` field value.
 * Falls back to "export" for unknown legacy types.
 */
export function canonicalWorkspaceTypeForLegacyType(
  legacyType: string,
): CanonicalWorkspaceType {
  return LEGACY_TYPE_TO_CANONICAL_WORKSPACE_TYPE[legacyType] ?? "export";
}

export function getArtifactMeta(type: string): ArtifactTypeMeta {
  return (
    ARTIFACT_TYPE_META[type as ArtifactType] ?? {
      label: type,
      icon: FileText,
      color: "var(--text-secondary)",
      description: "",
      section: "Other",
    }
  );
}
