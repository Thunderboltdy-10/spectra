import {
  BookOpen,
  Calendar,
  ClipboardList,
  Code2,
  FileText,
  Image,
  Bookmark,
  FolderOpen,
  PenLine,
  Shapes,
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
