/**
 * The labelled semantic fixture set: one student's work (30 items across every indexed kind) and
 * the queries a student or the agent would type, with the items that answer them. Categories
 * cover exact titles, paraphrase, Spanish, typos and the short, vague references the agent
 * resolves ("my chemistry notes", "the essay from yesterday").
 */

/** Sunday 4 October 2026, 12:00 UTC. Every fixture time is relative to it. */
export const EVAL_NOW = Date.parse("2026-10-04T12:00:00Z");
const DAY = 86_400_000;
export const daysFromNow = (days: number) => EVAL_NOW + days * DAY;

type Block = { id: string; type: "heading" | "paragraph"; text: string };
const doc = (...parts: Array<string | [string]>) => ({
  blocks: parts.map((part, index): Block => Array.isArray(part)
    ? { id: `b${index + 1}`, type: "heading", text: part[0] }
    : { id: `b${index + 1}`, type: "paragraph", text: part }),
});
const slides = (...list: Array<[string, ...string[]]>) => ({
  slides: list.map(([title, ...texts], index) => ({ id: `s${index + 1}`, title,
    objects: texts.map((text, objectIndex) => ({ id: `s${index + 1}o${objectIndex + 1}`, type: "text", content: { text } })) })),
});

export type FixtureArtifact = { key: string; kind: "artifact"; blueprintKey: string; title: string; summary?: string; tags?: string[];
  content: unknown; updatedDaysAgo: number; workspace?: "biology" | "history" };
export type FixtureThread = { key: string; kind: "thread"; title: string; summaryShort?: string;
  messages: Array<["user" | "assistant", string]>; updatedDaysAgo: number; about?: string };
export type FixtureEvent = { key: string; kind: "event"; title: string; eventKind: "official_event" | "personal_event" | "task";
  startInDays: number; notes?: string; location?: string };
export type FixtureSchool = { key: string; kind: "school"; recordType: string; title: string; audience: "class" | "mine" | "school";
  normalized: Record<string, unknown>; updatedDaysAgo: number };
export type FixtureItem = FixtureArtifact | FixtureThread | FixtureEvent | FixtureSchool;

