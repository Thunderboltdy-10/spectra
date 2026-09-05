"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ArtifactCollaborationTransport,
  CollaborationSyncSnapshot,
} from "./types";
import { createArtifactCollaborationTransport } from "../realtime/providers/provider-factory";
import type { RealtimeProviderKind } from "../realtime/providers/provider-factory";
import {
  BoundedYjsLocalPersistence,
  type LocalDurabilitySnapshot,
} from "../realtime/persistence";
import { leaseReleaseSubscriptions } from "../realtime/policies";
import {
  EMPTY_PRESENCE,
  EMPTY_SYNC_SNAPSHOT,
} from "./scoped-snapshots";

const CLOSED_SNAPSHOT: CollaborationSyncSnapshot = EMPTY_SYNC_SNAPSHOT;

const subscribeClosed = () => () => undefined;
const getClosedSnapshot = () => CLOSED_SNAPSHOT;
const CLOSED_DURABILITY: LocalDurabilitySnapshot = {
  state: "closed",
  bytes: 0,
  pendingRemoteSync: false,
  restored: false,
};
const getClosedDurability = () => CLOSED_DURABILITY;

export function artifactCollaborationPersistenceKey(
  artifactId: string,
  partitionKey: string,
  namespace: string,
  schemaVersion = 1,
) {
  return `work:${artifactId}:${partitionKey}:${namespace}:v${schemaVersion}`;
}

export function useArtifactCollaboration(
  artifactId: string | null | undefined,
  partitionKey = "root",
  schemaVersion = 1,
  providerKind?: RealtimeProviderKind,
  persistenceNamespace = "artifact",
) {
  const [generation, setGeneration] = useState(0);
  // The transport is created inside the effect rather than in useMemo so that
  // React StrictMode's simulated unmount/remount cycle always yields a live
  // transport: the cleanup destroys the instance, and the re-run builds a
  // fresh one instead of resurrecting a destroyed Y.Doc.
  const [transport, setTransport] =
    useState<ArtifactCollaborationTransport | null>(null);
  const [localPersistence, setLocalPersistence] =
    useState<BoundedYjsLocalPersistence | null>(null);
  const recoveringRef = useRef(false);
  const recoveryAttemptRef = useRef(0);
  useEffect(() => {
    if (!artifactId) {
      setTransport(null);
      setLocalPersistence(null);
      return;
    }
    const next = createArtifactCollaborationTransport(
      artifactId,
      partitionKey,
      schemaVersion,
      providerKind,
    );
    const persistence = new BoundedYjsLocalPersistence({
      key: artifactCollaborationPersistenceKey(
        artifactId,
        partitionKey,
        persistenceNamespace,
        schemaVersion,
      ),
      document: next.document,
      modelVersion: schemaVersion,
    });
    setTransport(next);
    setLocalPersistence(persistence);
    // Restore the bounded local Yjs state before joining the room. The room's
    // state-vector handshake then merges the offline branch rather than
    // replacing it or requiring React to replay a stale full snapshot.
    void persistence
      .initialize()
      .then(() => next.connect())
      .catch(() => next.connect())
      .catch(() => undefined);
    return () => {
      void persistence.persistNow();
      persistence.destroy();
      next.destroy();
      setTransport(null);
      setLocalPersistence(null);
    };
  }, [
    artifactId,
    generation,
    partitionKey,
    persistenceNamespace,
    providerKind,
    schemaVersion,
  ]);
  const snapshot = useSyncExternalStore(
    transport?.subscribeSync ?? subscribeClosed,
    transport?.getSyncSnapshot ?? getClosedSnapshot,
    getClosedSnapshot,
  );
  const localDurability = useSyncExternalStore(
    localPersistence?.subscribe ?? subscribeClosed,
    localPersistence?.getSnapshot ?? getClosedDurability,
    getClosedDurability,
  );
  useEffect(() =>
    transport?.subscribeLeaseReleases?.((event) => {
      leaseReleaseSubscriptions.release({
        targetId: event.target,
        leaseId: event.leaseId,
        releasedAt: event.releasedAt,
        reason: event.reason,
      });
    }), [transport]);
  useEffect(() => {
    if (
      snapshot.state === "synchronized" &&
      snapshot.unsynchronizedChanges === 0
    )
      localPersistence?.markRemoteDurable();
  }, [localPersistence, snapshot.state, snapshot.unsynchronizedChanges]);
  useEffect(() => {
    if (
      snapshot.unsynchronizedChanges === 0 &&
      snapshot.state !== "unsynchronized" &&
      snapshot.state !== "reconnecting"
    ) {
      recoveryAttemptRef.current = 0;
    }
  }, [snapshot.state, snapshot.unsynchronizedChanges]);
  useEffect(() => {
    if (
      !transport ||
      recoveringRef.current ||
      snapshot.level === "read" ||
      snapshot.unsynchronizedChanges === 0 ||
      snapshot.state !== "unsynchronized"
    )
      return;
    // A gateway rejection closes the socket after the local Y.Doc has already
    // recorded the rejected update. Reconnecting that same document resends
    // the unauthorized frame forever. The authored React draft remains intact,
    // so rebuild only the transport and let the normal synchronization path
    // reapply that draft under a fresh region claim.
    recoveringRef.current = true;
    const attempt = recoveryAttemptRef.current;
    const recoveryDelay = Math.min(10_000, 750 * 2 ** attempt);
    recoveryAttemptRef.current = Math.min(attempt + 1, 5);
    const timer = window.setTimeout(() => {
      transport.destroy();
      setGeneration((value) => value + 1);
      recoveringRef.current = false;
    }, recoveryDelay);
    return () => {
      window.clearTimeout(timer);
      recoveringRef.current = false;
    };
  }, [
    snapshot.level,
    snapshot.state,
    snapshot.unsynchronizedChanges,
    transport,
  ]);
  const recoverAuthoritative = useCallback(() => {
    transport?.destroy();
    setGeneration((value) => value + 1);
  }, [transport]);
  return {
    transport,
    ...snapshot,
    presence: EMPTY_PRESENCE,
    localDurability,
    recoverAuthoritative,
    // Only hard-lock when access is known read-only or revoked. Connecting,
    // closed, reconnecting, and unsynchronized must not freeze the editor —
    // private artifacts still need to be editable when the live socket is
    // slow or unavailable, and shared sessions should keep local drafts.
    canEdit:
      snapshot.state !== "permission_lost" && snapshot.level !== "read",
  };
}
