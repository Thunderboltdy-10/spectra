import type { WorkCardContent } from "@/features/spectra/components/work-card";

/*
 * Maya's school year, as the page shows it. Everything here is written by
 * hand and held in memory: no scene reads the network, and nothing a visitor
 * presses is saved anywhere. The content is real IB work a DP1 student meets,
 * so a coordinator recognises their own school in it.
 */

export const STUDENT = { first: "Maya", school: "Northfield International School", year: "DP1" };

/** Class inks, in the app's own ink tokens. */
export const CLASSES = [
  { key: "chem", name: "Chemistry HL", teacher: "Mr Okafor", ink: "var(--ink-blue)", tasks: 4 },
  { key: "hist", name: "History SL", teacher: "Ms Reyes", ink: "var(--ink-orange)", tasks: 3 },
  { key: "eng", name: "English A", teacher: "Ms Lindqvist", ink: "var(--ink-red)", tasks: 2 },
  { key: "math", name: "Maths AA HL", teacher: "Mr Haddad", ink: "var(--ink-violet)", tasks: 5 },
  { key: "span", name: "Spanish B", teacher: "Sra. Molina", ink: "var(--ink-yellow)", tasks: 2 },
  { key: "tok", name: "Theory of Knowledge", teacher: "Dr Asante", ink: "var(--ink-green)", tasks: 1 },
] as const;

export type ClassKey = (typeof CLASSES)[number]["key"];
export const classInk = (key: ClassKey) => CLASSES.find((entry) => entry.key === key)!.ink;

/** The pieces of a school evening that fly together on arrival. */
export const SCATTER = [
  { kind: "deadline", text: "Source analysis due Friday", meta: "History SL", x: -46, y: -30, r: -9 },
  { kind: "file", text: "History IA final (2).docx", meta: "Downloads", x: 44, y: -36, r: 7 },
  { kind: "card", text: "Mitochondria", meta: "Biology flashcard", x: -50, y: 12, r: 6 },
  { kind: "chat", text: "does anyone have friday's notes??", meta: "DP1 group chat", x: 47, y: 6, r: -5 },
  { kind: "note", text: "ask Ms Reyes about sources", meta: "", x: -30, y: 40, r: 4 },
  { kind: "slot", text: "Thu · Chemistry Paper 2", meta: "Calendar", x: 30, y: 42, r: -3 },
  { kind: "file", text: "ch7_respiration_scan.pdf", meta: "Desktop", x: -12, y: -44, r: 3 },
  { kind: "slide", text: "Cold War: causes", meta: "Slide 4 of 9", x: 15, y: -47, r: -6 },
] as const;

/* ---------------------------------------------------------------- Home */

export type WeekItem = { id: string; time?: string; title: string; ink: string; kind: "class" | "deadline" | "plan" | "event"; fresh?: boolean };

export const HOME_TODAY: WeekItem[] = [
  { id: "t1", time: "13:10", title: "Maths AA HL", ink: "var(--ink-violet)", kind: "class" },
  { id: "t2", time: "14:20", title: "Chemistry HL", ink: "var(--ink-blue)", kind: "class" },
  { id: "t3", time: "16:00", title: "Football practice", ink: "var(--text-tertiary)", kind: "event" },
];

/** The days after today: a deadline lands three days on, the test the hero asks about. */
export const HOME_LATER: WeekItem[][] = [
  [{ id: "d1", title: "Lab write-up", ink: "var(--ink-blue)", kind: "deadline" }],
  [{ id: "d2", title: "Oral practice", ink: "var(--ink-yellow)", kind: "class" }],
  [{ id: "d3", title: "Paper 2 test", ink: "var(--ink-blue)", kind: "deadline" }],
  [{ id: "d4", title: "Source analysis", ink: "var(--ink-orange)", kind: "deadline" }],
  [],
  [{ id: "d5", title: "CAS: beach clean", ink: "var(--ink-green)", kind: "event" }],
];

export const HOME_CARDS: Array<WorkCardContent & { id: string }> = [
  {
    id: "c-hist",
    type: "document",
    title: "History IA draft",
    preview: {
      kind: "text",
      heading: "To what extent did the Marshall Plan cause the Cold War?",
      lines: ["The Marshall Plan offered $13 billion in aid, but Stalin read it as a threat to his sphere of influence."],
    },
    place: "History SL",
    when: "Yesterday",
  },
  {
    id: "c-span",
    type: "flashcard_deck",
    title: "Spanish B: el medio ambiente",
    preview: { kind: "cards", count: 40, fronts: ["la sequía", "el reciclaje", "la huella de carbono"] },
    place: "Spanish B",
    when: "Mon",
  },
  {
    id: "c-math",
    type: "sheets",
    title: "Projectile data",
    preview: {
      kind: "grid",
      rows: [
        ["t (s)", "x (m)", "y (m)"],
        ["0.0", "0.00", "1.20"],
        ["0.2", "1.71", "2.36"],
        ["0.4", "3.42", "3.13"],
      ],
    },
    place: "Maths AA HL",
    when: "Sun",
  },
];

