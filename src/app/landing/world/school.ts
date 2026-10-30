import type { BriefSuggestion } from "@/features/spectra/today/daily-brief";
import { CLASSES, type ClassKey } from "./works";
import { TODAY, dayAt, dayName } from "./story";

/*
 * Henry's school, as ManageBac sends it: his classes, the timetable, what is
 * due, and the plans Spectra has made for it. Counted from today, so the real
 * calendar opens on the story's week.
 */

export type WireItem = {
  id: string;
  kind: "official_event" | "official_deadline" | "task" | "scheduled_work_block" | "personal_event" | "milestone" | "reminder";
  title: string;
  notes?: string;
  startAt?: number;
  endAt?: number;
  allDay?: boolean;
  timezone: string;
  timePrecision?: "exact" | "date_only";
  status: "active";
  sourceLocked: boolean;
  source?: { provider: string; recordId?: string; state: { kind: "available" } };
  location?: string;
  teacher?: string;
  classId?: string;
  taskItemId?: string;
  linkedWorkIds: string[];
  revision: number;
};

export const ZONE = typeof Intl === "undefined" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const PERIODS: Array<[number, number, number, number]> = [
  [8, 30, 9, 50],
  [10, 10, 11, 30],
  [12, 30, 13, 50],
  [14, 0, 15, 20],
];

/** Which class is in which period, Monday to Friday. */
const TIMETABLE: ClassKey[][] = [
  ["history", "biology", "english", "maths"],
  ["spanish", "maths", "history", "biology"],
  ["biology", "english", "maths", "history"],
  ["maths", "history", "spanish", "english"],
  ["english", "biology", "history", "spanish"],
];

const ROOMS: Record<ClassKey, string> = { history: "H12", biology: "Lab 3", english: "E4", maths: "M2", spanish: "L7" };

function lesson(day: number, period: number, key: ClassKey): WireItem {
  const [h1, m1, h2, m2] = PERIODS[period]!;
  const place = CLASSES[key];
  return {
    id: `lesson-${day}-${period}`,
    kind: "official_event",
    title: place.title,
    startAt: dayAt(day, h1, m1),
    endAt: dayAt(day, h2, m2),
    timezone: ZONE,
    status: "active",
    sourceLocked: true,
    source: { provider: "managebac", state: { kind: "available" } },
    location: ROOMS[key],
    teacher: place.teacher,
    classId: place.providerClassId,
    linkedWorkIds: [],
    revision: 1,
  };
}

function timetable(): WireItem[] {
  const items: WireItem[] = [];
  for (let day = -14; day <= 21; day++) {
    const weekday = new Date(dayAt(day, 12)).getDay();
    if (weekday === 0 || weekday === 6) continue;
    TIMETABLE[weekday - 1]!.forEach((key, period) => items.push(lesson(day, period, key)));
  }
  return items;
}

/** A school day `n` days ahead or more, never a weekend. */
function schoolDay(from: number) {
  let day = from;
  for (;;) {
    const weekday = new Date(dayAt(day, 12)).getDay();
    if (weekday !== 0 && weekday !== 6) return day;
    day += 1;
  }
}

export const DAYS = {
  tomorrow: 1,
  biologyTest: schoolDay(2),
  sourceAnalysis: schoolDay(3),
  essay: schoolDay(6),
  problemSet: schoolDay(2),
};

function deadline(id: string, key: ClassKey, title: string, at: number, notes: string): WireItem {
  return {
    id,
    kind: "official_deadline",
    title,
    notes,
    startAt: at,
    endAt: at,
    timezone: ZONE,
    status: "active",
    sourceLocked: true,
    source: { provider: "managebac", recordId: `${id}-record`, state: { kind: "available" } },
    teacher: CLASSES[key].teacher,
    classId: CLASSES[key].providerClassId,
    linkedWorkIds: [],
    revision: 1,
  };
}

export const DEADLINES = {
  biologyTest: deadline("due-bio-test", "biology", "Unit test: cell respiration", dayAt(DAYS.biologyTest, 10, 10), "In class, 45 minutes. Calculators allowed."),
  problemSet: deadline("due-maths", "maths", "Problem set 4: sequences and series", dayAt(DAYS.problemSet, 8, 0), "Questions 1 to 14, show your working."),
  essay: deadline("due-essay", "english", "Paper 2 practice essay", dayAt(DAYS.essay, 8, 0), "1,200 words, one of the three prompts."),
  /** The one Ms Gonzalez posts tonight, in the story. */
  /** The one Mr Okafor posts on the page, in the School scene. */
  labReport: deadline("due-lab", "biology", "Lab report: yeast respiration", dayAt(DAYS.sourceAnalysis, 16, 0), "Method, results table and a short evaluation. Use your data from the practical."),
  sourceAnalysis: deadline(
    "due-source",
    "history",
    "Source analysis: the Enabling Act",
    dayAt(DAYS.sourceAnalysis, 8, 0),
    "Two sources from the pack. Value and limitations of each, 600 words.",
  ),
};

