"use client";

import { useCallback, useEffect, useState } from "react";
import { spectraBus } from "../events";
import {
  getSpectraShareInvitations,
  type SpectraShareInvitation,
} from "../data/api";

/**
 * Invitations are their own subscription, not a field of the overview.
 *
 * Nothing shared with this reader exists anywhere in their tree until they
 * accept, so the invitation cannot be derived from the work they already
 * have — and the overview reloads on every workspace switch, which is no
 * reason to re-ask the server about invitations.
 *
 * The panel opens for `?collection=invitations` and for every Review from a
 * notification ("invitations.review"), even when the URL has not changed
 * because the reader is already here and collapsed the panel.
 */
export function useShareInvitations(invitationCollection: boolean) {
  const [shareInvitations, setShareInvitations] = useState<
    SpectraShareInvitation[]
  >([]);
  const [invitationsOpen, setInvitationsOpen] = useState(invitationCollection);
  const refreshInvitations = useCallback(async (force = false) => {
    const result = await getSpectraShareInvitations({ force }).catch(() => null);
    if (result) setShareInvitations(result.invitations);
  }, []);
  useEffect(() => {
    void refreshInvitations();
    const stopChanged = spectraBus.on("notifications.changed", () => {
      void refreshInvitations(true);
    });
    const stopReview = spectraBus.on("invitations.review", () => {
      setInvitationsOpen(true);
      void refreshInvitations(true);
    });
    return () => {
      stopChanged();
      stopReview();
    };
  }, [refreshInvitations]);
  useEffect(() => {
    if (!invitationCollection) return;
    setInvitationsOpen(true);
    void refreshInvitations(true);
  }, [invitationCollection, refreshInvitations]);
  return {
    shareInvitations,
    invitationsOpen,
    setInvitationsOpen,
    refreshInvitations,
  };
}
