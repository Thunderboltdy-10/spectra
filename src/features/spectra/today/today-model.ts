import type { CalendarItem } from "../calendar/domain/model";
import { addLocalDays, startOfLocalDay } from "../calendar/domain/local-days";

/*
 * Home's words (docs/product/HOME.md): a greeting for the hour and one plain
 * sentence about the day. Pure, so the page and its tests agree on them.
 */

export const AGENDA_DAYS = 14;

export function greeting(hour: number, name?: string | null) {
  // An initial alone ("P") reads as a typo, not a name.
  const first = name?.trim().split(/\s+/)[0]?.replace(/\.$/, "");
  const part = hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
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
