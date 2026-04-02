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
    color: "#0e8ee8",
    description: "Structured plan with timeline, milestones, and tasks",
    section: "Study Plans & Timetables",
  },
  timetable: {
    label: "Timetable",
    icon: Calendar,
    color: "#158f72",
    description: "Weekly or daily schedule with time slots",
    section: "Study Plans & Timetables",
  },
  note: {
    label: "Note",
    icon: PenLine,
    color: "#f59f0a",
    description: "Rich text note with formatting",
    section: "Notes & Documents",
  },
  flashcard_deck: {
    label: "Flashcard Deck",
    icon: BookOpen,
    color: "#1f9fb2",
    description: "Collection of flashcards with spaced repetition",
    section: "Flashcard Decks",
  },
  document: {
    label: "Document",
    icon: FileText,
    color: "#13806e",
    description: "Generated or uploaded document",
    section: "Notes & Documents",
  },
  code_project: {
    label: "Code Project",
    icon: Code2,
    color: "#ba4f26",
    description: "Code with preview capability",
    section: "Generated Media",
  },
  diagram: {
    label: "Diagram",
    icon: Shapes,
    color: "#0f6fa7",
    description: "Visual diagram or canvas",
    section: "Generated Media",
  },
  image: {
    label: "Image",
    icon: Image,
    color: "#ec4899",
    description: "Generated or uploaded image",
    section: "Generated Media",
  },
  bookmark: {
    label: "Bookmark",
    icon: Bookmark,
    color: "#637083",
    description: "Saved message or external link",
    section: "Saved Items",
  },
  collection: {
    label: "Collection",
    icon: FolderOpen,
    color: "#6b5f52",
    description: "Container grouping other artifacts",
    section: "Collections",
  },
  whiteboard: {
    label: "Whiteboard",
    icon: KanbanSquare,
    color: "#0f6fa7",
    description: "Open visual canvas for sketching, mapping, and iteration",
    section: "Generated Media",
  },
  visualization: {
    label: "Visualization",
    icon: ChartColumn,
    color: "#1f9fb2",
    description: "Chart, graph, or other structured visual output",
    section: "Generated Media",
  },
  quiz: {
    label: "Quiz",
    icon: BookOpen,
    color: "#8f51d9",
    description: "Question set with answer state and review flow",
    section: "Study Plans & Timetables",
  },
  concept_map: {
    label: "Concept Map",
    icon: Spline,
    color: "#158f72",
    description: "Node-link map for concepts and relationships",
    section: "Generated Media",
  },
  code_output: {
    label: "Code Output",
    icon: Code2,
    color: "#ba4f26",
    description: "Rendered code-backed output with fix-with-AI support",
    section: "Generated Media",
  },
  custom: {
    label: "Custom Widget",
    icon: Shapes,
    color: "#637083",
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

export function getArtifactMeta(type: string): ArtifactTypeMeta {
  return (
    ARTIFACT_TYPE_META[type as ArtifactType] ?? {
      label: type,
      icon: FileText,
      color: "#637083",
      description: "",
      section: "Other",
    }
  );
}
