import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import type { SchoolSyncKind, SchoolSyncMode } from "../../../../shared/school-sync";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import type { ArtifactStatus } from "../components/artifact-status";

/* The School page's reading of F1's API (convex/school.README.md): plain
   words for times, modes and problems, and the shapes the page groups by. */

export type SchoolPreferences = FunctionReturnType<typeof api.school.preferences>;
export type SchoolSyncStatus = FunctionReturnType<typeof api.school.syncStatus>;
export type SchoolKindStatus = SchoolSyncStatus["kinds"][number];
export type SchoolKindPreference = SchoolPreferences["kinds"][number];
export type SchoolClass = FunctionReturnType<typeof api.school.classes>["classes"][number];
export type SchoolTask = FunctionReturnType<typeof api.school.tasks>["tasks"][number];
export type SchoolTaskDetail = NonNullable<FunctionReturnType<typeof api.school.task>>;
export type SchoolCas = FunctionReturnType<typeof api.school.cas>;
export type SchoolExperience = SchoolCas["experiences"][number];
export type SchoolExperienceDetail = NonNullable<FunctionReturnType<typeof api.school.casExperience>>;

export const MODE_LABEL: Record<SchoolSyncMode, string> = { auto: "Auto", manual: "Manual", off: "Off" };
export const MODE_HINT: Record<SchoolSyncMode, string> = {
  auto: "Kept up to date in the background.",
  manual: "Only when you press Sync now.",
  off: "Never synced, and nothing is shown.",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "12 min ago", "3 hr ago", "yesterday", "4 days ago", then the date. */
export function ago(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} hr ago`;
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return dateLabel(at, now);
}

/** "in a moment", "in 40 min", "in 3 hr", "tomorrow", then the date. */
export function fromNow(at: number, now: number): string {
  const ahead = at - now;
  if (ahead < MINUTE) return "in a moment";
  if (ahead < HOUR) return `in ${Math.ceil(ahead / MINUTE)} min`;
  if (ahead < DAY) return `in ${Math.round(ahead / HOUR)} hr`;
  if (ahead < 2 * DAY) return "tomorrow";
  return `on ${dateLabel(at, now)}`;
}

/** "12 Mar", or "12 Mar 2024" outside this year. */
export function dateLabel(at: number, now: number): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** A task's due line: "Due tomorrow", "Due in 3 hr", "Was due 12 Mar", or nothing. */
export function dueLabel(dueAt: number | null, now: number): string | null {
  if (!dueAt) return null;
  if (dueAt < now) return `Was due ${dateLabel(dueAt, now)}`;
  if (dueAt - now < DAY) return `Due ${fromNow(dueAt, now)}`;
  if (dueAt - now < 2 * DAY) return "Due tomorrow";
  return `Due ${dateLabel(dueAt, now)}`;
}

/** One kind's sync in a sentence: what ran, and what runs next. */
export function kindLine(kind: Pick<SchoolKindStatus, "mode" | "state" | "available" | "lastSuccessAt" | "lastRunAt" | "nextRunAt">, now: number): string {
  if (!kind.available) return "Not available from ManageBac";
  if (kind.mode === "off" || kind.state === "off") return "Off";
  if (kind.state === "running") return "Syncing now";
  if (kind.state === "queued") return "Waiting to sync";
  const last = kind.lastSuccessAt ? `Synced ${ago(kind.lastSuccessAt, now)}` : "Not synced yet";
  const next = kind.nextRunAt ? `next ${fromNow(kind.nextRunAt, now)}` : kind.mode === "manual" ? "next when you sync" : null;
  return next ? `${last} · ${next}` : last;
}

/** The header's status control, in the artifact's pattern (EDITORS.md, "The status control"). */
export function schoolStatus(status: SchoolSyncStatus | undefined, now: number, syncing: boolean): ArtifactStatus | null {
  if (!status) return null;
  const facts = status.kinds
    .filter((kind) => kind.state !== "off" && kind.available)
    .map((kind) => ({ label: kind.label, value: kindLine(kind, now) }));
  if (status.connection.state === "not_connected" || status.connection.state === "blocked") {
    const problem = status.connection.problem;
    return {
      state: "offline",
      name: status.connection.state === "blocked" ? "Can't sync" : "Not connected",
      glyph: "offline",
      hue: "var(--text-tertiary)",
      running: false,
      sentence: problem ? `${problem.message} ${problem.fixHint}` : "ManageBac isn't connected.",
      facts: [],
      actions: [],
    };
  }
  const troubled = status.kinds.filter((kind) => kind.problem && kind.available && (kind.state === "failed" || kind.state === "blocked"));
  if (syncing || status.running) {
    const running = status.kinds.filter((kind) => kind.state === "running" || kind.state === "queued").length;
    return {
      state: "syncing",
      name: "Syncing",
      glyph: "syncing",
      hue: "var(--accent-cyan)",
      words: "Syncing",
      running: true,
      sentence: running > 1 ? `Syncing ${running} kinds of school data from ManageBac.` : "Syncing from ManageBac.",
      facts,
      actions: [],
    };
  }
  if (troubled.length) {
    const first = troubled[0]!.problem!;
    return {
      state: "problem",
      name: troubled.length > 1 ? `${troubled.length} syncs need attention` : "A sync needs attention",
      glyph: "problem",
      hue: "var(--danger)",
      words: troubled.length > 1 ? `${troubled.length} problems` : "Sync problem",
      running: false,
      sentence: `${first.message} ${first.fixHint}`,
      facts,
      actions: [{ kind: "retry", label: "Sync now" }],
    };
  }
  const last = status.connection.lastSyncAt;
  return {
    state: "saved",
    name: "Up to date",
    glyph: "saved",
    hue: "var(--success)",
    running: false,
    sentence: last ? `Synced from ManageBac ${ago(last, now)}.` : "Connected to ManageBac. Nothing synced yet.",
    facts,
    actions: [{ kind: "retry", label: "Sync now" }],
  };
}

export type TaskGroup = { key: string; className: string; terms: { term: string; tasks: SchoolTask[] }[] };

/** Past tasks grouped by class, then by term (newest first, as the API orders them). */
export function groupPastTasks(tasks: readonly SchoolTask[]): TaskGroup[] {
  const classes = new Map<string, TaskGroup>();
  for (const task of tasks) {
    const className = task.className ?? "Other work";
    const key = task.providerClassId ?? className;
    const group = classes.get(key) ?? { key, className, terms: [] };
    classes.set(key, group);
    const term = task.term ?? "No term";
    let bucket = group.terms.find((entry) => entry.term === term);
    if (!bucket) {
      bucket = { term, tasks: [] };
      group.terms.push(bucket);
    }
    bucket.tasks.push(task);
  }
  return [...classes.values()].sort((a, b) => a.className.localeCompare(b.className));
}

/** Current tasks by when they are due: overdue, this week, later, no date. */
export function groupCurrentTasks(tasks: readonly SchoolTask[], now: number) {
  const week = now + 7 * DAY;
  const groups = [
    { key: "overdue", label: "Overdue", tasks: [] as SchoolTask[] },
    { key: "week", label: "This week", tasks: [] as SchoolTask[] },
    { key: "later", label: "Later", tasks: [] as SchoolTask[] },
    { key: "undated", label: "No due date", tasks: [] as SchoolTask[] },
  ];
  for (const task of tasks) {
    const index = !task.dueAt ? 3 : task.dueAt < now ? 0 : task.dueAt <= week ? 1 : 2;
    groups[index]!.tasks.push(task);
  }
  return groups.filter((group) => group.tasks.length);
}

/** A task matches a search by its title, class, term or type. */
export function taskMatches(task: SchoolTask, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [task.title, task.className, task.term, task.taskType].some((value) => value?.toLowerCase().includes(needle));
}

/** "2.4 MB", "820 KB". */
export function sizeLabel(bytes: number | null | undefined) {
  if (!bytes) return null;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** The letters of an experience's strands: "C", "A S". */
export function strands(types: SchoolExperience["types"]) {
  return [types.creativity ? "Creativity" : null, types.activity ? "Activity" : null, types.service ? "Service" : null].filter(
    (value): value is string => Boolean(value),
  );
}

/** What the class-scoped kinds are called on a class's row. */
export const CLASS_KIND_ORDER: SchoolSyncKind[] = ["classes", "current_tasks", "past_tasks", "task_resources", "grades", "dropbox_files"];

/** An error as one plain sentence, without its code (convex/school.README.md: errors read as `CODE: message`). */
export function sentenceOf(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? readConvexError(error).message || error.message : "";
  const sentence = raw.replace(/^[A-Z][A-Z0-9_]+:\s*/, "").replace(/\[Request ID:[^\]]*\]\s*/gi, "").trim();
  return sentence && !/server error/i.test(sentence) ? sentence : fallback;
}
