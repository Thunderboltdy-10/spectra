"use client";

import { useSyncExternalStore } from "react";
import type {
  ArtifactCollaborationTransport,
  CollaborationSyncSnapshot,
  PresencePreviewSnapshot,
} from "./types";
import {
  EMPTY_PRESENCE,
  EMPTY_PREVIEW_SNAPSHOT,
  EMPTY_SYNC_SNAPSHOT,
} from "./scoped-snapshots";

const subscribeClosed = () => () => undefined;
const getClosedSync = () => EMPTY_SYNC_SNAPSHOT;
const getClosedPresence = () => EMPTY_PRESENCE;
const getClosedPreview = () => EMPTY_PREVIEW_SNAPSHOT;

export function useSyncState(
  transport: ArtifactCollaborationTransport | null | undefined,
): CollaborationSyncSnapshot {
  return useSyncExternalStore(
    transport?.subscribeSync ?? subscribeClosed,
    transport?.getSyncSnapshot ?? getClosedSync,
    getClosedSync,
  );
}

export function usePresence(
  transport: ArtifactCollaborationTransport | null | undefined,
) {
  return useSyncExternalStore(
    transport?.subscribePresence ?? subscribeClosed,
    transport?.getPresenceSnapshot ?? getClosedPresence,
    getClosedPresence,
  );
}

export function usePresencePreview(
  transport: ArtifactCollaborationTransport | null | undefined,
): PresencePreviewSnapshot {
  return useSyncExternalStore(
    transport?.subscribePresencePreview ?? subscribeClosed,
    transport?.getPresencePreviewSnapshot ?? getClosedPreview,
    getClosedPreview,
  );
}
