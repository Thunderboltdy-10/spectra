"use client";

import { useSyncExternalStore } from "react";
import {
  authorizedBridgeRequest,
  BRIDGE_REQUEST_TIMEOUT_MS,
  loadBridgeSession,
} from "./client";
import { bridgeIsAway } from "./availability";
import { deviceBaseline, wordsOf, type DeviceSeed } from "../collaboration/device-work";
import { requestSpectra } from "../data/request";
import { spectraBus } from "../events";
import { accountStorageRevision, assertAccountStorageRevision } from "@/lib/account-storage-scope";

/*
 * Talking to the work kept on this computer. Bridge answers from its own file,
 * so nothing here counts against anything in the cloud.
 */

export type WorkStorage = "device_backup" | "device_only" | "cloud";

export const DEVICE_WORK_TYPES = new Set([
  "document", "flashcard_deck", "quiz", "presentation", "sheets", "code", "whiteboard",
]);

type DeviceState = {
  /** This computer's store, once Bridge has answered. */
  storeId: string | null;
  /** What this account chose; unset means they haven't been asked. */
  storage: WorkStorage | null;
};

let state: DeviceState = { storeId: null, storage: null };
let stateRevision: string | undefined;
const listeners = new Set<() => void>();

function deviceState() {
  const revision = accountStorageRevision();
  if (stateRevision !== revision) {
    stateRevision = revision;
    state = { storeId: null, storage: null };
    seeded.clear(); knownOnDevice.clear();
  }
  return state;
}

export function publishDeviceState(next: Partial<DeviceState>) {
  deviceState();
  const merged = { ...state, ...next };
  if (merged.storeId === state.storeId && merged.storage === state.storage) return;
  state = merged;
  for (const listener of listeners) listener();
}

export function useDeviceState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    deviceState,
    deviceState,
  );
}

/** Where a new work goes: this computer, unless the person chose the cloud or Bridge isn't here. */
export function newWorkStoreId(blueprintKey: string) {
  deviceState();
  if (!state.storeId || state.storage === "cloud" || !DEVICE_WORK_TYPES.has(blueprintKey)) return undefined;
  return state.storeId;
}

export async function callWorks<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS * 2,
  options: { evenIfAway?: boolean } = {},
): Promise<T> {
  const revision = accountStorageRevision();
  assertAccountStorageRevision(revision);
  if (bridgeIsAway() && !options.evenIfAway) throw new Error("Spectra Bridge isn't answering on this computer.");
  const response = await authorizedBridgeRequest(
    "/v1/works/call",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 1, method, params }),
    },
    timeoutMs,
  );
  if (!response) throw new Error("Spectra Bridge isn't connected to this browser.");
  if (!response.ok) throw new Error(`Spectra Bridge answered ${response.status}.`);
  const reply = (await response.json()) as { result?: T; error?: string };
  assertAccountStorageRevision(revision);
  if (reply.error) throw new Error(reply.error);
  return reply.result as T;
}

export type DeviceWorkRow = {
  artifactId: string;
  title?: string | null;
  summary?: string | null;
  tags?: string[] | null;
  blueprintKey?: string | null;
  schemaVersion?: number | null;
  content?: unknown;
  updatedAt?: number;
};

export type DeviceStoreSummary = {
  storeId: string;
  works: number;
  changedSinceBackup: number;
  bytes: number;
  lastBackupAt: number | null;
};

export function deviceStoreSummary(options: { evenIfAway?: boolean } = {}) {
  return callWorks<DeviceStoreSummary>("summary", {}, undefined, options);
}

/** A new work's words, into Bridge. If Bridge has gone, they go to the cloud rather than nowhere. */
export async function seedNewDeviceWork(
  created: { artifactId: string; schemaVersion?: number },
  input: { blueprintKey: string; title: string; summary?: string; tags?: string[]; content?: unknown },
) {
  if (created.schemaVersion === undefined || input.content === undefined) return;
  const revision = accountStorageRevision();
  assertAccountStorageRevision(revision); deviceState();
  knownOnDevice.add(created.artifactId);
  const seed: DeviceSeed = {
    typeKey: input.blueprintKey,
    title: input.title,
    summary: input.summary,
    tags: input.tags ?? [],
    schemaVersion: created.schemaVersion,
    content: input.content,
  };
  try {
    const baseline = deviceBaseline(seed);
    await callWorks("seed", { artifactId: created.artifactId, stateBase64: baseline.stateBase64, projection: baseline.projection });
    assertAccountStorageRevision(revision);
    seeded.add(created.artifactId);
    void markSeeded(created.artifactId);
  } catch {
    assertAccountStorageRevision(revision);
    await sendWorkToCloud(created.artifactId, { ...input, tags: input.tags ?? [], text: wordsOf(input.content) });
    assertAccountStorageRevision(revision);
    knownOnDevice.delete(created.artifactId);
  }
}

