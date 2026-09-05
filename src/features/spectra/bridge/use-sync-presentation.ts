"use client";

import { useMemo } from "react";
import { useNow } from "@/hooks/use-now";
import {
  presentSync,
  replicaDisclosure,
  replicaHasNativeLock,
  type PresentSyncInput,
  type ReplicaTruth,
  type SyncPresentation,
} from "./status";
import { useProductOnline } from "./use-product-online";

export type ReplicaTruthSource = {
  replicas: readonly ReplicaTruth[];
  openConflictCount: number;
  pendingCount: number;
} | null | undefined;

/**
 * One presenter for every surface that speaks about sync (ARCHITECTURE-TRUTH §5).
 * Aging of "last verified" is a render concern: the clock ticks here so a
 * frozen timestamp cannot outlive the truth it describes (ST-1).
 */
export function useSyncPresentation(
  replicaTruth: ReplicaTruthSource,
  rest: Omit<
    PresentSyncInput,
    "replicas" | "openConflictCount" | "replicaPendingCount" | "online"
  > & { online?: boolean } = {},
): SyncPresentation & { disclosure: string[] } {
  const productOnline = useProductOnline();
  const now = useNow(30_000);
  const replicas = useMemo(
    () => replicaTruth?.replicas ?? [],
    [replicaTruth?.replicas],
  );
  const presentation = useMemo(
    () =>
      presentSync({
        replicas,
        openConflictCount: replicaTruth?.openConflictCount ?? 0,
        replicaPendingCount: replicaTruth?.pendingCount ?? 0,
        online: rest.online ?? productOnline,
        queuedChangeCount: rest.queuedChangeCount,
        transportState: rest.transportState,
        transportError: rest.transportError,
        dirty: rest.dirty,
        nativeActivity: rest.nativeActivity,
        nativeBridgeAvailable: rest.nativeBridgeAvailable,
        readOnly: rest.readOnly,
        protectedOriginal: rest.protectedOriginal,
        collaborative: rest.collaborative,
      }),
    [
      productOnline,
      replicaTruth?.openConflictCount,
      replicaTruth?.pendingCount,
      replicas,
      rest.collaborative,
      rest.dirty,
      rest.nativeActivity,
      rest.nativeBridgeAvailable,
      rest.online,
      rest.protectedOriginal,
      rest.queuedChangeCount,
      rest.readOnly,
      rest.transportError,
      rest.transportState,
    ],
  );
  const disclosure = useMemo(
    () =>
      replicaDisclosure(replicas, now || Date.now(), {
        nativeActivity: rest.nativeActivity,
        nativeLocked: replicas.some(replicaHasNativeLock),
      }),
    [now, replicas, rest.nativeActivity],
  );
  return { ...presentation, disclosure };
}
