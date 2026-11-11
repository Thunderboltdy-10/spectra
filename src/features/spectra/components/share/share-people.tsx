"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import { Check, ChevronRight, Loader2, X } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { LifeKey } from "@/components/ui/life-moments";
import { SelectField } from "@/components/ui/select";
import type { SpectraArtifactAccessRequest, SpectraInheritedAccessEntry } from "../../data/api";
import { SHARE_LEVEL_OPTIONS, levelLabel, type InheritedChoice, type ShareAccess, type ShareLevel, type ShareableResourceType } from "./use-share-access";

/*
 * Everyone who can open the thing: those asking to, those invited directly,
 * and, folded away, those who reach it through a workspace that holds it.
 * Each person is one line, their name first and what they can do at the end.
 */

const when = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

export function ShareRequests({ access }: { access: ShareAccess }) {
  if (!access.requests.length) return null;
  return (
    <section className="share-section" aria-labelledby="share-requests-title">
      <h3 id="share-requests-title" className="share-section-title">
        Asking for access
      </h3>
      <ul className="share-people">
        {access.requests.map((request) => (
          <AccessRequest key={request.requestId} request={request} access={access} />
        ))}
      </ul>
    </section>
  );
}

function AccessRequest({ request, access }: { request: SpectraArtifactAccessRequest; access: ShareAccess }) {
  const [level, setLevel] = useState<ShareLevel>(request.requestedLevel);
  const working = access.busyKey === `request:${request.requestId}`;
  const from = request.context ? `, from an embed in a ${request.context.containerType === "thread" ? "thread" : "artifact"}` : "";
  return (
    <li className="share-person share-person--request">
      <LifeKey id={`access-request:${request.requestId}`} />
      <div className="share-person-who">
        <span className="share-person-name">{request.requester?.name ?? "Someone who left your school"}</span>
        <span className="share-person-meta">
          Asked to {request.requestedLevel === "modify" ? "edit" : "view"} on {when.format(request.createdAt)}
          {from}
        </span>
        {request.message ? <q className="share-person-note">{request.message}</q> : null}
      </div>
      <div className="share-person-actions">
        <SelectField layer="modal" ariaLabel={`What ${request.requester?.name ?? "they"} can do`} value={level} disabled={working} onChange={(next) => setLevel(next as ShareLevel)} options={SHARE_LEVEL_OPTIONS} size="sm" triggerClassName="share-quiet-select" />
        <Button variant="ghost" size="sm" disabled={working} onClick={() => access.resolveRequest(request, "decline", level)}>
          Decline
        </Button>
        <Button variant="primary" size="sm" disabled={working} onClick={() => access.resolveRequest(request, "approve", level)}>
          {working ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Let in
        </Button>
      </div>
    </li>
  );
}

/** Everyone invited can edit: they are all collaborators. Off puts them all back to viewing. */
export function everyoneCanEdit(access: ShareAccess) {
  return access.shares.length > 0 && access.shares.every((share) => share.level === "modify");
}

export function ShareEveryoneCanEdit({
  access,
  resourceType,
  resourceId,
}: {
  access: ShareAccess;
  resourceType: ShareableResourceType;
  resourceId: string;
}) {
  const setEveryone = useMutation(api.sharingPeople.setEveryoneCanEdit);
  const [busy, setBusy] = useState(false);
  if (!access.shares.length) return null;
  const on = everyoneCanEdit(access);
  const toggle = async (canEdit: boolean) => {
    setBusy(true);
    try {
      await setEveryone({ resourceType, resourceId, canEdit });
      toast.success(canEdit ? "Everyone can edit now." : "Everyone can view only now.");
      await access.refresh(true);
    } catch (error) {
      toast.error(describeFailure(error, { fallback: "Who can edit did not change." }).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="share-switch-row">
      <span>
        Everyone can edit
        <span className="share-quiet">
          {on ? "Everyone here is a collaborator. People you invite next can edit too." : "Off: people can open and read it. Give one person edit above, or everyone here."}
        </span>
      </span>
      <Switch checked={on} disabled={busy} onCheckedChange={(next) => void toggle(next)} />
    </label>
  );
}

export function SharePeople({ access }: { access: ShareAccess }) {
  return (
    <section className="share-section" aria-labelledby="share-people-title">
      <h3 id="share-people-title" className="share-section-title">
        Who has access
      </h3>
      {access.loading && !access.shares.length ? (
        <p className="share-quiet" role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading who has access
        </p>
      ) : access.shares.length === 0 ? (
        <p className="share-quiet">Only you, so far. People you invite appear here once they accept.</p>
      ) : (
        <ul className="share-people">
          {access.shares.map((share) => {
            const pending = share.status === "pending";
            const removing = access.busyKey === `remove:${share.invitationId}`;
            const name = share.account?.name ?? "Someone who left your school";
            return (
              <li key={share.invitationId} className="share-person" data-pending={pending || undefined}>
                <LifeKey id={`share:${share.invitationId}`} />
                <div className="share-person-who">
                  <span className="share-person-name">{name}</span>
                  <span className="share-person-meta">{pending ? `Invited to ${share.level === "modify" ? "edit" : "view"}, not accepted yet` : share.account?.email}</span>
                </div>
                <div className="share-person-actions">
                  {pending ? (
                    <span className="share-person-level">{levelLabel(share.level)}</span>
                  ) : (
                    <SelectField layer="modal" ariaLabel={`What ${name} can do`} value={share.level} disabled={access.busyKey === `level:${share.invitationId}`} onChange={(next) => access.changeLevel(share, next as ShareLevel)} options={SHARE_LEVEL_OPTIONS} size="sm" triggerClassName="share-quiet-select" />
                  )}
                  <button type="button" className="share-person-remove" disabled={removing} onClick={() => access.remove(share)} aria-label={pending ? `Withdraw the invitation to ${name}` : `Remove ${name}`}>
                    {removing ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** People who reach a work through a workspace that holds it, narrowed here without changing the workspace. */
export function ShareInherited({ access }: { access: ShareAccess }) {
  const [open, setOpen] = useState(false);
  if (!access.inherited.length) return null;
  const count = access.inherited.length;
  return (
    <section className="share-section share-fold" data-open={open || undefined}>
      <button type="button" className="share-fold-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronRight className="size-3.5" aria-hidden />
        Through workspaces
        <span>{count === 1 ? "1 person" : `${count} people`}</span>
      </button>
      {open ? (
        <>
          <p className="share-quiet">They can open this because a workspace that holds it is shared with them. Narrowing it here leaves the workspace as it is.</p>
          <ul className="share-people">
            {access.inherited.map((entry) => (
              <InheritedPerson key={entry.account.accountId} entry={entry} access={access} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function InheritedPerson({ entry, access }: { entry: SpectraInheritedAccessEntry; access: ShareAccess }) {
  const selected: InheritedChoice = entry.exception?.effect === "deny" ? "none" : entry.exception?.effect === "restrict" ? "read" : "default";
  const through = entry.sources.map((source) => source.workspaceTitle).join(", ");
  return (
    <li className="share-person">
      <div className="share-person-who">
        <span className="share-person-name">{entry.account.name}</span>
        <span className="share-person-meta">
          Through {through}
          {entry.directLevel ? `, and invited here to ${entry.directLevel === "modify" ? "edit" : "view"}` : ""}
        </span>
      </div>
      <div className="share-person-actions">
        <SelectField
          layer="modal"
          ariaLabel={`What ${entry.account.name} can do here`}
          value={selected}
          disabled={access.busyKey === `inherited:${entry.account.accountId}`}
          onChange={(next) => access.setInheritedAccess(entry, next as InheritedChoice)}
          options={[
            { value: "default", label: levelLabel(entry.inheritedLevel) },
            ...(entry.inheritedLevel === "modify" ? [{ value: "read", label: "View only here" }] : []),
            { value: "none", label: "Not here" },
          ]}
          size="sm"
          triggerClassName="share-quiet-select"
        />
      </div>
    </li>
  );
}
