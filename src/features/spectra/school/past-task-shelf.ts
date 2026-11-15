import { accountStorageScope } from "@/lib/account-storage-scope";
import type { SchoolTask } from "./school-model";

/*
 * Spectra's servers keep a past task for two weeks. The student's own device keeps
 * a copy of each past task it has shown, for a year, so the archive still reads
 * as a whole; a kept task comes back from ManageBac when the student opens it.
 */

export type KeptTask = Omit<SchoolTask, "recordId"> & { key: string; savedAt: number };

const STORAGE_PREFIX = "spectra:past-task-shelf:v1:";
const KEEP_MS = 365 * 24 * 60 * 60_000;
const LIMIT = 600;

/** The same task keeps the same key when it comes back from ManageBac under a new id. */
export function keptTaskKey(task: Pick<SchoolTask, "providerClassId" | "dueAt" | "title">) {
  return `${task.providerClassId ?? ""}|${task.dueAt ?? ""}|${task.title}`;
}

function storageKey() {
  const scope = accountStorageScope();
  return scope ? `${STORAGE_PREFIX}${scope}` : null;
}

function isKeptTask(value: unknown): value is KeptTask {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.key === "string" && typeof row.title === "string" && typeof row.savedAt === "number";
}

export function readKeptTasks(now = Date.now()): KeptTask[] {
  const key = storageKey();
  if (!key) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isKeptTask).filter((task) => now - task.savedAt < KEEP_MS) : [];
  } catch {
    return [];
  }
}

/** Saves the past tasks the page just showed. Returns the shelf, or null when nothing changed. */
export function keepPastTasks(tasks: readonly SchoolTask[], now = Date.now()): KeptTask[] | null {
  const key = storageKey();
  if (!key) return null;
  const shelf = new Map(readKeptTasks(now).map((task) => [task.key, task]));
  let changed = false;
  for (const task of tasks) {
    if (!task.past) continue;
    const id = keptTaskKey(task);
    const before = shelf.get(id);
    // A day-old copy is fresh enough: the page doesn't rewrite storage on every render.
    if (before && before.status === task.status && before.className === task.className && now - before.savedAt < 24 * 60 * 60_000) continue;
    const { recordId: _recordId, ...rest } = task;
    shelf.set(id, { ...rest, key: id, savedAt: now });
    changed = true;
  }
  if (!changed) return null;
  const rows = [...shelf.values()].sort((a, b) => (b.dueAt ?? 0) - (a.dueAt ?? 0)).slice(0, LIMIT);
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    return null;
  }
  return rows;
}

/** Kept tasks the server no longer returns, as tickets the page can show beside the rest. */
export function keptTasksMissingFrom(
  kept: readonly KeptTask[],
  tasks: readonly SchoolTask[],
  filter: { providerClassId?: string; matches: (task: SchoolTask) => boolean },
): SchoolTask[] {
  const onServer = new Set(tasks.map(keptTaskKey));
  return kept
    .filter((task) => !onServer.has(task.key) && (!filter.providerClassId || task.providerClassId === filter.providerClassId))
    .map(({ key, savedAt: _savedAt, ...task }) => ({ ...task, recordId: `kept:${key}` as SchoolTask["recordId"], past: true }))
    .filter(filter.matches);
}

export function isKeptRecordId(recordId: string) {
  return recordId.startsWith("kept:");
}
