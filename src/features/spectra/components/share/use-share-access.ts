"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
import { readConvexError } from "../../../../../shared/convex-error.mjs";
import {
  getSpectraArtifactAccessRequests,
  getSpectraInheritedAudience,
  getSpectraPublicLinks,
  getSpectraShareState,
  postSpectra,
  type SpectraArtifactAccessRequest,
  type SpectraInheritedAccessEntry,
  type SpectraPublicLinkEntry,
  type SpectraSchoolMember,
  type SpectraShareEntry,
} from "../../data/api";

/*
 * Who can open one workspace, work or agent, and every change to it. The
 * dialog's sections only show this and call its actions; each action says
 * what happened in a toast and rereads the access, so no section keeps its
 * own copy of the truth.
 */

export type ShareableResourceType = "workspace" | "artifact" | "agent";
export type ShareLevel = "read" | "modify";
export type InheritedChoice = "default" | "read" | "none";

export const SHARE_LEVEL_OPTIONS = [
  { value: "read", label: "Can view" },
  { value: "modify", label: "Can edit" },
] as const;

export function levelLabel(level: ShareLevel) {
  return level === "modify" ? "Can edit" : "Can view";
}

/** Access changes seldom while the dialog is open; returning to it rereads. */
const QUIET_REFRESH_MS = 30_000;

function failure(error: unknown, fallback: string) {
  return readConvexError(error).message || (error instanceof Error ? error.message : fallback);
}

