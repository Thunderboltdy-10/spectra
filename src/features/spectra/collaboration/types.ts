import type * as Y from "yjs";

export type CollaborationSyncState =
  | "connecting"
  | "synchronizing"
  | "synchronized"
  | "reconnecting"
  | "unsynchronized"
  | "permission_lost"
  | "closed";

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
  previewPatches?: Array<{
    path: string;
    value: unknown;
  }>;
  previewSequence?: number;
  previewPhase?: "streaming";
  cursor?: CollaborationCursor | null;
  selection?: unknown;
  viewport?: unknown;
};

export type CollaborationCursor = {
  x: number;
  y: number;
  updatedAt?: number;
};

export type CollaborationTransportSnapshot = {
  state: CollaborationSyncState;
  level: "read" | "modify" | null;
  accountId?: string;
  displayName?: string;
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
  retry(): Promise<void>;
  disconnect(): void;
  destroy(): void;
  setPresence(fields: Omit<CollaborationPresence, "clientId">): void;
  transact(regionId: string, change: () => void): void;
  flush(): Promise<void>;
};