/** From now on a missing copy of this work is a lost copy, never an empty new one. */
async function markSeeded(artifactId: string) {
  await requestSpectra("/api/spectra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "touchDeviceWork", artifactId, seeded: true }),
  }).catch(() => undefined);
}

const REMOVALS_KEY = "spectra:device-removals-pending";

function pendingRemovals(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(`${REMOVALS_KEY}:${accountStorageRevision()}`) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, 200) : [];
  } catch {
    return [];
  }
}

function keepPendingRemovals(ids: string[]) {
  try {
    const key = `${REMOVALS_KEY}:${accountStorageRevision()}`;
    if (ids.length) window.localStorage.setItem(key, JSON.stringify(ids));
    else window.localStorage.removeItem(key);
  } catch {
    // Without storage the stale copy is only tidied on a later move.
  }
}

/** A work moved online whose copy here couldn't be removed then is removed now. */
export async function retryPendingRemovals() {
  const ids = pendingRemovals();
  if (!ids.length) return;
  const left: string[] = [];
  for (const artifactId of ids) {
    await callWorks("remove", { artifactId }).catch(() => left.push(artifactId));
  }
  keepPendingRemovals(left);
}

async function sendWorkToCloud(
  artifactId: string,
  work: { blueprintKey: string; title: string; summary?: string; tags: string[]; content?: unknown; text?: string },
) {
  const revision = accountStorageRevision();
  assertAccountStorageRevision(revision);
  const response = await requestSpectra("/api/spectra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "workMovedToCloud", artifactId, ...work }),
  });
  assertAccountStorageRevision(revision);
  if (!response.ok) throw new Error("This artifact could not be moved to the cloud.");
}

/** Takes a cloud work onto this computer, and only then lets go of the cloud's copy. */
export async function moveWorkToDevice(
  work: { _id: string; blueprintKey: string; title: string; summary?: string; tags?: string[]; schemaVersion?: number; content?: unknown },
  storeId: string,
) {
  const revision = accountStorageRevision();
  assertAccountStorageRevision(revision); deviceState();
  const baseline = deviceBaseline({
    typeKey: work.blueprintKey,
    title: work.title,
    summary: work.summary,
    tags: work.tags ?? [],
    schemaVersion: work.schemaVersion ?? 1,
    content: work.content,
  });
  await callWorks("import", { artifactId: work._id, stateBase64: baseline.stateBase64, projection: baseline.projection });
  assertAccountStorageRevision(revision);
  const response = await requestSpectra("/api/spectra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "workMovedToDevice", artifactId: work._id, storeId }),
  });
  assertAccountStorageRevision(revision);
  if (!response.ok) {
    await callWorks("remove", { artifactId: work._id }).catch(() => undefined);
    assertAccountStorageRevision(revision);
    throw new Error("This artifact could not be moved to this computer.");
  }
  knownOnDevice.add(work._id);
  seeded.add(work._id);
  spectraBus.emit("artifact.storageMoved", { artifactId: work._id });
}

/** Brings a work up to the cloud, for sharing or another computer. */
export async function moveWorkToCloud(artifactId: string) {
  const revision = accountStorageRevision();
  assertAccountStorageRevision(revision); deviceState();
  const stored = await callWorks<DeviceWorkRow | null>("get", { artifactId });
  assertAccountStorageRevision(revision);
  if (!stored?.blueprintKey) throw new Error("This artifact isn't on this computer.");
  await sendWorkToCloud(artifactId, {
    blueprintKey: stored.blueprintKey,
    title: stored.title ?? "Untitled",
    ...(stored.summary ? { summary: stored.summary } : {}),
    tags: stored.tags ?? [],
    content: stored.content,
    text: wordsOf(stored.content),
  });
  assertAccountStorageRevision(revision);
  await callWorks("remove", { artifactId }).catch(() => {
    keepPendingRemovals([...new Set([...pendingRemovals(), artifactId])]);
  });
  assertAccountStorageRevision(revision);
  knownOnDevice.delete(artifactId);
  seeded.delete(artifactId);
  spectraBus.emit("artifact.storageMoved", { artifactId });
}

