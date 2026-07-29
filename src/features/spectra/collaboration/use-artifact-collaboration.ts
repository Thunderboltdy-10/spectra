"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { HocuspocusArtifactTransport } from "./hocuspocus-transport";
import type { CollaborationTransportSnapshot } from "./types";

const CLOSED_SNAPSHOT: CollaborationTransportSnapshot = {
  state: "closed" as const,
  level: null,
  unsynchronizedChanges: 0,
  presence: [],
};

const subscribeClosed = () => () => undefined;
const getClosedSnapshot = () => CLOSED_SNAPSHOT;

export function useArtifactCollaboration(
  artifactId: string | null | undefined,
  partitionKey = "root",
  schemaVersion = 1,
) {
  const [generation, setGeneration] = useState(0);
  // The transport is created inside the effect rather than in useMemo so that
  // React StrictMode's simulated unmount/remount cycle always yields a live
  // transport: the cleanup destroys the instance, and the re-run builds a
  // fresh one instead of resurrecting a destroyed Y.Doc.
  const [transport, setTransport] =
    useState<HocuspocusArtifactTransport | null>(null);
  const recoveringRef = useRef(false);
  const recoveryAttemptRef = useRef(0);
  useEffect(() => {
    if (!artifactId) {
      setTransport(null);
      return;
    }
    const next = new HocuspocusArtifactTransport(
      artifactId,
      partitionKey,
      schemaVersion,
    );
    setTransport(next);
    void next.connect().catch(() => undefined);
    return () => {
      next.destroy();
      setTransport(null);
    };
  }, [artifactId, generation, partitionKey, schemaVersion]);
  const snapshot = useSyncExternalStore(
    transport?.subscribe ?? subscribeClosed,
    transport?.getSnapshot ?? getClosedSnapshot,
    getClosedSnapshot,
  );
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
      snapshot.unsynchronizedChanges === 0 ||
      (snapshot.state !== "unsynchronized" &&
        snapshot.state !== "reconnecting")
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
    recoverAuthoritative,
    // Only hard-lock when access is known read-only or revoked. Connecting,
    // closed, reconnecting, and unsynchronized must not freeze the editor —
    // private artifacts still need to be editable when the live socket is
    // slow or unavailable, and shared sessions should keep local drafts.
    canEdit:
      snapshot.state !== "permission_lost" && snapshot.level !== "read",
  };
}
