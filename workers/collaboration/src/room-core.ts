import * as Y from "yjs";
import { AwarenessRegistry } from "./awareness";
import { StructuralClaimRegistry } from "./claims";
import { InteractionLeaseRegistry } from "./leases";
import {
  MAX_AWARENESS_BYTES,
  MAX_UPDATE_BYTES,
  assertProtocol,
  type ConnectionClaims,
  type InteractionLease,
  type StructuralClaim,
} from "./protocol";
import type { YDocStore } from "./ydoc-store";

export type RoomPeer = {
  claims: ConnectionClaims;
  send(event: unknown): void;
};

export class RealtimeRoomCore {
  readonly document = new Y.Doc();
  readonly awareness = new AwarenessRegistry();
  readonly leases = new InteractionLeaseRegistry();
  readonly claims = new StructuralClaimRegistry();
  private peers = new Map<string, RoomPeer>();
  private loaded = false;
  private sequence = 0;
  private updatesSinceSnapshot = 0;
  private permissionEpoch: number | undefined;
  private updateRates = new Map<string, { startedAt: number; count: number }>();
  private awarenessRates = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly store: YDocStore,
    private readonly options: {
      schemaVersion?: number;
      compactEvery?: number;
      permissionEpoch?: number;
    } = {},
  ) {
    this.permissionEpoch = options.permissionEpoch;
  }

  setPermissionEpoch(epoch: number) {
    this.permissionEpoch = epoch;
    for (const [clientId, peer] of this.peers)
      if (peer.claims.permissionEpoch !== epoch) {
        peer.send({ type: "permission_revoked", permissionEpoch: epoch });
        this.disconnect(clientId);
      }
  }

  async load() {
    if (this.loaded) return;
    const snapshot = await this.store.loadLatestSnapshot();
    if (snapshot) {
      Y.applyUpdate(this.document, snapshot.state, "cold-snapshot");
      this.sequence = snapshot.sequence;
    }
    for (const update of await this.store.loadUpdatesAfter(this.sequence)) {
      Y.applyUpdate(this.document, update.update, "cold-replay");
      this.sequence = Math.max(this.sequence, update.sequence);
    }
    this.loaded = true;
  }

  connect(peer: RoomPeer) {
    assertProtocol(peer.claims.protocolVersion);
    this.peers.set(peer.claims.actor.clientId, peer);
    peer.send({
      type: "sync_snapshot",
      sequence: this.sequence,
      update: Y.encodeStateAsUpdate(this.document),
    });
  }

  disconnect(clientId: string) {
    this.peers.delete(clientId);
    this.awareness.remove(clientId);
    for (const lease of this.leases.releaseOwner(clientId))
      this.broadcast({
        type: "lease_released",
        leaseId: lease.id,
        target: lease.target,
        releasedAt: Date.now(),
        reason: "disconnect",
      });
    this.broadcast({ type: "presence_left", clientId });
  }

  async applyUpdate(
    clientId: string,
    update: Uint8Array,
    origin = "user",
    now = Date.now(),
  ) {
    const peer = this.requirePeer(clientId);
    this.enforceRate(this.updateRates, clientId, now, 120, 10_000, "ROOM_UPDATE_RATE_EXCEEDED");
    if (peer.claims.access !== "edit") throw new Error("ROOM_READ_ONLY");
    if (peer.claims.permissionEpoch !== (this.permissionEpoch ?? peer.claims.permissionEpoch))
      throw new Error("ROOM_PERMISSION_EPOCH_STALE");
    if (update.byteLength > MAX_UPDATE_BYTES) throw new Error("ROOM_UPDATE_TOO_LARGE");
    Y.applyUpdate(this.document, update, origin);
    // Peer fan-out is deliberately synchronous and precedes durable append.
    this.broadcast({ type: "sync_update", update, origin }, clientId);
    const sequence = await this.store.appendUpdate({
      update,
      clientId,
      actorKind: peer.claims.actor.actorKind,
      origin,
      createdAt: now,
    });
    peer.send({ type: "sync_ack", sequence });
    this.sequence = sequence;
    this.updatesSinceSnapshot += 1;
    await this.store.enqueueProjection({
      id: `work:${peer.claims.workId}:${sequence}`,
      sequenceFrom: sequence,
      sequenceTo: sequence,
      projectionKind: "work",
      attempts: 0,
      nextAttemptAt: now,
      status: "pending",
    });
    if (this.updatesSinceSnapshot >= (this.options.compactEvery ?? 128))
      await this.compact(now);
    return sequence;
  }

  updateAwareness(clientId: string, payload: unknown, sequence: number, now = Date.now()) {
    const peer = this.requirePeer(clientId);
    this.enforceRate(this.awarenessRates, clientId, now, 60, 1_000, "AWARENESS_RATE_EXCEEDED");
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_AWARENESS_BYTES)
      throw new Error("AWARENESS_TOO_LARGE");
    const accepted = this.awareness.update({
      actor: peer.claims.actor,
      payload,
      sequence,
      expiresAt: now + 30_000,
    });
    if (accepted) this.broadcast({ type: "awareness", actor: peer.claims.actor, payload, sequence }, clientId);
    return accepted;
  }

  acquireLease(clientId: string, lease: InteractionLease, now = Date.now()) {
    this.requireOwner(clientId, lease.owner.clientId);
    const result = this.leases.acquire(lease, now);
    this.broadcast({
      type: "lease_state",
      requestLeaseId: lease.id,
      requesterClientId: clientId,
      result,
    });
    return result;
  }

  releaseLease(
    clientId: string,
    leaseId: string,
    reason: "commit" | "blur" | "close" | "pointer_up" | "explicit" = "explicit",
  ) {
    const released = this.leases.release(leaseId, clientId);
    if (released)
      this.broadcast({
        type: "lease_released",
        leaseId,
        target: released.target,
        releasedAt: Date.now(),
        reason,
      });
    return Boolean(released);
  }

  expireInteractionLeases(now = Date.now()) {
    const released = this.leases.expire(now);
    for (const lease of released)
      this.broadcast({
        type: "lease_released",
        leaseId: lease.id,
        target: lease.target,
        releasedAt: now,
        reason: "expiry",
      });
    return released;
  }

  nextInteractionLeaseExpiry(now = Date.now()) {
    return this.leases
      .list(now)
      .map((lease) => lease.expiresAt)
      .sort((left, right) => left - right)[0];
  }

  acquireClaim(clientId: string, claim: StructuralClaim, now = Date.now()) {
    this.requireOwner(clientId, claim.owner.clientId);
    const state = this.claims.acquire(claim, now);
    this.broadcast({ type: "claim_state", claim: state });
    return state;
  }

  releaseClaim(clientId: string, claimId: string) {
    this.requirePeer(clientId);
    const claim = this.claims.get(claimId);
    if (claim && claim.owner.clientId !== clientId)
      throw new Error("ROOM_OWNER_MISMATCH");
    const resumed = this.claims.release(claimId);
    this.broadcast({ type: "claim_released", claimId, resumed });
    return resumed;
  }

  async compact(now = Date.now()) {
    await this.store.saveSnapshot({
      sequence: this.sequence,
      state: Y.encodeStateAsUpdate(this.document),
      stateVector: Y.encodeStateVector(this.document),
      schemaVersion: this.options.schemaVersion ?? 1,
      createdAt: now,
    });
    await this.store.deleteUpdatesThrough(this.sequence);
    this.updatesSinceSnapshot = 0;
  }

  private requirePeer(clientId: string) {
    const peer = this.peers.get(clientId);
    if (!peer) throw new Error("ROOM_PEER_UNKNOWN");
    return peer;
  }

  private requireOwner(clientId: string, ownerId: string) {
    this.requirePeer(clientId);
    if (clientId !== ownerId) throw new Error("ROOM_OWNER_MISMATCH");
  }

  private broadcast(event: unknown, exceptClientId?: string) {
    for (const [clientId, peer] of this.peers)
      if (clientId !== exceptClientId) peer.send(event);
  }

  private enforceRate(
    rates: Map<string, { startedAt: number; count: number }>,
    clientId: string,
    now: number,
    maximum: number,
    windowMs: number,
    error: string,
  ) {
    const current = rates.get(clientId);
    if (!current || now - current.startedAt >= windowMs) {
      rates.set(clientId, { startedAt: now, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > maximum) throw new Error(error);
  }
}
