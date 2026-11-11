"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ShareInvite } from "./share/share-invite";
import { ShareLink } from "./share/share-link";
import { ShareWorkspaceWorks } from "./share/share-workspace";
import { ShareEveryoneCanEdit, ShareInherited, SharePeople, ShareRequests, everyoneCanEdit } from "./share/share-people";
import { useShareAccess, type ShareableResourceType } from "./share/use-share-access";

/*
 * Sharing one workspace, work or agent: invite people from the school, see
 * and change who has access, and make a read-only link for anyone. Invited
 * people choose whether to accept, so nothing lands in their Library unasked.
 */

const NOUN: Record<ShareableResourceType, string> = { workspace: "workspace", artifact: "work", agent: "agent" };

export function ShareDialog({
  open,
  resourceType,
  resourceId,
  title,
  onClose,
  onChanged,
  beforeShare,
}: {
  open: boolean;
  resourceType: ShareableResourceType;
  resourceId: string;
  title: string;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
  /** A work kept on this computer: it moves online with the first invitation or link, and the dialog says so first. */
  beforeShare?: () => Promise<void>;
}) {
  const access = useShareAccess({ open, resourceType, resourceId, onChanged, beforeShare });
  const hasAccess = useMemo(
    () => new Set(access.shares.flatMap((share) => (share.account ? [share.account.accountId] : []))),
    [access.shares],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="share-dialog max-w-[540px] gap-0 p-0">
        <header className="share-head">
          <DialogTitle className="share-head-title">Share {title}</DialogTitle>
          <DialogDescription className="share-quiet">
            {resourceType === "workspace"
              ? "Invite people from your school. Once they accept, what you share in it shows in their Library, inside their own class when it is the same one."
              : `Invite people from your school. They can open and read the ${NOUN[resourceType]} once they accept; you choose who can edit.`}
            {beforeShare ? " It is kept on this computer now, so inviting someone or making a link moves it online for them to open." : null}
          </DialogDescription>
        </header>
        <div className="share-body">
          <ShareInvite access={access} hasAccess={hasAccess} defaultLevel={everyoneCanEdit(access) ? "modify" : "read"} />
          <ShareRequests access={access} />
          <SharePeople access={access} />
          <ShareEveryoneCanEdit access={access} resourceType={resourceType} resourceId={resourceId} />
          {resourceType === "workspace" ? (
            <ShareWorkspaceWorks workspaceId={resourceId} access={access} level={everyoneCanEdit(access) ? "modify" : "read"} />
          ) : null}
          {resourceType !== "workspace" ? <ShareInherited access={access} /> : null}
          <ShareLink access={access} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
