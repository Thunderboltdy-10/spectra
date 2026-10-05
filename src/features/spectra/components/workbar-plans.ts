import type { GroupedStep } from "@/components/ui/adaptive-groups";
import type { LabelPolicy } from "@/components/ui/adaptive-bar";
import type { WorkType } from "../work/registry";

/*
 * The hand-written collapse plan for every editor's workbar (EDITORS.md, "The
 * workbar"). Each tab says, in order, how its groups give way when the bar is
 * short of room. Nothing here is derived from priority tiers: a person decided
 * that Insert's Breaks fold before its Tables, and that a slide's Font keeps
 * its full form longest.
 *
 * Ids are the bindings' own local ids (`format.bold`, `add-question`); the bar
 * prefixes them with the work type at run time. Steps follow a command by id
 * wherever the person has reordered it, and the person cannot change them.
 *
 * Every plan is proved by `workbar-plans.test.ts` at the widths that occur:
 * the Side at its minimum and default, and fullscreen with and without the
 * companion. A plan that needs the engine's fallback at any of them fails.
 */

export type WorkbarPlan = {
  /** Universal symbols. Never labelled, at any width. */
  symbols: readonly string[];
  /** Commands whose meaning is in their words. Never shrunk to an icon. */
  worded: readonly string[];
  /** Regrouping for bindings whose shipped group is only their tab. */
  groups?: Readonly<Record<string, string>>;
  /** The collapse plan of each tab, contextual tabs included. */
  tabs: Readonly<Record<string, readonly GroupedStep[]>>;
};

/** Undo and redo, by editor. They lead every tab, icon only, and never collapse. */
export const HISTORY_IDS: Readonly<Record<WorkType, readonly string[]>> = {
  document: ["history.undo", "history.redo"],
  presentation: ["history.undo", "history.redo"],
  sheets: ["history.undo", "history.redo"],
  whiteboard: ["undo", "redo"],
  quiz: ["undo", "redo"],
  flashcard_deck: ["undo", "redo"],
  planner_task: ["undo", "redo"],
  timetable: ["undo", "redo"],
  code: [],
  agent: [],
};

export const HISTORY_GROUP = "History";

const hide = (...ids: string[]): GroupedStep[] => ids.map((id) => ({ hideLabel: id }));
const fold = (...groups: string[]): GroupedStep[] => groups.map((group) => ({ groupMenu: group }));
const more = (...refs: string[]): GroupedStep[] => refs.map((ref) => ({ toMenu: ref }));

const TEXT_SYMBOLS = [
  "format.bold",
  "format.italic",
  "format.underline",
  "format.strike",
  "format.list.bullet",
  "format.list.numbered",
];

const document: WorkbarPlan = {
  symbols: [
    ...TEXT_SYMBOLS,
    "format.list.demote",
    "format.list.promote",
    "format.indent.increase",
    "format.indent.decrease",
    "format.block.moveUp",
    "format.block.moveDown",
    "navigate.find",
  ],
  worded: [
    "insert.citation",
    "insert.footnote",
    "insert.pageBreak",
    "insert.sectionBreak",
    "insert.equation.inline",
    "references.bibliography",
    "references.source.add",
    "references.crossRef",
    "review.trackChanges.show",
    "review.trackChanges.propose",
    "review.comment.add",
    "layout.pageCanvas",
    "layout.focus",
    "layout.previewReader",
    "layout.header",
    "layout.footer",
    "table.row.after",
    "table.row.before",
    "table.column.after",
    "table.column.before",
    "table.row.delete",
    "table.column.delete",
    "table.merge",
    "table.split",
    "table.headerRow",
    "image.alt",
    "image.replace",
    "image.caption",
    "equation.edit",
  ],
  groups: {
    "navigate.find": "Find",
    "navigate.replace": "Find",
    "navigate.outline": "Find",
    "table.row.after": "Rows",
    "table.row.before": "Rows",
    "table.row.delete": "Rows",
    "table.column.after": "Columns",
    "table.column.before": "Columns",
    "table.column.delete": "Columns",
    "table.merge": "Cells",
    "table.split": "Cells",
    "table.headerRow": "Cells",
  },
  tabs: {
    General: [
      ...hide("review.comments", "navigate.replace", "navigate.outline"),
      ...fold("Find", "Review"),
      ...more("format.fontFamily"),
      ...fold("Font"),
      ...more("group:Review", "group:Find"),
    ],
    Format: [
      ...fold("Order", "Blocks"),
      ...hide("format.clear"),
      ...fold("Styles"),
      ...more("group:Order", "group:Blocks"),
      ...fold("Lists", "Paragraph"),
      ...more("group:Styles", "group:Lists"),
      ...fold("Font"),
      ...more("group:Paragraph"),
    ],
    Insert: [
      ...fold("Breaks", "Math"),
      ...hide("insert.link.remove", "insert.divider", "insert.taskList"),
      ...hide("insert.table", "insert.image", "insert.link"),
      ...fold("References", "Links"),
      ...more("group:Blocks", "group:Lists", "group:Breaks", "group:Math"),
      ...fold("Media"),
      ...more("group:References", "group:Links"),
    ],
    Layout: [...fold("View"), ...more("layout.columns"), ...fold("Page"), ...more("group:View")],
    References: [
      ...fold("Links"),
      ...hide("references.sources"),
      ...fold("Review", "Sources"),
      ...more("group:Links"),
      ...fold("Bibliography"),
      ...more("group:Review"),
    ],
    Table: [...fold("Cells", "Columns", "Rows"), ...more("group:Cells")],
    Image: [...fold("Accessibility"), ...more("image.replace"), ...fold("Arrange")],
    Equation: [...fold("Math")],
  },
};

