import type * as Y from "yjs";
import type { InteractionState } from "./interaction-model";

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
  actorKind?: "human" | "ai" | "system";
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
  /** Transient edit gesture so peers can mirror erase vs type chrome. */
  previewGesture?: "erasing" | "typing" | "selecting";
  /**
   * High-level interaction currently in progress. Peers should render only the
   * matching action chrome (caret, selection, drag, menu) and hide the hover
   * pointer while this is set.
   */
  interaction?: CollaborationInteraction | null;
  cursor?: CollaborationCursor | null;
  selection?: CollaborationSelection | null;
  /**
   * Peer-rendered open menu chrome. Native selects cannot be opened from
   * another client; AI and human menu gestures publish this instead.
   */
  menu?: {
    open: boolean;
    label: string;
    options: Array<{ value: string; label: string }>;
    highlighted?: string;
  } | null;
  viewport?: unknown;
  /**
   * Semantic interaction frame (protocol v2). This is the authoritative presence
   * payload: it names the artifact, control, character offset and action rather
   * than shipping viewport coordinates, so peers resolve geometry locally and
   * stay accurate across pane sizes, scroll positions and zoom levels.
   *
   * The fields above are the superseded v1 shape, retained so a client that has
   * not been updated still renders coarse presence instead of nothing.
   */
  interactionState?: InteractionState | null;
};

export type CollaborationInteraction = {
  kind:
    | "pointer"
    | "focus"
    | "typing"
    | "selecting"
    | "dragging"
    | "resizing"
    | "menu"
    | "toggle"
    | "create"
    | "remove"
    | "reorder"
    | "group";
  targetId?: string;
  targetKind?: "block" | "address" | "region" | "path" | "selector";
  label?: string;
};

export type CollaborationSelectionRange = {
  blockId: string;
  startOffset: number;
  endOffset: number;
  /**
   * When set, offsets are relative to this visual line inside a multiline
   * block (e.g. bullet `li` index under a list). Peers resolve the line in the
   * local DOM instead of treating the whole block as one flat string.
   */
  lineIndex?: number;
};

export type CollaborationSelection = {
  kind: "text";
  collapsed: boolean;
  text?: string;
  ranges: CollaborationSelectionRange[];
  /** Native Yjs-relative positions survive concurrent insert/delete edits. */
  relative?: {
    blockId: string;
    anchor: Uint8Array;
    head: Uint8Array;
  };
};

export type CollaborationCursor = {
  x: number;
  y: number;
  updatedAt?: number;
  /**
   * Interaction mode. Peers render a pointer, typing caret, or selection
   * chrome instead of always showing the same mouse glyph.
   */
  mode?: "pointer" | "typing" | "selecting";
  /**
   * Semantic target inside the artifact surface. Peers resolve this against
   * their local DOM so different pane sizes / scroll positions stay aligned.
   * Normalized x/y remain a fallback when no anchor is available.
   */
  anchor?: {
    kind: "block" | "address" | "region" | "path" | "selector";
    id: string;
    /** @deprecated Prefer offsetX; retained for older peers. */
    offset?: number;
    /**
     * Pointer-only fractional position inside the target box. Fine for hover
     * cursors; typing carets must use charOffset instead.
     */
    offsetX?: number;
    offsetY?: number;
    /**
     * Exact character offset inside a text block / path target. Peers place the
     * caret between characters via Range, not by guessing a fraction of the box.
     * When lineIndex is set, this offset is within that visual line.
     */
    charOffset?: number;
    /** Visual line inside a multiline block (list bullets, soft-broken notes). */
    lineIndex?: number;
  };
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

export type CollaborationSyncSnapshot = {
  state: CollaborationSyncState;
  level: "read" | "modify" | null;
  accountId?: string;
  displayName?: string;
  unsynchronizedChanges: number;
  error?: string;
};

export type PresencePreviewSnapshot = {
  signature: string;
  aiCollaborator: CollaborationPresence | null;
  patches: Array<{ path: string; value: unknown }>;
  people: CollaborationPresence[];
};

export type CollaborationActorIdentity = {
  accountId: string;
  clientId: string;
  actorKind: "human" | "ai" | "system";
  displayName: string;
};

export type CollaborationInteractionLease = {
  id: string;
  target: string;
  scope: "control" | "field" | "object" | "gesture";
  owner: CollaborationActorIdentity;
  operationId?: string;
  acquiredAt: number;
  expiresAt: number;
  releaseCondition: "blur" | "close" | "pointer_up" | "commit" | "explicit";
  sequence: number;
};

export type CollaborationLeaseResult =
  | { ok: true; lease: CollaborationInteractionLease }
  | { ok: false; conflict: CollaborationInteractionLease };

export type CollaborationLeaseRelease = {
  leaseId: string;
  target: string;
  releasedAt: number;
  reason:
    | "commit"
    | "blur"
    | "close"
    | "pointer_up"
    | "disconnect"
    | "expiry"
    | "explicit";
};

export type CollaborationStructuralClaim = {
  id: string;
  target: string;
  owner: CollaborationActorIdentity;
  operationId?: string;
  acquiredAt: number;
  expiresAt: number;
  state: "active" | "queued";
};

export type CollaborationClaimRelease = {
  claimId: string;
  resumed: CollaborationStructuralClaim | null;
};

export type ArtifactCollaborationTransport = {
  readonly document: Y.Doc;
  readonly clientId: string;
  getSnapshot(): CollaborationTransportSnapshot;
  subscribe(listener: () => void): () => void;
  getSyncSnapshot(): CollaborationSyncSnapshot;
  subscribeSync(listener: () => void): () => void;
  getPresenceSnapshot(): CollaborationPresence[];
  subscribePresence(listener: () => void): () => void;
  getPresencePreviewSnapshot(): PresencePreviewSnapshot;
  subscribePresencePreview(listener: () => void): () => void;
  connect(): Promise<void>;
  /**
   * Tell providers that IndexedDB restored a branch that never received a
   * remote durable acknowledgement. Providers that already queue the restored
   * update during document hydration may implement this as a no-op.
   */
  markLocalRecoveryPending?(): void;
  retry(): Promise<void>;
  disconnect(): void;
  destroy(): void;
  setPresence(fields: Omit<CollaborationPresence, "clientId">): void;
  transact(regionId: string, change: () => void): void;
  acquireInteractionLease?(
    lease: Omit<CollaborationInteractionLease, "owner">,
    signal?: AbortSignal,
  ): Promise<CollaborationLeaseResult>;
  renewInteractionLease?(leaseId: string, expiresAt: number): void;
  releaseInteractionLease?(
    leaseId: string,
    reason?: CollaborationLeaseRelease["reason"],
  ): void;
  subscribeLeaseReleases?(
    listener: (event: CollaborationLeaseRelease) => void,
  ): () => void;
  acquireStructuralClaim?(
    claim: Omit<CollaborationStructuralClaim, "owner" | "state">,
    signal?: AbortSignal,
  ): Promise<CollaborationStructuralClaim>;
  releaseStructuralClaim?(claimId: string): void;
  subscribeClaimReleases?(
    listener: (event: CollaborationClaimRelease) => void,
  ): () => void;
  flush(): Promise<void>;
};