export const FIXTURE_ITEMS: FixtureItem[] = [
  { key: "a-cell-notes", kind: "artifact", blueprintKey: "document", title: "Cell Biology Notes", workspace: "biology", updatedDaysAgo: 3,
    content: doc(["The cell"], "Mitochondria are the powerhouse of the cell and produce ATP through respiration.",
      "The nucleus stores DNA and controls the activities of the cell.", ["Membranes"],
      "The cell membrane is a phospholipid bilayer that controls what enters and leaves.") },
  { key: "a-cells-deck", kind: "artifact", blueprintKey: "presentation", title: "Cells and Organelles", workspace: "biology", updatedDaysAgo: 1,
    content: slides(["What is a cell?", "The smallest unit of life."], ["Organelles", "Ribosomes, mitochondria and chloroplasts each have a job."],
      ["Plant vs animal cells", "Plant cells have a cell wall and chloroplasts."]) },
  { key: "a-acids-notes", kind: "artifact", blueprintKey: "document", title: "Chemistry: Acids and Bases", updatedDaysAgo: 5,
    content: doc("pH measures how acidic or basic a solution is, from 0 to 14.", "Neutralisation: an acid and a base react to make a salt and water.",
      "Indicators such as litmus change colour with pH.") },
  { key: "a-titration-sheet", kind: "artifact", blueprintKey: "sheets", title: "Titration Lab Data", updatedDaysAgo: 6,
    content: { sheets: [{ id: "sheet-1", name: "Trials", cells: { A1: "Trial", B1: "Volume NaOH (mL)", C1: "pH",
      A2: "1", B2: "12.5", C2: "7.1", A3: "2", B3: "12.3", C3: "6.9" } }] } },
  { key: "a-wwi-essay", kind: "artifact", blueprintKey: "document", title: "Essay: Causes of the First World War", workspace: "history", updatedDaysAgo: 1,
    content: doc(["Introduction"], "The war began in 1914 after the assassination of Archduke Franz Ferdinand in Sarajevo.",
      ["Long-term causes"], "Militarism, the alliance system, imperialism and nationalism made a European war likely.") },
  { key: "a-photosynthesis", kind: "artifact", blueprintKey: "document", title: "Photosynthesis summary", workspace: "biology", updatedDaysAgo: 10,
    content: doc("Chlorophyll absorbs light energy.", "In the light-dependent reactions water is split and oxygen is released.",
      "The Calvin cycle fixes carbon dioxide into glucose.") },
  { key: "a-spanish-food", kind: "artifact", blueprintKey: "flashcard_deck", title: "Spanish vocabulary: food", updatedDaysAgo: 20,
    content: { cards: [{ id: "c1", front: "la manzana", back: "the apple" }, { id: "c2", front: "el pan", back: "the bread" },
      { id: "c3", front: "la leche", back: "the milk" }, { id: "c4", front: "el queso", back: "the cheese" }] } },
  { key: "a-periodic-quiz", kind: "artifact", blueprintKey: "quiz", title: "Periodic table quiz", updatedDaysAgo: 4,
    content: { questions: [{ id: "q1", prompt: "Which element has atomic number 1?", options: ["Hydrogen", "Helium", "Lithium"],
      explanation: "Hydrogen has exactly one proton." }, { id: "q2", prompt: "Which group holds the noble gases?", options: ["Group 1", "Group 18"],
      explanation: "Noble gases sit in group 18." }] } },
  { key: "a-climate-board", kind: "artifact", blueprintKey: "whiteboard", title: "Climate change mind map", updatedDaysAgo: 12,
    content: { nodes: [{ id: "f1", type: "frame", semanticLabel: "Causes" },
      { id: "n1", type: "sticky", frameId: "f1", content: { text: "Burning fossil fuels releases carbon dioxide, a greenhouse gas." } },
      { id: "f2", type: "frame", semanticLabel: "Effects" },
      { id: "n2", type: "sticky", frameId: "f2", content: { text: "Sea level rise and more extreme weather." } }] } },
  { key: "a-history-task", kind: "artifact", blueprintKey: "planner_task", title: "Finish history essay draft", workspace: "history", updatedDaysAgo: 2,
    content: { taskTitle: "Finish history essay draft", description: "Write the conclusion and add citations to the First World War essay." } },
  { key: "a-fib-code", kind: "artifact", blueprintKey: "code", title: "Fibonacci in Python", updatedDaysAgo: 30,
    content: { files: [{ id: "f1", path: "main.py", source: "def fib(n, memo={}):\n    # memoised recursion\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n" }] } },
  { key: "a-coach-agent", kind: "artifact", blueprintKey: "agent", title: "Essay feedback coach", updatedDaysAgo: 15,
    content: { profile: { purpose: "Gives feedback on essay structure, thesis and use of evidence." },
      instructions: { text: "Ask for the essay question first, then comment on the argument paragraph by paragraph." } } },
  { key: "a-macbeth", kind: "artifact", blueprintKey: "document", title: "Macbeth character analysis", updatedDaysAgo: 8,
    content: doc("Lady Macbeth's ambition drives the murder of Duncan.", "Guilt later consumes her: she sleepwalks and tries to wash imagined blood from her hands.") },
  { key: "a-energy-deck", kind: "artifact", blueprintKey: "presentation", title: "Renewable energy pitch", updatedDaysAgo: 9,
    content: slides(["Why renewables", "Solar panels and wind turbines now cost less per kWh than coal."], ["Our plan", "Put solar panels on the school roof."]) },
  { key: "a-revolucion", kind: "artifact", blueprintKey: "document", title: "Apuntes: la Revolución Francesa", workspace: "history", updatedDaysAgo: 7,
    content: doc("La toma de la Bastilla el 14 de julio de 1789.", "Causas: crisis económica y desigualdad entre los estamentos.",
      "La Declaración de los Derechos del Hombre y del Ciudadano.") },
  { key: "a-quadratics", kind: "artifact", blueprintKey: "document", title: "Quadratic equations", updatedDaysAgo: 14,
    content: doc("A quadratic has the form ax² + bx + c = 0.", "The discriminant b² − 4ac tells how many real roots there are.", "Completing the square.") },
  { key: "a-budget", kind: "artifact", blueprintKey: "sheets", title: "Monthly budget", updatedDaysAgo: 25,
    content: { sheets: [{ id: "sheet-1", name: "October", cells: { A1: "Item", B1: "Amount", A2: "Phone", B2: "15", A3: "Savings", B3: "40" } }] } },
  { key: "a-newton", kind: "artifact", blueprintKey: "document", title: "Newton's laws of motion", updatedDaysAgo: 11,
    content: doc("First law: an object stays at rest or in uniform motion unless a force acts (inertia).",
      "Second law: F = ma, force equals mass times acceleration.", "Third law: every action has an equal and opposite reaction.") },
  { key: "a-volcano-deck", kind: "artifact", blueprintKey: "presentation", title: "Volcanoes and plate tectonics", updatedDaysAgo: 16,
    content: slides(["Plate boundaries", "Magma rises where tectonic plates pull apart."], ["Ring of Fire", "Most eruptions happen around the Pacific."]) },
  { key: "a-enzymes-notes", kind: "artifact", blueprintKey: "document", title: "Enzymes", workspace: "biology", updatedDaysAgo: 2,
    content: doc("Enzymes are biological catalysts.", "Temperature and pH change enzyme activity; too much heat denatures the active site.") },
  { key: "t-titration-help", kind: "thread", title: "Help with titration calculation", updatedDaysAgo: 1,
    messages: [["user", "How do I work out the concentration of the acid from my titration results?"],
      ["assistant", "Use moles = concentration × volume. At the end point the moles of NaOH equal the moles of HCl, so divide by the acid volume."]] },
  { key: "t-wwi-brainstorm", kind: "thread", title: "Brainstorm: WWI essay thesis", updatedDaysAgo: 3, about: "a-wwi-essay",
    messages: [["user", "Help me pick a thesis about why the war started in 1914."],
      ["assistant", "You could argue that the alliance system turned a regional crisis in the Balkans into a world war."]] },
  { key: "t-fotosintesis", kind: "thread", title: "Dudas sobre la fotosíntesis", updatedDaysAgo: 6,
    messages: [["user", "¿Por qué las plantas necesitan luz para hacer la fotosíntesis?"],
      ["assistant", "La clorofila absorbe la luz y esa energía se usa para convertir el dióxido de carbono y el agua en glucosa."]] },
  { key: "t-macbeth-chat", kind: "thread", title: "Macbeth quotes", updatedDaysAgo: 9,
    messages: [["user", "Find quotes about guilt in Macbeth for my analysis."],
      ["assistant", "\"Out, damned spot!\" shows Lady Macbeth's guilt, and Macbeth's \"Will all great Neptune's ocean wash this blood\" shows his."]] },
  { key: "e-chem-test", kind: "event", title: "Chemistry test: acids and bases", eventKind: "official_event", startInDays: 1,
    notes: "Topics: pH, neutralisation and titration.", location: "Lab 2" },
  { key: "e-football", kind: "event", title: "Football practice", eventKind: "personal_event", startInDays: 2, location: "School field" },
  { key: "e-bio-lab", kind: "event", title: "Biology lab: enzyme experiment", eventKind: "official_event", startInDays: 3, location: "Lab 1" },
  { key: "s-enzyme-report", kind: "school", recordType: "assignment", title: "Lab report: enzyme activity", audience: "class", updatedDaysAgo: 4,
    normalized: { className: "Biology HL", dueAt: daysFromNow(5),
      description: "Write up the catalase experiment: how temperature changes the rate of reaction." } },
  { key: "s-cas-reflection", kind: "school", recordType: "cas_reflection", title: "CAS reflection: beach clean-up", audience: "mine", updatedDaysAgo: 18,
    normalized: { description: "What I learned organising the beach clean-up with my service group." } },
  { key: "s-library", kind: "school", recordType: "announcement", title: "Library closed for renovation", audience: "school", updatedDaysAgo: 2,
    normalized: { body: "The library is closed next week while the reading room is renovated. Books can be returned at reception." } },
];