const presentation: WorkbarPlan = {
  symbols: [...TEXT_SYMBOLS, "navigate.find", "view.zoom.in", "view.zoom.out"],
  worded: [
    "present.start",
    "present.rehearse",
    "present.stop",
    "view.notesPage",
    "notes.panel",
    "present.toggleNotes",
    "present.blackout",
    "insert.placeholderText",
    "insert.embed",
    "design.resetPlaceholders",
    "design.slideNumbers",
    "design.audit",
    "animate.transitionApplyAll",
    "stage.snap",
    "accessibility.readingOrder",
    "accessibility.altText",
    "data.bindSource",
    "data.live",
    "transition.native",
    "transition.nativeTiming",
    "arrange.lock",
  ],
  groups: { "navigate.find": "Find" },
  tabs: {
    General: [
      ...hide("review.comments", "design.open"),
      ...fold("View"),
      ...hide("slide.duplicate", "slide.moveEarlier", "slide.moveLater"),
      ...fold("Review", "Design"),
      ...hide("slide.add"),
      ...fold("Slides"),
      ...more("group:Review", "group:Design", "group:View", "group:Find", "group:Slides"),
    ],
    Insert: [
      ...fold("Links"),
      ...hide("insert.video", "insert.table"),
      ...fold("Data", "Media"),
      ...hide("insert.textBox", "insert.image", "slide.add"),
      ...more("group:Links"),
      ...fold("Text", "Shapes"),
      ...more("group:Data", "group:Media"),
    ],
    Design: [
      ...fold("Sources", "Review", "Structure", "Format"),
      ...hide("design.open"),
      ...more("group:Sources", "group:Review"),
      ...fold("Layout"),
      ...more("group:Structure"),
      ...fold("Theme"),
      ...more("group:Format"),
    ],
    Arrange: [
      ...hide("arrange.ungroup", "arrange.bringToFront", "arrange.sendToBack"),
      ...fold("Guides"),
      ...hide("arrange.group", "arrange.bringForward", "arrange.sendBackward"),
      ...fold("Order", "Group", "Align"),
      ...more("group:Guides"),
    ],
    Animate: [...fold("Transitions"), ...fold("Emphasis")],
    Present: [
      ...fold("Notes"),
      ...hide("present.pointer"),
      ...fold("Start", "Presenter"),
      ...more("group:Notes"),
    ],
    Shape: [
      ...fold("Data", "Accessibility", "Geometry", "Image"),
      ...more("group:Data"),
      ...fold("Shape", "Styles"),
      ...hide("format.clear"),
      ...fold("Paragraph", "Lists"),
      ...more("group:Accessibility", "group:Geometry"),
      ...more("format.fontFamily"),
      ...more("group:Styles", "group:Image"),
      ...fold("Font"),
      ...more("group:Lists"),
    ],
    Transition: [...fold("Native"), ...fold("Transitions")],
  },
};

