import * as Y from "yjs";
import type {
  ArtifactCollaborationTransport,
  CollaborationClaimRelease,
  CollaborationInteractionLease,
  CollaborationLeaseRelease,
  CollaborationLeaseResult,
  CollaborationPresence,
  CollaborationStructuralClaim,
  CollaborationTransportSnapshot,
} from "../../collaboration/types";
import { SPECTRA_PROTOCOL_VERSIONS } from "../../migrations/protocol";
import { isEmptyYjsUpdate } from "../../work/models/yjs/shared";
import { resolveDocumentRelativeSelection } from "../../work/models/yjs/relative-position";
import { ScopedCollaborationSnapshots } from "../../collaboration/scoped-snapshots";
import {
  SYNC_RETRY_POLICY,
  syncRetryDelayMs,
} from "../../../../../shared/sync-retry-policy";

type ProviderOptions = {
  workId: string;
  partitionKey?: string;
  schemaVersion: number;
  tokenEndpoint?: string;
  fetch?: typeof fetch;
  createSocket?: (url: string) => WebSocket;
  document?: Y.Doc;
  clientId?: string;
  actorKind?: "human" | "ai" | "system";
};

type TokenResponse = {
  token: string;
  url: string;
  level: "read" | "modify";
  accountId?: string;
  displayName?: string;
};

function bytesJson(_key: string, value: unknown) {
  return value instanceof Uint8Array ? { $bytes: Array.from(value) } : value;
}

function reviveBytes(_key: string, value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { $bytes?: unknown }).$bytes)
  )
    return new Uint8Array((value as { $bytes: number[] }).$bytes);
  return value;
}

