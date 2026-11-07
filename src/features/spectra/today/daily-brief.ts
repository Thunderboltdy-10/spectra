import type { HarnessMessage } from "../ai/harness/types";

/*
 * The morning brief (docs/product/HOME.md, "The morning brief"): what's coming
 * up, the few things to do today, each one press away, and yesterday in a line
 * or two. A quiet yesterday doesn't make a quiet brief: there's always a next
 * thing to get ahead of, and it's written whatever the model does. The
 * server gathers the context and asks the model once a day; this module is
 * the shapes, the prompt and the reading of the answer. Pure, so the route,
 * Home and the tests agree on them.
 */

export const BRIEF_LIMITS = { items: 14, title: 140, note: 280, suggestions: 5 } as const;

/** Kinds of work the brief may propose Spectra makes. */
export const BRIEF_WORK_TYPES = ["document", "flashcard_deck", "quiz", "presentation"] as const;
export type BriefWorkType = (typeof BRIEF_WORK_TYPES)[number];

/** `type` is a work's kind, so a suggestion to open it can show it. */
export type BriefContextItem = { id: string; title: string; note?: string; at?: number; type?: string };

export type BriefContext = {
  /** The student's local day, "YYYY-MM-DD", and their time zone. */
  day: string;
  timeZone: string;
  /** Threads talked in yesterday. */
  yesterdayThreads: BriefContextItem[];
  /** Works made or changed yesterday. */
  yesterdayWorks: BriefContextItem[];
  /** Works touched lately, to pick up. */
  recentWorks: BriefContextItem[];
  /** Classes and plans today. */
  today: BriefContextItem[];
  /** Deadlines in the next two weeks. */
  due: BriefContextItem[];
  /** Deadlines after that, for looking further ahead on a quiet week. */
  later: BriefContextItem[];
  /** Their classes and projects, so there's always something to get ahead on. */
  places: string[];
  /** School tasks past their deadline and still open; ids are "school:<record>". */
  late: BriefContextItem[];
  /** Tasks with no date. */
  open: BriefContextItem[];
};

/** A task the brief proposes to add, every detail filled in. */
export type BriefTaskDraft = {
  title: string;
  notes?: string;
  /** "YYYY-MM-DD" in the student's time zone. */
  dueDay?: string;
  /** "HH:MM"; without it the task is due that day. */
  dueTime?: string;
  estimateMinutes?: number;
  steps?: string[];
};

export type BriefSuggestion = {
  /**
   * make: Spectra makes a `workType` work from `prompt`. ask: `prompt` waits in
   * the dock to send. open: opens the work `targetId`, of kind `workType`.
   * task: opens the task `targetId`. add: adds the `task` drafted here.
   */
  kind: "make" | "ask" | "open" | "task" | "add";
  title: string;
  why: string;
  prompt?: string;
  workType?: string;
  targetId?: string;
  task?: BriefTaskDraft;
  /** How to do it: a few concrete instructions, in order. */
  steps?: string[];
  /** Already acted on today: what it made or added, when that has an id. */
  done?: boolean;
  doneId?: string;
};

export type DailyBrief = { recap: string; ahead?: string; suggestions: BriefSuggestion[] };

const pad = (value: number) => String(value).padStart(2, "0");

/** The wall-clock parts of `at` in `timeZone`. */
function zonedParts(at: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return { year: +parts.year!, month: +parts.month!, day: +parts.day!, hour: +parts.hour!, minute: +parts.minute!, second: +parts.second! };
}

