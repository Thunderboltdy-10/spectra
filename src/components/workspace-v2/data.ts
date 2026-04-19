import type { IconName } from "./icons";
import type { WorkspaceData, WorkspaceItemData } from "@/lib/workspace/contracts";

/* ─── V2 canvas shapes ─── */

export type V2Kind =
  | "note" | "essay" | "pset" | "flashcards" | "thread"
  | "reading" | "lab" | "schedule" | "code" | "visual";

export type V2Territory = {
  id: string;
  sourceId: string;            // real workspace id
  name: string;
  subtitle: string;
  glyph: string;
  color: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
};

export type V2Item = {
  id: string;
  sourceId: string;            // real item id
  workspaceId: string;         // v2 territory id
  kind: V2Kind;
  title: string;
  preview?: string;
  body?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  updated: string;
  meta: Record<string, unknown>;
  problems?: { q: string; a: string; status: "todo" | "stuck" | "done" }[];
  cards?: { q: string; a: string }[];
  messages?: { role: "user" | "ai"; text: string }[];
  linked?: string[];
};

export const TIERS = {
  OUT: 0.28,
  WORKSPACE: 0.55,
  ITEM: 0.95,
  BLOOM: 1.25,
};

export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 2.4;

export const KIND_META: Record<V2Kind, { label: string; tone: string; icon: IconName }> = {
  note: { label: "Note", tone: "#6b5f52", icon: "note" },
  essay: { label: "Essay", tone: "#b67616", icon: "essay" },
  pset: { label: "Problem set", tone: "#0e8ee8", icon: "pset" },
  flashcards: { label: "Flashcards", tone: "#20b8b2", icon: "flashcards" },
  thread: { label: "Thread", tone: "#0e8ee8", icon: "thread" },
  reading: { label: "Reading", tone: "#6b5f52", icon: "reading" },
  lab: { label: "Lab", tone: "#20b8b2", icon: "lab" },
  schedule: { label: "Due", tone: "#e05137", icon: "schedule" },
  code: { label: "Code", tone: "#3a322a", icon: "pset" },
  visual: { label: "Visual", tone: "#b67616", icon: "layers" },
};

const PALETTE = ["#20b8b2", "#0e8ee8", "#b67616", "#e05137", "#148f5d", "#6b5f52"];

/* ─── Map canonical itemType to v2 kind ─── */
function toKind(itemType: WorkspaceItemData["itemType"]): V2Kind {
  switch (itemType) {
    case "note": return "note";
    case "export": return "reading";
    case "visual": return "visual";
    case "code": return "code";
    case "board": return "visual";
    case "flashcard_deck": return "flashcards";
    case "quiz": return "flashcards";
    case "thread": return "thread";
    case "planner": return "schedule";
    default: return "note";
  }
}

function timeAgo(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

/* ─── Grid layout for items inside a territory ─── */
function layoutItems(
  wsItems: WorkspaceItemData[],
  workspaceId: string,
  territory: { cx: number; cy: number; w: number; h: number },
  color: string,
): V2Item[] {
  const COLS = 3;
  const cellW = 320;
  const cellH = 240;
  const gapX = 40;
  const gapY = 36;
  const totalW = COLS * cellW + (COLS - 1) * gapX;
  const startX = territory.cx - totalW / 2;
  const startY = territory.cy - territory.h / 2 + 140;
  return wsItems.map((it, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const kind = toKind(it.itemType);
    return {
      id: `v2-${it.id}`,
      sourceId: it.id,
      workspaceId,
      kind,
      title: it.title,
      preview: it.preview,
      x: it.canvasX ?? startX + col * (cellW + gapX),
      y: it.canvasY ?? startY + row * (cellH + gapY),
      w: cellW,
      h: cellH,
      color,
      updated: it.meta ?? timeAgo(it.updatedAt),
      meta: {},
    };
  });
}

/* ─── Convert real workspaces → v2 territories + items ─── */
export function buildV2Graph(workspaces: WorkspaceData[]): { territories: V2Territory[]; items: V2Item[] } {
  if (workspaces.length === 0) return { territories: [], items: [] };
  const COLS = 2;
  const TERR_W = 1400;
  const TERR_H = 900;
  const SPACING_X = 1700;
  const SPACING_Y = 1200;

  const territories: V2Territory[] = workspaces.map((ws, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx = col * SPACING_X - ((COLS - 1) * SPACING_X) / 2;
    const cy = row * SPACING_Y - ((Math.ceil(workspaces.length / COLS) - 1) * SPACING_Y) / 2;
    const color = PALETTE[i % PALETTE.length];
    return {
      id: `terr-${ws.id}`,
      sourceId: ws.id,
      name: ws.name,
      subtitle: `${ws.itemCount} items`,
      glyph: ws.emoji || "◎",
      color,
      cx,
      cy,
      w: TERR_W,
      h: TERR_H,
    };
  });

  const items: V2Item[] = [];
  workspaces.forEach((ws, i) => {
    const terr = territories[i];
    const laid = layoutItems(ws.items, terr.id, terr, terr.color);
    items.push(...laid);
  });

  return { territories, items };
}

/* ─── Quick starts ─── */
export const QUICK_STARTS = [
  { id: "exam-prep", title: "Plan my exam week", blurb: "Creates a study plan across workspaces with focus blocks.", tone: "#0e8ee8" },
  { id: "cram", title: "Cram session for tomorrow", blurb: "Generates flashcards + 90-min plan from your weakest items.", tone: "#e05137" },
  { id: "essay", title: "Help me finish this essay", blurb: "Outline, counter-arg, and a streamlined draft review.", tone: "#b67616" },
  { id: "holiday", title: "Plan a 3-day break", blurb: "Time-blocks study around a break respecting deadlines.", tone: "#20b8b2" },
  { id: "research", title: "Start a research project", blurb: "Sets up source library, outline, and citation scratch.", tone: "#148f5d" },
] as const;

export type QuickStart = (typeof QUICK_STARTS)[number];