export const HOME_MADE: Array<WorkCardContent & { id: string }> = [
  {
    id: "m-quiz",
    type: "quiz",
    title: "Organic chemistry check",
    preview: {
      kind: "questions",
      count: 24,
      first: "Which functional group turns acidified dichromate from orange to green?",
      options: ["Primary alcohol", "Ketone", "Ester"],
    },
    place: "Chemistry HL",
    when: "Just now",
  },
  {
    id: "m-cards",
    type: "flashcard_deck",
    title: "Functional groups",
    preview: { kind: "cards", count: 32, fronts: ["Carboxylic acid", "Ester", "Amine"] },
    place: "Chemistry HL",
    when: "Just now",
  },
];

/* ---------------------------------------------------------------- the island's other runs */

export type IslandRun = {
  id: string;
  ask: string;
  /** The tab's name while it works. */
  tab: string;
  notice: string;
  /** What the island says it is doing, in turn. */
  steps: string[];
  /** What lands: cards at the front of "Pick up", plans in the week. */
  cards?: Array<WorkCardContent & { id: string }>;
  plans?: Array<{ day: number; item: WeekItem }>;
  reply?: { text: string; chips: string[] };
};

export const HERO_RUN: IslandRun = {
  id: "test",
  ask: "Chemistry test on {day}. Help me get ready.",
  tab: "Ready for {day}",
  notice: "Ready for {day}: a plan, a quiz and 32 flashcards.",
  steps: ["Reading Mr Okafor's slides on organic chemistry", "Finding time around football on Monday", "Writing 24 questions from your notes", "Making 32 flashcards"],
  cards: HOME_MADE,
  plans: [
    { day: 0, item: { id: "p0", time: "19:30", title: "Revise: alcohols", ink: "var(--ink-blue)", kind: "plan", fresh: true } },
    { day: 1, item: { id: "p1", title: "Revise: esters", ink: "var(--ink-blue)", kind: "plan", fresh: true } },
    { day: 2, item: { id: "p2", title: "Practice quiz", ink: "var(--ink-blue)", kind: "plan", fresh: true } },
  ],
};

export const SUGGESTED_RUNS: IslandRun[] = [
  {
    id: "slides",
    ask: "Turn my Cold War notes into slides for Friday",
    tab: "Cold War slides",
    notice: "Cold War: causes is ready, 9 slides.",
    steps: ["Reading your Cold War notes", "Planning nine slides", "Drawing the timeline"],
    cards: [
      {
        id: "s-cw",
        type: "presentation",
        title: "Cold War: causes",
        preview: { kind: "slides", count: 9, titles: ["Cold War: causes", "Yalta and Potsdam", "The Marshall Plan"] },
        place: "History SL",
        when: "Just now",
      },
    ],
  },
  {
    id: "due",
    ask: "What's due this week?",
    tab: "Due this week",
    notice: "Three things are due this week.",
    steps: ["Checking ManageBac", "Looking through your calendar"],
    reply: {
      text: "Three things. The chemistry lab write-up tomorrow, Paper 2 on {day}, and your history source analysis the day after. The lab is nearly done: you have one graph left.",
      chips: ["Lab write-up", "Paper 2 test", "Source analysis"],
    },
  },
  {
    id: "cas",
    ask: "Plan my CAS project around the beach clean",
    tab: "CAS project",
    notice: "Your CAS plan is in the calendar.",
    steps: ["Reading the CAS guide", "Planning around Saturday", "Writing the reflection prompts"],
    cards: [
      {
        id: "s-cas",
        type: "planner_task",
        title: "CAS: Coastline project",
        preview: { kind: "task", status: "doing", note: "Beach clean on Saturday, then the reflection.", steps: { done: 1, total: 5 } },
        place: "CAS",
        when: "Just now",
      },
    ],
    plans: [{ day: 3, item: { id: "p-cas", title: "CAS: plan the route", ink: "var(--ink-green)", kind: "plan", fresh: true } }],
  },
];

/* ---------------------------------------------------------------- notes, refracted */

export const NOTES = {
  title: "Cell respiration",
  place: "Biology HL",
  blocks: [
    { heading: "Glycolysis", lines: ["In the cytoplasm", "Glucose splits into 2 pyruvate", "Net gain of 2 ATP and 2 NADH"] },
    { heading: "Link reaction and Krebs cycle", lines: ["In the mitochondrial matrix", "Each turn releases 2 CO₂"] },
    { heading: "Electron transport chain", lines: ["Inner mitochondrial membrane", "Oxygen is the final electron acceptor", "About 34 ATP"] },
  ],
};

export const QUIZ = {
  question: "Where does glycolysis take place?",
  options: ["Mitochondrial matrix", "Cytoplasm", "Inner mitochondrial membrane"],
  answer: 1,
};

export const FLASHCARD = {
  front: "Krebs cycle",
  back: "Takes place in the mitochondrial matrix. Each turn releases two CO₂ and makes NADH, FADH₂ and one ATP.",
};

