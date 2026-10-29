import type { SpectraArtifact } from "@/features/spectra/data/api";
import type { TreeNode } from "@/features/spectra/organization/tree-client";
import { DEADLINES, ZONE, type WireItem } from "./school";
import { dayAt } from "./story";
import { CLASSES, type ClassKey } from "./works";

/*
 * Henry's classes as their own pages show them: what is to do (from
 * ManageBac), what he made for each, what the teacher shared into it, and the
 * term's past tasks by month. The class page on the landing is the app's own
 * (ClassShelf); this is what it reads.
 */

export const CLASS_KEYS = Object.keys(CLASSES) as ClassKey[];

/** The class page's folder, as the Library tree names it. */
export const folderOf = (key: ClassKey) => `class-${key}`;
export const classOfFolder = (folderId: string) => CLASS_KEYS.find((key) => folderOf(key) === folderId) ?? null;
export const classOfProvider = (providerClassId: string) => CLASS_KEYS.find((key) => CLASSES[key].providerClassId === providerClassId) ?? null;

const block = (id: string, type: string, text: string, attrs?: Record<string, unknown>) => ({ id, type, text, ...(attrs ? { attrs } : {}) });

function doc(id: string, title: string, key: ClassKey, days: number, blocks: ReturnType<typeof block>[], summary: string): SpectraArtifact {
  const place = CLASSES[key];
  const updatedAt = dayAt(days, 18);
  return {
    _id: id,
    blueprintKey: "document",
    title,
    content: { blocks },
    summary,
    tags: [],
    status: "active",
    createdAt: updatedAt - 86_400_000,
    updatedAt,
    placements: [{ workspaceId: place.workspaceId, workspaceTitle: place.title, nodeId: `node-${id}` }],
    placementStatus: "workspace",
    ownership: "owned",
    accessLevel: "modify",
    capabilities: ["read", "modify", "share", "delete", "use", "comment"],
  };
}

/** What Henry made for the classes the story does not visit. */
export const CLASS_WORKS: SpectraArtifact[] = [
  doc(
    "work-sequences",
    "Sequences: worked examples",
    "maths",
    -2,
    [
      block("s-title", "heading", "Arithmetic and geometric sequences", { level: 1 }),
      block("s-a", "paragraph", "Arithmetic: add the same d each time, so uₙ = u₁ + (n − 1)d. Geometric: multiply by r, so uₙ = u₁rⁿ⁻¹."),
      block("s-b", "list", "Sum of n arithmetic terms: n/2 (2u₁ + (n − 1)d)\nSum of n geometric terms: u₁(rⁿ − 1)/(r − 1)\nInfinite sum, only when |r| < 1: u₁/(1 − r)"),
    ],
    "The two kinds of sequence, their sums, and when an infinite sum exists.",
  ),
  doc(
    "work-vocab",
    "El medio ambiente: vocabulario",
    "spanish",
    -4,
    [
      block("v-title", "heading", "El medio ambiente", { level: 1 }),
      block("v-a", "list", "la huella de carbono: carbon footprint\nlos residuos: waste\nreciclar: to recycle\nel calentamiento global: global warming"),
      block("v-b", "paragraph", "Para el oral: una opinión, un ejemplo y una solución en cada respuesta."),
    ],
    "Vocabulary and a plan for the individual oral.",
  ),
  doc(
    "work-ib-notes",
    "Unit 2 notes: Weimar to the Third Reich",
    "history",
    -6,
    [
      block("w-title", "heading", "Weimar to the Third Reich", { level: 1 }),
      block("w-a", "paragraph", "How a democracy voted itself out: the crises of 1923 and 1929, Article 48, and the months from January to March 1933."),
    ],
    "The road from 1923 to the Enabling Act, in order.",
  ),
  doc(
    "work-poem",
    "Unseen poem: annotations",
    "english",
    -1,
    [
      block("p-title", "heading", "Unseen poem", { level: 1 }),
      block("p-a", "paragraph", "The speaker never says she is angry; the short lines and the hard consonants do it for her."),
    ],
    "Annotations on tone, form and the turn in the last stanza.",
  ),
];