export type FixtureQuery = {
  query: string;
  category: "exact" | "paraphrase" | "spanish" | "typo" | "vague";
  /** Items that answer the query; the first is the best answer. */
  relevant: string[];
  hints?: { open?: string[]; recent?: string[] };
};

export const FIXTURE_QUERIES: FixtureQuery[] = [
  { query: "Cell Biology Notes", category: "exact", relevant: ["a-cell-notes"] },
  { query: "Monthly budget", category: "exact", relevant: ["a-budget"] },
  { query: "Fibonacci in Python", category: "exact", relevant: ["a-fib-code"] },
  { query: "Renewable energy pitch", category: "exact", relevant: ["a-energy-deck"] },
  { query: "powerhouse of the cell", category: "paraphrase", relevant: ["a-cell-notes", "a-cells-deck"] },
  { query: "how plants turn sunlight into sugar", category: "paraphrase", relevant: ["a-photosynthesis", "t-fotosintesis"] },
  { query: "why did the first world war start", category: "paraphrase", relevant: ["a-wwi-essay", "t-wwi-brainstorm"] },
  { query: "measuring how acidic a solution is", category: "paraphrase", relevant: ["a-acids-notes"] },
  { query: "global warming causes", category: "paraphrase", relevant: ["a-climate-board"] },
  { query: "force equals mass times acceleration", category: "paraphrase", relevant: ["a-newton"] },
  { query: "how many solutions does a quadratic have", category: "paraphrase", relevant: ["a-quadratics"] },
  { query: "biological catalysts and temperature", category: "paraphrase", relevant: ["a-enzymes-notes", "s-enzyme-report"] },
  { query: "apuntes sobre la célula", category: "spanish", relevant: ["a-cell-notes", "a-cells-deck"] },
  { query: "causas de la primera guerra mundial", category: "spanish", relevant: ["a-wwi-essay", "t-wwi-brainstorm"] },
  { query: "revolución francesa", category: "spanish", relevant: ["a-revolucion"] },
  { query: "vocabulario de comida", category: "spanish", relevant: ["a-spanish-food"] },
  { query: "photosynthsis sumary", category: "typo", relevant: ["a-photosynthesis"] },
  { query: "macbth guilt", category: "typo", relevant: ["a-macbeth", "t-macbeth-chat"] },
  { query: "volcanos tectonic plaets", category: "typo", relevant: ["a-volcano-deck"] },
  { query: "titraton", category: "typo", relevant: ["a-titration-sheet", "t-titration-help"] },
  { query: "my chemistry notes", category: "vague", relevant: ["a-acids-notes"] },
  { query: "the essay from yesterday", category: "vague", relevant: ["a-wwi-essay"] },
  { query: "that deck about cells", category: "vague", relevant: ["a-cells-deck"] },
  { query: "what did I ask about titration", category: "vague", relevant: ["t-titration-help"] },
  { query: "when is my chemistry test", category: "vague", relevant: ["e-chem-test"] },
  { query: "enzyme lab report due", category: "vague", relevant: ["s-enzyme-report"] },
  { query: "the presentation", category: "vague", relevant: ["a-energy-deck"], hints: { open: ["a-energy-deck"] } },
  { query: "CAS reflection", category: "exact", relevant: ["s-cas-reflection"] },
];