const sheets: WorkbarPlan = {
  symbols: [
    "format.bold",
    "format.italic",
    "format.underline",
    "format.strike",
    "navigate.find",
    "view.zoom.in",
    "view.zoom.out",
    "clipboard.copy",
    "clipboard.cut",
    "clipboard.paste",
  ],
  worded: [
    "freeze.rows",
    "freeze.columns",
    "format.merge",
    "format.unmerge",
    "format.wrap",
    "fill.down",
    "fill.right",
    "sort.asc",
    "sort.desc",
    "sort.custom",
    "validation.set",
    "conditional.apply",
    "formula.autosum",
    "formula.calculate",
    "formula.trace",
    "namedRange.create",
    "insert.row",
    "insert.column",
    "table.create",
    "sheet.new",
    "chart.title",
    "chart.range",
    "note.set",
  ],
  groups: { "navigate.find": "Find", "navigate.replace": "Find" },
  tabs: {
    General: [
      ...hide("review.comments", "clear.all", "format", "chart.insert"),
      ...fold("Fill", "Clipboard"),
      ...hide("navigate.replace", "formula.bar"),
      ...fold("View", "Review", "Freeze"),
      ...more("group:Fill", "group:View", "group:Review"),
      ...fold("Chart", "Inspector", "Find"),
      ...more("group:Chart", "group:Inspector", "group:Freeze", "group:Clipboard"),
    ],
    Format: [
      ...hide("format"),
      ...fold("Conditional", "Size", "Merge", "Alignment"),
      ...hide("format.clear"),
      ...fold("Borders", "Fill", "Number"),
      ...more("group:Conditional", "group:Size"),
      ...fold("Paragraph"),
      ...more("group:Merge", "group:Alignment", "group:Borders"),
      ...more("format.fontFamily"),
      ...fold("Font"),
      ...more("group:Fill"),
    ],
    Insert: [...hide("chart.insert"), ...fold("Sheets", "Tables", "Rows and columns")],
    Data: [...fold("Validation", "Freeze"), ...hide("filter.toggle"), ...fold("Sort and filter")],
    Formula: [
      ...hide("formula.library", "formula.bar"),
      ...fold("Names", "Auditing", "Calculate"),
      ...fold("Library"),
      ...more("group:Names", "group:Auditing"),
    ],
    Review: [...fold("Notes")],
    Chart: [...fold("Data"), ...fold("Type")],
  },
};

const whiteboard: WorkbarPlan = {
  symbols: ["zoom-in", "zoom-out"],
  worded: [],
  groups: { "zoom-out": "Zoom", "zoom-in": "Zoom", fit: "Zoom", pages: "Pages" },
  tabs: {
    General: [...hide("pages", "fit"), ...fold("Zoom")],
    Insert: [],
    Arrange: [],
    Shape: [],
  },
};

const quiz: WorkbarPlan = {
  symbols: [],
  worded: ["build", "add-question"],
  groups: {
    preview: "Mode",
    build: "Mode",
    questions: "Questions",
    "add-question": "Questions",
    "question-details": "Questions",
    cohort: "Results",
    attempts: "Results",
    settings: "Quiz",
  },
  tabs: {
    General: [
      ...hide("question-details", "settings", "attempts", "cohort"),
      ...fold("Results"),
      ...hide("questions"),
      ...fold("Questions"),
      ...more("group:Results", "group:Quiz"),
    ],
    Questions: [],
    // "Preview as learner" is placed here by its binding (tab: "Review").
    Review: [...hide("preview")],
  },
};

const flashcards: WorkbarPlan = {
  symbols: [],
  worded: ["add-card"],
  groups: { "add-card": "Cards", rail: "Cards", import: "Cards", browse: "Study", progress: "Study" },
  tabs: {
    General: [...hide("import", "rail", "progress", "browse"), ...fold("Study"), ...more("group:Study", "import", "rail")],
    Cards: [],
    Study: [],
  },
};

const code: WorkbarPlan = {
  symbols: ["find"],
  worded: ["publish"],
  groups: { controls: "Source", files: "Source", find: "Source", format: "Source", settings: "Settings", publish: "Publish" },
  tabs: {
    General: [
      ...hide("settings", "format", "files", "controls"),
      ...fold("Source"),
      ...more("group:Settings"),
      ...fold("Publish"),
    ],
    Run: [],
    Files: [],
  },
};

const plan: WorkbarPlan = {
  symbols: [],
  worded: [],
  groups: { find: "Find", filters: "Find", import: "Import" },
  tabs: { General: [...hide("import", "filters", "find"), ...more("group:Import"), ...fold("Find")], Plan: [] },
};

const timetable: WorkbarPlan = {
  symbols: ["previous", "next"],
  worded: ["today", "add"],
  groups: { today: "Range", previous: "Range", next: "Range", view: "Range", calendars: "Calendars", add: "Calendars" },
  tabs: {
    General: [
      ...hide("calendars"),
      ...fold("Calendars"),
      ...more("view", "group:Calendars"),
      ...fold("Range"),
    ],
    Schedule: [],
  },
};

