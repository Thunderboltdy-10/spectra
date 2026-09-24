"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  canonicalJsonEqual,
  type ArtifactLiveValue,
} from "../collaboration/artifact-yjs-model";
import type { ReplicaTruth } from "../bridge/status";
import { spectraBus } from "../events";
import {
  nativeMaterializationStale,
  nativeMaterializationVerified,
} from "../bridge/native-materialization-exit";
import {
  nativeMaterializationRequest,
  nativeLiveContentKey,
  nativeLiveNeedsPromotion,
} from "../lenses/native-live-promotion";
import type { RecentNativeOperation } from "../lenses/native-reconciliation";
import type { NativeSaveReceipt } from "../../../../shared/native-office-contract";
import { syncRetryDelayMs } from "../../../../shared/sync-retry-policy";

export type NativeMaterialization =
  | { state: "queueing"; artifactId: string }
  | { state: "pending"; artifactId: string; hash: string; receipt?: NativeSaveReceipt };

type NativeMaterializationRetry = {
  artifactId: string;
  contentKey: string;
  attempt: number;
};

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
  flushSnapshot?: () => ArtifactLiveValue | null;
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

function isRetryableMaterializationError(error: unknown) {
  if (error instanceof TypeError) return true;
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { retryable?: unknown }).retryable === true,
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
  protectedOriginal?: boolean;
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
  recentOperations,
  bridgeAvailable,
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
  recentOperations?: readonly RecentNativeOperation[];
  bridgeAvailable?: boolean;
  conflicts:
    | readonly {
        regionIds: string[];
        partNames: string[];
        previews?: NativeConflict["previews"];
      }[]
    | undefined;
  setContent: (content: unknown) => void;
  setBaseline: (snapshot: EditorSnapshot) => void;
  setDirty: (dirty: boolean) => void;
}) {
  const [nativeWriteError, setNativeWriteError] = useState<string>();
  const [nativeMaterialization, setNativeMaterialization] =
    useState<NativeMaterialization>();
  const [nativeMaterializationRetry, setNativeMaterializationRetry] =
    useState<NativeMaterializationRetry>();
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
  const lastPromotedLiveKeyRef = useRef<string | undefined>(undefined);
  const lastFailedPromotionKeyRef = useRef<string | undefined>(undefined);
  const nativeMaterializationInFlightRef = useRef(new Set<string>());
  const nativeMaterializationRetryAttemptsRef = useRef(new Map<string, number>());
  const activeArtifactIdRef = useRef(artifactId);
  activeArtifactIdRef.current = artifactId;
  const currentNativeMaterialization =
    nativeMaterialization?.artifactId === artifactId
      ? nativeMaterialization
      : undefined;
  const bridgeWasAvailableRef = useRef(bridgeAvailable !== false);

  useEffect(() => {
    lastPromotedLiveKeyRef.current = undefined;
    lastFailedPromotionKeyRef.current = undefined;
    setNativeWriteError(undefined);
    setNativeMaterialization(undefined);
    setNativeMaterializationRetry(undefined);
    setNativeConflict(null);
    nativeMaterializationRetryAttemptsRef.current.clear();
  }, [artifactId]);

  useEffect(() => {
    if (bridgeAvailable !== false && !bridgeWasAvailableRef.current) {
      lastFailedPromotionKeyRef.current = undefined;
    }
    bridgeWasAvailableRef.current = bridgeAvailable !== false;
  }, [bridgeAvailable]);

  const applyExternalProjection = useCallback(
    async (
      projection: unknown,
      attribution = `Edited in ${nativeOfficeApplication}`,
    ) => {
      nativeProjectionOverrideRef.current = projection;
      const nextValue = { ...live.liveValue, content: projection };
      const applied = await live.synchronize(nextValue);
      if (typeof window !== "undefined") {
        const target = window as Window & {
          __spectraNativeProjection?: Array<Record<string, unknown>>;
        };
        const log = (target.__spectraNativeProjection ??= []);
        log.push({
          event: "applyExternalProjection",
          applied: !syncRejected(applied),
          rejected: syncRejected(applied),
          blockCount: Array.isArray(
            (projection as { blocks?: unknown[] } | null)?.blocks,
          )
            ? (projection as { blocks: unknown[] }).blocks.length
            : null,
          hasWordMarker: JSON.stringify(projection).includes("RCV1WORDNATIVE"),
          at: Date.now(),
        });
        if (log.length > 40) log.splice(0, log.length - 40);
      }
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
          receipt?: NativeSaveReceipt;
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
          spectraBus.emit("artifact.lensActivated", { artifactId, projection });
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
    if (canonicalJsonEqual(live.modelSnapshot.value.content, refreshedContent))
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
      if (nativeMaterializationInFlightRef.current.has(artifactId)) return;
      nativeMaterializationInFlightRef.current.add(artifactId);
      const contentKey = nativeLiveContentKey(snapshot.content);
      setNativeMaterialization({ state: "queueing", artifactId });
      setNativeMaterializationRetry(undefined);
      setNativeWriteError(undefined);
      try {
        const endpoint = nativeWordDocument
          ? "/api/spectra/lenses/docx"
          : "/api/spectra/lenses/office";
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The Yjs update is durably acknowledged. The route checkpoints that
          // shared log and materializes its canonical projection server-side.
          body: JSON.stringify(nativeMaterializationRequest(artifactId)),
        });
        const result = (await response.json().catch(() => null)) as {
          hash?: string;
          message?: string;
          state?: string;
          receipt?: NativeSaveReceipt;
          conflict?: NativeConflict;
        } | null;
        if (!response.ok) {
          const error = new Error(
            result?.message ??
              `This edit could not be written safely to the ${nativeOfficeApplication} file.`,
          );
          Object.assign(error, {
            retryable:
              response.status === 408 ||
              response.status === 425 ||
              response.status === 429 ||
              response.status >= 500,
          });
          throw error;
        }
        // cloud_saved / deferred_native: Spectra kept the edit; there is no
        // local Bridge replica (or no retained native payload URL yet). Do not
        // toast NATIVE_PAYLOAD_UNAVAILABLE as a false Word/Office writeback.
        if (
          result?.state === "unchanged" ||
          result?.state === "cloud_saved" ||
          result?.state === "deferred_native"
        ) {
          nativeMaterializationRetryAttemptsRef.current.delete(contentKey);
          if (activeArtifactIdRef.current !== artifactId) return;
          lastPromotedLiveKeyRef.current = nativeLiveContentKey(
            snapshot.content,
          );
          lastFailedPromotionKeyRef.current = undefined;
          setNativeMaterialization(undefined);
          return;
        }
        if (result?.state === "conflicted") {
          nativeMaterializationRetryAttemptsRef.current.delete(contentKey);
          if (activeArtifactIdRef.current !== artifactId) return;
          lastPromotedLiveKeyRef.current = nativeLiveContentKey(
            snapshot.content,
          );
          lastFailedPromotionKeyRef.current = undefined;
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
            `The ${nativeOfficeApplication} write was queued without a verifiable hash.`,
          );
        nativeMaterializationRetryAttemptsRef.current.delete(contentKey);
        if (activeArtifactIdRef.current !== artifactId) return;
        lastPromotedLiveKeyRef.current = nativeLiveContentKey(snapshot.content);
        lastFailedPromotionKeyRef.current = undefined;
        setNativeMaterialization({
          state: "pending",
          artifactId,
          hash: result.hash,
          receipt: result.receipt,
        });
      } catch (error) {
        if (activeArtifactIdRef.current === artifactId) {
          lastFailedPromotionKeyRef.current = contentKey;
          setNativeMaterialization(undefined);
          setNativeWriteError(
            error instanceof Error
              ? error.message
              : `This edit could not be written safely to the ${nativeOfficeApplication} file.`,
          );
          if (isRetryableMaterializationError(error)) {
            const attempt =
              (nativeMaterializationRetryAttemptsRef.current.get(contentKey) ?? 0) + 1;
            nativeMaterializationRetryAttemptsRef.current.set(contentKey, attempt);
            if (attempt <= 8)
              setNativeMaterializationRetry({ artifactId, contentKey, attempt });
          }
        }
      } finally {
        nativeMaterializationInFlightRef.current.delete(artifactId);
      }
    },
    [
      artifactId,
      nativeOfficeApplication,
      nativeOfficeDocument,
      nativeWordDocument,
    ],
  );

  useEffect(() => {
    if (
      nativeProjectionOverrideRef.current !== undefined &&
      canonicalJsonEqual(
        live.liveValue.content,
        nativeProjectionOverrideRef.current,
      )
    ) {
      nativeProjectionOverrideRef.current = undefined;
    }
  }, [live.liveValue.content]);

  useEffect(() => {
    const onLensActivated = (detail: {
      artifactId: string;
      projection?: unknown;
    }) => {
      if (detail.artifactId !== artifactId || !detail.projection || dirty)
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
    return spectraBus.on("artifact.lensActivated", onLensActivated);
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
      if (result?.state === "applied" && result.projection) {
        await applyExternalProjection(
          result.projection,
          result.attribution ?? `Edited in ${nativeOfficeApplication}`,
        );
        setNativeConflict(null);
      } else if (result?.state === "current" && result.projection && resolution) {
        await applyExternalProjection(
          result.projection,
          result.attribution ?? `Edited in ${nativeOfficeApplication}`,
        );
        setNativeConflict(null);
      }
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
        .sort(
          (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
        )[0]
    : undefined;
  const nativeCloudReplica = nativeOfficeDocument
    ? replicas?.find((replica) => replica.kind === "cloud")
    : undefined;

  useEffect(() => {
    if (!nativeMaterializationRetry) return;
    if (nativeMaterializationRetry.artifactId !== artifactId) return;
    const liveValue = live.modelSnapshot.value;
    const contentKey = nativeLiveContentKey(liveValue?.content);
    if (contentKey !== nativeMaterializationRetry.contentKey) {
      nativeMaterializationRetryAttemptsRef.current.delete(
        nativeMaterializationRetry.contentKey,
      );
      setNativeMaterializationRetry(undefined);
      return;
    }
    if (
      dirty ||
      live.unsynchronizedChanges > 0 ||
      !live.modelSnapshot.initialized ||
      live.modelSnapshot.validity !== "valid" ||
      nativeLocalReplica?.state === "pending"
    )
      return;
    const timer = window.setTimeout(() => {
      setNativeMaterializationRetry(undefined);
      lastFailedPromotionKeyRef.current = undefined;
      if (liveValue) void queueNativeMaterialization(liveValue);
    },
    syncRetryDelayMs(
      nativeMaterializationRetry.attempt,
      `native-materialization:${artifactId}:${nativeMaterializationRetry.contentKey}`,
    ));
    return () => window.clearTimeout(timer);
  }, [
    artifactId,
    dirty,
    live.modelSnapshot.initialized,
    live.modelSnapshot.validity,
    live.modelSnapshot.value,
    live.unsynchronizedChanges,
    nativeLocalReplica?.state,
    nativeMaterializationRetry,
    queueNativeMaterialization,
  ]);

  useEffect(() => {
    if (!nativeOfficeDocument || !nativeLocalReplica) return;
    if (currentNativeMaterialization || dirty || live.unsynchronizedChanges > 0)
      return;
    if (
      !live.modelSnapshot.initialized ||
      live.modelSnapshot.validity !== "valid"
    )
      return;
    if (nativeLocalReplica.state === "pending") return;
    const liveValue = live.modelSnapshot.value;
    if (!liveValue?.content) return;
    const contentKey = nativeLiveContentKey(liveValue.content);
    if (
      !nativeLiveNeedsPromotion({
        initialized: true,
        dirty: false,
        nativeActivity: false,
        unsynchronized: false,
        localReplicaPending: false,
        operations: recentOperations,
        contentKey,
        lastAttemptedKey: lastPromotedLiveKeyRef.current,
        bridgeAvailable,
        lastFailedKey: lastFailedPromotionKeyRef.current,
        protectedOriginal: nativeLocalReplica.protectedOriginal === true,
      })
    )
      return;
    void queueNativeMaterialization(liveValue);
  }, [
    bridgeAvailable,
    dirty,
    live.modelSnapshot.initialized,
    live.modelSnapshot.validity,
    live.modelSnapshot.value,
    live.unsynchronizedChanges,
    nativeLocalReplica,
    currentNativeMaterialization,
    nativeOfficeDocument,
    queueNativeMaterialization,
    recentOperations,
  ]);

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
      currentNativeMaterialization ||
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
    currentNativeMaterialization,
    nativeOfficeApplication,
    nativeOfficeDocument,
    nativeCloudReplica,
    reconcileNativeRevision,
  ]);

  useEffect(() => {
    if (!currentNativeMaterialization || !nativeLocalReplica) return;
    if (
      nativeMaterializationVerified(currentNativeMaterialization, nativeLocalReplica)
    ) {
      setNativeMaterialization(undefined);
      setNativeAttribution("Saved locally");
    } else if (
      nativeMaterializationStale(currentNativeMaterialization, nativeLocalReplica)
    ) {
      setNativeMaterialization(undefined);
    }
  }, [nativeLocalReplica, currentNativeMaterialization]);

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
    setNativeConflict((current) =>
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
  }, [
    conflicts,
    nativeOfficeApplication,
    nativeOfficeDocument,
    persistedNativeConflict,
  ]);

  useEffect(() => {
    if (
      !nativeOfficeDocument ||
      !reconcilableLocalRevision ||
      (dirty && nativeLocalReplica?.state !== "ahead") ||
      (live.unsynchronizedChanges > 0 &&
        nativeLocalReplica?.state !== "ahead") ||
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
    nativeMaterialization: currentNativeMaterialization,
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