/** "YYYY-MM-DD" for the day `at` falls on in `timeZone`. */
export function zonedDay(at: number, timeZone: string) {
  const { year, month, day } = zonedParts(at, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The instant a wall-clock time on a day happens in `timeZone`. */
export function zonedInstant(day: string, time: string, timeZone: string) {
  const [year, month, date] = day.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const wall = Date.UTC(year!, month! - 1, date!, hour, minute);
  let at = wall;
  // Two passes settle the zone's offset, daylight saving included.
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = zonedParts(at, timeZone);
    at += wall - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  }
  return at;
}

/** The day `count` days after "YYYY-MM-DD". */
export function nextDay(day: string, count = 1) {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, date! + count));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** A valid IANA zone, else UTC. */
export function readTimeZone(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

const clip = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

function section(label: string, items: BriefContextItem[], timeZone: string) {
  if (!items.length) return `${label}: none.`;
  const lines = items.slice(0, BRIEF_LIMITS.items).map((item) => {
    const when = item.at ? ` (${zonedDay(item.at, timeZone)})` : "";
    const note = item.note ? `: ${clip(item.note, BRIEF_LIMITS.note)}` : "";
    const kind = item.type ? ` <${item.type}>` : "";
    return `- [${item.id}]${kind} ${clip(item.title, BRIEF_LIMITS.title)}${when}${note}`;
  });
  return `${label}:\n${lines.join("\n")}`;
}

export function briefMessages(context: BriefContext): HarnessMessage[] {
  return [
    {
      role: "system",
      content: [
        "You write a student's morning brief in Spectra, their school workspace. They read it when they wake up.",
        'Reply with JSON only: {"ahead": string, "recap": string, "suggestions": [suggestion]}.',
        "ahead: one or two plain sentences on what matters next, in the second person: the nearest deadlines and tests with their days, and what to get ahead of. This is the heart of the brief, so always write it. On a quiet week, look further ahead or say what would be worth doing now while there's room.",
        "recap: one or two plain sentences about what they did yesterday, naming the threads and works. If nothing happened yesterday, leave it empty. Never write that there is nothing to report.",
        "suggestions: always four or five things to do, most useful first, whatever yesterday looked like. Do the work for the student where you can rather than only pointing at it. Always include at least one work to make or pick up (make or open) and at least one thing to ask Spectra (ask):",
        "- When a deadline or test is coming, propose making the work that prepares for it (make), such as a quiz to revise or a document that plans the essay.",
        "- When something coming has no task to prepare it yet, draft that task with every detail (add): a dated, timed slot before the deadline, an estimate and the steps.",
        "- Point at a late task, or one due in the next three days, at most twice (task). Pick up a recent work only when it is unfinished (open).",
        "- With little coming up, suggest getting ahead in one of their classes: revising what they last worked on, a quiz on a recent topic, or a plan for the next big assessment.",
        "Each suggestion is one of:",
        '- {"kind":"task","targetId":"<id>"}: work on a due, late or undated task from the lists.',
        '- {"kind":"open","targetId":"<id>"}: pick up a recent work from the lists.',
        `- {"kind":"make","workType":"${BRIEF_WORK_TYPES.join('"|"')}","prompt":"..."}: Spectra makes a new work for a deadline or class, such as a revision quiz before a test or a document to plan an essay. prompt is the request to Spectra, written as the student would and precise enough to need no follow-up: the kind of work, the class, the topic and its subtopics, the deadline, and the size and shape (how many questions or cards, which sections, what level).`,
        '- {"kind":"add","task":{"title":"...","notes":"...","dueDay":"YYYY-MM-DD","dueTime":"HH:MM","estimateMinutes":45,"steps":["..."]}}: add a task the lists do not have yet but should, such as preparing for a coming deadline. Fill in every detail you can; dueTime and steps are optional.',
        '- {"kind":"ask","prompt":"..."}: a question worth asking Spectra today, written as the student would.',
        "Every suggestion also has title (under eight words, starting with a verb) and why (one short sentence naming the reason: a date, a class, what is left).",
        'A suggestion may also have "steps": two to four short, concrete instructions for doing it today, in order, each naming exactly what to do and for how long (such as "Answer questions 1 to 5 without notes, 20 minutes"). Give steps whenever the title alone would leave the student unsure how to start; leave them out of "add", whose task has its own.',
        "Use only ids from the lists. Never invent classes, dates or works. Plain words, no emoji, no markdown.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Today is ${context.day}.`,
        section("Threads yesterday", context.yesterdayThreads, context.timeZone),
        section("Works changed yesterday", context.yesterdayWorks, context.timeZone),
        section("Recent works", context.recentWorks, context.timeZone),
        section("Today", context.today, context.timeZone),
        section("Due in the next two weeks", context.due, context.timeZone),
        section("Due after that", context.later, context.timeZone),
        context.places.length ? `Their classes and projects: ${context.places.slice(0, BRIEF_LIMITS.items).join(", ")}.` : "",
        section("Late", context.late, context.timeZone),
        section("Open tasks with no date", context.open, context.timeZone),
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function str(value: unknown, length: number) {
  return typeof value === "string" && value.trim() ? clip(value.trim(), length) : undefined;
}

function readTask(value: unknown): BriefTaskDraft | null {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const title = str(raw.title, 140);
  if (!title) return null;
  const notes = str(raw.notes, 1_000);
  const dueDay = typeof raw.dueDay === "string" && DAY_PATTERN.test(raw.dueDay) ? raw.dueDay : undefined;
  const dueTime = dueDay && typeof raw.dueTime === "string" && TIME_PATTERN.test(raw.dueTime) ? raw.dueTime : undefined;
  const minutes = typeof raw.estimateMinutes === "number" ? Math.round(raw.estimateMinutes) : NaN;
  const steps = Array.isArray(raw.steps) ? raw.steps.flatMap((step) => str(step, 200) ?? []).slice(0, 8) : [];
  return {
    title,
    ...(notes ? { notes } : {}),
    ...(dueDay ? { dueDay } : {}),
    ...(dueTime ? { dueTime } : {}),
    ...(minutes > 0 && minutes <= 600 ? { estimateMinutes: minutes } : {}),
    ...(steps.length ? { steps } : {}),
  };
}

/** The model's answer, kept only where it names things that exist. */
export function parseBrief(text: string, context: BriefContext): DailyBrief {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const raw = JSON.parse(json) as Record<string, unknown>;
  const recap = str(raw.recap, 600) ?? "";
  const ahead = str(raw.ahead, 600);
  const works = new Map([...context.recentWorks, ...context.yesterdayWorks].map((item) => [item.id, item.type]));
  const tasks = new Set([...context.due, ...context.late, ...context.open, ...context.today].map((item) => item.id));
  const suggestions = (Array.isArray(raw.suggestions) ? raw.suggestions : []).flatMap((value): BriefSuggestion[] => {
    const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const title = str(item.title, 80);
    const why = str(item.why, 200) ?? "";
    const targetId = typeof item.targetId === "string" ? item.targetId : "";
    const prompt = str(item.prompt, 800);
    if (!title) return [];
    const steps = Array.isArray(item.steps) ? item.steps.flatMap((step) => str(step, 160) ?? []).slice(0, 4) : [];
    const how = steps.length ? { steps } : {};
    if (item.kind === "open" && works.has(targetId)) {
      const workType = works.get(targetId);
      return [{ kind: "open", title, why, targetId, ...(workType ? { workType } : {}), ...how }];
    }
    if (item.kind === "task" && tasks.has(targetId)) return [{ kind: "task", title, why, targetId, ...how }];
    if (item.kind === "make" && prompt && BRIEF_WORK_TYPES.includes(item.workType as BriefWorkType))
      return [{ kind: "make", title, why, prompt, workType: item.workType as BriefWorkType, ...how }];
    if (item.kind === "add") {
      const task = readTask(item.task);
      return task ? [{ kind: "add", title, why, task }] : [];
    }
    if (item.kind === "ask" && prompt) return [{ kind: "ask", title, why, prompt, ...how }];
    return [];
  });
  if (!ahead && !suggestions.length) throw new Error("The brief came back empty.");
  return { recap, ...(ahead ? { ahead } : {}), suggestions: suggestions.slice(0, BRIEF_LIMITS.suggestions) };
}

const shortDay = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(at);

/**
 * The brief without the model: plainer, and still a real plan. A morning with
 * no brief at all is the one thing this must never be.
 */
export function plainBrief(context: BriefContext): DailyBrief {
  const coming = [...context.due, ...context.later].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const next = coming[0];
  const after = coming[1];
  const ahead = next
    ? `${clip(next.title, BRIEF_LIMITS.title)} is next, on ${shortDay(next.at ?? Date.now(), context.timeZone)}${after ? `, then ${clip(after.title, BRIEF_LIMITS.title)} on ${shortDay(after.at ?? Date.now(), context.timeZone)}` : ""}.`
    : context.places.length
      ? `Nothing has a date yet, so this is a good week to get ahead in ${context.places.slice(0, 2).join(" and ")}.`
      : "Nothing has a date yet, so this is a good week to get ahead.";
  const moves: BriefSuggestion[] = [];
  for (const task of context.late.slice(0, 1))
    moves.push({ kind: "task", title: `Catch up on ${clip(task.title, 50)}`, why: "This one is past its deadline.", targetId: task.id });
  if (next) {
    moves.push({
      kind: "make",
      workType: "document",
      title: `Plan for ${clip(next.title, 50)}`,
      why: `It's on ${shortDay(next.at ?? Date.now(), context.timeZone)}.`,
      prompt: `Make a short document that plans how I get ${next.title} done by ${shortDay(next.at ?? Date.now(), context.timeZone)}: what's left, what to do first and when.`,
    });
    moves.push({
      kind: "add",
      title: `Set time aside for ${clip(next.title, 40)}`,
      why: "A slot before the deadline makes it real.",
      task: { title: `Work on ${clip(next.title, 100)}`, dueDay: zonedDay(next.at ?? Date.now(), context.timeZone), estimateMinutes: 45 },
    });
  }
  const recent = context.recentWorks[0];
  if (recent)
    moves.push({
      kind: "open",
      title: `Pick up ${clip(recent.title, 50)}`,
      why: "It's what you worked on last.",
      targetId: recent.id,
      ...(recent.type ? { workType: recent.type } : {}),
    });
  const place = context.places[0];
  if (!next && place)
    moves.push({
      kind: "make",
      workType: "quiz",
      title: `Test yourself in ${clip(place, 50)}`,
      why: "A short quiz shows what to revise before it matters.",
      prompt: `Make a ten-question quiz on what I've been studying lately in ${place}.`,
    });
  moves.push({
    kind: "ask",
    title: "Plan the next two weeks",
    why: "See what's coming and when to do it.",
    prompt: "Look at what's coming up in my calendar and tasks, and plan the next two weeks with me.",
  });
  return { recap: "", ahead, suggestions: moves.slice(0, BRIEF_LIMITS.suggestions) };
}
