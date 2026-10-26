import type { SpectraArtifact, SpectraBlueprintKey } from "@/features/spectra/data/api";
import { normalizePresentationContent } from "@/features/spectra/presentation/model";
import { dayAt } from "./story";

/*
 * Henry's works, with their real content. Each opens in the real studio for
 * its kind, so what a visitor reads, flips or answers on the landing page is
 * what Spectra would show Henry.
 */

export type ClassKey = "history" | "biology" | "english" | "maths" | "spanish";

export const CLASSES: Record<ClassKey, { workspaceId: string; providerClassId: string; title: string; teacher: string }> = {
  history: { workspaceId: "ws-history", providerClassId: "mb-history", title: "History HL", teacher: "Ms Gonzalez" },
  biology: { workspaceId: "ws-biology", providerClassId: "mb-biology", title: "Biology SL", teacher: "Mr Okafor" },
  english: { workspaceId: "ws-english", providerClassId: "mb-english", title: "English A: Lang & Lit", teacher: "Ms Lindqvist" },
  maths: { workspaceId: "ws-maths", providerClassId: "mb-maths", title: "Maths AA SL", teacher: "Mr Haddad" },
  spanish: { workspaceId: "ws-spanish", providerClassId: "mb-spanish", title: "Spanish B", teacher: "Sra. Ruiz" },
};

const block = (id: string, type: string, text: string, attrs?: Record<string, unknown>) => ({
  id,
  type,
  text,
  ...(attrs ? { attrs } : {}),
});

export const NOTES_CONTENT = {
  blocks: [
    block("n-title", "heading", "Cell respiration", { level: 1 }),
    block("n-lede", "paragraph", "Respiration releases energy from glucose as ATP. It happens in every living cell, all the time, not only when you breathe."),
    block("n-aerobic", "heading", "Aerobic respiration", { level: 2 }),
    block("n-equation", "paragraph", "Glucose + oxygen → carbon dioxide + water, releasing a large amount of ATP (about 30 to 32 per glucose)."),
    block("n-stages", "list", "Glycolysis, in the cytoplasm: glucose is split into two pyruvate, net 2 ATP\nThe link reaction, in the mitochondrial matrix: pyruvate becomes acetyl CoA\nThe Krebs cycle, in the matrix: CO2 is released, NADH and FADH2 carry electrons\nOxidative phosphorylation, on the inner membrane: most of the ATP is made"),
    block("n-anaerobic", "heading", "Anaerobic respiration", { level: 2 }),
    block("n-anaerobic-text", "paragraph", "Without oxygen only glycolysis runs, so there is far less ATP. Yeast makes ethanol and CO2; muscle makes lactate, which is why it burns after a sprint."),
    block("n-callout", "callout", "Remember: oxygen is the final electron acceptor. No oxygen, no electron transport chain.", { tone: "warning" }),
    block("n-mitochondria", "heading", "Why the mitochondria matter", { level: 2 }),
    block("n-mito-text", "paragraph", "The folded inner membrane (the cristae) gives a large surface for the electron transport chain and ATP synthase. Cells that need a lot of energy, like muscle and sperm cells, have many mitochondria."),
  ],
};

export const IA_CONTENT = {
  blocks: [
    block("ia-title", "heading", "To what extent did the Enabling Act of 1933 give Hitler legal power?", { level: 1 }),
    block("ia-a", "heading", "Identification and evaluation of sources", { level: 2 }),
    block("ia-a1", "paragraph", "This investigation looks at how the Enabling Act of March 1933 changed the way power was held in Germany. The first source is the text of the Act itself, which allowed the cabinet to pass laws without the Reichstag for four years."),
    block("ia-a2", "paragraph", "The second source is a speech by Otto Wels, leader of the SPD, given in the Reichstag before the vote. Its value is that it was spoken by an opponent in the room, at the time, knowing the risk."),
    block("ia-b", "heading", "Investigation", { level: 2 }),
    block("ia-b1", "paragraph", "The Act was passed by 444 votes to 94, but the vote took place with SA men lining the Kroll Opera House and the Communist deputies already arrested or in hiding. It was legal in form, but the conditions of the vote were not free."),
    block("ia-b2", "paragraph", "Historians disagree about how much the Act mattered. Some argue that it was the legal foundation of the dictatorship, others that power was really taken through terror on the streets and the Reichstag Fire Decree a month earlier."),
  ],
};

const question = (id: string, prompt: string, options: string[], correct: string, explanation: string) => ({
  id,
  prompt,
  type: "multiple_choice" as const,
  options,
  correctAnswer: correct,
  explanation,
  difficulty: "medium" as const,
  sourceRefs: ["work-notes"],
  feedback: "",
});

