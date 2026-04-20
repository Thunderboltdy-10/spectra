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
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  contentTop: number;
  contentBottom: number;
};

export type V2Item = {
  id: string;
  sourceId: string;            // real item id
  sourceArtifactId?: string;
  sourcePlannerItemId?: string;
  sourceChatId?: string;
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

export const V2_LAYOUT = {
  itemW: 280,
  itemH: 240,
  gapX: 24,
  gapY: 28,
  sectionGap: 64,
  sectionGapX: 56,
  sidePad: 80,
  topPad: 168,
  bottomPad: 96,
  titleInsetX: 30,
  titleInsetY: 24,
  titleBlockH: 116,
  minCols: 1,
  maxCols: 4,
  compactCols: 2,
  minTerritoryW: 1080,
  maxTerritoryW: 1680,
  minTerritoryH: 820,
  territoryGapX: 240,
  territoryGapY: 280,
  atlasCols: 2,
} as const;

/**
 * Compute the *base* territory size from item count alone.
 * The actual rendered height may grow if section packing in app.tsx
 * spills past `contentBottom`; the atlas allocates extra Y headroom
 * (`territoryGapY`) so workspaces never overlap each other vertically.
 */
function computeTerritorySize(itemCount: number) {
  const {
    itemW,
    itemH,
    gapX,
    gapY,
    sidePad,
    topPad,
    bottomPad,
    minCols,
    maxCols,
    compactCols,
    minTerritoryW,
    maxTerritoryW,
    minTerritoryH,
  } = V2_LAYOUT;

  const safeCount = Math.max(itemCount, 1);
  const cols = Math.max(minCols, Math.min(maxCols, Math.ceil(Math.sqrt(safeCount))));
  const targetCols = safeCount <= 2 ? safeCount : Math.max(compactCols, cols);
  const safeCols = Math.max(minCols, Math.min(maxCols, targetCols));
  const width = Math.max(
    minTerritoryW,
    Math.min(maxTerritoryW, sidePad * 2 + safeCols * itemW + Math.max(0, safeCols - 1) * gapX),
  );
  const rows = Math.max(1, Math.ceil(safeCount / safeCols));
  const height = Math.max(
    minTerritoryH,
    topPad + bottomPad + rows * itemH + Math.max(0, rows - 1) * gapY,
  );

  return { width, height, columns: safeCols };
}

/* ─── Grid layout for items inside a territory ─── */
function layoutItems(
  wsItems: WorkspaceItemData[],
  workspaceId: string,
  territory: { cx: number; cy: number; w: number; h: number; contentTop: number },
  color: string,
): V2Item[] {
  const { itemW: cellW, itemH: cellH, gapX, gapY, sidePad } = V2_LAYOUT;
  const usableW = territory.w - sidePad * 2;
  const cols = Math.max(1, Math.min(4, Math.floor((usableW + gapX) / (cellW + gapX))));
  const totalW = cols * cellW + (cols - 1) * gapX;
  const startX = territory.cx - totalW / 2;
  const startY = territory.contentTop;
  const clusters = new Map<string, WorkspaceItemData[]>();
  wsItems.forEach((item) => {
    const cluster = (item.topicCluster?.trim() || item.itemType || "misc").toLowerCase();
    const bucket = clusters.get(cluster) ?? [];
    bucket.push(item);
    clusters.set(cluster, bucket);
  });
  const ordered = Array.from(clusters.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .flatMap(([, items]) => items);
  return wsItems.map((it, i) => {
    const orderedIndex = ordered.findIndex((row) => row.id === it.id);
    const index = orderedIndex >= 0 ? orderedIndex : i;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const kind = toKind(it.itemType);
    return {
      id: `v2-${it.id}`,
      sourceId: it.id,
      sourceArtifactId: it.sourceArtifactId,
      sourcePlannerItemId: it.sourcePlannerItemId,
      sourceChatId: it.sourceChatId,
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
  const { atlasCols, territoryGapX, territoryGapY, titleInsetY, titleBlockH } = V2_LAYOUT;

  // Step 1: precompute each workspace's frame (width/height based on item count).
  const frames = workspaces.map((ws, i) => ({
    ws,
    color: PALETTE[i % PALETTE.length],
    row: Math.floor(i / atlasCols),
    ...computeTerritorySize(ws.items.length),
  }));

  // Step 2: per-row geometry — tallest wins, total width is sum+gaps.
  const totalRows = Math.ceil(workspaces.length / atlasCols);
  const rowHeights: number[] = Array.from({ length: totalRows }, () => V2_LAYOUT.minTerritoryH);
  const rowWidths: number[] = Array.from({ length: totalRows }, () => 0);
  frames.forEach((frame) => {
    rowHeights[frame.row] = Math.max(rowHeights[frame.row], frame.height);
    rowWidths[frame.row] += frame.width;
  });
  // Add inter-territory gaps to each row's total width.
  for (let row = 0; row < totalRows; row += 1) {
    const rowCount = frames.filter((frame) => frame.row === row).length;
    rowWidths[row] += Math.max(0, rowCount - 1) * territoryGapX;
  }

  // Step 3: stack rows vertically with a generous vertical gap so workspaces
  // can never visually collide even if section packing grows them a bit.
  const rowOffsets: number[] = Array.from({ length: totalRows }, () => 0);
  let yCursor = 0;
  for (let row = 0; row < totalRows; row += 1) {
    rowOffsets[row] = yCursor;
    yCursor += rowHeights[row] + territoryGapY;
  }
  const totalHeight = yCursor - territoryGapY;

  // Step 4: place each territory centered on its row.
  const territories: V2Territory[] = frames.map((frame) => {
    const row = frame.row;
    const rowItems = frames.filter((f) => f.row === row);
    const rowStartX = -rowWidths[row] / 2;
    // Determine x based on order within row.
    const indexInRow = rowItems.findIndex((f) => f.ws.id === frame.ws.id);
    const xOffset = rowItems
      .slice(0, indexInRow)
      .reduce((sum, f) => sum + f.width + territoryGapX, 0);
    const cx = rowStartX + xOffset + frame.width / 2;
    const cy = rowOffsets[row] - totalHeight / 2 + frame.height / 2;
    const contentTop = cy - frame.height / 2 + titleInsetY + titleBlockH;
    return {
      id: `terr-${frame.ws.id}`,
      sourceId: frame.ws.id,
      name: frame.ws.name,
      subtitle: `${frame.ws.itemCount} items`,
      glyph: frame.ws.emoji || "◎",
      color: frame.color,
      cx,
      cy,
      w: frame.width,
      h: frame.height,
      minX: cx - frame.width / 2,
      maxX: cx + frame.width / 2,
      minY: cy - frame.height / 2,
      maxY: cy + frame.height / 2,
      contentTop,
      contentBottom: cy + frame.height / 2 - V2_LAYOUT.bottomPad,
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
