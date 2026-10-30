import { readPerformances, type AiPerformance } from "./performance";

// A newly created work only becomes readable after its commit. Its writer's
// socket can already be gone by then, so keep the acknowledged performance
// briefly for the studio Follow AI is opening, which may be a while behind the
// run: a followed view finishes the hand on screen before it moves on. This
// never writes document data.
const JOIN_WINDOW_MS = 30_000;
const recent = new Map<string, { performance: AiPerformance; committedAt: number }>();
const listeners = new Set<() => void>();

export function rememberCommittedPerformance(value: unknown, committedAt: unknown) {
  if (typeof committedAt !== "number" || !Number.isFinite(committedAt) ||
      Date.now() - committedAt > JOIN_WINDOW_MS || committedAt > Date.now() + 5_000) return;
  const performance = readPerformances({ performances: [value] })[0];
  if (!performance || performance.withdrawn || recent.has(performance.id)) return;
  for (const [id, entry] of recent)
    if (Date.now() - entry.committedAt > JOIN_WINDOW_MS) recent.delete(id);
  recent.set(performance.id, { performance, committedAt });
  if (recent.size > 40) recent.delete(recent.keys().next().value!);
  listeners.forEach((listener) => listener());
  return performance;
}

export function committedPerformancesFor(artifactId: string): AiPerformance[] {
  return [...recent.values()]
    .filter((entry) => entry.performance.artifactId === artifactId && Date.now() - entry.committedAt <= JOIN_WINDOW_MS)
    .map(({ performance }) => ({ ...performance, startAt: Date.now() }));
}

export function subscribeCommittedPerformances(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
