import "server-only";
import { callSpectraModel } from "../ai/harness/model";
import { calendarItemFromWire, type CalendarItem } from "../calendar/domain/model";
import { plainTextFromStored } from "../rich-content/adapters";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import {
  briefMessages,
  nextDay,
  parseBrief,
  zonedInstant,
  type BriefContext,
  type BriefContextItem,
} from "./daily-brief";

/*
 * Writing the morning brief (docs/product/HOME.md, "The morning brief"), as
 * the student: from Home when it opens, or from the scheduler before they
 * wake. Everything it reads goes through the student's own queries, so it
 * sees exactly what they may see. The claim lets one writer through per day.
 */

const AGENDA_DAYS = 14;
const DUE_KINDS = new Set<CalendarItem["kind"]>(["official_deadline", "task", "milestone", "reminder"]);

type Row = Record<string, unknown>;

const rows = (value: unknown, key: string): Row[] => {
  if (Array.isArray(value)) return value as Row[];
  const inner = value && typeof value === "object" ? (value as Row)[key] : undefined;
  return Array.isArray(inner) ? (inner as Row[]) : [];
};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** A part that cannot be read is left out rather than failing the brief. */
const optional = <T,>(read: Promise<T>, fallback: T) => read.catch(() => fallback);

export async function gatherBriefContext(day: string, timeZone: string): Promise<BriefContext> {
  const todayStart = zonedInstant(day, "00:00", timeZone);
  const yesterdayStart = zonedInstant(nextDay(day, -1), "00:00", timeZone);
  const tomorrowStart = zonedInstant(nextDay(day), "00:00", timeZone);
  const horizon = zonedInstant(nextDay(day, AGENDA_DAYS), "00:00", timeZone);
  const yesterday = (at: number | undefined) => at !== undefined && at >= yesterdayStart && at < todayStart;

  const [threadPage, artifacts, calendar, school] = await Promise.all([
    optional(convexQuery<object, unknown>("spectraThreads:list", { limit: 30 }), null),
    optional(convexQuery<object, unknown>("spectraArtifacts:list", { placement: "all", limit: 40 }), null),
    optional(convexQuery<object, unknown>("calendar:overview", { from: todayStart, to: horizon }), null),
    optional(convexQuery<object, unknown>("school:tasks", { view: "current" }), null),
  ]);

  const threads = rows(threadPage, "threads").filter((thread) => text(thread.status) === "active");
  const works = rows(artifacts, "artifacts")
    .filter(
      (work) =>
        text(work.status) === "active" &&
        text(work.blueprintKey) !== "thread_reference" &&
        !(Array.isArray(work.tags) && work.tags.includes("managebac")),
    )
    .sort((a, b) => (num(b.updatedAt) ?? 0) - (num(a.updatedAt) ?? 0));
  const workItem = (work: Row): BriefContextItem => ({
    id: text(work._id),
    title: text(work.title) || "Untitled",
    ...(text(work.summary) ? { note: text(work.summary) } : {}),
    at: num(work.updatedAt),
    type: text(work.blueprintKey),
  });

  const items = rows(calendar, "items").map(calendarItemFromWire);
  const live = items.filter((item) => item.status === "active" && item.startAt !== undefined);
  const agendaItem = (item: CalendarItem): BriefContextItem => ({
    id: item.id,
    title: item.title,
    ...(item.notes ? { note: item.notes } : {}),
    at: item.startAt,
  });

  return {
    day,
    timeZone,
    yesterdayThreads: threads
      .filter((thread) => yesterday(num(thread.lastMessageAt) ?? num(thread.updatedAt)))
      .map((thread) => ({
        id: text(thread._id),
        title: text(thread.title) || "Untitled thread",
        note: plainTextFromStored(text(thread.summaryShort) || text(thread.previewText)),
      })),
    yesterdayWorks: works.filter((work) => yesterday(num(work.updatedAt))).map(workItem),
    recentWorks: works.slice(0, 12).map(workItem),
    today: live.filter((item) => item.startAt! >= todayStart && item.startAt! < tomorrowStart).map(agendaItem),
    due: live.filter((item) => DUE_KINDS.has(item.kind) && item.startAt! >= tomorrowStart).map(agendaItem),
    late: rows(school, "tasks")
      .filter((task) => !task.past && num(task.dueAt) !== undefined && num(task.dueAt)! < todayStart)
      .map((task) => ({
        id: `school:${text(task.recordId)}`,
        title: text(task.title),
        ...(text(task.className) ? { note: text(task.className) } : {}),
        at: num(task.dueAt),
      })),
    open: rows(calendar, "unscheduledTasks")
      .map(calendarItemFromWire)
      .filter((item) => item.status === "active")
      .map(agendaItem),
  };
}

/** Writes the day's brief unless it is written or being written; true when this call wrote it. */
export async function writeMorningBrief({ day, timeZone, signal }: { day: string; timeZone: string; signal: AbortSignal }) {
  const claimed = await convexMutation<{ day: string }, boolean>("dailyBriefs:claim", { day });
  if (!claimed) return false;
  try {
    const context = await gatherBriefContext(day, timeZone);
    const turn = await callSpectraModel({
      messages: briefMessages(context),
      reasoning: "high",
      purpose: "daily",
      maxTokens: 2_000,
      responseFormat: { type: "json_object" },
      signal,
      title: "Spectra morning brief",
    });
    await convexMutation("dailyBriefs:save", { day, ...parseBrief(turn.text, context) });
    return true;
  } catch (error) {
    await convexMutation("dailyBriefs:save", { day, failed: true }).catch(() => undefined);
    throw error;
  }
}
