/**
 * The one piece of work this page is about.
 *
 * Every scene after the prism is looking at the same document: the same title,
 * the same five sections, the same three sources, the same Friday deadline. That
 * is the point — Spectra is not a set of features that each produce something,
 * it is one place where one piece of work stays connected to everything else.
 *
 * Everything here is deterministic and offline. No request is ever made, no
 * timestamp is read from the clock, and the coarse fixture time keeps the
 * server and the client rendering the same page.
 */

const HOUR = 3_600_000;

/** A fixed instant, so server and client agree on every relative label. */
export const STORY_NOW = Date.UTC(2026, 8, 16, 9, 0, 0);

export const WORK = {
  id: "work-ecosystems",
  title: "Ecosystems revision notes",
  subject: "Biology",
  due: "Friday",
  sections: 5,
  sources: 3,
} as const;

/** The three sources the work carries, and how far each has been verified. */
export const SOURCES = [
  {
    id: "src-textbook",
    label: "Campbell Biology, ch. 4",
    kind: "Textbook",
    state: "verified",
  },
  {
    id: "src-slides",
    label: "Week 6 lecture slides",
    kind: "Class material",
    state: "verified",
  },
  {
    id: "src-dataset",
    label: "Ecosystem field data",
    kind: "Sheet",
    state: "live",
  },
] as const;

export const VERIFIED_SOURCE_IDS = ["src-textbook", "src-slides"] as const;

/**
 * The document body, in the product's own rich-content notation.
 *
 * `[[cite:id:span|Label]]` is a real citation and renders through the product's
 * parser, which is what makes the sources on this page genuinely attached
 * rather than drawn to look attached.
 */
export const DOC_BODY = `## Light-dependent reactions

Chlorophyll in the thylakoid membrane absorbs photons and splits water, releasing oxygen and driving the proton gradient that makes ATP [[cite:src-slides:span-2|Week 6 slides]].

## The Calvin cycle

Carbon fixation happens in the stroma, where rubisco attaches CO₂ to a five-carbon sugar. Three turns of the cycle produce one molecule of glyceraldehyde-3-phosphate [[cite:src-textbook:span-4-7|Campbell, ch. 4]].

## Respiration, in balance

Photosynthesis and respiration are not opposites running at the same rate. Net primary productivity is what remains after the plant has respired, and that difference is what the rest of the ecosystem lives on.`;

/**
 * The third source, as a real workbook.
 *
 * `SOURCES` calls this one a live Sheet, so it has to actually be one: the
 * numbers the revision document cites are these numbers, in the product's own
 * sheets model, with a real formula in the column the story contends over.
 */
export const FIELD_DATA = {
  workbook: { calculationMode: "automatic", locale: "en-GB" },
  sheets: [
    {
      id: "plots",
      name: "Field plots",
      frozenRows: 1,
      columnWidths: { "0": 132, "1": 96, "2": 96, "3": 104 },
      cells: {
        A1: { value: "Plot" },
        B1: { value: "Light" },
        C1: { value: "Biomass" },
        D1: { value: "Net gain" },
        A2: { value: "Woodland edge" },
        B2: { value: 820 },
        C2: { value: 4.6 },
        D2: { formula: "=C2/B2*1000" },
        A3: { value: "Open meadow" },
        B3: { value: 1460 },
        C3: { value: 6.1 },
        D3: { formula: "=C3/B3*1000" },
        A4: { value: "Pond margin" },
        B4: { value: 1120 },
        C4: { value: 5.2 },
        D4: { formula: "=C4/B4*1000" },
        A5: { value: "Deep shade" },
        B5: { value: 240 },
        C5: { value: 1.4 },
        D5: { formula: "=C5/B5*1000" },
        A6: { value: "Mean" },
        C6: { formula: "=AVERAGE(C2:C5)" },
        D6: { formula: "=AVERAGE(D2:D5)" },
      },
      tables: [{ id: "plots", name: "Plots", range: "A1:D6" }],
    },
  ],
} as const;

/** The cell both AIs reach for. Biomass for the pond margin, remeasured. */
export const CONTESTED_CELL = "/sheets/0/cells/C4";

const DAY = 24 * HOUR;

/**
 * The plan, as the product's real plan model.
 *
 * Five tasks, three of them scheduled into calendar blocks later in the story,
 * one blocked on the source question the Live Dock asks. The dependency is what
 * makes it a plan rather than a list.
 */
