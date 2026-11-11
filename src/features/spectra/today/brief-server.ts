import "server-only";
import { callSpectraModel } from "../ai/harness/model";
import { calendarItemFromWire, type CalendarItem } from "../calendar/domain/model";
import { plainTextFromStored } from "../rich-content/adapters";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import {
  briefMessages,
  nextDay,
  parseBrief,
  plainBrief,
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
/** A quiet fortnight still has something on the way. */
const LOOK_AHEAD_DAYS = 45;
const MODEL_ATTEMPTS = 2;
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
  const farHorizon = zonedInstant(nextDay(day, LOOK_AHEAD_DAYS), "00:00", timeZone);
  const yesterday = (at: number | undefined) => at !== undefined && at >= yesterdayStart && at < todayStart;

  const [threadPage, artifacts, calendar, school, workspaces] = await Promise.all([
    optional(convexQuery<object, unknown>("spectraThreads:list", { limit: 30 }), null),
    optional(convexQuery<object, unknown>("spectraArtifacts:list", { placement: "all", limit: 40 }), null),
    optional(convexQuery<object, unknown>("calendar:overview", { from: todayStart, to: farHorizon }), null),
    optional(convexQuery<object, unknown>("school:tasks", { view: "current" }), null),
    optional(convexQuery<object, unknown>("spectraWorkspaces:list", {}), null),
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

  // School tasks not on the calendar yet are still coming; the calendar's own copy wins.
  const dueItems = live.filter((item) => DUE_KINDS.has(item.kind) && item.startAt! >= tomorrowStart);
  const onCalendar = new Set(dueItems.map((item) => item.title.trim().toLowerCase()));
  const schoolComing = rows(school, "tasks").flatMap((task): BriefContextItem[] => {
    const at = num(task.dueAt);
    if (task.past || at === undefined || at < tomorrowStart || onCalendar.has(text(task.title).trim().toLowerCase())) return [];
    return [{ id: `school:${text(task.recordId)}`, title: text(task.title), ...(text(task.className) ? { note: text(task.className) } : {}), at }];
  });
  const coming = [...dueItems.map(agendaItem), ...schoolComing].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

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
    due: coming.filter((item) => (item.at ?? 0) < horizon),
    later: coming.filter((item) => (item.at ?? 0) >= horizon),
    places: rows(workspaces, "workspaces")
      .filter((workspace) => text(workspace.status) !== "archived")
      .map((workspace) => text(workspace.title))
      .filter(Boolean)
      .slice(0, 20),
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

/** The model's brief, topped up where it came back thin; the plain one if the model can't. */
async function composeBrief(context: BriefContext, signal: AbortSignal) {
  const plain = plainBrief(context);
  for (let attempt = 0; attempt < MODEL_ATTEMPTS; attempt += 1) {
    try {
      const turn = await callSpectraModel({
        messages: briefMessages(context),
        reasoning: "medium",
        purpose: "daily",
        // Reasoning counts against this; a tight limit leaves no room for the answer.
        maxTokens: 8_000,
        responseFormat: { type: "json_object" },
        signal,
        title: "Spectra morning brief",
      });
      const written = parseBrief(turn.text, context);
      const suggestions = [
        ...written.suggestions,
        ...plain.suggestions.filter((move) => !written.suggestions.some((kept) => kept.kind === move.kind)),
      ].slice(0, Math.max(written.suggestions.length, 4));
      return { recap: written.recap, ahead: written.ahead ?? plain.ahead, suggestions };
    } catch {
      // A failed attempt falls through to the next, then to the plain brief.
      if (signal.aborted) break;
    }
  }
  return plain;
}

/** Writes the day's brief unless it is written or being written; true when this call wrote it. */
export async function writeMorningBrief({ day, timeZone, signal }: { day: string; timeZone: string; signal: AbortSignal }) {
  const claimed = await convexMutation<{ day: string }, boolean>("dailyBriefs:claim", { day });
  if (!claimed) return false;
  try {
    const context = await gatherBriefContext(day, timeZone);
    await convexMutation("dailyBriefs:save", { day, ...(await composeBrief(context, signal)) });
    return true;
  } catch (error) {
    await convexMutation("dailyBriefs:save", { day, failed: true }).catch(() => undefined);
    throw error;
  }
}