/* ---------------------------------------------------------------- the morning */

export const BRIEF = {
  wake: "07:00",
  yesterday: "You finished the history sources and got 18 of 24 on the chemistry quiz. Esters are still shaky.",
  moves: [
    { id: "add", kind: "Add task", title: "Revise esters", detail: "Tue · 17:00 · 45 min", live: true },
    { id: "make", kind: "Make it", title: "10 questions on esters", detail: "From your notes and Mr Okafor's slides", live: true },
    { id: "open", kind: "Open", title: "Lab write-up", detail: "Due tomorrow · one graph left", live: false },
    { id: "ask", kind: "Ask", title: "What counts as a strong TOK object?", detail: "For the exhibition", live: false },
  ],
};

export const WEEK = [
  { day: "Mon", date: "3", items: [{ title: "Chemistry HL", ink: "var(--ink-blue)" }, { title: "Football", ink: "var(--text-tertiary)" }] },
  { day: "Tue", date: "4", items: [{ title: "Lab write-up", ink: "var(--ink-blue)" }] },
  { day: "Wed", date: "5", items: [{ title: "Oral practice", ink: "var(--ink-yellow)" }] },
  { day: "Thu", date: "6", items: [{ title: "Paper 2 test", ink: "var(--ink-blue)" }] },
  { day: "Fri", date: "7", items: [{ title: "Source analysis", ink: "var(--ink-orange)" }] },
  { day: "Sat", date: "8", items: [{ title: "CAS: beach clean", ink: "var(--ink-green)" }] },
  { day: "Sun", date: "9", items: [] },
];

/* ---------------------------------------------------------------- the exercise book */

export const SOURCES = [
  {
    id: "task",
    glyph: "school",
    title: "IA: Rate of reaction",
    meta: "ManageBac · due 14 Nov",
    quote: "Your method must let someone else repeat the experiment exactly.",
  },
  {
    id: "slides",
    glyph: "slides",
    title: "IA guidance",
    meta: "Mr Okafor · shared with the class",
    quote: "Control at least three variables, and say how you kept each one fixed.",
  },
  {
    id: "notes",
    glyph: "document",
    title: "Kinetics notes",
    meta: "Your notes · 12 Oct",
    quote: "Temperature in the water bath drifted by about 2 °C in the trial run.",
  },
  {
    id: "lab",
    glyph: "sheet",
    title: "Lab data.xlsx",
    meta: "On your laptop",
    quote: "",
  },
  {
    id: "past",
    glyph: "pdf",
    title: "Paper 2 (2023).pdf",
    meta: "On your laptop",
    quote: "",
  },
] as const;

export const BOOK_THREAD = {
  ask: "What does Mr Okafor want in my IA method?",
  answer: [
    { text: "He wants a method someone else could repeat exactly", cite: 0 },
    { text: ", with at least three controlled variables and how you kept each fixed", cite: 1 },
    { text: ". Your trial run's water bath drifted by 2 °C, so say how you'll hold it steady", cite: 2 },
    { text: ".", cite: null },
  ],
};

/* ---------------------------------------------------------------- the Word file */

export const ESSAY = {
  file: "History IA final (2).docx",
  folder: ["Documents", "School", "History"],
  others: [
    { name: "Sources.pdf", when: "12 Oct" },
    { name: "Notes on Yalta.docx", when: "9 Oct" },
    { name: "Timeline.xlsx", when: "2 Oct" },
  ],
  title: "To what extent did the Marshall Plan cause the Cold War?",
  before: "The Marshall Plan was a very important event that had lots of effects on the Cold War.",
  after: "The Marshall Plan did not start the Cold War, but it turned a rivalry into two economic blocs.",
  rest:
    "Announced in June 1947, it offered $13 billion to rebuild Europe. Stalin forbade the Eastern bloc from accepting it and answered with Cominform, then Comecon.",
  comment: "Your opening now answers the question directly, as the IA criteria ask.",
};

/* ---------------------------------------------------------------- together */

export const GROUP = {
  deck: "Why people move: climate migration",
  place: "Geography group project",
  people: [
    { name: "Leo", hue: "var(--ink-green)" },
    { name: "Ms Reyes", hue: "var(--ink-orange)" },
    { name: "Maya", hue: "var(--ink-blue)" },
  ],
  bars: [
    { label: "2019", value: 24.9 },
    { label: "2020", value: 30.7 },
    { label: "2021", value: 23.7 },
    { label: "2022", value: 32.6 },
    { label: "2023", value: 26.4 },
  ],
  comment: "Where is this data from?",
  source: "Source: IDMC, Global Report on Internal Displacement 2024",
};

/* ---------------------------------------------------------------- for schools */

export const SCHOOL_FACTS = [
  { title: "It connects to ManageBac.", text: "Classes, tasks, files and CAS arrive on their own. Nobody types anything twice." },
  { title: "Teachers share once.", text: "A teacher's workspace shows up inside every student's class, live." },
  { title: "You decide what it may do.", text: "Choose what Spectra can see, change and send, for the whole school." },
];
