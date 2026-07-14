import type * as Y from "yjs";

export type CollaborationSyncState = "connecting" | "synchronizing" | "synchronized" | "reconnecting" | "unsynchronized" | "permission_lost" | "closed";

export type CollaborationPresence = {
  clientId: string;
  accountId?: string;
  name?: string;
  color?: string;
  actorKind?: "human" | "ai";
  runId?: string;
  operationId?: string;
  activeRegionId?: string;
  activeRegionIds?: string[];
  cursor?: unknown;
  selection?: unknown;
  viewport?: unknown;
};

export type CollaborationTransportSnapshot = {
  state: CollaborationSyncState;
  level: "read" | "modify" | null;
  unsynchronizedChanges: number;
  presence: CollaborationPresence[];
  error?: string;
};

export type ArtifactCollaborationTransport = {
  readonly document: Y.Doc;
  readonly clientId: string;
  getSnapshot(): CollaborationTransportSnapshot;
  subscribe(listener: () => void): () => void;
  connect(): Promise<void>;
  disconnect(): void;
  destroy(): void;
  setPresence(fields: Omit<CollaborationPresence, "clientId">): void;
  transact(regionId: string, change: () => void): void;
  flush(): Promise<void>;
};
