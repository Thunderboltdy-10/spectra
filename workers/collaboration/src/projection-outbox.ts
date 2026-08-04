import type { ProjectionOutboxItem, YDocStore } from "./ydoc-store";

export type Projector = (item: ProjectionOutboxItem) => Promise<void>;

export async function drainProjectionOutbox(
  store: YDocStore,
  projector: Projector,
  now = Date.now(),
) {
  const due = await store.dueProjections(now);
  for (const item of due) {
    try {
      await projector({ ...item, status: "processing" });
      await store.updateProjection({ ...item, status: "completed" });
    } catch {
      const attempts = item.attempts + 1;
      await store.updateProjection({
        ...item,
        attempts,
        nextAttemptAt: now + Math.min(60_000, 2 ** attempts * 1_000),
        status: "pending",
      });
    }
  }
  return due.length;
}
