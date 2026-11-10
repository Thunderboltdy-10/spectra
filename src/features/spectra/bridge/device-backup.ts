"use client";

import { base64ToBytes } from "../collaboration/device-work";
import { callWorks, deviceStoreSummary } from "./device-works";
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
  server: {
    uploadUrl: () => Promise<string>;
    record: (input: { storeId: string; storageId: string; bytes: number; works: number; full: boolean }) => Promise<{ at: number }>;
  },
  options: { force?: boolean } = {},
) {
  const revision = accountStorageRevision();
  assertAccountStorageRevision(revision);
  if (!options.force && !takeLock()) return { state: "elsewhere" as const };
  const summary = await deviceStoreSummary();
  assertAccountStorageRevision(revision);
  if (!summary.works) return { state: "empty" as const };
  const full = !settings.lastFullBackupAt || Date.now() - settings.lastFullBackupAt >= FULL_EVERY_MS;
  if (!full && !summary.changedSinceBackup) return { state: "unchanged" as const };
  const bundle = await callWorks<{ bundleBase64: string; works: number; bytes: number }>("backup", { full }, 120_000);
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
  const { at } = await server.record({ storeId: summary.storeId, storageId, bytes: bundle.bytes, works: bundle.works, full });
  assertAccountStorageRevision(revision);
  await callWorks("backedUp", { at });
  assertAccountStorageRevision(revision);
  return { state: "saved" as const, at, works: bundle.works, bytes: bundle.bytes };
}

/** Brings backed-up work back onto this computer, oldest first; newer work here is kept. */
export async function restoreBackups(backups: Array<{ url: string | null }>) {
  const revision = accountStorageRevision();
  assertAccountStorageRevision(revision);
  let restored = 0;
  for (const backup of backups) {
    if (!backup.url) continue;
    const response = await fetch(backup.url);
    assertAccountStorageRevision(revision);
    if (!response.ok) throw new Error("A backup could not be downloaded.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertAccountStorageRevision(revision);
    let binary = "";
    for (let at = 0; at < bytes.length; at += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    const result = await callWorks<{ restored?: number }>("restore", { bundleBase64: btoa(binary) }, 120_000);
    assertAccountStorageRevision(revision);
    restored += result.restored ?? 0;
  }
  return restored;
}