export const QUIZ_CONTENT = {
  questions: [
    question("q1", "Where in the cell does glycolysis take place?", ["The cytoplasm", "The mitochondrial matrix", "The inner mitochondrial membrane", "The nucleus"], "The cytoplasm", "Glycolysis needs no organelle: glucose is split in the cytoplasm."),
    question("q2", "What is the final electron acceptor in aerobic respiration?", ["Oxygen", "NAD+", "Pyruvate", "Carbon dioxide"], "Oxygen", "Oxygen accepts electrons at the end of the chain and forms water."),
    question("q3", "What does yeast produce in anaerobic respiration?", ["Ethanol and carbon dioxide", "Lactate", "Water and carbon dioxide", "Acetyl CoA"], "Ethanol and carbon dioxide", "That is why bread rises and why yeast is used to make alcohol."),
    question("q4", "Why do muscle cells have many mitochondria?", ["They need a lot of ATP", "They store glucose there", "Mitochondria make the cell stronger", "They make lactate"], "They need a lot of ATP", "More mitochondria means more electron transport chains making ATP."),
    question("q5", "Roughly how much ATP does one glucose give in aerobic respiration?", ["About 30 to 32", "2", "About 100", "About 12"], "About 30 to 32", "Glycolysis gives 2; oxidative phosphorylation gives most of the rest."),
  ],
  settings: {
    showAnswersImmediately: true,
    timed: false,
    shuffleQuestions: false,
    passingScore: 0,
    experience: {
      persistence: "personal",
      identity: "signed_in",
      timing: "untimed",
      attempts: "unlimited",
      revealAnswers: "immediate",
      resultsVisibility: "learner",
    },
  },
};

const card = (id: string, front: string, back: string, hint = "") => ({
  id,
  front,
  back,
  hint,
  sourceRefs: ["work-notes"],
  confidence: "unknown" as const,
  section: "Cell respiration",
  tags: [],
});

export const CARDS_CONTENT = {
  cards: [
    card("c1", "What is respiration for?", "Releasing energy from glucose as ATP, in every living cell."),
    card("c2", "Where does glycolysis happen?", "In the cytoplasm. Glucose → two pyruvate, net 2 ATP."),
    card("c3", "What happens in the link reaction?", "Pyruvate becomes acetyl CoA in the mitochondrial matrix, releasing CO2."),
    card("c4", "What is the final electron acceptor?", "Oxygen. It forms water at the end of the electron transport chain.", "Think about what you breathe in."),
    card("c5", "Anaerobic respiration in yeast gives…", "Ethanol and carbon dioxide."),
    card("c6", "Anaerobic respiration in muscle gives…", "Lactate. Little ATP, and the burn after a sprint."),
    card("c7", "Why are the cristae folded?", "A larger surface for the electron transport chain and ATP synthase."),
    card("c8", "Roughly how much ATP per glucose, aerobically?", "About 30 to 32."),
  ],
  settings: { shuffle: true, revealMode: "click", showHints: true },
};

const INK = "#1f1d1a";
const textObject = (id: string, text: string, x: number, y: number, width: number, height: number, style: Record<string, unknown>) => ({
  id,
  type: "text" as const,
  x,
  y,
  width,
  height,
  rotation: 0,
  content: { text },
  style: { color: INK, ...style },
});

const slide = (id: string, title: string, body?: string) => ({
  id,
  title,
  layoutId: body ? "title-content" : "title-only",
  transition: { kind: "fade" as const, durationMs: 350 },
  speakerNotes: "",
  objects: [
    textObject(`${id}-title`, title, 80, body ? 60 : 200, 840, body ? 90 : 130, { fontSize: body ? 40 : 54, fontWeight: 700, align: body ? "left" : "center" }),
    ...(body ? [textObject(`${id}-body`, body, 80, 170, 840, 320, { fontSize: 24, lineHeight: 1.5 })] : []),
  ],
});

export const DECK_CONTENT = normalizePresentationContent({
  theme: { id: "spectra-default" },
  slides: [
    slide("s1", "Cell respiration, in five slides"),
    slide("s2", "Why cells respire", "Every cell needs ATP, all the time.\nRespiration releases it from glucose.\nIt is not the same as breathing."),
    slide("s3", "Four stages", "Glycolysis, in the cytoplasm\nThe link reaction, in the matrix\nThe Krebs cycle, in the matrix\nOxidative phosphorylation, on the cristae"),
    slide("s4", "Without oxygen", "Only glycolysis runs: 2 ATP per glucose.\nYeast: ethanol and CO2.\nMuscle: lactate."),
    slide("s5", "Remember for Thursday", "Oxygen is the final electron acceptor.\nThe cristae give the chain its surface.\nAerobic gives about 30 to 32 ATP."),
  ],
  settings: { aspectRatio: "16:9", defaultTransition: "none", showSlideNumbers: true },
});

