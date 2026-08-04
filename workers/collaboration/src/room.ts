import { verifyConnectionToken } from "./auth";
import { drainProjectionOutbox } from "./projection-outbox";
import type { RoomMessage, SocketAttachment } from "./protocol";
import { RealtimeRoomCore } from "./room-core";
import { SqlYDocStore } from "./ydoc-store";

export type CollaborationEnv = {
  SPECTRA_COLLAB_TOKEN_SECRET: string;
  CONVEX_PROJECTION_URL?: string;
  CONVEX_PROJECTION_TOKEN?: string;
};

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS yjs_updates(sequence INTEGER PRIMARY KEY AUTOINCREMENT,update_blob BLOB NOT NULL,client_id TEXT NOT NULL,actor_kind TEXT NOT NULL,origin TEXT NOT NULL,created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS snapshots(sequence INTEGER PRIMARY KEY,state_blob BLOB NOT NULL,state_vector BLOB NOT NULL,schema_version INTEGER NOT NULL,created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS room_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS structural_claims(claim_id TEXT PRIMARY KEY,target TEXT NOT NULL,owner TEXT NOT NULL,operation_id TEXT,expires_at INTEGER NOT NULL,state TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS projection_outbox(id TEXT PRIMARY KEY,sequence_from INTEGER NOT NULL,sequence_to INTEGER NOT NULL,projection_kind TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,status TEXT NOT NULL)",
];

function encode(value: unknown) {
  return JSON.stringify(value, (_key, item) =>
    item instanceof Uint8Array
      ? { $bytes: Array.from(item) }
      : item,
  );
}

function decode(value: string) {
  return JSON.parse(value, (_key, item) =>
    item && typeof item === "object" && Array.isArray(item.$bytes)
      ? new Uint8Array(item.$bytes)
      : item,
  ) as RoomMessage;
}

export class CollaborationRoom {
  private readonly store: SqlYDocStore;
  private readonly room: RealtimeRoomCore;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CollaborationEnv,
  ) {
    for (const statement of SCHEMA) state.storage.sql.exec(statement);
    this.store = new SqlYDocStore(state.storage);
    this.room = new RealtimeRoomCore(this.store);
    void state.blockConcurrencyWhile(async () => {
      await this.room.load();
      const persistedClaims = [
        ...state.storage.sql.exec<{
          claim_id: string;
          target: string;
          owner: string;
          operation_id?: string;
          expires_at: number;
          state: "active" | "queued";
        }>("SELECT claim_id,target,owner,operation_id,expires_at,state FROM structural_claims"),
      ].map((row) => ({
        id: row.claim_id,
        target: row.target,
        owner: JSON.parse(row.owner),
        operationId: row.operation_id,
        acquiredAt: 0,
        expiresAt: row.expires_at,
        state: row.state,
      }));
      this.room.claims.restore(persistedClaims);
      for (const socket of state.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment;
        this.room.connect({
          claims: attachment.claims,
          send: (event) => socket.send(encode(event)),
        });
      }
    });
  }

  async fetch(request: Request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket upgrade required", { status: 426 });
    const url = new URL(request.url);
    const token =
      url.searchParams.get("token") ??
      request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return new Response("Missing connection token", { status: 401 });
    const claims = await verifyConnectionToken(
      token,
      this.env.SPECTRA_COLLAB_TOKEN_SECRET,
    );
    await this.room.load();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: SocketAttachment = {
      claims,
      activeLeaseIds: [],
      lastAwarenessSequence: 0,
    };
    server.serializeAttachment(attachment);
    this.state.acceptWebSocket(server);
    this.room.connect({ claims, send: (event) => server.send(encode(event)) });
    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit & { webSocket: WebSocket });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    const message = decode(
      typeof raw === "string" ? raw : new TextDecoder().decode(raw),
    );
    if (message.protocolVersion !== attachment.claims.protocolVersion)
      throw new Error("PROTOCOL_VERSION_MISMATCH");
    const clientId = attachment.claims.actor.clientId;
    if (message.type === "sync_update")
      await this.room.applyUpdate(clientId, message.update, message.origin);
    else if (message.type === "awareness") {
      this.room.updateAwareness(clientId, message.payload, message.sequence);
      socket.serializeAttachment({
        ...attachment,
        lastAwarenessSequence: message.sequence,
      } satisfies SocketAttachment);
    } else if (message.type === "lease_acquire") {
      const result = this.room.acquireLease(clientId, message.lease);
      if (result.ok)
        socket.serializeAttachment({
          ...attachment,
          activeLeaseIds: [...new Set([...attachment.activeLeaseIds, message.lease.id])],
        } satisfies SocketAttachment);
    } else if (message.type === "lease_renew")
      this.room.leases.renew(message.leaseId, clientId, message.expiresAt);
    else if (message.type === "lease_release")
      this.room.releaseLease(clientId, message.leaseId, message.reason);
    else if (message.type === "claim_acquire") {
      const claim = this.room.acquireClaim(clientId, message.claim);
      this.state.storage.sql.exec(
        "INSERT OR REPLACE INTO structural_claims(claim_id,target,owner,operation_id,expires_at,state) VALUES(?,?,?,?,?,?)",
        claim.id,
        claim.target,
        JSON.stringify(claim.owner),
        claim.operationId ?? null,
        claim.expiresAt,
        claim.state,
      );
    } else if (message.type === "claim_release") {
      const resumed = this.room.releaseClaim(clientId, message.claimId);
      this.state.storage.sql.exec(
        "DELETE FROM structural_claims WHERE claim_id=?",
        message.claimId,
      );
      if (resumed)
        this.state.storage.sql.exec(
          "UPDATE structural_claims SET state='active' WHERE claim_id=?",
          resumed.id,
        );
    }
    await this.state.storage.setAlarm(Date.now() + 1_000);
  }

  webSocketClose(socket: WebSocket) {
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    this.room.disconnect(attachment.claims.actor.clientId);
  }

  webSocketError(socket: WebSocket) {
    this.webSocketClose(socket);
  }

  async alarm() {
    const now = Date.now();
    this.room.expireInteractionLeases(now);
    await drainProjectionOutbox(this.store, async (item) => {
      if (!this.env.CONVEX_PROJECTION_URL)
        throw new Error("PROJECTION_ENDPOINT_UNAVAILABLE");
      const response = await fetch(this.env.CONVEX_PROJECTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.env.CONVEX_PROJECTION_TOKEN
            ? { Authorization: `Bearer ${this.env.CONVEX_PROJECTION_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(item),
      });
      if (!response.ok) throw new Error(`PROJECTION_FAILED: ${response.status}`);
    });
    const projectionPending = (
      await this.store.dueProjections(now + 60_000)
    ).length;
    const leaseExpiry = this.room.nextInteractionLeaseExpiry(now);
    const nextAlarm = Math.min(
      projectionPending ? now + 1_000 : Number.POSITIVE_INFINITY,
      leaseExpiry ?? Number.POSITIVE_INFINITY,
    );
    if (Number.isFinite(nextAlarm))
      await this.state.storage.setAlarm(Math.max(now + 10, nextAlarm));
  }
}
