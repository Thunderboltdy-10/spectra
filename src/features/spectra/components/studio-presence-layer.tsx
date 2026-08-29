"use client";

import { useMemo } from "react";
import type { ArtifactCollaborationTransport } from "../collaboration/types";
import { usePresence } from "../collaboration/scoped-hooks";
import type { InteractionState } from "../collaboration/interaction-model";
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