export const SHEET_CONTENT = {
  workbook: { calculationMode: "automatic", locale: "en-GB" },
  sheets: [
    {
      id: "sheet-yeast",
      name: "Yeast",
      cells: {
        A1: { value: "Temperature (°C)", format: { bold: true } },
        B1: { value: "CO2 in 10 min (cm³)", format: { bold: true } },
        C1: { value: "Rate (cm³/min)", format: { bold: true } },
        A2: { value: 15 }, B2: { value: 4.2 }, C2: { formula: "=B2/10" },
        A3: { value: 25 }, B3: { value: 9.8 }, C3: { formula: "=B3/10" },
        A4: { value: 35 }, B4: { value: 17.5 }, C4: { formula: "=B4/10" },
        A5: { value: 45 }, B5: { value: 12.1 }, C5: { formula: "=B5/10" },
        A6: { value: 55 }, B6: { value: 2.3 }, C6: { formula: "=B6/10" },
        A8: { value: "Fastest", format: { italic: true } },
        B8: { formula: "=MAX(B2:B6)" },
      },
      tables: [],
      charts: [
        {
          id: "chart-yeast",
          type: "line",
          sourceRange: "A1:B6",
          title: "Yeast respiration by temperature",
          showLegend: false,
          position: { x: 380, y: 20, width: 420, height: 260 },
        },
      ],
      columnWidths: { A: 140, B: 170, C: 140 },
    },
  ],
  activeSheetId: "sheet-yeast",
};

export const ESSAY_CONTENT = {
  blocks: [
    block("e-title", "heading", "How does Shelley present ambition in Frankenstein?", { level: 1 }),
    block("e-1", "paragraph", "From Walton's first letter, ambition is a light that blinds. He wants to reach \"a land surpassing in wonders\" and does not count the cost to his crew."),
    block("e-2", "paragraph", "Victor's ambition is the same light turned inward: he works alone, at night, and stops seeing the people who love him."),
  ],
};

export type StoryWork = SpectraArtifact & { classKey: ClassKey | null };

const stamp = (days: number, hour: number) => dayAt(days, hour);

function work(
  id: string,
  blueprintKey: SpectraBlueprintKey,
  title: string,
  classKey: ClassKey | null,
  content: unknown,
  updatedAt: number,
  extra: Partial<SpectraArtifact> = {},
): StoryWork {
  const place = classKey ? CLASSES[classKey] : null;
  return {
    _id: id,
    blueprintKey,
    title,
    content,
    tags: [],
    status: "active",
    createdAt: updatedAt - 86_400_000,
    updatedAt,
    placements: place ? [{ workspaceId: place.workspaceId, workspaceTitle: place.title, nodeId: `node-${id}` }] : [],
    placementStatus: place ? "workspace" : "inbox",
    ownership: "owned",
    accessLevel: "modify",
    capabilities: ["read", "modify", "share", "delete", "use", "comment"],
    classKey,
    ...extra,
  };
}

export const WORKS = {
  notes: work("work-notes", "document", "Cell respiration notes", "biology", NOTES_CONTENT, stamp(0, 20), {
    summary: "Glycolysis, the link reaction, the Krebs cycle and the electron transport chain.",
  }),
  ia: work("work-ia", "document", "History IA draft", "history", IA_CONTENT, stamp(-1, 18), {
    summary: "To what extent did the Enabling Act of 1933 give Hitler legal power?",
    isShared: true,
    sharedWithCount: 1,
  }),
  quiz: work("work-quiz", "quiz", "Cell respiration: check yourself", "biology", QUIZ_CONTENT, stamp(0, 21)),
  cards: work("work-cards", "flashcard_deck", "Respiration cards", "biology", CARDS_CONTENT, stamp(0, 21)),
  deck: work("work-deck", "presentation", "Respiration in five slides", "biology", DECK_CONTENT, stamp(0, 21)),
  sheet: work("work-sheet", "sheets", "Yeast lab results", "biology", SHEET_CONTENT, stamp(-2, 16)),
  essay: work("work-essay", "document", "Frankenstein: ambition essay", "english", ESSAY_CONTENT, stamp(-3, 19)),
} satisfies Record<string, StoryWork>;

export type WorkKey = keyof typeof WORKS;
export const ALL_WORKS: StoryWork[] = Object.values(WORKS);