const seeded = new Set<string>();
const knownOnDevice = new Set<string>();

export function isDeviceWork(artifactId: string) {
  deviceState();
  return knownOnDevice.has(artifactId);
}

/** The work as Bridge last saved it, or nothing when Bridge can't say. */
export async function readDeviceWork(artifactId: string) {
  deviceState();
  knownOnDevice.add(artifactId);
  return callWorks<DeviceWorkRow | null>("get", { artifactId }).catch(() => null);
}

const VERSION_SOURCES: Record<string, string> = {
  before_ai: "checkpoint",
  before_restore: "checkpoint",
  ai: "ai",
  restore: "restore",
  edit: "manual",
  close: "manual",
};

type StoredVersion = {
  id: number;
  at: number;
  source: string;
  summary?: string | null;
  actor?: string | null;
  runId?: string | null;
  title?: string | null;
  content?: unknown;
};

function versionSummary(artifactId: string, version: StoredVersion) {
  const label =
    version.summary ??
    (version.source === "before_ai"
      ? "Your artifact before the AI's edit"
      : version.source === "before_restore"
        ? "Your artifact before restore"
        : version.source === "ai"
          ? "AI edit"
          : version.source === "restore"
            ? "Restored version"
            : "Saved");
  return {
    _id: `device:${version.id}`,
    artifactId,
    source: VERSION_SOURCES[version.source] ?? "manual",
    ...(version.runId ? { runId: version.runId } : {}),
    summary: label,
    createdAt: version.at,
    snapshotState: "ready" as const,
  };
}

/** History for work on this computer, shaped like the history panel's pages. */
export async function deviceVersionPage(artifactId: string, limit: number) {
  const versions = await callWorks<StoredVersion[]>("versions", { artifactId, limit });
  return { versions: versions.map((version) => versionSummary(artifactId, version)), continueCursor: null, isDone: true };
}

export async function deviceVersion(artifactId: string, versionId: string) {
  const id = Number(versionId.slice("device:".length));
  const version = await callWorks<StoredVersion | null>("version", { artifactId, id });
  if (!version) return null;
  return {
    ...versionSummary(artifactId, version),
    after: { title: version.title ?? "Untitled", content: version.content, tags: [] as string[] },
  };
}

/** Gets a browser into the room on this computer, or says why it can't. */
export async function enterDeviceRoom<T extends { token: string; device?: { storeId: string; storageSeeded?: boolean; seed: DeviceSeed } }>(
  artifactId: string,
  session: T,
): Promise<T> {
  const device = session.device;
  if (!device) return session;
  const revision = accountStorageRevision();
  assertAccountStorageRevision(revision); deviceState();
  knownOnDevice.add(artifactId);
  if (!loadBridgeSession())
    throw new Error(
      "COLLABORATION_DEVICE_UNAVAILABLE: This artifact is kept on a computer through Spectra Bridge, which isn't connected to this browser.",
    );
  let summary: DeviceStoreSummary;
  try {
    summary = await deviceStoreSummary();
  } catch {
    throw new Error(
      "COLLABORATION_DEVICE_UNAVAILABLE: This artifact is kept on this computer and Spectra Bridge isn't answering. Open it and your artifact comes straight back.",
    );
  }
  assertAccountStorageRevision(revision);
  if (summary.storeId !== device.storeId)
    throw new Error(
      "COLLABORATION_DEVICE_ELSEWHERE: This artifact is kept on another of your computers. Open it there, or move it to the cloud from that computer.",
    );
  if (!seeded.has(artifactId)) {
    // Seeding makes a new work; it never stands in for one this computer has lost.
    const held = await callWorks<DeviceWorkRow | null>("get", { artifactId });
    assertAccountStorageRevision(revision);
    if (!held) {
      if (device.storageSeeded)
        throw new Error("COLLABORATION_DEVICE_MISSING: This artifact isn't on this computer. Bring it back from your backup.");
      const baseline = deviceBaseline(device.seed);
      await callWorks("seed", { artifactId, stateBase64: baseline.stateBase64, projection: baseline.projection });
      assertAccountStorageRevision(revision);
      void markSeeded(artifactId);
    }
    seeded.add(artifactId);
  }
  assertAccountStorageRevision(revision);
  return { ...session, token: loadBridgeSession() ?? "" };
}
