import type { SpectraThread } from "../data/api";

/*
 * The threads view's groups (SHELL.md, "The threads view"): what is moving,
 * what the user pinned, what is recent by day, and the artifacts several
 * conversations touched. Plain data, so the view only renders.
 */

export type ThreadGroup = { key: string; title: string; threads: SpectraThread[] };

const DAY = 86_400_000;
export const RECENT_LIMIT = 40;
const ARTIFACT_GROUPS = 4;

const lastTouched = (thread: SpectraThread) => thread.lastMessageAt ?? thread.updatedAt;

function startOfDay(at: number) {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today", "Yesterday", "This week" or "Earlier", by the user's calendar days. */
export function dayGroup(at: number, now: number) {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  return "Earlier";
}

export function groupThreads(
  threads: readonly SpectraThread[],
  { activeIds = new Set<string>(), now = Date.now() }: { activeIds?: ReadonlySet<string>; now?: number } = {},
): ThreadGroup[] {
  const live = threads.filter((thread) => thread.status === "active").sort((a, b) => lastTouched(b) - lastTouched(a));
  const active = live.filter((thread) => activeIds.has(thread._id));
  const pinned = live.filter((thread) => thread.pinned && !activeIds.has(thread._id));
  const rest = live.filter((thread) => !thread.pinned && !activeIds.has(thread._id)).slice(0, RECENT_LIMIT);

  const groups: ThreadGroup[] = [];
  if (active.length) groups.push({ key: "active", title: "Active", threads: active });
  if (pinned.length) groups.push({ key: "pinned", title: "Pinned", threads: pinned });
  const byDay = new Map<string, SpectraThread[]>();
  for (const thread of rest) {
    const day = dayGroup(lastTouched(thread), now);
    byDay.set(day, [...(byDay.get(day) ?? []), thread]);
  }
  for (const day of ["Today", "Yesterday", "This week", "Earlier"]) {
    const rows = byDay.get(day);
    if (rows?.length) groups.push({ key: `day:${day}`, title: day, threads: rows });
  }

  // Artifacts that more than one conversation worked on, busiest first.
  const byArtifact = new Map<string, { title: string; threads: SpectraThread[] }>();
  for (const thread of live) {
    for (const artifact of thread.contexts?.artifacts ?? []) {
      const entry = byArtifact.get(artifact.id) ?? { title: artifact.title, threads: [] };
      entry.threads.push(thread);
      byArtifact.set(artifact.id, entry);
    }
  }
  const shared = [...byArtifact.entries()]
    .filter(([, entry]) => entry.threads.length > 1)
    .sort((a, b) => b[1].threads.length - a[1].threads.length || lastTouched(b[1].threads[0]) - lastTouched(a[1].threads[0]))
    .slice(0, ARTIFACT_GROUPS);
  for (const [id, entry] of shared) groups.push({ key: `artifact:${id}`, title: entry.title, threads: entry.threads });
  return groups;
}

/** Words-only matching for when the semantic layer has nothing (offline, or too short a query). */
export function matchThreads(threads: readonly SpectraThread[], query: string) {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return threads.filter((thread) => {
    const text = [thread.title, thread.summaryShort, thread.previewText, ...(thread.contexts?.artifacts ?? []).map((artifact) => artifact.title)]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}
