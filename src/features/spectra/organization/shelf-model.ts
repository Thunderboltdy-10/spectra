import { startOfDay } from "../school/school-model";

/*
 * Work on a shelf, by when it was last touched (LIBRARY.md, "The shelf"): the
 * newest first, under plain headings a student would say out loud. The shelf
 * keeps going as the reader scrolls, so the headings are what keep a long
 * stretch of cards findable.
 */

export type WhenGroup<T> = { key: string; label: string; items: T[] };

const DAY = 24 * 60 * 60 * 1000;

function whenOf(at: number, now: number): { key: string; label: string } {
  const today = startOfDay(now);
  if (at >= today) return { key: "today", label: "Today" };
  if (at >= today - DAY) return { key: "yesterday", label: "Yesterday" };
  if (at >= today - 6 * DAY) return { key: "week", label: "Earlier this week" };
  const date = new Date(at);
  const current = new Date(now);
  if (date.getFullYear() === current.getFullYear() && date.getMonth() === current.getMonth())
    return { key: "month", label: "Earlier this month" };
  const sameYear = date.getFullYear() === current.getFullYear();
  return {
    key: `${date.getFullYear()}-${date.getMonth()}`,
    label: date.toLocaleDateString(undefined, { month: "long", ...(sameYear ? {} : { year: "numeric" }) }),
  };
}

/** Items already newest first, gathered under when they were touched. */
export function groupByWhen<T>(items: readonly T[], at: (item: T) => number, now: number): WhenGroup<T>[] {
  const groups: WhenGroup<T>[] = [];
  for (const item of items) {
    const when = whenOf(at(item), now);
    const last = groups.at(-1);
    if (last?.key === when.key) last.items.push(item);
    else groups.push({ ...when, items: [item] });
  }
  return groups;
}