function block(id: string, title: string, day: number, hour: number, minutes: number, toward: WireItem, minute = 0): WireItem {
  const start = dayAt(day, hour, minute);
  return {
    id,
    kind: "scheduled_work_block",
    title,
    startAt: start,
    endAt: start + minutes * 60_000,
    timezone: ZONE,
    status: "active",
    sourceLocked: false,
    classId: toward.classId,
    taskItemId: toward.id,
    linkedWorkIds: [],
    revision: 1,
  };
}

/** What Spectra plans for the source analysis once it arrives. */
export const PLAN_BLOCKS = [
  block("plan-source-1", "Read the two sources", DAYS.tomorrow, 16, 60, DEADLINES.sourceAnalysis),
  block("plan-source-2", "Write the source analysis", schoolDay(2), 16, 75, DEADLINES.sourceAnalysis),
];

/** The time Spectra finds for the lab report when Henry asks. */
export const LAB_BLOCK = block("plan-lab", "Write up the yeast lab", DAYS.biologyTest, 17, 50, DEADLINES.labReport, 30);

/** What Spectra makes of Henry's respiration slides for the test: the revision in pieces, around tomorrow's study block. */
export const REVISION_BLOCKS = [
  block("plan-rev-1", "Glycolysis and the link reaction", DAYS.tomorrow, 15, 40, DEADLINES.biologyTest, 40),
  block("plan-rev-2", "Krebs cycle flashcards", DAYS.tomorrow, 16, 30, DEADLINES.biologyTest, 25),
  block("plan-rev-3", "Past paper: respiration questions", DAYS.tomorrow, 17, 40, DEADLINES.biologyTest, 50),
];

export const STUDY_BLOCK = block("plan-bio", "Revise cell respiration", DAYS.tomorrow, 17, 45, DEADLINES.biologyTest);

export function initialCalendar(): WireItem[] {
  return [...timetable(), DEADLINES.biologyTest, DEADLINES.problemSet, DEADLINES.essay, STUDY_BLOCK];
}

export const SCHOOL_CLASSES = (Object.keys(CLASSES) as ClassKey[]).map((key) => ({
  providerClassId: CLASSES[key].providerClassId,
  recordId: `class-${key}`,
  title: CLASSES[key].title,
  subject: CLASSES[key].title.split(" ")[0] ?? null,
  yearGroupId: "dp1",
  academicPeriodKey: "2026-27",
  archived: false,
  selected: true,
  modes: {},
}));

export function schoolTask(item: WireItem) {
  const key = (Object.keys(CLASSES) as ClassKey[]).find((entry) => CLASSES[entry].providerClassId === item.classId) ?? "history";
  return {
    recordId: `${item.id}-record`,
    title: item.title,
    providerClassId: item.classId ?? null,
    className: CLASSES[key].title,
    dueAt: item.startAt ?? null,
    status: "open",
    taskType: "summative",
    term: "Term 1",
    past: (item.startAt ?? Infinity) < TODAY,
    sourceState: "available",
    provenanceUrl: null,
  };
}

/** Monday's brief, written overnight. */
export function morningBrief(): { recap: string; suggestions: BriefSuggestion[] } {
  return {
    recap: `Ms Gonzalez posted the source analysis last night, due ${dayName(DEADLINES.sourceAnalysis.startAt!)}. I read the pack she attached and set aside an hour this afternoon. Your Biology test is ${dayName(DEADLINES.biologyTest.startAt!)}, and the cards from your notes are ready.`,
    suggestions: [
      {
        kind: "task",
        title: "Read the two sources at 16:00",
        why: "An hour set aside for the source analysis, due " + dayName(DEADLINES.sourceAnalysis.startAt!) + ".",
        targetId: DEADLINES.sourceAnalysis.id,
        steps: ["Open the source pack", "Note the origin and purpose of each", "One line on value, one on limitation"],
      },
      {
        kind: "open",
        title: "Study the respiration cards",
        why: `Your Biology test is ${dayName(DEADLINES.biologyTest.startAt!)}. Eight cards, ten minutes.`,
        targetId: "work-cards",
        workType: "flashcard_deck",
      },
      {
        kind: "open",
        title: "Ms Gonzalez replied to your comment",
        why: "On your History IA draft: the date for the second source.",
        targetId: "work-ia",
        workType: "document",
      },
    ],
  };
}

export const DAY_START = TODAY;
