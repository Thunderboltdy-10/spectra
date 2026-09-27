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
import { syncRetryDelayMs } from "../../../../shared/sync-retry-policy";

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
  const [initializationError, setInitializationError] = useState<string>();
  const recoveringRef = useRef(false);
  const recoveryAttemptRef = useRef(0);
  useEffect(() => {
    if (!artifactId) {
      setTransport(null);
      setLocalPersistence(null);
      setInitializationError(undefined);
      return;
    }
    setTransport(null);
    setLocalPersistence(null);
    setInitializationError(undefined);
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
    const unsubscribeRecovery = next.subscribeSync(() => {
      const sync = next.getSyncSnapshot();
      const conflict = sync.recoveryConflict;
      if (conflict) persistence.preserveConflict(conflict);
      // Capture the exact acknowledged generation synchronously. A later
      // React effect can otherwise attach this anchor to a newer dirty draft.
      if (sync.state === "synchronized" && sync.unsynchronizedChanges === 0)
        persistence.markRemoteDurable(sync.durableAnchor);
    });
    let cancelled = false;
    // Restore the bounded local Yjs state before joining the room. The room's
    // state-vector handshake then merges the offline branch rather than
    // replacing it or requiring React to replay a stale full snapshot.
    void persistence
      .initialize()
      .then((durability) => {
        if (cancelled) return;
        if (durability.state === "error")
          throw new Error("LOCAL_COLLABORATION_RESTORE_FAILED");
        if (durability?.pendingRemoteSync)
          next.markLocalRecoveryPending?.(durability.recoveryConflict, {
            recoveryAnchor: durability.recoveryAnchor, authoredRegionIds: durability.authoredRegionIds,
          });
        else if (durability?.recoveryAnchor)
          next.restoreDurableAnchor?.(durability.recoveryAnchor);
        setTransport(next);
        setLocalPersistence(persistence);
      })
      .then(() => {
        if (!cancelled) void next.connect();
      })
      .catch(() => {
        if (cancelled) return;
        // Joining before local recovery succeeds can make an empty document
        // look like a valid room state and let later writes replace the saved
        // offline branch. Keep the room closed and surface the failure.
        setInitializationError("LOCAL_COLLABORATION_RESTORE_FAILED");
      });
    return () => {
      cancelled = true;
      unsubscribeRecovery();
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
      snapshot.unsynchronizedChanges === 0 &&
      snapshot.state === "synchronized"
    ) {
      recoveryAttemptRef.current = 0;
    }
  }, [snapshot.state, snapshot.unsynchronizedChanges]);
  useEffect(() => {
    if (!localPersistence) return;
    const flush = () => void localPersistence.persistNow();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (snapshot.unsynchronizedChanges <= 0) return;
      const durability = localPersistence.getSnapshot();
      const locallyCommitted =
        (durability.state === "local_only" && durability.pendingRemoteSync) ||
        (durability.state === "ready" && !durability.pendingRemoteSync);
      if (locallyCommitted) return;
      flush();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [localPersistence, snapshot.unsynchronizedChanges]);
  useEffect(() => {
    if (
      !transport ||
      recoveringRef.current ||
      snapshot.level === "read" ||
      snapshot.recoveryConflict ||
      (localDurability.pendingRemoteSync && ["error", "quota_exceeded"].includes(localDurability.state)) ||
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
    if (attempt >= 8) { recoveringRef.current = false; return; }
    const recoveryDelay = syncRetryDelayMs(
      attempt + 1,
      `collaboration-recovery:${artifactId}`,
    );
    recoveryAttemptRef.current = attempt + 1;
    const timer = window.setTimeout(() => {
      void (async () => {
        await localPersistence?.persistNow();
        const local = localPersistence?.getSnapshot();
        if (!local || !["ready", "local_only"].includes(local.state)) { recoveringRef.current = false; return; }
        transport.destroy();
        setGeneration((value) => value + 1);
        recoveringRef.current = false;
      })();
    }, recoveryDelay);
    return () => {
      window.clearTimeout(timer);
      recoveringRef.current = false;
    };
  }, [
    snapshot.level,
    snapshot.state,
    snapshot.unsynchronizedChanges,
    snapshot.recoveryConflict,
    transport,
    artifactId,
    localPersistence,
    localDurability.state,
    localDurability.pendingRemoteSync,
  ]);
  // Rebuilds the live session from the local head, e.g. after a recovery
  // adoption committed a new head. Never writes content itself.
  const reopenLiveSession = useCallback(() => {
    recoveryAttemptRef.current = 0;
    transport?.destroy();
    setGeneration((value) => value + 1);
  }, [transport]);
  const canRecoverOffline =
    localDurability.state === "ready" ||
    localDurability.state === "local_only" ||
    localDurability.state === "persisting";
  return {
    transport,
    ...snapshot,
    initializationError,
    presence: EMPTY_PRESENCE,
    localDurability,
    localPersistence,
    reopenLiveSession,
    // Only hard-lock when access is known read-only or revoked. Connecting,
    // closed, reconnecting, and unsynchronized must not freeze the editor —
    // private artifacts still need to be editable when the live socket is
    // slow or unavailable, and shared sessions should keep local drafts.
    canEdit:
      snapshot.state !== "permission_lost" &&
      snapshot.level !== "read" &&
      (snapshot.state === "synchronized" || canRecoverOffline),
  };
}
