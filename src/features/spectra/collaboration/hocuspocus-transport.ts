"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import type { ArtifactCollaborationTransport, CollaborationPresence, CollaborationSyncState, CollaborationTransportSnapshot } from "./types";

type SessionResponse = { token: string; documentName: string; provider: "self_hosted_yjs"; url: string; expiresInMs: number; level: "read" | "modify"; accountId: string; displayName: string };

function clientIdentity(artifactId: string) {
  const key = `spectra.collaboration.client.${artifactId}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.sessionStorage.setItem(key, value);
  return value;
}

async function session(artifactId: string, partitionKey: string, clientId: string, schemaVersion: number) {
  const response = await fetch("/api/spectra/collaboration/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artifactId, partitionKey, clientId, schemaVersion }), cache: "no-store" });
  const payload = await response.json() as SessionResponse | { error?: string | { message?: string } };
  if (!response.ok || !("token" in payload)) {
    const error = "error" in payload ? typeof payload.error === "string" ? payload.error : payload.error?.message : undefined;
    throw new Error(error || "Could not start collaboration.");
  }
  return payload;
}

export class HocuspocusArtifactTransport implements ArtifactCollaborationTransport {
  readonly document = new Y.Doc();
  readonly clientId: string;
  private provider: HocuspocusProvider | null = null;
  private listeners = new Set<() => void>();
  private state: CollaborationSyncState = "connecting";
  private level: "read" | "modify" | null = null;
  private unsynchronizedChanges = 0;
  private presence: CollaborationPresence[] = [];
  private error?: string;
  private destroyed = false;
  private snapshot: CollaborationTransportSnapshot = {
    state: "connecting",
    level: null,
    unsynchronizedChanges: 0,
    presence: [],
  };

  constructor(private readonly artifactId: string, private readonly partitionKey = "root", private readonly schemaVersion = 1) {
    this.clientId = clientIdentity(artifactId);
  }

  getSnapshot = (): CollaborationTransportSnapshot => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private update(next: Partial<CollaborationTransportSnapshot>) {
    if (next.state) this.state = next.state;
    if (next.level !== undefined) this.level = next.level;
    if (next.unsynchronizedChanges !== undefined) this.unsynchronizedChanges = next.unsynchronizedChanges;
    if (next.presence) this.presence = next.presence;
    if (next.error !== undefined) this.error = next.error;
    this.snapshot = {
      state: this.state,
      level: this.level,
      unsynchronizedChanges: this.unsynchronizedChanges,
      presence: this.presence,
      ...(this.error ? { error: this.error } : {}),
    };
    this.emit();
  }

  async connect() {
    if (this.destroyed || this.provider) return;
    this.update({ state: "connecting", error: undefined });
    try {
      const initial = await session(this.artifactId, this.partitionKey, this.clientId, this.schemaVersion);
      this.update({ level: initial.level, state: "synchronizing" });
      this.provider = new HocuspocusProvider({
      url: initial.url,
      name: initial.documentName,
      document: this.document,
      flushDelay: 180,
      token: async () => (await session(this.artifactId, this.partitionKey, this.clientId, this.schemaVersion)).token,
      onStatus: ({ status }) => {
        if (status === "connected") this.update({ state: this.provider?.synced ? "synchronized" : "synchronizing" });
        else this.update({ state: this.state === "connecting" ? "connecting" : "reconnecting" });
      },
      onSynced: ({ state }) => this.update({ state: state && this.unsynchronizedChanges === 0 ? "synchronized" : "synchronizing" }),
      onUnsyncedChanges: ({ number }) => this.update({ unsynchronizedChanges: number, state: number > 0 ? "synchronizing" : this.provider?.synced ? "synchronized" : this.state }),
      onAwarenessChange: ({ states }) => this.update({ presence: states.map((entry) => {
        const user = entry.user && typeof entry.user === "object" ? entry.user as Record<string, unknown> : {};
        return {
          clientId: typeof user.clientId === "string" ? user.clientId : String(entry.clientId),
          ...(typeof user.accountId === "string" ? { accountId: user.accountId } : {}),
          ...(typeof user.name === "string" ? { name: user.name } : {}),
          ...(typeof user.color === "string" ? { color: user.color } : {}),
          ...(user.actorKind === "ai" || user.actorKind === "human" ? { actorKind: user.actorKind } : {}),
          ...(typeof user.runId === "string" ? { runId: user.runId } : {}),
          ...(typeof user.operationId === "string" ? { operationId: user.operationId } : {}),
          ...(typeof user.activeRegionId === "string" ? { activeRegionId: user.activeRegionId } : {}),
          ...(Array.isArray(user.activeRegionIds) && user.activeRegionIds.every((regionId) => typeof regionId === "string") ? { activeRegionIds: user.activeRegionIds as string[] } : {}),
          ...(user.cursor !== undefined ? { cursor: user.cursor } : {}),
          ...(user.selection !== undefined ? { selection: user.selection } : {}),
          ...(user.viewport !== undefined ? { viewport: user.viewport } : {}),
        };
      }) }),
      onAuthenticationFailed: ({ reason }) => this.update({ state: "permission_lost", error: reason || "Access was removed." }),
      onDisconnect: ({ event }) => this.update({ state: event.code === 4403 ? "permission_lost" : this.unsynchronizedChanges > 0 ? "unsynchronized" : "reconnecting", error: event.reason || undefined }),
      });
      this.provider.setAwarenessField("user", { clientId: this.clientId, accountId: initial.accountId, name: initial.displayName });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start collaboration.";
      this.update({ state: "unsynchronized", error: message });
      throw error;
    }
  }

  disconnect() {
    this.provider?.disconnect();
    this.update({ state: this.unsynchronizedChanges > 0 ? "unsynchronized" : "closed" });
  }

  destroy() {
    this.destroyed = true;
    this.provider?.destroy();
    this.provider = null;
    this.document.destroy();
    this.update({ state: "closed", presence: [] });
    this.listeners.clear();
  }

  setPresence(fields: Omit<CollaborationPresence, "clientId">) {
    this.provider?.setAwarenessField("user", { clientId: this.clientId, ...fields });
  }

  transact(regionId: string, change: () => void) {
    if (this.state !== "synchronized" || this.unsynchronizedChanges > 0) throw new Error("COLLABORATION_NOT_SYNCHRONIZED: Reconnect before editing. Spectra does not queue offline changes.");
    if (this.level !== "modify") throw new Error("COLLABORATION_READ_ONLY: You have read-only access.");
    this.document.transact(change, { kind: "spectra-region", regionId, clientId: this.clientId });
  }

  async flush() {
    if (!this.provider) throw new Error("COLLABORATION_NOT_CONNECTED");
    this.provider.flushPendingUpdates();
    if (this.provider.synced && !this.provider.hasUnsyncedChanges) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => { cleanup(); reject(new Error("COLLABORATION_SYNC_TIMEOUT: The edit is still unsynchronized.")); }, 12_000);
      const unsubscribe = this.subscribe(() => {
        if (this.state === "permission_lost" || this.state === "closed") { cleanup(); reject(new Error("COLLABORATION_ACCESS_LOST")); }
        else if (this.state === "synchronized" && this.unsynchronizedChanges === 0) { cleanup(); resolve(); }
      });
      function cleanup() { window.clearTimeout(timeout); unsubscribe(); }
    });
  }
}
