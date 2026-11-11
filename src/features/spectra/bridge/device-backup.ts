"use client";

import { base64ToBytes } from "../collaboration/device-work";
import { callWorks, deviceStoreSummary } from "./device-works";
import { loadBridgeStatusCache } from "./client";
import { accountStorageRevision, accountStorageScope, assertAccountStorageRevision } from "@/lib/account-storage-scope";

/*
 * Copies what changed on this computer up to the account every so often, so a
 * lost laptop doesn't lose the work. Never on each edit, and never at all for
 * someone who chose to keep everything on this computer.
 */

const LOCK_KEY = "spectra:device-backup-started";
const LOCK_MS = 10 * 60_000;
const FULL_EVERY_MS = 7 * 24 * 60 * 60_000;

export type BackupSettings = {
  storage: string | null;
  backupEveryHours: number;
  lastBackupAt: number | null;
  lastFullBackupAt: number | null;
  /** Backups other computers left for this one after its works moved here. */
  handOvers?: string[];
};

export type BackupServer = {
  uploadUrl: () => Promise<string>;
  record: (input: {
    storeId: string;
    storageId: string;
    bytes: number;
    works: number;
    full: boolean;
    computerName?: string;
    handOverTo?: string[];
  }) => Promise<{ at: number }>;
};

export function backupIsDue(settings: BackupSettings, now = Date.now()) {
  if (settings.storage === "cloud" || settings.storage === "device_only") return false;
  if (!settings.lastBackupAt) return true;
  return now - settings.lastBackupAt >= settings.backupEveryHours * 60 * 60_000;
}

function takeLock() {
  try {
    const key = `${LOCK_KEY}:${accountStorageScope()}`;
    const started = Number(window.localStorage.getItem(key));
    if (started && Date.now() - started < LOCK_MS) return false;
    window.localStorage.setItem(key, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

export async function backUpNow(
  settings: BackupSettings,
  server: BackupServer,
  options: { force?: boolean; handOverTo?: string[] } = {},
) {
  const revision = accountStorageRevision();
  assertAccountStorageRevision(revision);
  if (!options.force && !takeLock()) return { state: "elsewhere" as const };
  const summary = await deviceStoreSummary();
  assertAccountStorageRevision(revision);
  if (!summary.works) return { state: "empty" as const };
  const full = !settings.lastFullBackupAt || Date.now() - settings.lastFullBackupAt >= FULL_EVERY_MS;
  if (!full && !summary.changedSinceBackup) return { state: "unchanged" as const };
  const bundle = await callWorks<{ bundleBase64: string; works: number; bytes: number; snapshotRev?: number }>("backup", { full }, 120_000);
  assertAccountStorageRevision(revision);
  const url = await server.uploadUrl();
  assertAccountStorageRevision(revision);
  const upload = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: base64ToBytes(bundle.bundleBase64),
  });
  assertAccountStorageRevision(revision);
  if (!upload.ok) throw new Error(`The backup could not be uploaded (${upload.status}).`);
  const { storageId } = (await upload.json()) as { storageId: string };
  assertAccountStorageRevision(revision);
  const computerName = loadBridgeStatusCache()?.deviceName || undefined;
  const { at } = await server.record({
    storeId: summary.storeId,
    storageId,
    bytes: bundle.bytes,
    works: bundle.works,
    full,
    ...(computerName ? { computerName } : {}),
    ...(options.handOverTo?.length ? { handOverTo: options.handOverTo } : {}),
  });
  assertAccountStorageRevision(revision);
  // Only what the bundle held counts as backed up; an edit made meanwhile waits for the next one.
  await callWorks("backedUp", { at, snapshotRev: bundle.snapshotRev });
  assertAccountStorageRevision(revision);
  return { state: "saved" as const, at, works: bundle.works, bytes: bundle.bytes };
}

async function restoreOne(url: string, params: { onlyHeld?: boolean; handOverId?: string } = {}) {
  const revision = accountStorageRevision();
  const response = await fetch(url);
  assertAccountStorageRevision(revision);
  if (!response.ok) throw new Error("A backup could not be downloaded.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assertAccountStorageRevision(revision);
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  const result = await callWorks<{ restored?: number; artifactIds?: string[] }>(
    "restore",
    { bundleBase64: btoa(binary), ...params },
    120_000,
  );
  assertAccountStorageRevision(revision);
  return result.artifactIds ?? [];
}

/** Brings one computer's backups onto this one, oldest first, merged with what is here. Returns the works it brought. */
export async function restoreBackups(backups: Array<{ url: string | null }>) {
  const revision = accountStorageRevision();
  assertAccountStorageRevision(revision);
  const restored = new Set<string>();
  for (const backup of backups) {
    if (!backup.url) continue;
    for (const id of await restoreOne(backup.url)) restored.add(id);
  }
  return [...restored];
}

/**
 * On a computer whose works were taken over by another: the edits written here
 * since its last backup go to the new home in one backup addressed to it.
 */
export async function handOverEdits(
  settings: BackupSettings,
  server: BackupServer & { targets: (artifactIds: string[]) => Promise<string[]> },
) {
  if (settings.storage === "device_only" || settings.storage === "cloud") return { state: "none" as const };
  const { artifactIds } = await callWorks<{ artifactIds: string[] }>("changed");
  if (!artifactIds.length) return { state: "none" as const };
  const targets = await server.targets(artifactIds.slice(0, 200));
  if (!targets.length) return { state: "none" as const };
  return backUpNow(settings, server, { handOverTo: targets });
}

/** On the computer works moved to: merges the hand-overs it hasn't merged, only into works it holds. */
export async function mergeHandOvers(
  waiting: readonly string[],
  list: () => Promise<Array<{ id: string; url: string | null }>>,
) {
  if (!waiting.length) return 0;
  const { backupIds } = await callWorks<{ backupIds: string[] }>("handOversMerged");
  const merged = new Set(backupIds);
  if (waiting.every((id) => merged.has(id))) return 0;
  let brought = 0;
  for (const backup of await list()) {
    if (merged.has(backup.id) || !backup.url) continue;
    brought += (await restoreOne(backup.url, { onlyHeld: true, handOverId: backup.id })).length;
  }
  return brought;
}
