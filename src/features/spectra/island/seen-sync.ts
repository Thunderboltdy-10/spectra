"use client";

import { postSpectra } from "../data/api";

/*
 * Seen runs are also told to the server, so reading a thread on one device
 * makes it read on the others (their island reads `seenRunId` on its tabs).
 * Marks are batched; a failed send is retried with the next batch.
 */
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function sendSeenRuns(runIds: readonly string[]) {
  for (const id of runIds) if (id && !id.startsWith("pending")) pending.add(id);
  if (!pending.size || timer) return;
  timer = setTimeout(() => {
    timer = null;
    const batch = [...pending].slice(0, 40);
    for (const id of batch) pending.delete(id);
    void postSpectra({ action: "markRunTabsSeen", runIds: batch }).catch(() => {
      for (const id of batch) pending.add(id);
    });
  }, 1_200);
}
