import { createContext } from "react";
import * as Y from "yjs";
import type {
  ArtifactCollaborationTransport,
  CollaborationPresence,
  CollaborationSyncSnapshot,
  CollaborationTransportSnapshot,
  PresencePreviewSnapshot,
} from "./types";
import { EMPTY_PRESENCE, EMPTY_PREVIEW_SNAPSHOT } from "./scoped-snapshots";

/** Updates read from a backup, not edits made here. */
export const AWAY_SEED_ORIGIN = Symbol("away-copy-seed");

/*
 * The live document for a work whose computer is away: no room, only the
 * copy rebuilt from that computer's backups. Edits stay in this Y.Doc (and
 * this browser's cache) and are handed back to the computer as a backup it
 * merges, the same way works hand over between computers.
 */
export class AwayCopyTransport implements ArtifactCollaborationTransport {
  readonly document = new Y.Doc();
  readonly clientId = String(this.document.clientID);
  private sync: CollaborationSyncSnapshot = { state: "connecting", level: "modify", unsynchronizedChanges: 0 };
  private full: CollaborationTransportSnapshot = { ...this.sync, presence: EMPTY_PRESENCE };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly seeds: readonly Uint8Array[],
    private readonly onEdit: (document: Y.Doc) => void,
    /** Last word before the document goes, while it can still be read. */
    private readonly onClose?: (document: Y.Doc) => void,
  ) {
    this.document.on("update", this.onUpdate);
  }

  private onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === AWAY_SEED_ORIGIN || this.sync.state !== "synchronized") return;
    this.onEdit(this.document);
  };

  private set(next: Partial<CollaborationSyncSnapshot>) {
    this.sync = { ...this.sync, ...next };
    this.full = { ...this.sync, presence: EMPTY_PRESENCE };
    for (const listener of this.listeners) listener();
  }

  getSnapshot = () => this.full;
  getSyncSnapshot = () => this.sync;
  getPresenceSnapshot = (): CollaborationPresence[] => EMPTY_PRESENCE;
  getPresencePreviewSnapshot = (): PresencePreviewSnapshot => EMPTY_PREVIEW_SNAPSHOT;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  subscribeSync = this.subscribe;
  subscribePresence = () => () => undefined;
  subscribePresencePreview = () => () => undefined;

  async connect() {
    if (this.sync.state === "synchronized" || this.document.isDestroyed) return;
    // Merged over what this browser kept from earlier visits: one history, so nothing doubles.
    for (const seed of this.seeds) if (seed.length) Y.applyUpdate(this.document, seed, AWAY_SEED_ORIGIN);
    this.set({ state: "synchronized" });
  }

  async retry() {
    await this.connect();
  }

  disconnect() {}

  destroy() {
    if (!this.document.isDestroyed) this.onClose?.(this.document);
    this.document.off("update", this.onUpdate);
    this.set({ state: "closed" });
    this.listeners.clear();
    this.document.destroy();
  }

  setPresence() {}

  transact(regionId: string, change: () => void) {
    this.document.transact(change, { kind: "spectra-region", regionId, clientId: this.clientId });
  }

  async flush() {}
}

/** Set around a work's editor while its computer is away: its live document comes from here. */
export type AwayCopyScope = {
  artifactId: string;
  create: () => ArtifactCollaborationTransport;
};

export const AwayCopyContext = createContext<AwayCopyScope | null>(null);
