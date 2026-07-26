"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import type {
  ArtifactCollaborationTransport,
  CollaborationPresence,
  CollaborationSyncState,
  CollaborationTransportSnapshot,
} from "./types";

function authenticationActuallyRevoked(reason?: string) {
  const value = (reason ?? "").toUpperCase();
  if (!value) return false;
  if (value.includes("TOKEN_EXPIRED") || value.includes("SESSION_EXPIRED"))
    return false;
  // The gateway closes every connection whose policy version is stale so the
  // provider can obtain a fresh token. That close is a reauthorization prompt,
  // not proof that access was removed: upgrades, invitation acceptance, and
  // workspace-policy changes all use the same signal.
  if (value.includes("ACCESS OR PERMISSIONS CHANGED")) return false;
  return (
    value.includes("ACCESS") ||
    value.includes("FORBIDDEN") ||
    value.includes("PERMISSION") ||
    value.includes("REVOKED")
  );
}

type SessionResponse = {
  token: string;
  documentName: string;
  provider: "self_hosted_yjs";
  url: string;
  expiresInMs: number;
  level: "read" | "modify";
  accountId: string;
  displayName: string;
};

function collaborationCursor(
  value: unknown,
): NonNullable<CollaborationPresence["cursor"]> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.x !== "number" ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== "number" ||
    !Number.isFinite(candidate.y)
  )
    return undefined;
  return {
    x: candidate.x,
    y: candidate.y,
    ...(typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt)
      ? { updatedAt: candidate.updatedAt }
      : {}),
  };
}

