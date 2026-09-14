export const COLLABORATION_PROTOCOL_VERSION = 1;
// Durable apply gate — must match self-hosted MAX_DURABLE_UPDATE_BYTES (760 KiB).
// Realtime frames may still use MAX_REALTIME_MESSAGE_BYTES; do not conflate them.
export const MAX_DURABLE_UPDATE_BYTES = 760 * 1024;
export const MAX_REALTIME_MESSAGE_BYTES = 1_048_576;
/** @deprecated Prefer MAX_DURABLE_UPDATE_BYTES; kept as the room apply ceiling. */
export const MAX_UPDATE_BYTES = MAX_DURABLE_UPDATE_BYTES;
export const MAX_AWARENESS_BYTES = 16_384;

export type ActorIdentity = {
  accountId: string;
  clientId: string;
  actorKind: "human" | "ai" | "system";
  displayName: string;
};

export type RoomAccess = "read_only" | "edit";

export type ConnectionClaims = {
  workId: string;
  roomId: string;
  workspaceId?: string;
  actor: ActorIdentity;
  access: RoomAccess;
  capabilities: string[];
  permissionEpoch: number;
  protocolVersion: number;
  expiresAt: number;
  runId?: string;
  operationId?: string;
};

export type SocketAttachment = {
  claims: ConnectionClaims;
  activeLeaseIds: string[];
  lastAwarenessSequence: number;
};

export type RoomMessage =
  | { type: "sync_update"; protocolVersion: number; update: Uint8Array; origin: string }
  | { type: "awareness"; protocolVersion: number; payload: unknown; sequence: number }
  | { type: "lease_acquire"; protocolVersion: number; lease: InteractionLease }
  | { type: "lease_renew"; protocolVersion: number; leaseId: string; expiresAt: number }
  | {
      type: "lease_release";
      protocolVersion: number;
      leaseId: string;
      reason?: "commit" | "blur" | "close" | "pointer_up" | "explicit";
    }
  | { type: "claim_acquire"; protocolVersion: number; claim: StructuralClaim }
  | { type: "claim_release"; protocolVersion: number; claimId: string };

export type InteractionLease = {
  id: string;
  target: string;
  scope: "control" | "field" | "object" | "gesture";
  owner: ActorIdentity;
  operationId?: string;
  acquiredAt: number;
  expiresAt: number;
  releaseCondition: "blur" | "close" | "pointer_up" | "commit" | "explicit";
  sequence: number;
};

export type StructuralClaim = {
  id: string;
  target: string;
  owner: ActorIdentity;
  operationId?: string;
  acquiredAt: number;
  expiresAt: number;
  state: "active" | "queued";
};

export function assertProtocol(version: number) {
  if (version !== COLLABORATION_PROTOCOL_VERSION)
    throw new Error(`PROTOCOL_VERSION_UNSUPPORTED: ${version}`);
}

export function roomName(workId: string, partition?: string) {
  const cleanWorkId = workId.trim();
  if (!cleanWorkId || cleanWorkId.includes(":"))
    throw new Error("ROOM_WORK_ID_INVALID");
  if (!partition) return `work:${cleanWorkId}`;
  const cleanPartition = partition.trim();
  if (!cleanPartition || cleanPartition.includes(":"))
    throw new Error("ROOM_PARTITION_INVALID");
  return `work:${cleanWorkId}:${cleanPartition}`;
}
