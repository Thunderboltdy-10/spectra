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
  ArtifactYjsModel,
  type ArtifactLiveModelSnapshot,
  type ArtifactLiveValue,
} from "./artifact-yjs-model";
import { useArtifactCollaboration } from "./use-artifact-collaboration";

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
) {
  const supported = isArtifactTypeKey(typeKey);
  const manifest = supported ? requireArtifactTypeManifest(typeKey) : null;
  const collaboration = useArtifactCollaboration(
    supported && connect ? artifactId : null,
    "root",
    manifest?.schemas.currentVersion ?? 1,
  );
  const model = useMemo(
    () =>
      supported && collaboration.transport
        ? new ArtifactYjsModel(typeKey, collaboration.transport)
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
  const initializingRef = useRef(false);
  const [initializationError, setInitializationError] = useState<string>();

  useEffect(() => () => model?.destroy(), [model]);

  useEffect(() => {
    if (
      !model ||
      !controller ||
      modelSnapshot.initialized ||
      initializingRef.current ||
      collaboration.state !== "synchronized" ||
      collaboration.level !== "modify"
    )
      return;
    initializingRef.current = true;
    setInitializationError(undefined);
    void model
      .initialize(initialValue, controller)
      .then((result) => {
        if (!result.applied && result.reason === "conflict") {
          setInitializationError(
            "Another collaborator is preparing the live artifact. Spectra will load it as soon as synchronization completes.",
          );
        }
      })
      .catch((error) =>
        setInitializationError(
          error instanceof Error
            ? error.message
            : "Could not initialize live collaboration.",
        ),
      )
      .finally(() => {
        initializingRef.current = false;
      });
  }, [
    collaboration.level,
    collaboration.state,
    controller,
    initialValue,
    model,
    modelSnapshot.initialized,
  ]);

  const synchronize = useCallback(
    async (next: ArtifactLiveValue) => {
      if (!model || !controller) throw new Error("COLLABORATION_NOT_AVAILABLE");
      if (!model.getSnapshot().initialized) {
        const initialized = await model.initialize(next, controller);
        if (
          !initialized.applied &&
          initialized.reason !== "already_initialized"
        )
          return initialized;
      }
      return model.replaceSnapshot(next, controller);
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
    restoreRegions,
    initializationError,
    supported,
  };
}