function clientIdentity(artifactId: string) {
  const key = `spectra.collaboration.client.${artifactId}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.sessionStorage.setItem(key, value);
  return value;
}

async function session(
  artifactId: string,
  partitionKey: string,
  clientId: string,
  schemaVersion: number,
) {
  const response = await fetch("/api/spectra/collaboration/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artifactId, partitionKey, clientId, schemaVersion }),
    cache: "no-store",
  });
  const payload = (await response.json()) as
    SessionResponse | { error?: string | { message?: string } };
  if (!response.ok || !("token" in payload)) {
    const error =
      "error" in payload
        ? typeof payload.error === "string"
          ? payload.error
          : payload.error?.message
        : undefined;
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
  private accountId?: string;
  private displayName?: string;
  private unsynchronizedChanges = 0;
  private presence: CollaborationPresence[] = [];
  private localPresence: CollaborationPresence | null = null;
  private error?: string;
  private destroyed = false;
  private intentionallyDisconnected = false;
  private authorizationTimer?: number;
  private authorizationRefreshRunning = false;
  private snapshot: CollaborationTransportSnapshot = {
    state: "connecting",
    level: null,
    unsynchronizedChanges: 0,
    presence: [],
  };

  constructor(
    private readonly artifactId: string,
    private readonly partitionKey = "root",
    private readonly schemaVersion = 1,
  ) {
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
    if (next.accountId !== undefined) this.accountId = next.accountId;
    if (next.displayName !== undefined) this.displayName = next.displayName;
    if (next.unsynchronizedChanges !== undefined)
      this.unsynchronizedChanges = next.unsynchronizedChanges;
    if (next.presence) this.presence = next.presence;
    if (next.error !== undefined) this.error = next.error;
    this.snapshot = {
      state: this.state,
      level: this.level,
      ...(this.accountId ? { accountId: this.accountId } : {}),
      ...(this.displayName ? { displayName: this.displayName } : {}),
      unsynchronizedChanges: this.unsynchronizedChanges,
      presence: this.presence,
      ...(this.error ? { error: this.error } : {}),
    };
    this.emit();
  }

  private startAuthorizationWatch() {
    if (this.authorizationTimer !== undefined) return;
    this.authorizationTimer = window.setInterval(() => {
      // Read-only collaborators need an active recheck because an upgrade has
      // no edit message that would naturally force server reauthorization.
      // Keep the watch narrow so private and modify sessions create no polling
      // traffic during normal editing.
      if (
        this.destroyed ||
        this.intentionallyDisconnected ||
        this.level !== "read" ||
        this.authorizationRefreshRunning
      )
        return;
      this.authorizationRefreshRunning = true;
      void session(
        this.artifactId,
        this.partitionKey,
        this.clientId,
        this.schemaVersion,
      )
        .then((refreshed) => {
          if (this.destroyed || refreshed.level === this.level) return;
          this.update({
            state: "reconnecting",
            level: refreshed.level,
            accountId: refreshed.accountId,
            displayName: refreshed.displayName,
            error: undefined,
          });
          // Reconnect so the gateway's connection-level readOnly flag is
          // rebuilt from the new token before the editor is unlocked.
          this.provider?.disconnect();
          this.provider?.connect();
        })
        .catch((error) => {
          const reason =
            error instanceof Error ? error.message : "Access was removed.";
          if (!authenticationActuallyRevoked(reason)) return;
          this.update({
            state: "permission_lost",
            level: null,
            error: reason,
          });
          this.provider?.disconnect();
        })
        .finally(() => {
          this.authorizationRefreshRunning = false;
        });
    }, 2_000);
  }

  async connect() {
    if (this.destroyed || this.provider) return;
    this.update({ state: "connecting", error: undefined });
    this.intentionallyDisconnected = false;
    try {
      const initial = await session(
        this.artifactId,
        this.partitionKey,
        this.clientId,
        this.schemaVersion,
      );
      // A route transition or HMR teardown can happen while the server session
      // is still being issued. Never resurrect a provider after its transport
      // has been destroyed; doing so creates an invisible reconnect/token loop.
      if (this.destroyed) return;
      this.provider = new HocuspocusProvider({
        url: initial.url,
        name: initial.documentName,
        document: this.document,
        flushDelay: 180,
        token: async () => {
          if (this.destroyed) throw new Error("COLLABORATION_CLOSED");
          const refreshed = await session(
            this.artifactId,
            this.partitionKey,
            this.clientId,
            this.schemaVersion,
          );
          this.update({
            level: refreshed.level,
            accountId: refreshed.accountId,
            displayName: refreshed.displayName,
            error: undefined,
          });
          return refreshed.token;
        },
        onStatus: ({ status }) => {
          if (status === "connected") {
            if (this.localPresence)
              this.provider?.setAwarenessField("user", this.localPresence);
            this.update({
              state: this.provider?.synced ? "synchronized" : "synchronizing",
            });
          } else if (
            !this.intentionallyDisconnected &&
            this.state !== "permission_lost" &&
            this.state !== "closed"
          )
            this.update({
              state:
                this.state === "connecting" ? "connecting" : "reconnecting",
            });
        },
        onSynced: ({ state }) => {
          if (this.state !== "permission_lost" && this.state !== "closed")
            this.update({
              state:
                state && this.unsynchronizedChanges === 0
                  ? "synchronized"
                  : "synchronizing",
            });
        },
        onUnsyncedChanges: ({ number }) => {
          const terminal =
            this.state === "permission_lost" || this.state === "closed";
          this.update({
            unsynchronizedChanges: number,
            ...(terminal
              ? {}
              : {
                  state:
                    number > 0
                      ? "synchronizing"
                      : this.provider?.synced
                        ? "synchronized"
                        : this.state,
                }),
          });
        },
        onAwarenessChange: ({ states }) =>
          this.update({
            presence: states.map((entry) => {
              const user =
                entry.user && typeof entry.user === "object"
                  ? (entry.user as Record<string, unknown>)
                  : {};
              return {
                clientId:
                  typeof user.clientId === "string"
                    ? user.clientId
                    : String(entry.clientId),
                ...(typeof user.accountId === "string"
                  ? { accountId: user.accountId }
                  : {}),
                ...(typeof user.name === "string" ? { name: user.name } : {}),
                ...(typeof user.color === "string"
                  ? { color: user.color }
                  : {}),
                ...(user.actorKind === "ai" || user.actorKind === "human"
                  ? { actorKind: user.actorKind }
                  : {}),
                ...(typeof user.runId === "string"
                  ? { runId: user.runId }
                  : {}),
                ...(typeof user.operationId === "string"
                  ? { operationId: user.operationId }
                  : {}),
                ...(typeof user.activeRegionId === "string"
                  ? { activeRegionId: user.activeRegionId }
                  : {}),
                ...(Array.isArray(user.activeRegionIds) &&
                user.activeRegionIds.every(
                  (regionId) => typeof regionId === "string",
                )
                  ? { activeRegionIds: user.activeRegionIds as string[] }
                  : {}),
                ...(Array.isArray(user.previewPatches) &&
                user.previewPatches.every(
                  (patch) =>
                    patch &&
                    typeof patch === "object" &&
                    typeof (patch as { path?: unknown }).path === "string" &&
                    "value" in patch,
                )
                  ? {
                      previewPatches: user.previewPatches as Array<{
                        path: string;
                        value: unknown;
                      }>,
                    }
                  : {}),
                ...(Number.isInteger(user.previewSequence)
                  ? { previewSequence: user.previewSequence as number }
                  : {}),
                ...(user.previewPhase === "streaming"
                  ? { previewPhase: "streaming" as const }
                  : {}),
                ...(collaborationCursor(user.cursor)
                  ? { cursor: collaborationCursor(user.cursor) }
                  : {}),
                ...(user.selection !== undefined
                  ? { selection: user.selection }
                  : {}),
                ...(user.viewport !== undefined
                  ? { viewport: user.viewport }
                  : {}),
              };
            }),
          }),
        onAuthenticationFailed: ({ reason }) => {
          const revoked = authenticationActuallyRevoked(reason);
          this.update({
            state: revoked ? "permission_lost" : "reconnecting",
            error: revoked ? reason || "Access was removed." : undefined,
          });
        },
        onStateless: ({ payload }) => {
          try {
            const message = JSON.parse(payload) as { type?: string };
            if (message?.type !== "spectra.permission_changed") return;
            this.update({
              state: "reconnecting",
              error: undefined,
              level: null,
            });
          } catch {
            // Ignore malformed stateless payloads from the gateway.
          }
        },
        onDisconnect: ({ event }) => {
          const revoked =
            event.code === 4403 && authenticationActuallyRevoked(event.reason);
          this.update({
            state: revoked
              ? "permission_lost"
              : this.unsynchronizedChanges > 0
                ? "unsynchronized"
                : "reconnecting",
            error: revoked ? event.reason || "Access was removed." : undefined,
          });
        },
      });
      this.localPresence = {
        clientId: this.clientId,
        accountId: initial.accountId,
        name: initial.displayName,
        actorKind: "human",
      };
      this.provider.setAwarenessField("user", this.localPresence);
      this.startAuthorizationWatch();
    } catch (error) {
      this.update({
        state: "unsynchronized",
        error:
          error instanceof Error
            ? error.message
            : "Could not start collaboration.",
      });
    }
  }

  disconnect() {
    this.intentionallyDisconnected = true;
    if (this.authorizationTimer !== undefined) {
      window.clearInterval(this.authorizationTimer);
      this.authorizationTimer = undefined;
    }
    this.provider?.disconnect();
    this.update({
      state: this.unsynchronizedChanges > 0 ? "unsynchronized" : "closed",
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.intentionallyDisconnected = true;
    if (this.authorizationTimer !== undefined) {
      window.clearInterval(this.authorizationTimer);
      this.authorizationTimer = undefined;
    }
    this.provider?.destroy();
    this.provider = null;
    this.document.destroy();
    this.update({ state: "closed", presence: [] });
    this.listeners.clear();
  }

  async retry() {
    if (this.destroyed) throw new Error("COLLABORATION_CLOSED");
    if (this.state === "permission_lost")
      throw new Error("COLLABORATION_ACCESS_LOST");
    if (!this.provider) {
      await this.connect();
      return;
    }
    this.intentionallyDisconnected = false;
    this.update({ state: "reconnecting", error: undefined });
    this.provider.connect();
    this.provider.flushPendingUpdates();
    await this.flush();
  }

  setPresence(fields: Omit<CollaborationPresence, "clientId">) {
    this.localPresence = {
      ...(this.localPresence ?? {}),
      ...fields,
      clientId: this.clientId,
    };
    this.provider?.setAwarenessField("user", this.localPresence);
  }

  transact(regionId: string, change: () => void) {
    if (this.state !== "synchronized" || this.unsynchronizedChanges > 0)
      throw new Error(
        "COLLABORATION_NOT_SYNCHRONIZED: Reconnect before editing. Spectra does not queue offline changes.",
      );
    if (this.level !== "modify")
      throw new Error("COLLABORATION_READ_ONLY: You have read-only access.");
    this.document.transact(change, {
      kind: "spectra-region",
      regionId,
      clientId: this.clientId,
    });
  }

  async flush() {
    if (!this.provider) throw new Error("COLLABORATION_NOT_CONNECTED");
    this.provider.flushPendingUpdates();
    // Hocuspocus records a just-transacted update on its next task. Checking
    // `hasUnsyncedChanges` immediately can therefore report a false clean
    // state, causing the region claim to be released before the gateway has
    // authorized and persisted the update.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
    if (this.provider.synced && !this.provider.hasUnsyncedChanges) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(
          new Error(
            "COLLABORATION_SYNC_TIMEOUT: The edit is still unsynchronized.",
          ),
        );
      }, 12_000);
      const unsubscribe = this.subscribe(() => {
        if (this.state === "permission_lost" || this.state === "closed") {
          cleanup();
          reject(new Error("COLLABORATION_ACCESS_LOST"));
        } else if (
          this.state === "synchronized" &&
          this.unsynchronizedChanges === 0
        ) {
          cleanup();
          resolve();
        }
      });
      function cleanup() {
        window.clearTimeout(timeout);
        unsubscribe();
      }
    });
  }
}
