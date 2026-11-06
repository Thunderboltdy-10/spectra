"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { liveFolder } from "../devices/devices-model";
import { DEVICES_HREF } from "./client";
import { useBridgeHealth } from "./use-bridge";

/*
 * What this computer is doing for the Library, right where its files appear.
 * It comes from Bridge, so a refresh shows the same sync still going. Quiet
 * when everything is up to date.
 */
export function LibrarySyncStrip() {
  const { status, checked, reachability } = useBridgeHealth();
  if (!checked || !status) return null;
  const folders = (status.mounts ?? []).map((mount) => liveFolder(mount, Boolean(status.paused)));
  if (folders.length === 0) return null;

  let line: string | null = null;
  let progress: { synced: number; total: number } | null = null;
  if (!status.paired || reachability !== "connected") {
    line = `${folders[0].name}${folders.length > 1 ? ` and ${folders.length - 1} more` : ""} can't sync until Bridge is connected.`;
  } else {
    const problem = folders.find((folder) => folder.tone === "attention");
    const busy = folders.filter((folder) => folder.tone === "busy");
    if (problem) line = `${problem.name}: ${problem.detail ?? problem.label}`;
    else if (busy.length) {
      const synced = busy.reduce((sum, folder) => sum + (folder.progress?.synced ?? 0), 0);
      const total = busy.reduce((sum, folder) => sum + (folder.progress?.total ?? 0), 0);
      progress = total > 0 ? { synced, total } : null;
      const names = busy.length === 1 ? busy[0].name : `${busy.length} folders`;
      line = progress ? `Syncing ${names}, ${synced.toLocaleString()} of ${total.toLocaleString()} files` : `Syncing ${names}`;
    }
  }
  if (!line) return null;
  return (
    <Link
      href={DEVICES_HREF}
      className="relative mb-2 flex h-8 shrink-0 items-center gap-2 overflow-hidden rounded-control border border-[var(--border-subtle)] px-3 text-caption text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
    >
      <Icon name="syncing" size={13} />
      <span className="min-w-0 truncate">{line}</span>
      {progress ? (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-[var(--border-subtle)]">
          <span className="block h-full bg-[var(--text-secondary)]" style={{ width: `${(progress.synced / progress.total) * 100}%` }} />
        </span>
      ) : null}
    </Link>
  );
}
