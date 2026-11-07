import { readPerformances, type AiPerformance } from "./performance";

// A newly created work only becomes readable after its commit. Its writer's
// socket can already be gone by then, so keep the acknowledged performance for
// the first time this work is opened, which may be a while behind the run. It
// plays once: opening the work again shows it finished. This never writes
// document data.
const JOIN_WINDOW_MS = 10 * 60_000;
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

/** It has been played, so it never plays again. */
export function forgetCommittedPerformance(id: string) {
  recent.delete(id);
}

export function subscribeCommittedPerformances(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