export class CloudflareRealtimeProvider
  implements ArtifactCollaborationTransport
{
  readonly document: Y.Doc;
  readonly clientId: string;
  private readonly remoteOrigin = Symbol("cloudflare-remote");
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private intentionallyDisconnected = false;
  private destroyed = false;
  private readonly snapshots = new ScopedCollaborationSnapshots({
    state: "closed",
  });
  private awarenessSequence = 0;
  private pendingUpdates: Uint8Array[] = [];
  private pendingLeases = new Map<
    string,
    {
      resolve: (result: CollaborationLeaseResult) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();
  private pendingClaims = new Map<
    string,
    {
      resolve: (result: CollaborationStructuralClaim) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();
  private leaseReleaseListeners = new Set<
    (event: CollaborationLeaseRelease) => void
  >();
  private claimReleaseListeners = new Set<
    (event: CollaborationClaimRelease) => void
  >();

  constructor(private readonly options: ProviderOptions) {
    this.clientId = options.clientId ?? crypto.randomUUID();
    this.document = options.document ?? new Y.Doc();
    this.document.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this.remoteOrigin) return;
      this.pendingUpdates.push(update);
      this.patch({ unsynchronizedChanges: this.pendingUpdates.length });
      this.send({ type: "sync_update", update, origin: String(origin ?? "user") });
    });
  }

  private get snapshot() {
    return this.snapshots.getSnapshot();
  }

  getSnapshot = this.snapshots.getSnapshot;
  getSyncSnapshot = this.snapshots.getSyncSnapshot;
  getPresenceSnapshot = this.snapshots.getPresenceSnapshot;
  getPresencePreviewSnapshot = this.snapshots.getPresencePreviewSnapshot;
  subscribe = this.snapshots.subscribe;
  subscribeSync = this.snapshots.subscribeSync;
  subscribePresence = this.snapshots.subscribePresence;
  subscribePresencePreview = this.snapshots.subscribePresencePreview;

  async connect() {
    if (this.destroyed) return;
    if (this.socket && this.socket.readyState <= 1) return;
    if (this.connecting) return this.connecting;
    this.intentionallyDisconnected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connecting = this.connectOnce()
      .catch((error: unknown) => {
        if (!this.destroyed && !this.intentionallyDisconnected) {
          this.patch({
            state: "unsynchronized",
            error:
              error instanceof Error
                ? error.message
                : "Realtime connection unavailable.",
          });
          this.scheduleReconnect();
        }
        throw error;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  private async connectOnce() {
    this.patch({ state: "connecting", error: undefined });
    const request = this.options.fetch ?? fetch;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SYNC_RETRY_POLICY.collaborationConnectTimeoutMs);
    let payload: TokenResponse;
    try {
      const response = await request(
        this.options.tokenEndpoint ?? "/api/spectra/collaboration/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artifactId: this.options.workId,
            partitionKey: this.options.partitionKey ?? "root",
            clientId: this.clientId,
            schemaVersion: this.options.schemaVersion,
            realtimeProvider: "cloudflare",
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok)
        throw new Error(`COLLABORATION_TOKEN_FAILED: ${response.status}`);
      const token = (await response.json()) as {
        data?: TokenResponse;
      } & TokenResponse;
      payload = token.data ?? token;
    } catch (error) {
      if (timedOut) throw new Error("COLLABORATION_CONNECT_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const base = payload.url.replace(/\/$/, "");
    const roomUrl = `${base}/rooms/${encodeURIComponent(this.options.workId)}${
      this.options.partitionKey && this.options.partitionKey !== "root"
        ? `/${encodeURIComponent(this.options.partitionKey)}`
        : ""
    }?token=${encodeURIComponent(payload.token)}`;
    if (this.destroyed || this.intentionallyDisconnected) return;
    const socket = (this.options.createSocket ?? ((url) => new WebSocket(url)))(roomUrl);
    this.socket = socket;
    this.patch({
      state: "synchronizing",
      level: payload.level,
      accountId: payload.accountId,
      displayName: payload.displayName,
    });
    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.patch({ state: "synchronizing", error: undefined });
    });
    socket.addEventListener("message", (event) => this.receive(String(event.data)));
    socket.addEventListener("close", () => {
      this.rejectPendingCoordination("COLLABORATION_RECONNECTING");
      if (this.socket === socket) this.socket = null;
      if (!this.intentionallyDisconnected && this.snapshot.state !== "closed") {
        this.patch({ state: "reconnecting" });
        this.scheduleReconnect();
      }
    });
    socket.addEventListener("error", () => {
      this.patch({ state: "unsynchronized", error: "Realtime connection unavailable." });
      socket.close();
    });
  }

  private scheduleReconnect() {
    if (this.intentionallyDisconnected || this.reconnectTimer) return;
    const attempt = this.reconnectAttempt + 1;
    this.reconnectAttempt = attempt;
    const delay = syncRetryDelayMs(
      attempt,
      `cloudflare-collaboration:${this.options.workId}:${this.options.partitionKey ?? "root"}`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => undefined);
    }, delay);
  }

  retry() {
    if (this.destroyed) return Promise.reject(new Error("COLLABORATION_CLOSED"));
    // Closing an old socket during a manual retry must not also schedule the
    // automatic reconnect path from its close event.
    this.intentionallyDisconnected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.reconnectAttempt = 0;
    this.intentionallyDisconnected = false;
    return this.connect();
  }

  disconnect() {
    this.intentionallyDisconnected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.patch({ state: "closed" });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disconnect();
    this.rejectPendingCoordination("COLLABORATION_CLOSED");
    this.snapshots.clear();
    this.leaseReleaseListeners.clear();
    this.claimReleaseListeners.clear();
    this.document.destroy();
  }

  setPresence(fields: Omit<CollaborationPresence, "clientId">) {
    this.awarenessSequence += 1;
    this.send({
      type: "awareness",
      payload: fields,
      sequence: this.awarenessSequence,
    });
  }

  transact(_regionId: string, change: () => void) {
    if (this.snapshot.level !== "modify")
      throw new Error("COLLABORATION_READ_ONLY");
    this.document.transact(change, "local-human");
  }

  acquireInteractionLease(
    lease: Omit<CollaborationInteractionLease, "owner">,
    signal?: AbortSignal,
  ) {
    if (this.snapshot.level !== "modify")
      return Promise.reject(new Error("COLLABORATION_READ_ONLY"));
    const owner = this.actorIdentity();
    return new Promise<CollaborationLeaseResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Lease acquisition aborted", "AbortError"));
        return;
      }
      const onAbort = () => {
        const pending = this.pendingLeases.get(lease.id);
        if (!pending) return;
        this.pendingLeases.delete(lease.id);
        pending.cleanup();
        reject(new DOMException("Lease acquisition aborted", "AbortError"));
      };
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      this.pendingLeases.set(lease.id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (!this.send({ type: "lease_acquire", lease: { ...lease, owner } })) {
        this.pendingLeases.delete(lease.id);
        cleanup();
        reject(new Error("COLLABORATION_COORDINATION_OFFLINE"));
      }
    });
  }

  renewInteractionLease(leaseId: string, expiresAt: number) {
    this.send({ type: "lease_renew", leaseId, expiresAt });
  }

  releaseInteractionLease(
    leaseId: string,
    reason: CollaborationLeaseRelease["reason"] = "explicit",
  ) {
    if (reason === "disconnect" || reason === "expiry") reason = "explicit";
    this.send({ type: "lease_release", leaseId, reason });
  }

  subscribeLeaseReleases(listener: (event: CollaborationLeaseRelease) => void) {
    this.leaseReleaseListeners.add(listener);
    return () => this.leaseReleaseListeners.delete(listener);
  }

  acquireStructuralClaim(
    claim: Omit<CollaborationStructuralClaim, "owner" | "state">,
    signal?: AbortSignal,
  ) {
    if (this.snapshot.level !== "modify")
      return Promise.reject(new Error("COLLABORATION_READ_ONLY"));
    const owner = this.actorIdentity();
    return new Promise<CollaborationStructuralClaim>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Claim acquisition aborted", "AbortError"));
        return;
      }
      const onAbort = () => {
        const pending = this.pendingClaims.get(claim.id);
        if (!pending) return;
        this.pendingClaims.delete(claim.id);
        pending.cleanup();
        reject(new DOMException("Claim acquisition aborted", "AbortError"));
      };
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      this.pendingClaims.set(claim.id, { resolve, reject, cleanup });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (
        !this.send({
          type: "claim_acquire",
          claim: { ...claim, owner, state: "active" },
        })
      ) {
        this.pendingClaims.delete(claim.id);
        cleanup();
        reject(new Error("COLLABORATION_COORDINATION_OFFLINE"));
      }
    });
  }

  releaseStructuralClaim(claimId: string) {
    this.send({ type: "claim_release", claimId });
  }

  subscribeClaimReleases(listener: (event: CollaborationClaimRelease) => void) {
    this.claimReleaseListeners.add(listener);
    return () => this.claimReleaseListeners.delete(listener);
  }

  async flush() {
    if (this.snapshot.unsynchronizedChanges === 0) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("COLLABORATION_SYNC_TIMEOUT"));
      }, 10_000);
      const unsubscribe = this.subscribe(() => {
        if (this.snapshot.unsynchronizedChanges > 0) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      });
    });
  }

  private receive(raw: string) {
    const event = JSON.parse(raw, reviveBytes) as {
      type: string;
      update?: Uint8Array;
      actor?: {
        clientId: string;
        accountId?: string;
        actorKind?: "human" | "ai" | "system";
        displayName?: string;
      };
      payload?: Omit<CollaborationPresence, "clientId">;
      clientId?: string;
      requestLeaseId?: string;
      requesterClientId?: string;
      result?: CollaborationLeaseResult;
      claim?: CollaborationStructuralClaim;
      leaseId?: string;
      target?: string;
      releasedAt?: number;
      reason?: CollaborationLeaseRelease["reason"];
      claimId?: string;
      resumed?: CollaborationStructuralClaim | null;
    };
    if (event.type === "sync_snapshot" || event.type === "sync_update") {
      if (event.update) {
        const serverVector = Y.encodeStateVectorFromUpdate(event.update);
        Y.applyUpdate(this.document, event.update, this.remoteOrigin);
        if (event.type === "sync_snapshot" && this.pendingUpdates.length > 0) {
          // Collapse every offline/local branch into the exact state-vector
          // difference the room is missing. Applying the server snapshot never
          // replaces local work; CRDT state is merged first, then uploaded.
          const localDifference = Y.encodeStateAsUpdate(this.document, serverVector);
          this.pendingUpdates = isEmptyYjsUpdate(localDifference)
            ? []
            : [localDifference];
          if (this.pendingUpdates.length)
            this.send({
              type: "sync_update",
              update: localDifference,
              origin: "local-reconnect-merge",
            });
        }
      }
      this.patch({
        state:
          event.type === "sync_snapshot" && this.pendingUpdates.length
            ? "synchronizing"
            : "synchronized",
        unsynchronizedChanges: this.pendingUpdates.length,
        presence: this.snapshot.presence.map((entry) =>
          this.resolveRelativePresence(entry),
        ),
      });
    } else if (event.type === "sync_ack") {
      this.pendingUpdates.shift();
      this.patch({
        state: this.pendingUpdates.length ? "synchronizing" : "synchronized",
        unsynchronizedChanges: this.pendingUpdates.length,
      });
    } else if (event.type === "awareness" && event.actor) {
      const actorPresence: CollaborationPresence = {
        ...event.payload,
        clientId: event.actor.clientId,
        accountId: event.actor.accountId,
        actorKind: event.actor.actorKind,
        name: event.actor.displayName,
      };
      const resolvedPresence = this.resolveRelativePresence(actorPresence);
      const presence = [
        ...this.snapshot.presence.filter(
          (entry) => entry.clientId !== resolvedPresence.clientId,
        ),
        resolvedPresence,
      ];
      this.patch({ presence });
    } else if (event.type === "presence_left" && event.clientId) {
      this.patch({
        presence: this.snapshot.presence.filter(
          (entry) => entry.clientId !== event.clientId,
        ),
      });
    } else if (event.type === "permission_revoked") {
      this.patch({ state: "permission_lost", level: null });
    } else if (
      event.type === "lease_state" &&
      event.requesterClientId === this.clientId &&
      event.requestLeaseId &&
      event.result
    ) {
      const pending = this.pendingLeases.get(event.requestLeaseId);
      if (pending) {
        this.pendingLeases.delete(event.requestLeaseId);
        pending.cleanup();
        pending.resolve(event.result);
      }
    } else if (
      event.type === "lease_released" &&
      event.leaseId &&
      event.target &&
      event.releasedAt &&
      event.reason
    ) {
      const released: CollaborationLeaseRelease = {
        leaseId: event.leaseId,
        target: event.target,
        releasedAt: event.releasedAt,
        reason: event.reason,
      };
      for (const listener of this.leaseReleaseListeners) listener(released);
    } else if (event.type === "claim_state" && event.claim) {
      const pending = this.pendingClaims.get(event.claim.id);
      if (pending) {
        this.pendingClaims.delete(event.claim.id);
        pending.cleanup();
        pending.resolve(event.claim);
      }
    } else if (event.type === "claim_released" && event.claimId) {
      const released: CollaborationClaimRelease = {
        claimId: event.claimId,
        resumed: event.resumed ?? null,
      };
      for (const listener of this.claimReleaseListeners) listener(released);
    }
  }

  private send(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(
      JSON.stringify(
        {
          ...payload,
          protocolVersion: SPECTRA_PROTOCOL_VERSIONS.collaboration,
        },
        bytesJson,
      ),
    );
    return true;
  }

  private actorIdentity() {
    const accountId = this.snapshot.accountId;
    if (!accountId) throw new Error("COLLABORATION_ACTOR_UNKNOWN");
    return {
      accountId,
      clientId: this.clientId,
      actorKind: this.options.actorKind ?? "human",
      displayName: this.snapshot.displayName ?? "Collaborator",
    };
  }

  private resolveRelativePresence(
    presence: CollaborationPresence,
  ): CollaborationPresence {
    const relative = presence.selection?.relative;
    if (!relative) return presence;
    const resolved = resolveDocumentRelativeSelection(this.document, relative);
    if (!resolved) return presence;
    return {
      ...presence,
      selection: {
        ...presence.selection,
        kind: "text",
        collapsed: resolved.anchor === resolved.head,
        ranges: [
          {
            blockId: resolved.blockId,
            startOffset: Math.min(resolved.anchor, resolved.head),
            endOffset: Math.max(resolved.anchor, resolved.head),
          },
        ],
      },
    };
  }

  private rejectPendingCoordination(code: string) {
    const error = new Error(code);
    for (const [id, pending] of this.pendingLeases) {
      this.pendingLeases.delete(id);
      pending.cleanup();
      pending.reject(error);
    }
    for (const [id, pending] of this.pendingClaims) {
      this.pendingClaims.delete(id);
      pending.cleanup();
      pending.reject(error);
    }
  }

  private patch(patch: Partial<CollaborationTransportSnapshot>) {
    this.snapshots.apply({ ...this.snapshot, ...patch });
  }
}
