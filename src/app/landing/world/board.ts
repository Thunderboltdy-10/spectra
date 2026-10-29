import type { SpectraArtifact } from "@/features/spectra/data/api";
import { STORY, TODAY } from "./story";

/*
 * The board this page was planned on, in Spectra: one frame for each section,
 * the headline in each, and the notes left while it was made. The reveal opens
 * it in the real whiteboard studio, so it can be moved around and written on.
 */

const FRAME = { width: 560, height: 340, gap: 90, columns: 4 };

const SECTIONS: Array<{ id: string; title: string; headline: string; note?: string }> = [
  { id: "hero", title: "Hero", headline: "All your schoolwork, in one place.", note: "the prism flies into the island" },
  { id: "glue", title: "The glue", headline: "School runs on a dozen apps that have never heard of each other." },
  { id: "ask", title: "Ask", headline: "Ask the one place that knows.", note: "vague question, specific answer" },
  { id: "make", title: "Make", headline: "Make anything from what you already have." },
  { id: "teachers", title: "Teachers", headline: "For teachers, an agent takes the first pass.", note: "every mark is still hers" },
  { id: "laptop", title: "Laptop", headline: "The files on your laptop are in it too." },
  { id: "together", title: "Together", headline: "It works on your document with you, and so can your teacher." },
  { id: "school", title: "School", headline: "Your school's calendar, with time to do the work in it." },
  { id: "night", title: "Night", headline: "While Henry sleeps, it keeps up.", note: "dark, slowly" },
  { id: "morning", title: "Morning", headline: "Wake up to a plan, not a pile." },
  { id: "board", title: "This board", headline: "This page was made in Spectra." },
  { id: "door", title: "Door", headline: "See it with your own classes.", note: "a real form, not a mailto" },
];

const node = (id: string, type: string, x: number, y: number, width: number, height: number, content: unknown, style?: Record<string, unknown>, rotation = 0) => ({
  id,
  type,
  pageId: "page-1",
  layerId: "layer-1",
  x,
  y,
  width,
  height,
  rotation,
  zIndex: 0,
  content,
  ...(style ? { style } : {}),
});

const NOTE = { fill: "color-mix(in oklab, var(--accent-gold) 28%, var(--card-paper))", stroke: "transparent", color: "var(--text-primary)" };

function nodes() {
  const out: ReturnType<typeof node>[] = [];
  SECTIONS.forEach((section, index) => {
    const x = (index % FRAME.columns) * (FRAME.width + FRAME.gap);
    const y = Math.floor(index / FRAME.columns) * (FRAME.height + FRAME.gap);
    out.push(node(`frame-${section.id}`, "frame", x, y, FRAME.width, FRAME.height, { title: section.title }, { fill: "var(--card-paper)", stroke: "var(--border-strong)" }));
    out.push(node(`head-${section.id}`, "text", x + 36, y + 70, FRAME.width - 72, 150, { text: section.headline }, { color: "var(--text-primary)", fontSize: 30, fontWeight: 600 }));
    if (section.note) out.push(node(`note-${section.id}`, "note", x + FRAME.width - 230, y + FRAME.height - 120, 200, 96, { text: section.note }, NOTE, index % 2 ? 2 : -2));
  });
  // The line that did not make it.
  out.push(node(SUPERCHARGE, "note", 120, -170, 250, 110, { text: "~~Supercharge your learning~~" }, NOTE, -4));
  return out.map((entry, index) => ({ ...entry, zIndex: index + 1 }));
}

export const SUPERCHARGE = "note-supercharge";

export const BOARD_CONTENT = {
  viewport: { x: -80, y: -230, zoom: 0.42, pageId: "page-1" },
  pages: [{ id: "page-1", name: "Landing page" }],
  layers: [{ id: "layer-1", pageId: "page-1", name: "Canvas", visible: true, locked: false }],
  nodes: nodes(),
  edges: [],
  zOrder: [],
  settings: { gridSize: 24, snapToGrid: false, showGrid: true },
};

/** Where the supercharge note is in `nodes`, which is how the board addresses it. */
export const SUPERCHARGE_INDEX = BOARD_CONTENT.nodes.findIndex((entry) => entry.id === SUPERCHARGE);

export const PAGE_BOARD: SpectraArtifact = {
  _id: "work-landing-board",
  blueprintKey: "whiteboard",
  title: "Landing page",
  content: BOARD_CONTENT,
  tags: [],
  status: "active",
  createdAt: TODAY - 30 * 86_400_000,
  updatedAt: STORY.evening,
  placements: [],
  placementStatus: "inbox",
  ownership: "owned",
  accessLevel: "modify",
  capabilities: ["read", "modify", "use", "comment"],
};
