"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { ArtifactLiveValue } from "../collaboration/artifact-yjs-model";
import type { ReplicaTruth } from "../bridge/status";
import {
  nativeMaterializationStale,
  nativeMaterializationVerified,
} from "../bridge/native-materialization-exit";

export type NativeMaterialization =
  | { state: "queueing" }
  | { state: "pending"; hash: string };

export type NativeConflict = {
  regionIds: string[];
  message: string;
  previews?: Array<{
    regionId: string;
    spectra: string;
    external: string;
  }>;
};

type NativeLive = {
  liveValue: ArtifactLiveValue;
  synchronize: (next: ArtifactLiveValue) => Promise<unknown>;
  modelSnapshot: {
    initialized: boolean;
    validity: string;
    value: { content: unknown } | null;
  };
  unsynchronizedChanges: number;
};

function syncRejected(result: unknown): boolean {
  return Boolean(
    result &&
      typeof result === "object" &&
      "applied" in result &&
      (result as { applied?: boolean }).applied === false,
  );
}

type EditorSnapshot = {
  title: string;
  summary: string;
  tagDraft: string;
  content: unknown;
};

type ReplicaRow = ReplicaTruth & {
  updatedAt?: number;
  contentHash?: string;
  revision: string;
  fidelityMap?: unknown;
};

/**
 * Lens open, external projection apply, and native reconcile (ARCHITECTURE-PLATFORM §3).
 * The studio still owns the semantic editor; this hook is the only native-file
 * refresh/reconcile path.
 */