const agent: WorkbarPlan = { symbols: [], worded: [], tabs: {} };

export const WORKBAR_PLANS: Readonly<Record<WorkType, WorkbarPlan>> = {
  document,
  presentation,
  sheets,
  whiteboard,
  quiz,
  flashcard_deck: flashcards,
  code,
  planner_task: plan,
  timetable,
  agent,
};

/**
 * A binding's local id as the bar knows it. Command ids carry a `type.` prefix
 * and spell every separator as a dot (`add-question` is `quiz.add.question`),
 * so plan ids are compared in that same spelling.
 */
export function localCommandId(type: WorkType, id: string) {
  const local = id.startsWith(`${type}.`) ? id.slice(type.length + 1) : id;
  return local.replaceAll(/[^a-zA-Z0-9]+/g, ".");
}

const normalised = new Map<WorkType, {
  history: Set<string>;
  symbols: Set<string>;
  worded: Set<string>;
  groups: Map<string, string>;
}>();

function planIndex(type: WorkType) {
  let index = normalised.get(type);
  if (!index) {
    const plan = WORKBAR_PLANS[type];
    const norm = (id: string) => localCommandId(type, id);
    index = {
      history: new Set(HISTORY_IDS[type].map(norm)),
      symbols: new Set(plan.symbols.map(norm)),
      worded: new Set(plan.worded.map(norm)),
      groups: new Map(Object.entries(plan.groups ?? {}).map(([id, group]) => [norm(id), group])),
    };
    normalised.set(type, index);
  }
  return index;
}

export function isHistoryCommand(type: WorkType, id: string) {
  return planIndex(type).history.has(localCommandId(type, id));
}

/** The group a command sits in on the bar. */
export function planGroupOf(type: WorkType, id: string, shipped: string | undefined, tab: string) {
  const local = localCommandId(type, id);
  const index = planIndex(type);
  if (index.history.has(local)) return HISTORY_GROUP;
  return index.groups.get(local) ?? shipped ?? tab;
}

/**
 * How a command's words behave. A rendered control (a font picker, a stepper)
 * keeps its form, so its words are fixed; so is a command with no icon.
 */
export function planLabelPolicy(
  type: WorkType,
  id: string,
  command: { icon?: unknown; keepLabel?: boolean; control?: { kind: string } },
): LabelPolicy {
  const local = localCommandId(type, id);
  const index = planIndex(type);
  if (index.history.has(local)) return "never";
  if (!command.icon) return "always";
  if (index.symbols.has(local)) return "never";
  if (command.keepLabel || index.worded.has(local)) return "always";
  return "whenRoom";
}

/** The plan of one tab, with its ids spelt as the bar's command ids. */
export function planStepsFor(type: WorkType, tab: string): GroupedStep[] {
  const steps = WORKBAR_PLANS[type].tabs[tab] ?? [];
  const full = (ref: string) => (ref.startsWith("group:") ? ref : `${type}.${localCommandId(type, ref)}`);
  return steps.map((step) =>
    "hideLabel" in step
      ? { hideLabel: full(step.hideLabel) }
      : "toMenu" in step
        ? { toMenu: full(step.toMenu) }
        : step,
  );
}

/*
 * Widths, for the first paint and for the plan tests. The bar measures its real
 * controls once they have laid out; these follow `spectra-app.css` (a 32px
 * icon button, 9px padding, 6px gap, micro type at about 6.4px a character) so
 * a plan proved here holds on screen.
 */
const CHARACTER = 6.4;

export function estimateCommandWidths(command: {
  label: string;
  icon?: unknown;
  control?: { kind: string; options?: readonly unknown[] };
}): { full: number; icon: number } {
  const kind = command.control?.kind;
  if (kind === "select" || kind === "menu") return { full: 132, icon: 132 };
  if (kind === "numeric") return { full: 92, icon: 92 };
  if (kind === "color") return { full: 44, icon: 44 };
  if (kind === "segmented") {
    const width = 6 + Math.max(2, command.control?.options?.length ?? 2) * 28;
    return { full: width, icon: width };
  }
  const text = Math.ceil(command.label.length * CHARACTER);
  if (!command.icon) return { full: 18 + text, icon: 18 + text };
  return { full: 38 + text, icon: 32 };
}

export function estimateGroupMenuWidth(group: string) {
  return Math.ceil(30 + group.length * CHARACTER);
}

export const WORKBAR_METRICS = { gap: 3, groupGap: 13, more: 32 } as const;
