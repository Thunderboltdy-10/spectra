"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactCollaborationTransport } from "../collaboration/types";
import { usePresence } from "../collaboration/scoped-hooks";
import type { InteractionState } from "../collaboration/interaction-model";
import {
  SurfaceField,
  useActivityField,
  type FieldInfluence,
} from "../field/surface-field";
import type { StudioPresentationState } from "../bridge/status";
import {
  CollaborationCursorLayer,
  CollaborationPresenceIndicator,
} from "./collaboration-presence";
import { InteractionLayer } from "./presence/interaction-layer";
import type { ArtifactCommentRegion } from "./artifact-comments-panel";

export function StudioLegacyCursorLayer({
  transport,
  currentAccountId,
  currentDisplayName,
}: {
  transport: ArtifactCollaborationTransport | null | undefined;
  currentAccountId?: string;
  currentDisplayName?: string;
}) {
  const presence = usePresence(transport);
  const legacyPresence = useMemo(
    () => presence.filter((person) => !person.interactionState),
    [presence],
  );
  return (
    <CollaborationCursorLayer
      presence={legacyPresence}
      currentClientId={transport?.clientId}
      currentAccountId={currentAccountId}
      currentDisplayName={currentDisplayName}
    />
  );
}

export function StudioInteractionLayer({
  transport,
}: {
  transport: ArtifactCollaborationTransport | null | undefined;
}) {
  const presence = usePresence(transport);
  const localClientId = transport?.clientId;
  const remoteInteractionStates = useMemo<InteractionState[]>(
    () =>
      presence
        .filter((person) => person.clientId !== localClientId)
        .map((person) => person.interactionState)
        .filter((state): state is InteractionState => Boolean(state)),
    [localClientId, presence],
  );
  return (
    <InteractionLayer
      states={remoteInteractionStates}
      localClientId={localClientId}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The work surface's field, driven by what is actually happening on it.
 *
 * The surface itself carries the quiet lattice (the same material the cards
 * and the dock are made of). Two real event sources wake it, and nothing
 * else does:
 *
 *   presence — a collaborator's or an AI run's published interaction state
 *     resolves through `useActivityField` to the exact region being worked,
 *     in the actor's own colour. This is the same awareness feed the cursor
 *     layer reads, so the field can never disagree with the cursors.
 *   sync — when the presenter's state leaves saving/pending and lands on a
 *     durable truth (saved/live), the surface answers with one restrained
 *     convergence near the header that reported it, then lets go.
 *
 * Idle cost is a compositor-only drift; there is no render loop here. When
 * nobody else is on the artifact and no save is completing, the influence
 * list is empty and this component re-renders only when presence changes.
 * ------------------------------------------------------------------ */

/** The converge keyframe resolves in 900ms; the node leaves shortly after. */
const SYNC_COMPLETION_LINGER_MS = 1250;

/**
 * A one-shot field wake for a completed save/sync transition. Returns an
 * empty list while idle; a fresh influence id per completion so back-to-back
 * saves each get their own convergence.
 */
export function useSyncCompletionField(
  state: StudioPresentationState | undefined,
): FieldInfluence[] {
  const [pulse, setPulse] = useState(0);
  const previous = useRef(state);
  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    const wasWorking = was === "saving" || was === "pending";
    const landed = state === "saved" || state === "live";
    if (!wasWorking || !landed) return;
    setPulse((count) => count + 1);
    const timer = window.setTimeout(
      () => setPulse(0),
      SYNC_COMPLETION_LINGER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [state]);
  return useMemo<FieldInfluence[]>(() => {
    if (!pulse) return [];
    return [
      {
        /* A fresh id per pulse remounts the wake node, so the one-shot
           converge animation fires for every completion, not just the
           first. */
        id: `sync-completion-${pulse}`,
        /* High and to the right — directly beneath the header corner where
           the save state itself is reported. */
        x: 0.82,
        y: 0.1,
        radius: 0.34,
        strength: 0.55,
        hue: "var(--success)",
        state: "success",
      },
    ];
  }, [pulse]);
}

/** A sync transition is visible while it is true, not only after it lands. */
export function fieldForSyncState(
  state: StudioPresentationState | undefined,
): FieldInfluence | null {
  if (state === "saving" || state === "pending") {
    return {
      id: "sync-transition",
      x: 0.82,
      y: 0.1,
      radius: 0.3,
      strength: state === "saving" ? 0.34 : 0.24,
      hue: "var(--accent-cyan)",
      state: "waiting",
    };
  }
  if (state === "error") {
    return {
      id: "sync-transition",
      x: 0.82,
      y: 0.1,
      radius: 0.3,
      strength: 0.3,
      hue: "var(--danger)",
      state: "failure",
    };
  }
  if (state === "offline") {
    return {
      id: "sync-transition",
      x: 0.82,
      y: 0.1,
      radius: 0.26,
      strength: 0.14,
      hue: "var(--text-tertiary)",
      state: "waiting",
    };
  }
  return null;
}

export function StudioActivityField({
  transport,
  surfaceRef,
  syncState,
}: {
  transport: ArtifactCollaborationTransport | null | undefined;
  surfaceRef: React.RefObject<HTMLElement | null>;
  syncState?: StudioPresentationState;
}) {
  const presence = usePresence(transport);
  const localClientId = transport?.clientId;
  const remoteInteractionStates = useMemo<InteractionState[]>(
    () =>
      presence
        .filter((person) => person.clientId !== localClientId)
        .map((person) => person.interactionState)
        .filter((state): state is InteractionState => Boolean(state)),
    [localClientId, presence],
  );
  const activity = useActivityField(surfaceRef, remoteInteractionStates, {
    localClientId,
  });
  const sync = useSyncCompletionField(syncState);
  const transition = fieldForSyncState(syncState);
  const influences = useMemo(
    () => [...activity, ...(transition ? [transition] : []), ...sync],
    [activity, sync, transition],
  );
  return (
    <SurfaceField
      influences={influences}
      scale="stage"
      grain="wave"
      depth
      behind
    />
  );
}

export function StudioPresenceIndicator({
  transport,
  currentAccountId,
  currentDisplayName,
  regions,
  onFocusPresence,
}: {
  transport: ArtifactCollaborationTransport | null | undefined;
  currentAccountId?: string;
  currentDisplayName?: string;
  regions: readonly ArtifactCommentRegion[];
  onFocusPresence?: React.ComponentProps<
    typeof CollaborationPresenceIndicator
  >["onFocusPresence"];
}) {
  const presence = usePresence(transport);
  const localClientId = transport?.clientId;
  const collaboratorCount = presence.filter(
    (person) => person.clientId !== localClientId,
  ).length;
  if (collaboratorCount === 0) return null;
  return (
    <CollaborationPresenceIndicator
      presence={presence}
      currentClientId={localClientId}
      currentAccountId={currentAccountId}
      currentDisplayName={currentDisplayName}
      regions={regions}
      onFocusPresence={onFocusPresence}
    />
  );
}