export function useArtifactNativeSync({
  artifactId,
  nativeOfficeDocument,
  nativeWordDocument,
  nativeOfficeApplication,
  dirty,
  userHasEditedRef,
  reconcilingRemoteRef,
  currentSnapshotRef,
  live,
  initialLiveValue,
  replicas,
  conflicts,
  setContent,
  setBaseline,
  setDirty,
}: {
  artifactId: string;
  nativeOfficeDocument: boolean;
  nativeWordDocument: boolean;
  nativeOfficeApplication: string;
  dirty: boolean;
  userHasEditedRef: MutableRefObject<boolean>;
  reconcilingRemoteRef: MutableRefObject<boolean>;
  currentSnapshotRef: MutableRefObject<EditorSnapshot>;
  live: NativeLive;
  initialLiveValue: ArtifactLiveValue;
  replicas: readonly ReplicaRow[] | undefined;
  conflicts: readonly {
    regionIds: string[];
    partNames: string[];
    previews?: NativeConflict["previews"];
  }[] | undefined;
  setContent: (content: unknown) => void;
  setBaseline: (snapshot: EditorSnapshot) => void;
  setDirty: (dirty: boolean) => void;
}) {
  const [nativeWriteError, setNativeWriteError] = useState<string>();
  const [nativeMaterialization, setNativeMaterialization] =
    useState<NativeMaterialization>();
  const [nativeAttribution, setNativeAttribution] = useState<string>();
  const [nativeLensProjection, setNativeLensProjection] = useState<unknown>();
  const [nativeProjectionReady, setNativeProjectionReady] = useState(false);
  const [nativeConflict, setNativeConflict] = useState<NativeConflict | null>(
    null,
  );
  const nativeReconciliationRevisionRef = useRef<string | undefined>(undefined);
  const nativeProjectionArtifactRef = useRef<string | undefined>(undefined);
  const nativeLensRefreshRef = useRef<string | undefined>(undefined);
  const nativeLocalRevisionRef = useRef<string | undefined>(undefined);
  const pendingNativeProjectionRef = useRef<unknown>(undefined);
  const nativeProjectionOverrideRef = useRef<unknown>(undefined);

  const applyExternalProjection = useCallback(
    async (
      projection: unknown,
      attribution = `Edited in ${nativeOfficeApplication}`,
    ) => {
      nativeProjectionOverrideRef.current = projection;
      const nextValue = { ...live.liveValue, content: projection };
      const applied = await live.synchronize(nextValue);
      if (syncRejected(applied))
        throw new Error(
          `The ${nativeOfficeApplication} edit overlaps an active collaborator region.`,
        );
      const snapshot = {
        ...currentSnapshotRef.current,
        content: projection,
      };
      reconcilingRemoteRef.current = true;
      userHasEditedRef.current = false;
      setContent(projection);
      setBaseline(snapshot);
      setDirty(false);
      setNativeAttribution(attribution);
      setNativeLensProjection(undefined);
      setNativeProjectionReady(false);
      window.requestAnimationFrame(() => {
        reconcilingRemoteRef.current = false;
      });
    },
    [
      currentSnapshotRef,
      live,
      nativeOfficeApplication,
      reconcilingRemoteRef,
      setBaseline,
      setContent,
      setDirty,
      userHasEditedRef,
    ],
  );

  useEffect(() => {
    if (!nativeOfficeDocument || nativeLensRefreshRef.current === artifactId)
      return;
    nativeLensRefreshRef.current = artifactId;
    let cancelled = false;
    let completed = false;
    const endpoint = nativeWordDocument
      ? "/api/spectra/lenses/docx"
      : "/api/spectra/lenses/office";
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open", artifactId }),
    })
      .then(async (response) => {
        const result = (await response.json().catch(() => null)) as {
          state?: string;
          content?: unknown;
          projection?: unknown;
          message?: string;
          conflict?: NativeConflict;
        } | null;
        if (!response.ok)
          throw new Error(
            result?.message ??
              `The ${nativeOfficeApplication} file could not be opened safely.`,
          );
        if (!cancelled) {
          completed = true;
          if (result?.state === "conflicted") {
            setNativeConflict({
              regionIds: result.conflict?.regionIds ?? [],
              previews: result.conflict?.previews,
              message:
                result.conflict?.message ??
                `${nativeOfficeApplication} and Spectra changed the same work region.`,
            });
            return;
          }
          const projection = result?.content ?? result?.projection;
          if (projection !== undefined) {
            nativeProjectionOverrideRef.current = projection;
            setNativeLensProjection(projection);
            setNativeProjectionReady(true);
          }
          window.dispatchEvent(
            new CustomEvent("spectra:artifact-lens-activated", {
              detail: { artifactId, projection },
            }),
          );
        }
      })
      .catch((error: unknown) => {
        completed = true;
        nativeLensRefreshRef.current = undefined;
        if (!cancelled)
          setNativeWriteError(
            error instanceof Error
              ? error.message
              : `The ${nativeOfficeApplication} file could not be opened safely.`,
          );
      });
    return () => {
      cancelled = true;
      if (!completed && nativeLensRefreshRef.current === artifactId)
        nativeLensRefreshRef.current = undefined;
    };
  }, [
    artifactId,
    nativeOfficeApplication,
    nativeOfficeDocument,
    nativeWordDocument,
  ]);

  useEffect(() => {
    if (
      !nativeWordDocument ||
      !live.modelSnapshot.initialized ||
      live.modelSnapshot.validity !== "valid" ||
      !live.modelSnapshot.value ||
      dirty ||
      userHasEditedRef.current ||
      live.unsynchronizedChanges > 0
    )
      return;
    if (nativeProjectionArtifactRef.current === artifactId) return;
    nativeProjectionArtifactRef.current = artifactId;
    const refreshedContent = initialLiveValue.content;
    if (
      JSON.stringify(live.modelSnapshot.value.content) ===
      JSON.stringify(refreshedContent)
    )
      return;
    void live
      .synchronize({ ...initialLiveValue, content: refreshedContent })
      .then((result) => {
        if (syncRejected(result)) {
          nativeProjectionArtifactRef.current = undefined;
        }
      })
      .catch(() => {
        nativeProjectionArtifactRef.current = undefined;
      });
  }, [
    artifactId,
    dirty,
    initialLiveValue,
    live,
    nativeWordDocument,
    userHasEditedRef,
  ]);

  const queueNativeMaterialization = useCallback(
    async (snapshot: { content?: unknown }) => {
      if (!nativeOfficeDocument) return;
      setNativeMaterialization({ state: "queueing" });
      setNativeWriteError(undefined);
      try {
        const endpoint = nativeWordDocument
          ? "/api/spectra/lenses/docx"
          : "/api/spectra/lenses/office";
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "materialize",
            artifactId,
            content: snapshot.content,
          }),
        });
        const result = (await response.json().catch(() => null)) as {
          hash?: string;
          message?: string;
          state?: string;
          conflict?: NativeConflict;
        } | null;
        if (!response.ok)
          throw new Error(
            result?.message ??
              "This edit could not be written safely to the Word file.",
          );
        if (result?.state === "unchanged") {
          setNativeMaterialization(undefined);
          return;
        }
        if (result?.state === "conflicted") {
          setNativeMaterialization(undefined);
          setNativeConflict({
            regionIds: result.conflict?.regionIds ?? [],
            previews: result.conflict?.previews,
            message:
              result.conflict?.message ??
              `${nativeOfficeApplication} and Spectra changed the same work region.`,
          });
          return;
        }
        if (!result?.hash)
          throw new Error(
            "The Word write was queued without a verifiable hash.",
          );
        setNativeMaterialization({ state: "pending", hash: result.hash });
      } catch (error) {
        setNativeMaterialization(undefined);
        setNativeWriteError(
          error instanceof Error
            ? error.message
            : "This edit could not be written safely to the Word file.",
        );
      }
    },
    [artifactId, nativeOfficeApplication, nativeOfficeDocument, nativeWordDocument],
  );

  useEffect(() => {
    if (
      nativeProjectionOverrideRef.current !== undefined &&
      JSON.stringify(live.liveValue.content) ===
        JSON.stringify(nativeProjectionOverrideRef.current)
    ) {
      nativeProjectionOverrideRef.current = undefined;
    }
  }, [live.liveValue.content]);

  useEffect(() => {
    const onLensActivated = (event: Event) => {
      const detail = (
        event as CustomEvent<{ artifactId?: string; projection?: unknown }>
      ).detail;
      if (detail?.artifactId !== artifactId || !detail.projection || dirty)
        return;
      if (
        !live.modelSnapshot.initialized ||
        live.modelSnapshot.validity !== "valid" ||
        live.unsynchronizedChanges > 0
      ) {
        pendingNativeProjectionRef.current = detail.projection;
        return;
      }
      void applyExternalProjection(
        detail.projection,
        `Edited in ${nativeOfficeApplication}`,
      ).catch((error: unknown) => {
        setNativeWriteError(
          error instanceof Error
            ? error.message
            : `The ${nativeOfficeApplication} projection could not be applied safely.`,
        );
      });
    };
    window.addEventListener("spectra:artifact-lens-activated", onLensActivated);
    return () =>
      window.removeEventListener(
        "spectra:artifact-lens-activated",
        onLensActivated,
      );
  }, [
    applyExternalProjection,
    artifactId,
    dirty,
    live.modelSnapshot.initialized,
    live.modelSnapshot.validity,
    live.unsynchronizedChanges,
    nativeOfficeApplication,
  ]);

  useEffect(() => {
    if (
      !nativeLensProjection ||
      dirty ||
      !live.modelSnapshot.initialized ||
      live.modelSnapshot.validity !== "valid" ||
      live.unsynchronizedChanges > 0
    )
      return;
    const projection = nativeLensProjection;
    setNativeLensProjection(undefined);
    void applyExternalProjection(
      projection,
      `Opened from ${nativeOfficeApplication}`,
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      if (/maximum update depth|too many re-renders/i.test(message)) return;
      setNativeWriteError(
        message ||
          `The ${nativeOfficeApplication} projection could not be applied safely.`,
      );
    });
  }, [
    applyExternalProjection,
    dirty,
    live.modelSnapshot.initialized,
    live.modelSnapshot.validity,
    live.unsynchronizedChanges,
    nativeLensProjection,
    nativeOfficeApplication,
  ]);

  useEffect(() => {
    const projection = pendingNativeProjectionRef.current;
    if (
      !projection ||
      dirty ||
      !live.modelSnapshot.initialized ||
      live.modelSnapshot.validity !== "valid" ||
      live.unsynchronizedChanges > 0
    )
      return;
    pendingNativeProjectionRef.current = undefined;
    void applyExternalProjection(
      projection,
      `Edited in ${nativeOfficeApplication}`,
    ).catch((error: unknown) => {
      pendingNativeProjectionRef.current = projection;
      setNativeWriteError(
        error instanceof Error
          ? error.message
          : `The ${nativeOfficeApplication} projection could not be applied safely.`,
      );
    });
  }, [
    applyExternalProjection,
    dirty,
    live.modelSnapshot.initialized,
    live.modelSnapshot.validity,
    live.unsynchronizedChanges,
    nativeOfficeApplication,
  ]);

  const reconcileNativeRevision = useCallback(
    async (resolution?: "word" | "spectra") => {
      const response = await fetch(
        nativeWordDocument
          ? "/api/spectra/lenses/docx"
          : "/api/spectra/lenses/office",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reconcile",
            artifactId,
            ...(resolution
              ? {
                  resolution:
                    resolution === "word" && !nativeWordDocument
                      ? "local"
                      : resolution,
                }
              : {}),
          }),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        state?: string;
        projection?: unknown;
        attribution?: string;
        status?: string;
        message?: string;
        conflict?: {
          regionIds?: string[];
          message?: string;
          previews?: NativeConflict["previews"];
        };
      } | null;
      if (!response.ok)
        throw new Error(
          result?.message ??
            `The ${nativeOfficeApplication} edit could not be reconciled safely.`,
        );
      if (result?.state === "applied" && result.projection)
        await applyExternalProjection(
          result.projection,
          result.attribution ?? `Edited in ${nativeOfficeApplication}`,
        );
      else if (result?.state === "conflicted")
        setNativeConflict({
          regionIds: result.conflict?.regionIds ?? [],
          previews: result.conflict?.previews,
          message:
            result.conflict?.message ??
            `${nativeOfficeApplication} and Spectra changed the same work region.`,
        });
      else if (resolution === "spectra") {
        setNativeConflict(null);
        setNativeAttribution(
          result?.attribution ??
            result?.status ??
            "Waiting to save your Spectra version locally",
        );
      }
      setNativeWriteError(undefined);
    },
    [
      applyExternalProjection,
      artifactId,
      nativeOfficeApplication,
      nativeWordDocument,
    ],
  );

  const nativeLocalReplica = nativeOfficeDocument
    ? replicas
        ?.filter(
          (replica) =>
            replica.kind === "local" && replica.state !== "unavailable",
        )
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0]
    : undefined;
  const nativeCloudReplica = nativeOfficeDocument
    ? replicas?.find((replica) => replica.kind === "cloud")
    : undefined;

  useEffect(() => {
    if (!nativeOfficeDocument || !nativeLocalReplica) return;
    const previousRevision = nativeLocalRevisionRef.current;
    const localChangedSinceCloud = Boolean(
      nativeLocalReplica.contentHash &&
        nativeCloudReplica?.contentHash &&
        nativeLocalReplica.contentHash !== nativeCloudReplica.contentHash,
    );
    nativeLocalRevisionRef.current = nativeLocalReplica.revision;
    if (
      (!previousRevision && !localChangedSinceCloud) ||
      previousRevision === nativeLocalReplica.revision ||
      nativeLocalReplica.state !== "current" ||
      nativeMaterialization ||
      dirty ||
      live.unsynchronizedChanges > 0
    )
      return;
    nativeReconciliationRevisionRef.current = `current:${nativeLocalReplica.revision}`;
    const timer = window.setTimeout(() => {
      void reconcileNativeRevision().catch((error: unknown) => {
        setNativeWriteError(
          error instanceof Error
            ? error.message
            : `The ${nativeOfficeApplication} edit could not be reconciled safely.`,
        );
      });
    }, 360);
    return () => window.clearTimeout(timer);
  }, [
    dirty,
    live.unsynchronizedChanges,
    nativeLocalReplica,
    nativeMaterialization,
    nativeOfficeApplication,
    nativeOfficeDocument,
    nativeCloudReplica,
    reconcileNativeRevision,
  ]);

  useEffect(() => {
    if (!nativeMaterialization || !nativeLocalReplica) return;
    if (nativeMaterializationVerified(nativeMaterialization, nativeLocalReplica)) {
      setNativeMaterialization(undefined);
      setNativeAttribution("Saved locally");
    } else if (nativeMaterializationStale(nativeMaterialization, nativeLocalReplica)) {
      setNativeMaterialization(undefined);
    }
  }, [nativeLocalReplica, nativeMaterialization]);

  const reconcilableLocalRevision =
    nativeLocalReplica?.state === "ahead" ||
    nativeLocalReplica?.state === "diverged"
      ? `${nativeLocalReplica.state}:${nativeLocalReplica.revision}`
      : undefined;
  const persistedNativeConflict = nativeOfficeDocument
    ? conflicts?.[0]
    : undefined;

  useEffect(() => {
    if (!nativeOfficeDocument || conflicts === undefined) return;
    if (!persistedNativeConflict) {
      setNativeConflict(null);
      return;
    }
    const regionCount = persistedNativeConflict.regionIds.length;
    const preservedPartCount = persistedNativeConflict.partNames.length;
    setNativeConflict(
      (current) =>
        current
          ? {
              ...current,
              regionIds: persistedNativeConflict.regionIds,
              previews: persistedNativeConflict.previews ?? current.previews,
            }
          : {
              regionIds: persistedNativeConflict.regionIds,
              previews: persistedNativeConflict.previews,
              message: regionCount
                ? `${nativeOfficeApplication} and Spectra changed ${regionCount === 1 ? "the same work region" : `${regionCount} overlapping work regions`}. Choose which version to keep.`
                : preservedPartCount
                  ? `${nativeOfficeApplication} and Spectra changed the same preserved native content. Choose which version to keep.`
                  : `${nativeOfficeApplication} and Spectra changed this work independently. Choose which version to keep.`,
            },
    );
  }, [conflicts, nativeOfficeApplication, nativeOfficeDocument, persistedNativeConflict]);

  useEffect(() => {
    if (
      !nativeOfficeDocument ||
      !reconcilableLocalRevision ||
      (dirty && nativeLocalReplica?.state !== "ahead") ||
      (live.unsynchronizedChanges > 0 && nativeLocalReplica?.state !== "ahead") ||
      nativeReconciliationRevisionRef.current === reconcilableLocalRevision
    )
      return;
    nativeReconciliationRevisionRef.current = reconcilableLocalRevision;
    const timer = window.setTimeout(() => {
      void reconcileNativeRevision().catch((error: unknown) => {
        setNativeWriteError(
          error instanceof Error
            ? error.message
            : `The ${nativeOfficeApplication} edit could not be reconciled safely.`,
        );
      });
    }, 360);
    return () => window.clearTimeout(timer);
  }, [
    reconcilableLocalRevision,
    dirty,
    live.unsynchronizedChanges,
    nativeLocalReplica?.state,
    reconcileNativeRevision,
    nativeOfficeApplication,
    nativeOfficeDocument,
  ]);

  return {
    nativeWriteError,
    setNativeWriteError,
    nativeMaterialization,
    nativeAttribution,
    setNativeAttribution,
    nativeProjectionReady,
    nativeProjectionOverrideRef,
    nativeConflict,
    setNativeConflict,
    applyExternalProjection,
    queueNativeMaterialization,
    reconcileNativeRevision,
  };
}