export function useShareAccess({
  open,
  resourceType,
  resourceId,
  onChanged,
}: {
  open: boolean;
  resourceType: ShareableResourceType;
  resourceId: string;
  onChanged?: () => void | Promise<void>;
}) {
  const [shares, setShares] = useState<SpectraShareEntry[]>([]);
  const [publicLinks, setPublicLinks] = useState<SpectraPublicLinkEntry[]>([]);
  const [inherited, setInherited] = useState<SpectraInheritedAccessEntry[]>([]);
  const [requests, setRequests] = useState<SpectraArtifactAccessRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const work = resourceType !== "workspace";

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const [shareResult, linkResult, inheritedResult, requestResult] = await Promise.all([
          getSpectraShareState(resourceType, resourceId),
          getSpectraPublicLinks(resourceType, resourceId),
          work ? getSpectraInheritedAudience(resourceId) : Promise.resolve({ audience: [] }),
          work ? getSpectraArtifactAccessRequests(resourceId) : Promise.resolve({ requests: [] }),
        ]);
        setShares(shareResult.shares);
        setPublicLinks(linkResult.publicLinks);
        setInherited(inheritedResult.audience);
        setRequests(requestResult.requests);
      } catch (error) {
        if (!quiet) toast.error(failure(error, "Could not read who has access."));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [resourceId, resourceType, work],
  );

  useEffect(() => {
    if (!open) return;
    void refresh();
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const interval = window.setInterval(refreshVisible, QUIET_REFRESH_MS);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [open, refresh]);

  /** One change: marks its control busy, writes, rereads, and says how it went. */
  const change = useCallback(
    async <T,>(key: string, write: () => Promise<T>, done: string | ((result: T) => string), fallback: string) => {
      setBusyKey(key);
      try {
        const result = await write();
        await refresh(true);
        await onChanged?.();
        toast.success(typeof done === "function" ? done(result) : done);
        return result;
      } catch (error) {
        toast.error(failure(error, fallback));
        return undefined;
      } finally {
        setBusyKey(null);
      }
    },
    [onChanged, refresh],
  );

  const invite = useCallback(
    (people: SpectraSchoolMember[], level: ShareLevel, message: string) =>
      change(
        "invite",
        async () => {
          // One invitation each: a person already invited elsewhere still gets theirs.
          for (const person of people) {
            await postSpectra({
              action: "inviteShare",
              resourceType,
              resourceId,
              inviteeAccountId: person.accountId,
              level,
              message: message.trim() || undefined,
            });
          }
          return people;
        },
        (sent) => (sent.length === 1 ? `Invitation sent to ${sent[0]!.name}.` : `Invitations sent to ${sent.length} people.`),
        "Could not send the invitation.",
      ),
    [change, resourceId, resourceType],
  );

  const changeLevel = useCallback(
    (share: SpectraShareEntry, level: ShareLevel) => {
      if (share.level === level || share.status !== "accepted") return;
      void change(
        `level:${share.invitationId}`,
        () => postSpectra({ action: "changeShareLevel", invitationId: share.invitationId, level }),
        `${share.account?.name ?? "They"} ${level === "modify" ? "can edit now" : "can view only now"}.`,
        "Could not change their access.",
      );
    },
    [change],
  );

  const remove = useCallback(
    (share: SpectraShareEntry) => {
      const pending = share.status === "pending";
      void change(
        `remove:${share.invitationId}`,
        () =>
          pending
            ? postSpectra({ action: "revokePendingShareInvitation", invitationId: share.invitationId })
            : postSpectra({ action: "revokeShareAccess", resourceType, resourceId, grantId: share.grantId }),
        pending ? "Invitation withdrawn." : "Access removed.",
        "Could not remove their access.",
      );
    },
    [change, resourceId, resourceType],
  );

  const resolveRequest = useCallback(
    (request: SpectraArtifactAccessRequest, decision: "approve" | "decline", level: ShareLevel) => {
      void change(
        `request:${request.requestId}`,
        () =>
          postSpectra({
            action: "resolveArtifactAccessRequest",
            requestId: request.requestId,
            decision,
            ...(decision === "approve" ? { level } : {}),
          }),
        decision === "approve" ? "Access given." : "Request declined.",
        "Could not answer this request.",
      );
    },
    [change],
  );

  const setInheritedAccess = useCallback(
    (entry: SpectraInheritedAccessEntry, next: InheritedChoice) => {
      const accountId = entry.account.accountId;
      void change(
        `inherited:${accountId}`,
        () =>
          next === "default"
            ? postSpectra({ action: "clearArtifactAccessException", artifactId: resourceId, accountId })
            : postSpectra({
                action: "setArtifactAccessException",
                artifactId: resourceId,
                accountId,
                effect: next === "none" ? "deny" : "restrict",
              }),
        next === "none"
          ? `${entry.account.name} can no longer open this.`
          : next === "read"
            ? `${entry.account.name} can only view this now.`
            : `${entry.account.name} has their workspace access again.`,
        "Could not change their access.",
      );
    },
    [change, resourceId],
  );

  /** Makes a read-only link; its address is shown once, so it comes back here. */
  const createLink = useCallback(
    async (expiresInDays: number | null) => {
      const result = await change(
        "link:create",
        () =>
          postSpectra<{ url: string }>({
            action: "createPublicLink",
            resourceType,
            resourceId,
            expiresAt: expiresInDays === null ? undefined : Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
          }),
        "Link made. Copy it now: it is shown only once.",
        "Could not make the link.",
      );
      return result ? new URL(result.url, window.location.origin).toString() : null;
    },
    [change, resourceId, resourceType],
  );

  const revokeLink = useCallback(
    (link: SpectraPublicLinkEntry) =>
      change(`link:${link.linkId}`, () => postSpectra({ action: "revokePublicLink", linkId: link.linkId }), "Link turned off.", "Could not turn the link off."),
    [change],
  );

  /** A link Spectra made in one of the user's runs: the server derives its address again for the run's owner. */
  const copySpectraLink = useCallback(async (link: SpectraPublicLinkEntry) => {
    if (!link.madeBySpectra) return;
    setBusyKey(`link:copy:${link.linkId}`);
    try {
      const result = await postSpectra<{ url: string }>({
        action: "revealAiPublicLink",
        runId: link.madeBySpectra.runId,
        operationId: link.madeBySpectra.operationId,
      });
      await navigator.clipboard.writeText(new URL(result.url, window.location.origin).toString());
      toast.success("Public link copied.");
    } catch (error) {
      toast.error(readConvexError(error).message || "Could not copy the link. Make a new one here instead.");
    } finally {
      setBusyKey(null);
    }
  }, []);

  return {
    refresh,
    shares,
    publicLinks,
    inherited,
    requests,
    loading,
    busyKey,
    invite,
    changeLevel,
    remove,
    resolveRequest,
    setInheritedAccess,
    createLink,
    revokeLink,
    copySpectraLink,
  };
}

export type ShareAccess = ReturnType<typeof useShareAccess>;