/** Labelled pairs for the Related threshold: related work, and pairs that must stay apart. */
export const RELATED_PAIRS: Array<{ a: string; b: string; related: boolean }> = [
  { a: "a-cell-notes", b: "a-cells-deck", related: true },
  { a: "a-acids-notes", b: "a-titration-sheet", related: true },
  { a: "a-acids-notes", b: "e-chem-test", related: true },
  { a: "a-wwi-essay", b: "t-wwi-brainstorm", related: true },
  { a: "a-photosynthesis", b: "t-fotosintesis", related: true },
  { a: "a-enzymes-notes", b: "s-enzyme-report", related: true },
  { a: "a-macbeth", b: "t-macbeth-chat", related: true },
  { a: "a-titration-sheet", b: "t-titration-help", related: true },
  { a: "a-cell-notes", b: "a-budget", related: false },
  { a: "a-wwi-essay", b: "a-quadratics", related: false },
  { a: "a-fib-code", b: "a-macbeth", related: false },
  { a: "a-spanish-food", b: "a-newton", related: false },
  { a: "a-energy-deck", b: "a-revolucion", related: false },
  { a: "a-volcano-deck", b: "a-coach-agent", related: false },
  { a: "e-football", b: "a-photosynthesis", related: false },
  { a: "s-library", b: "a-climate-board", related: false },
];
