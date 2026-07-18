"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { HocuspocusArtifactTransport } from "./hocuspocus-transport";

const CLOSED_SNAPSHOT = {
  state: "closed" as const,
  level: null,
  unsynchronizedChanges: 0,
  presence: [],
};

const subscribeClosed = () => () => undefined;
const getClosedSnapshot = () => CLOSED_SNAPSHOT;

export function useArtifactCollaboration(artifactId: string | null | undefined, partitionKey = "root", schemaVersion = 1) {
  const [generation, setGeneration] = useState(0);
  const transport = useMemo(() => artifactId ? new HocuspocusArtifactTransport(artifactId, partitionKey, schemaVersion) : null, [artifactId, generation, partitionKey, schemaVersion]);
  useEffect(() => {
    if (!transport) return;
    void transport.connect().catch(() => undefined);
    return () => transport.destroy();
  }, [transport]);
  const snapshot = useSyncExternalStore(
    transport?.subscribe ?? subscribeClosed,
    transport?.getSnapshot ?? getClosedSnapshot,
    getClosedSnapshot,
  );
  const recoverAuthoritative = useCallback(() => {
    transport?.destroy();
    setGeneration((value) => value + 1);
  }, [transport]);
  return { transport, ...snapshot, recoverAuthoritative, canEdit: snapshot.state === "synchronized" && snapshot.level === "modify" && snapshot.unsynchronizedChanges === 0 };
}