/** The source pack Ms Gonzalez shared into History: it shows in Henry's class, under her name. */
export const SOURCE_PACK: SpectraArtifact = {
  ...doc(
    "work-source-pack",
    "Source pack: the Enabling Act",
    "history",
    -1,
    [
      block("sp-title", "heading", "Source pack: the Enabling Act", { level: 1 }),
      block("sp-a", "paragraph", "Source A: the text of the Enabling Act, 23 March 1933. Source B: Otto Wels's speech to the Reichstag the same day."),
      block("sp-b", "callout", "For each source: origin, purpose, content. Then one value and one limitation.", { tone: "info" }),
    ],
    "Two sources for the analysis due this week.",
  ),
  ownership: "shared",
  accessLevel: "read",
  capabilities: ["read", "use", "comment"],
};

export function treeNode(work: SpectraArtifact, parentId: string): TreeNode {
  return {
    nodeId: `node-${work._id}`,
    parentId,
    kind: "work",
    name: work.title,
    sourceId: work._id,
    orderKey: String(work.updatedAt),
    pinned: false,
    isContainer: false,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    activityAt: work.updatedAt,
    typeKey: work.blueprintKey,
    source: { blueprintKey: work.blueprintKey, title: work.title, summary: work.summary, updatedAt: work.updatedAt, available: true },
  } as TreeNode;
}

/** The works a class's page lists: everything placed in its workspace. */
export const inClass = (work: SpectraArtifact, key: ClassKey) =>
  work.placements?.some((placement) => placement.workspaceId === CLASSES[key].workspaceId) ?? false;

/** The term so far, as ManageBac has it: what each class set and is already past. */
const PAST: Record<ClassKey, Array<[string, number]>> = {
  history: [
    ["Paper 1 practice: Weimar sources", -9],
    ["Essay plan: causes of the Depression", -16],
    ["Reading quiz: the Treaty of Versailles", -24],
    ["Timeline: 1918 to 1923", -38],
  ],
  biology: [
    ["Enzymes practical write-up", -6],
    ["Cell structure quiz", -14],
    ["Microscopy drawing", -27],
    ["Membranes: data question", -41],
  ],
  english: [
    ["Commentary: advertising texts", -8],
    ["Learner portfolio entry 2", -20],
    ["Frankenstein reading log", -33],
  ],
  maths: [
    ["Problem set 3: functions", -7],
    ["Quiz: indices and logarithms", -15],
    ["Problem set 2: algebra", -28],
  ],
  spanish: [
    ["Escritura: un correo formal", -5],
    ["Comprensión auditiva 3", -19],
    ["Vocabulario: la tecnología", -31],
  ],
};

const pastItem = (key: ClassKey, title: string, days: number, index: number): WireItem => ({
  id: `past-${key}-${index}`,
  kind: "official_deadline",
  title,
  startAt: dayAt(days, 8),
  endAt: dayAt(days, 8),
  timezone: ZONE,
  status: "active",
  sourceLocked: true,
  classId: CLASSES[key].providerClassId,
  teacher: CLASSES[key].teacher,
  linkedWorkIds: [],
  revision: 1,
});

export const PAST_TASKS: WireItem[] = CLASS_KEYS.flatMap((key) => PAST[key].map(([title, days], index) => pastItem(key, title, days, index)));

/** New from ManageBac in the Classes scene: one per class, each set as Henry watches. */
export const NEW_TASKS: Record<ClassKey, WireItem> = {
  // Copies of the story's own, so this scene never takes back what another one filed.
  history: { ...DEADLINES.sourceAnalysis, id: "new-history" },
  biology: {
    ...pastItem("biology", "Data question: rates of photosynthesis", 6, 0),
    id: "new-biology",
    notes: "Paper 3 style, from the light intensity data.",
  },
  english: {
    ...pastItem("english", "Individual oral: outline", 9, 0),
    id: "new-english",
    notes: "Bullet points only, 10 of them at most.",
  },
  maths: {
    ...pastItem("maths", "Investigation: choosing a topic", 8, 0),
    id: "new-maths",
    notes: "One paragraph on the maths you would like to explore.",
  },
  spanish: {
    ...pastItem("spanish", "Presentación: mi ciudad ideal", 5, 0),
    id: "new-spanish",
    notes: "Tres minutos, con una imagen.",
  },
};
