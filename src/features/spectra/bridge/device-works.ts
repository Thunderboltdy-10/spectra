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
const listeners = new Set<() => void>();

export function publishDeviceState(next: Partial<DeviceState>) {
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
    () => state,
    () => state,
  );
}

/** Where a new work goes: this computer, unless the person chose the cloud or Bridge isn't here. */
export function newWorkStoreId(blueprintKey: string) {
  if (!state.storeId || state.storage === "cloud" || !DEVICE_WORK_TYPES.has(blueprintKey)) return undefined;
  return state.storeId;
}

export async function callWorks<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS * 2,
  options: { evenIfAway?: boolean } = {},
): Promise<T> {
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
    seeded.add(created.artifactId);
  } catch {
    await sendWorkToCloud(created.artifactId, { ...input, tags: input.tags ?? [], text: wordsOf(input.content) });
    knownOnDevice.delete(created.artifactId);
  }
}

async function sendWorkToCloud(
  artifactId: string,
  work: { blueprintKey: string; title: string; summary?: string; tags: string[]; content?: unknown; text?: string },
) {
  const response = await requestSpectra("/api/spectra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "workMovedToCloud", artifactId, ...work }),
  });
  if (!response.ok) throw new Error("This work could not be moved to the cloud.");
}

/** Takes a cloud work onto this computer, and only then lets go of the cloud's copy. */
export async function moveWorkToDevice(
  work: { _id: string; blueprintKey: string; title: string; summary?: string; tags?: string[]; schemaVersion?: number; content?: unknown },
  storeId: string,
) {
  const baseline = deviceBaseline({
    typeKey: work.blueprintKey,
    title: work.title,
    summary: work.summary,
    tags: work.tags ?? [],
    schemaVersion: work.schemaVersion ?? 1,
    content: work.content,
  });
  await callWorks("import", { artifactId: work._id, stateBase64: baseline.stateBase64, projection: baseline.projection });
  const response = await requestSpectra("/api/spectra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "workMovedToDevice", artifactId: work._id, storeId }),
  });
  if (!response.ok) {
    await callWorks("remove", { artifactId: work._id }).catch(() => undefined);
    throw new Error("This work could not be moved to this computer.");
  }
  knownOnDevice.add(work._id);
  seeded.add(work._id);
}

/** Brings a work up to the cloud, for sharing or another computer. */
export async function moveWorkToCloud(artifactId: string) {
  const stored = await callWorks<DeviceWorkRow | null>("get", { artifactId });
  if (!stored?.blueprintKey) throw new Error("This work isn't on this computer.");
  await sendWorkToCloud(artifactId, {
    blueprintKey: stored.blueprintKey,
    title: stored.title ?? "Untitled",
    ...(stored.summary ? { summary: stored.summary } : {}),
    tags: stored.tags ?? [],
    content: stored.content,
    text: wordsOf(stored.content),
  });
  await callWorks("remove", { artifactId }).catch(() => undefined);
  knownOnDevice.delete(artifactId);
  seeded.delete(artifactId);
}

const seeded = new Set<string>();
const knownOnDevice = new Set<string>();

export function isDeviceWork(artifactId: string) {
  return knownOnDevice.has(artifactId);
}

/** The work as Bridge last saved it, or nothing when Bridge can't say. */
export async function readDeviceWork(artifactId: string) {
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
      ? "Your work before the AI's edit"
      : version.source === "before_restore"
        ? "Your work before restore"
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
export async function enterDeviceRoom<T extends { token: string; device?: { storeId: string; seed: DeviceSeed } }>(
  artifactId: string,
  session: T,
): Promise<T> {
  const device = session.device;
  if (!device) return session;
  knownOnDevice.add(artifactId);
  if (!loadBridgeSession())
    throw new Error(
      "COLLABORATION_DEVICE_UNAVAILABLE: This work is kept on a computer through Spectra Bridge, which isn't connected to this browser.",
    );
  let summary: DeviceStoreSummary;
  try {
    summary = await deviceStoreSummary();
  } catch {
    throw new Error(
      "COLLABORATION_DEVICE_UNAVAILABLE: This work is kept on this computer and Spectra Bridge isn't answering. Open it and your work comes straight back.",
    );
  }
  if (summary.storeId !== device.storeId)
    throw new Error(
      "COLLABORATION_DEVICE_ELSEWHERE: This work is kept on another of your computers. Open it there, or move it to the cloud from that computer.",
    );
  if (!seeded.has(artifactId)) {
    const baseline = deviceBaseline(device.seed);
    await callWorks("seed", { artifactId, stateBase64: baseline.stateBase64, projection: baseline.projection });
    seeded.add(artifactId);
  }
  return { ...session, token: loadBridgeSession() ?? "" };
}
