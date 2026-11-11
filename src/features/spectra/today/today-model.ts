import type { CalendarItem } from "../calendar/domain/model";
import { addLocalDays, startOfLocalDay } from "../calendar/domain/local-days";
import { dayPart } from "./day-sky";
import type { BriefSuggestion } from "./daily-brief";

/*
 * Home's words (docs/product/HOME.md): a greeting for the hour and one plain
 * sentence about the day. Pure, so the page and its tests agree on them.
 */

export const AGENDA_DAYS = 14;

export function greeting(hour: number, name?: string | null) {
  // An initial alone ("P") reads as a typo, not a name.
  const first = name?.trim().split(/\s+/)[0]?.replace(/\.$/, "");
  // One clock for the greeting and the brief beneath it (dayPart), so they never disagree.
  const day = dayPart(hour);
  const part = day === "night" ? (hour < 5 ? "Still up" : "Good evening") : `Good ${day}`;
  return first && first.length > 1 ? `${part}, ${first}.` : `${part}.`;
}

/** "today", "tomorrow", "on Friday" within the week, else "on 28 Oct". */
export function relativeDay(at: number, now: number) {
  const days = Math.round((startOfLocalDay(at) - startOfLocalDay(now)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 7) return `on ${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(at)}`;
  return `on ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(at)}`;
}

export type TodayAgenda = {
  /** What happens today, in time order. */
  today: CalendarItem[];
  /** Deadlines and plans after today, within AGENDA_DAYS. */
  upcoming: CalendarItem[];
  /** Everything after today within AGENDA_DAYS: lessons and study time as well as what is due. */
  week?: CalendarItem[];
  /** Tasks with no date yet. */
  open: CalendarItem[];
};

const DUE_KINDS = new Set<CalendarItem["kind"]>(["official_deadline", "task", "milestone", "reminder"]);

export function splitAgenda(items: CalendarItem[], unscheduled: CalendarItem[], now: number): TodayAgenda {
  const dayStart = startOfLocalDay(now);
  const tomorrow = addLocalDays(dayStart, 1);
  const horizon = addLocalDays(dayStart, AGENDA_DAYS);
  const live = items.filter((item) => item.status === "active" && typeof item.startAt === "number").sort((a, b) => a.startAt! - b.startAt!);
  return {
    today: live.filter((item) => item.startAt! >= dayStart && item.startAt! < tomorrow),
    upcoming: live.filter((item) => DUE_KINDS.has(item.kind) && item.startAt! >= tomorrow && item.startAt! < horizon),
    week: live.filter((item) => item.startAt! >= tomorrow && item.startAt! < horizon),
    open: unscheduled.filter((item) => item.status === "active"),
  };
}

/** The day in one sentence: what Spectra is doing, what is left today, what is next due. */
export function daySentence({ moving, agenda, now }: { moving: number; agenda: TodayAgenda | null; now: number }) {
  const parts: string[] = [];
  if (moving) parts.push(`Spectra is working on ${moving === 1 ? "a thread" : `${moving} threads`} for you.`);
  if (agenda) {
    const later = agenda.today.filter((item) => (item.endAt ?? item.startAt ?? 0) > now);
    const classes = later.filter((item) => item.kind === "official_event").length;
    if (classes) parts.push(`${classes === 1 ? "One class" : `${classes} classes`} left today.`);
    const next = [...agenda.today.filter((item) => DUE_KINDS.has(item.kind) && (item.startAt ?? 0) > now), ...agenda.upcoming][0];
    if (next?.startAt) parts.push(`${next.title} is due ${relativeDay(next.startAt, now)}.`);
    else parts.push("Nothing is due in the next two weeks.");
  }
  return parts.join(" ");
}

/**
 * Three first questions for an account with no threads yet (F9), from what
 * Spectra can already see: the next date from School, the work touched last,
 * a class. Drawn in the brief's own suggestion rows; each waits in the field.
 */
export function firstQuestions({
  agenda,
  recentWork,
  className,
  now,
}: {
  agenda: TodayAgenda | null;
  recentWork?: { title: string } | null;
  className?: string | null;
  now: number;
}): BriefSuggestion[] {
  const clip = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text);
  const due = [...(agenda?.today ?? []), ...(agenda?.upcoming ?? [])].find((item) => DUE_KINDS.has(item.kind) && item.startAt);
  const questions: BriefSuggestion[] = [];
  if (due?.startAt)
    questions.push({
      kind: "ask",
      title: `Get started on ${clip(due.title, 40)}`,
      why: `It's due ${relativeDay(due.startAt, now)}.`,
      prompt: `Help me get started on ${due.title}, due ${relativeDay(due.startAt, now)}: what is left, and what should I do first?`,
    });
  if (recentWork?.title)
    questions.push({
      kind: "ask",
      title: `Ask about ${clip(recentWork.title, 40)}`,
      why: "It's what you opened last.",
      prompt: `Read ${recentWork.title} and tell me the one thing that would improve it most.`,
    });
  if (className)
    questions.push({
      kind: "ask",
      title: `Quiz me on ${clip(className, 40)}`,
      why: "A few questions show what to revise.",
      prompt: `Ask me five quick questions on what we are studying in ${className}, one at a time.`,
    });
  const fallbacks: BriefSuggestion[] = [
    { kind: "ask", title: "Plan the next two weeks", why: "See what's coming and when to do it.", prompt: "Look at what's coming up in my calendar and tasks, and plan the next two weeks with me." },
    { kind: "ask", title: "Explain something I'm stuck on", why: "Step by step, at your pace.", prompt: "I'm stuck on something in class. Ask me what it is, then explain it step by step." },
    { kind: "ask", title: "Make a revision plan", why: "Short sessions, spread out.", prompt: "Help me make a revision plan for my next test, in short sessions spread over the days before it." },
  ];
  for (const fallback of fallbacks) if (questions.length < 3) questions.push(fallback);
  return questions.slice(0, 3);
}
