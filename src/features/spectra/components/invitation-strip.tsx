"use client";

import { Check, ChevronDown, LayoutGrid, Loader2, Mail } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { LifeKey } from "@/components/ui/life-moments";
import { workTypeMeta } from "./artifact-card";
import type { SpectraShareInvitation } from "../data/api";

/**
 * Share invitations, and the strip that announces them.
 *
 * Nothing shared with a reader appears anywhere in their Library until they
 * accept it, so the invitation has to be visible from the surface where they
 * would otherwise go looking for the thing — and it has to say that plainly,
 * because "it is not there yet" and "it was never shared" look identical.
 */
export function InvitationStrip({
  invitations,
  open,
  busyKey,
  onToggle,
  onRespond,
}: {
  invitations: SpectraShareInvitation[];
  open: boolean;
  busyKey: string | null;
  onToggle: () => void;
  onRespond: (invitationId: string, response: "accept" | "decline") => void;
}) {
  const count = invitations.length;
  return (
    <section className="invitation-strip" data-open={open || undefined} aria-label="Invitations waiting for you">
      <button type="button" onClick={onToggle} aria-expanded={open} className="invitation-strip-toggle">
        <Mail className="size-4" aria-hidden />
        <strong>{count === 1 ? "Something was shared with you" : `${count} things were shared with you`}</strong>
        <span>Nothing appears in your Library until you accept.</span>
        <ChevronDown className="invitation-strip-chevron size-4" aria-hidden />
      </button>
      {open ? (
        <ul className="invitation-strip-list">
          {invitations.map((invitation) => (
            <InvitationLine
              key={invitation.invitationId}
              invitation={invitation}
              working={busyKey === `invitation:${invitation.invitationId}`}
              onRespond={onRespond}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function InvitationLine({
  invitation,
  working,
  onRespond,
}: {
  invitation: SpectraShareInvitation;
  working: boolean;
  onRespond: (invitationId: string, response: "accept" | "decline") => void;
}) {
  const meta = invitation.resource.typeKey !== "workspace" ? workTypeMeta[invitation.resource.typeKey] : null;
  const Icon = meta?.icon ?? LayoutGrid;
  const kind = invitation.resourceType === "workspace" ? "a workspace" : `a ${(meta?.label ?? "work").toLowerCase()}`;
  return (
    <li className="invitation-line">
      <LifeKey id={`invitation:${invitation.invitationId}`} />
      <Icon className="invitation-line-glyph size-[18px]" style={{ color: meta?.color }} aria-hidden />
      <div className="invitation-line-what">
        <strong>{invitation.resource.title}</strong>
        <span>
          {invitation.inviter?.name ?? "Someone in your school"} shared {kind} for you to {invitation.level === "modify" ? "edit" : "view"}
        </span>
        {invitation.message ? <q>{invitation.message}</q> : null}
      </div>
      <div className="invitation-line-actions">
        <Button variant="ghost" size="sm" disabled={working} onClick={() => onRespond(invitation.invitationId, "decline")}>
          Decline
        </Button>
        <Button variant="primary" size="sm" disabled={working} onClick={() => onRespond(invitation.invitationId, "accept")}>
          {working ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Accept
        </Button>
      </div>
    </li>
  );
}
