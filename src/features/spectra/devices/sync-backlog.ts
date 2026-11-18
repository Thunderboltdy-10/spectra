"use client";

import { useMemo } from "react";
import { useConvexAuth, useQueries } from "convex/react";
import { api } from "../../../../convex/_generated/api";

/** Which way a file still has to go, or why it can't. */
export type BacklogDirection = "toComputer" | "toSpectra" | "conflict" | "problem";
export type BacklogFile = { workId: string; path: string; direction: BacklogDirection };
export type FolderBacklog = Record<BacklogDirection, BacklogFile[]>;

export const EMPTY_BACKLOG: FolderBacklog = { toComputer: [], toSpectra: [], conflict: [], problem: [] };

/** What reads first when a file is in two states at once (it can't be). */
const RANK: Record<BacklogDirection, number> = { conflict: 0, problem: 1, toComputer: 2, toSpectra: 3 };

export type SyncBacklog = {
  /** Per synced folder (its grant), the files still moving each way. */
  byFolder: ReadonlyMap<string, FolderBacklog>;
  /** Per piece of work, the one direction it is waiting on. */
  byWork: ReadonlyMap<string, BacklogDirection>;
};

export function groupBacklog(files: ReadonlyArray<BacklogFile & { grantId: string }>): SyncBacklog {
  const byFolder = new Map<string, FolderBacklog>();
  const byWork = new Map<string, BacklogDirection>();
  for (const file of files) {
    const folder = byFolder.get(file.grantId) ?? { toComputer: [], toSpectra: [], conflict: [], problem: [] };
    folder[file.direction].push({ workId: file.workId, path: file.path, direction: file.direction });
    byFolder.set(file.grantId, folder);
    const current = byWork.get(file.workId);
    if (!current || RANK[file.direction] < RANK[current]) byWork.set(file.workId, file.direction);
  }
  for (const folder of byFolder.values())
    for (const list of Object.values(folder)) list.sort((a, b) => a.path.localeCompare(b.path));
  return { byFolder, byWork };
}

/**
 * Read as a value, never thrown: a backend that doesn't have the query yet
 * (deployed after the web app) or a failed read leaves the lanes empty
 * instead of taking the Devices page down with it.
 */
export function useSyncBacklog(enabled: boolean): SyncBacklog {
  const { isAuthenticated } = useConvexAuth();
  const on = enabled && isAuthenticated;
  // useQueries resubscribes whenever this object changes, so it is kept stable.
  const request = useMemo(() => {
    const queries: Parameters<typeof useQueries>[0] = {};
    if (on) queries.backlog = { query: api.bridge.syncBacklog, args: {} };
    return queries;
  }, [on]);
  const results = useQueries(request);
  const result = results.backlog as { files: Array<BacklogFile & { grantId: string }> } | null | undefined | Error;
  return useMemo(() => groupBacklog(result && !(result instanceof Error) ? result.files : []), [result]);
}

/** "3 files", "1 file". */
export function files(count: number) {
  return `${count.toLocaleString()} file${count === 1 ? "" : "s"}`;
}

/** A file's own badge in a folder's list. */
export const BACKLOG_BADGE: Record<BacklogDirection, { label: string; hint: string; icon: "arrowDown" | "arrowUp" | "problem" | "info" }> = {
  toComputer: {
    label: "Spectra's edits on the way",
    hint: "Saved to the file once the computer is on and the file isn't open in Office.",
    icon: "arrowDown",
  },
  toSpectra: {
    label: "Edits on the way to Spectra",
    hint: "Spectra takes in the saved file within a minute, or when it's next opened there.",
    icon: "arrowUp",
  },
  conflict: {
    label: "Edited in both places",
    hint: "Nothing is lost: open it in Spectra to keep both sets of changes.",
    icon: "info",
  },
  problem: {
    label: "Couldn't sync",
    hint: "Retry the folder. If it keeps failing, Show logs says why.",
    icon: "problem",
  },
};
