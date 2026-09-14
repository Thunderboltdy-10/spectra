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
  canonicalJsonEqual,
  type ArtifactLiveModelSnapshot,
  type ArtifactLiveValue,
} from "./artifact-yjs-model";
import { NativeArtifactYjsModel } from "../work/models/yjs/native-artifact-model";
import { useArtifactCollaboration } from "./use-artifact-collaboration";
import { realtimeProviderForWorkType } from "../realtime/providers/provider-factory";
import { nativeRoomBaselineExpected } from "./native-bootstrap";
import { studioContentLooksHollow } from "../components/artifact-studio-value-utils";

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
    typeKey,
  );
  const [ownedModel, setOwnedModel] =
    useState<NativeArtifactYjsModel | null>(null);
  useEffect(() => {
    if (!supported || !collaboration.transport) {
      setOwnedModel(null);
      return;
    }
    // NativeArtifactYjsModel owns a Y.Doc listener and UndoManager. Construct
    // it in the effect lifecycle so Strict Mode's setup/cleanup probe destroys
    // the first instance before creating the live one; render-time useMemo
    // construction leaked the discarded instance and could leave the retained
    // instance destroyed.
    const next = new NativeArtifactYjsModel(typeKey, collaboration.transport);
    setOwnedModel(next);
    return () => next.destroy();
  }, [collaboration.transport, supported, typeKey]);
  const model =
    supported &&
    ownedModel?.transport === collaboration.transport &&
    ownedModel.typeKey === typeKey
      ? ownedModel
      : null;
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
  }, [collaboration.state, model, modelSnapshot.initialized]);

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
    if (canonicalJsonEqual(modelSnapshot.value, initialValue)) {
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

  // Sheets: a pre-decode gateway bootstrap can leave a valid hollow Yjs room
  // while Convex still holds a budgeted nonempty activation head. Push that
  // head once so Library 200k open is not stuck on Empty sheet.
  const sheetsHeadHealRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeKey !== "sheets") return;
    if (
      collaboration.state !== "synchronized" ||
      collaboration.unsynchronizedChanges > 0 ||
      modelSnapshot.validity !== "valid" ||
      !modelSnapshot.value ||
      !model ||
      !controller
    )
      return;
    const liveContent = modelSnapshot.value.content;
    const seedContent = initialValue.content;
    if (
      !studioContentLooksHollow(liveContent) ||
      studioContentLooksHollow(seedContent)
    )
      return;
    const healKey = `${artifactId}:${authoritativeRevision ?? "seed"}`;
    if (sheetsHeadHealRef.current === healKey) return;
    sheetsHeadHealRef.current = healKey;
    void model
      .replaceSnapshot(initialValue, controller)
      .catch(() => {
        if (sheetsHeadHealRef.current === healKey) sheetsHeadHealRef.current = null;
      });
  }, [
    artifactId,
    authoritativeRevision,
    collaboration.state,
    collaboration.unsynchronizedChanges,
    controller,
    initialValue,
    model,
    modelSnapshot.validity,
    modelSnapshot.value,
    typeKey,
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

  const flushSnapshot = useCallback(() => {
    if (!model) return modelSnapshot.value;
    return model.flushSnapshot().value;
  }, [model, modelSnapshot.value]);

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
    flushSnapshot,
    restoreRegions,
    initializationError,
    supported,
  };
}
