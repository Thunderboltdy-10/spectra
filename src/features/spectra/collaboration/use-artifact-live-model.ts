"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  isArtifactTypeKey,
  requireArtifactTypeManifest,
} from "../artifacts/registry";
import { ArtifactRegionController } from "./region-controller";
import {
  type ArtifactLiveModelSnapshot,
  type ArtifactLiveValue,
} from "./artifact-yjs-model";
import { NativeArtifactYjsModel } from "../work/models/yjs/native-artifact-model";
import { useArtifactCollaboration } from "./use-artifact-collaboration";
import { realtimeProviderForWorkType } from "../realtime/providers/provider-factory";
import { nativeRoomBaselineExpected } from "./native-bootstrap";

const EMPTY_MODEL_SNAPSHOT: ArtifactLiveModelSnapshot = {
  initialized: false,
  validity: "uninitialized",
  value: null,
  regionIds: [],
};
const subscribeEmpty = () => () => undefined;
const getEmptySnapshot = () => EMPTY_MODEL_SNAPSHOT;

export function useArtifactLiveModel(
  artifactId: string,
  typeKey: string,
  initialValue: ArtifactLiveValue,
  connect = true,
  authoritativeRevision?: string | null,
) {
  const supported = isArtifactTypeKey(typeKey);
  const manifest = supported ? requireArtifactTypeManifest(typeKey) : null;
  const collaboration = useArtifactCollaboration(
    supported && connect ? artifactId : null,
    "root",
    manifest?.schemas.currentVersion ?? 1,
    realtimeProviderForWorkType(typeKey),
  );
  const model = useMemo(
    () =>
      supported && collaboration.transport
        ? new NativeArtifactYjsModel(typeKey, collaboration.transport)
        : null,
    [collaboration.transport, supported, typeKey],
  );
  const controller = useMemo(
    () =>
      collaboration.transport
        ? new ArtifactRegionController(artifactId, collaboration.transport)
        : null,
    [artifactId, collaboration.transport],
  );
  const modelSnapshot = useSyncExternalStore(
    model?.subscribe ?? subscribeEmpty,
    model?.getSnapshot ?? getEmptySnapshot,
    getEmptySnapshot,
  );
  const [initializationError, setInitializationError] = useState<string>();
  const reconciledRevisionRef = useRef<string | null>(null);

  useEffect(() => () => model?.destroy(), [model]);

  useEffect(() => {
    if (
      modelSnapshot.initialized ||
      !nativeRoomBaselineExpected(collaboration.state)
    ) {
      setInitializationError(undefined);
      return;
    }
    // The room/gateway authors the canonical native baseline. Give the final
    // sync update one bounded window to reach the model; a client must never
    // manufacture an equivalent Y.Doc with unrelated struct identities.
    const timer = window.setTimeout(() => {
      if (!model?.getSnapshot().initialized)
        setInitializationError(
          "Working locally while Spectra reconnects. Your draft stays editable and will synchronize when the live model returns.",
        );
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [
    collaboration.state,
    model,
    modelSnapshot.initialized,
  ]);

  useEffect(() => {
    if (
      !authoritativeRevision ||
      reconciledRevisionRef.current === authoritativeRevision ||
      collaboration.state !== "synchronized" ||
      collaboration.unsynchronizedChanges > 0 ||
      modelSnapshot.validity !== "valid" ||
      !modelSnapshot.value ||
      !collaboration.transport
    )
      return;
    const liveKey = JSON.stringify(modelSnapshot.value);
    const authoritativeKey = JSON.stringify(initialValue);
    if (liveKey === authoritativeKey) {
      reconciledRevisionRef.current = authoritativeRevision;
      return;
    }
    // The persisted AI projection is written only after the Yjs operation was
    // durably acknowledged. If this open client disagrees at that revision, it
    // missed a broadcast even if its socket still says "synchronized". Force
    // a state-vector round trip so the native editor receives the real commit.
    reconciledRevisionRef.current = authoritativeRevision;
    void collaboration.transport.retry().catch(() => {
      // Permit one later retry if the network failed during reconciliation.
      if (reconciledRevisionRef.current === authoritativeRevision)
        reconciledRevisionRef.current = null;
    });
  }, [
    authoritativeRevision,
    collaboration.state,
    collaboration.transport,
    collaboration.unsynchronizedChanges,
    initialValue,
    modelSnapshot.validity,
    modelSnapshot.value,
  ]);

  const synchronize = useCallback(
    async (next: ArtifactLiveValue) => {
      if (!model || !controller) throw new Error("COLLABORATION_NOT_AVAILABLE");
      if (!model.getSnapshot().initialized)
        throw new Error("ARTIFACT_LIVE_MODEL_UNINITIALIZED");
      return model.replaceSnapshot(next, controller);
    },
    [controller, model],
  );

  const synchronizeMetadata = useCallback(
    async (next: ArtifactLiveValue) => {
      if (!model || !controller) throw new Error("COLLABORATION_NOT_AVAILABLE");
      if (!model.getSnapshot().initialized)
        throw new Error("ARTIFACT_LIVE_MODEL_UNINITIALIZED");
      return model.replaceMetadataSnapshot(next, controller);
    },
    [controller, model],
  );

  const restoreRegions = useCallback(
    async (next: ArtifactLiveValue, regionIds: readonly string[]) => {
      if (!model || !controller) throw new Error("COLLABORATION_NOT_AVAILABLE");
      if (!model.getSnapshot().initialized)
        throw new Error("ARTIFACT_LIVE_MODEL_UNINITIALIZED");
      return model.replaceRegionsFromSnapshot(next, regionIds, controller);
    },
    [controller, model],
  );

  return {
    ...collaboration,
    model,
    modelSnapshot,
    liveValue:
      modelSnapshot.validity === "valid" && modelSnapshot.value
        ? modelSnapshot.value
        : initialValue,
    synchronize,
    synchronizeMetadata,
    restoreRegions,
    initializationError,
    supported,
  };
}