export const STUDY_PLAN = {
  version: 4,
  title: "Ecosystems, before Friday",
  description: "Five blocks of work, ordered by what depends on what.",
  sections: [
    { id: "read", title: "Read", order: 0 },
    { id: "write", title: "Write", order: 1 },
    { id: "check", title: "Check", order: 2 },
  ],
  milestones: [
    {
      id: "friday",
      title: "Hand in",
      dueAt: STORY_NOW + 4 * DAY,
      status: "planned",
      order: 0,
    },
  ],
  tasks: [
    {
      id: "task-read",
      title: "Read chapter 4 against the mark scheme",
      description: "Photosynthesis, respiration, and where they meet.",
      sectionId: "read",
      status: "done",
      dependencyIds: [],
      assigneeIds: [],
      referenceIds: ["src-textbook"],
      sourceRefs: [],
      calendarBlockIds: ["block-mon"],
      checklist: [],
      estimateMinutes: 40,
      order: 0,
    },
    {
      id: "task-calvin",
      title: "Write the Calvin cycle summary",
      description: "Three turns, one G3P. Keep it to five sentences.",
      sectionId: "write",
      status: "doing",
      dependencyIds: ["task-read"],
      assigneeIds: [],
      referenceIds: ["src-slides"],
      sourceRefs: [],
      calendarBlockIds: ["block-tue"],
      checklist: [],
      estimateMinutes: 35,
      dueAt: STORY_NOW + 2 * DAY,
      order: 1,
    },
    {
      id: "task-sources",
      title: "Settle which source the summary follows",
      description: "The slides and the textbook disagree on rubisco.",
      sectionId: "write",
      status: "blocked",
      dependencyIds: ["task-calvin"],
      assigneeIds: [],
      referenceIds: ["src-slides", "src-textbook"],
      sourceRefs: [],
      calendarBlockIds: [],
      checklist: [],
      estimateMinutes: 10,
      order: 2,
    },
    {
      id: "task-data",
      title: "Recheck the pond margin biomass",
      description: "The plot was remeasured after the storm.",
      sectionId: "check",
      status: "todo",
      dependencyIds: [],
      assigneeIds: [],
      referenceIds: ["src-dataset"],
      sourceRefs: [],
      calendarBlockIds: ["block-thu"],
      checklist: [],
      estimateMinutes: 20,
      order: 3,
    },
    {
      id: "task-hand-in",
      title: "Read it back once, then hand in",
      description: "Out loud, with the mark scheme next to it.",
      sectionId: "check",
      status: "todo",
      dependencyIds: ["task-calvin", "task-data"],
      milestoneId: "friday",
      assigneeIds: [],
      referenceIds: [],
      sourceRefs: [],
      calendarBlockIds: [],
      checklist: [],
      estimateMinutes: 15,
      dueAt: STORY_NOW + 4 * DAY,
      order: 4,
    },
  ],
  views: [{ id: "view-list", kind: "list", title: "List" }],
} as const;

/* ------------------------------------------------------------------ *
 * The week
 *
 * The calendar the story schedules into uses the product's own domain model:
 * `CalendarItem`, `CALENDAR_LAYERS`, and the separation rules that make an
 * official deadline immovable and a work block meaningless without a task.
 * The scene draws these; it never invents them.
 * ------------------------------------------------------------------ */

/** Monday of the story's week. Derived from the fixture, never from a clock. */
export const WEEK_START = (() => {
  const weekday = new Date(STORY_NOW).getUTCDay();
  return Date.UTC(2026, 8, 16 - ((weekday + 6) % 7), 0, 0, 0);
})();

/** Monday is 0. Hours are the story's own, so the grid can never drift. */
export function slot(weekday: number, hour: number, minute = 0): number {
  return WEEK_START + weekday * DAY + hour * HOUR + minute * 60_000;
}

export const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
] as const;

/** The hours the grid shows: after school, before it becomes unreasonable. */
export const WEEK_HOURS = { from: 15, to: 21 } as const;

/** What the run is doing, in the product's own semantic-step language. */
export const RUN_STEPS = {
  reading: "Reading the chapter against the mark scheme",
  drafting: "Drafting the Calvin cycle summary",
  checking: "Checking the finished document",
  waitingForPablo: "Waiting for Pablo to finish",
  updating: "Updating the explanation",
  scheduling: "Scheduling three study blocks",
  finishing: "Finishing the page",
} as const;

export const FIXTURE_TIME = {
  created: STORY_NOW - 3 * HOUR,
  updated: STORY_NOW - 22 * 60_000,
  lastMessage: STORY_NOW - 18 * 60_000,
} as const;
