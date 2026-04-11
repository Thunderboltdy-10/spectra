import type { CanonicalWorkspaceType } from "@/lib/artifact-types";

/* ─── Zoom Tiers ──────────────────────────────────────── */

export const ZOOM_TIERS = {
  /** Far out – all workspaces visible as readable cards */
  LANDSCAPE: { max: 0.20, label: "landscape" },
  /** Mid – one workspace fills most of the viewport */
  SUMMARY: { min: 0.20, max: 0.55, label: "summary" },
  /** Deep – content-level detail, inline editing */
  DETAIL: { min: 0.55, label: "detail" },
} as const;

export type ZoomTier = "landscape" | "summary" | "detail";

export function zoomTierForLevel(zoom: number): ZoomTier {
  if (zoom < ZOOM_TIERS.LANDSCAPE.max) return "landscape";
  if (zoom < ZOOM_TIERS.SUMMARY.max) return "summary";
  return "detail";
}

/* ─── Viewport Constants ─────────────────────────────── */

export const VIEWPORT = {
  MIN_ZOOM: 0.12,
  MAX_ZOOM: 2.0,
  DEFAULT_ZOOM: 0.18,
  /** Zoom level that triggers auto-commit into a workspace */
  AUTO_ENTRY_THRESHOLD: 0.9,
} as const;

/* ─── Territory Sizing ───────────────────────────────── */

export const TERRITORY = {
  /** Width of a workspace territory at detail zoom */
  WIDTH: 1500,
  /** Height of a workspace territory at detail zoom */
  HEIGHT: 1200,
  /** Spacing between workspace centers in grid layout */
  SPACING_X: 2000,
  SPACING_Y: 1600,
  /** Max workspaces per row before wrapping */
  COLS: 3,
} as const;

/* ─── View Modes ─────────────────────────────────────── */

export const VIEW_MODES = ["byType", "byTopic", "timeline"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/* ─── Workspace Item Shape ───────────────────────────── */

export type WorkspaceItemData = {
  id: string;
  workspaceId: string;
  title: string;
  preview?: string;
  itemType: CanonicalWorkspaceType;
  status: "active" | "idle" | "completed" | "archived";
  canvasX?: number;
  canvasY?: number;
  updatedAt?: number;
  meta?: string;
};

/* ─── Workspace Shape ────────────────────────────────── */

export type WorkspaceData = {
  id: string;
  name: string;
  emoji: string;
  status: "active" | "quiet" | "completed" | "archived";
  itemCount: number;
  lastActivity?: number;
  items: WorkspaceItemData[];
};

/* ─── Tint Zone Mapping ──────────────────────────────── */

import type { TintZoneVariant } from "@/components/workspace/tint-zone";

export const TYPE_TO_TINT: Record<CanonicalWorkspaceType, TintZoneVariant> = {
  note: "warm",
  visual: "accent",
  code: "cool",
  export: "muted",
  board: "neutral",
  flashcard_deck: "cool",
  quiz: "accent",
  thread: "cool",
  planner: "accent",
};

/* ─── Tint Zone Grouping Labels ──────────────────────── */

export const TYPE_GROUP_LABELS: Record<string, { label: string; types: CanonicalWorkspaceType[] }> = {
  documents: { label: "Documents", types: ["note", "export"] },
  code: { label: "Code", types: ["code"] },
  media: { label: "Media", types: ["visual", "board"] },
  study: { label: "Study", types: ["flashcard_deck", "quiz"] },
  threads: { label: "Threads", types: ["thread"] },
  planning: { label: "Planning", types: ["planner"] },
};
