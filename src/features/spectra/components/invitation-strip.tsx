"use client";

import { Loader2, ChevronDown, Mail, Share2, LayoutGrid } from "@/components/icons/glyph-icons";
import { cn } from "@/lib/utils";
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
  return (
    <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_5%,var(--bg-primary))]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-10 w-full items-center gap-2 px-4 text-left text-ui text-[var(--text-primary)]"
      >
        <Mail className="size-4 shrink-0 text-[var(--brand-primary)]" />
        <span className="font-medium">
          {invitations.length === 1
            ? "1 invitation is waiting for you"
            : `${invitations.length} invitations are waiting for you`}
        </span>
        <span className="text-[var(--text-secondary)]">
          Nothing appears in your Library until you accept.
        </span>
        <ChevronDown
          className={cn(
            "ml-auto size-4 shrink-0 text-[var(--text-tertiary)] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="max-h-[46vh] overflow-y-auto border-t border-[var(--border-subtle)] px-4 pb-4">
          <InvitationInbox
            invitations={invitations}
            busyKey={busyKey}
            onRespond={onRespond}
          />
        </div>
      ) : null}
    </div>
  );
}

function InvitationInbox({
  invitations,
  busyKey,
  onRespond,
}: {
  invitations: SpectraShareInvitation[];
  busyKey: string | null;
  onRespond: (invitationId: string, response: "accept" | "decline") => void;
}) {
  return (
    <section className="mt-4" aria-labelledby="share-invitations-title">
      <div className="mb-4">
        <h2
          id="share-invitations-title"
          className="font-display text-heading font-semibold text-[var(--text-primary)]"
        >
          Waiting for you
        </h2>
        <p className="mt-1 text-ui text-[var(--text-secondary)]">
          Nothing appears in Shared until you accept. You can review the
          requested access first.
        </p>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {invitations.map((invitation) => {
          const artifactMeta =
            invitation.resource.typeKey !== "workspace"
              ? workTypeMeta[invitation.resource.typeKey]
              : null;
          const Icon = artifactMeta?.icon ?? LayoutGrid;
          const working = busyKey === `invitation:${invitation.invitationId}`;
          return (
            <article
              key={invitation.invitationId}
              className="rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-sm)]"
            >
              <LifeKey id={`invitation:${invitation.invitationId}`} />
              <div className="flex items-start gap-3.5">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-[var(--bg-secondary)]"
                  style={{
                    color: artifactMeta?.color ?? "var(--text-secondary)",
                  }}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="truncate font-display text-heading font-semibold text-[var(--text-primary)]">
                      {invitation.resource.title}
                    </h3>
                    <span className="rounded-chip bg-[var(--bg-secondary)] px-1.5 py-0.5 text-micro font-medium text-[var(--text-secondary)]">
                      {invitation.resourceType === "workspace"
                        ? "Workspace"
                        : (artifactMeta?.label ?? "Work")}
                    </span>
                  </div>
                  <p className="mt-1 text-caption text-[var(--text-secondary)]">
                    <span className="font-medium text-[var(--text-primary)]">
                      {invitation.inviter?.name ?? "A school member"}
                    </span>{" "}
                    invited you with{" "}
                    {invitation.level === "modify" ? "modify" : "read-only"}{" "}
                    access.
                  </p>
                  {invitation.message ? (
                    <p className="mt-3 rounded-control border-l-2 border-[var(--border-strong)] bg-[var(--bg-secondary)] px-3 py-2 text-caption leading-5 text-[var(--text-secondary)]">
                      {invitation.message}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
                <button
                  type="button"
                  disabled={working}
                  onClick={() => onRespond(invitation.invitationId, "decline")}
                  className="h-8 rounded-control px-3 text-caption font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45"
                >
                  Decline
                </button>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => onRespond(invitation.invitationId, "accept")}
                  className="inline-flex h-8 items-center gap-2 rounded-control bg-[var(--text-primary)] px-3 text-caption font-medium text-[var(--bg-primary)] disabled:opacity-45"
                >
                  {working ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Share2 className="h-3.5 w-3.5" />
                  )}
                  Accept
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
