"use client";

import { useState } from "react";
import Image from "next/image";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Copy, Share2, Users } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { describeFailure } from "@/components/ui/truthful-state";
import { useAuthedArgs } from "../../data/use-authed-args";

/*
 * Who has this work, from its own header (sharingPeople.forArtifact): the
 * author, everyone it is shared with and what each can do. Shown only once it
 * is shared. Its author also sees who has made changes, and can let everyone
 * edit or open Share; a reader is offered a copy of their own.
 */

const ROLE = { owner: "Owner", edit: "Can edit", view: "Can view" } as const;

export function SharedPeopleButton({
  artifactId,
  onShare,
  onCopy,
}: {
  artifactId: string;
  onShare?: () => void;
  onCopy?: () => void;
}) {
  const people = useQuery(api.sharingPeople.forArtifact, useAuthedArgs({ artifactId: artifactId as Id<"spectraArtifacts"> }));
  const setEveryone = useMutation(api.sharingPeople.setEveryoneCanEdit);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!people?.shared) return null;

  const others = people.people.filter((person) => person.role !== "owner");
  const everyoneEdits = others.length > 0 && others.every((person) => person.role === "edit");
  const count = people.people.length;
  const label = people.schoolWide ? "Shared with your school" : `Shared with ${count - 1} ${count === 2 ? "person" : "people"}`;

  const toggle = async (canEdit: boolean) => {
    setBusy(true);
    try {
      await setEveryone({ resourceType: "artifact", resourceId: artifactId, canEdit });
      toast.success(canEdit ? "Everyone can edit now." : "Everyone can view only now.");
    } catch (error) {
      toast.error(describeFailure(error, { fallback: "Who can edit did not change." }).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip label={label} side="bottom">
        <PopoverTrigger asChild>
          <button type="button" className="shared-people-button" aria-label={`${label}. Who has this`}>
            <Users className="size-4" aria-hidden />
            <span className="tabular-nums">{people.schoolWide ? "School" : count}</span>
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="shared-people w-[20rem] p-0" aria-label="Who has this">
        <header className="shared-people-head">
          <h3>Who has this</h3>
          <p>
            {people.isOwner
              ? "You wrote it. Only you see its history."
              : people.myLevel === "modify"
                ? "You can edit it, and so can Spectra for you."
                : "You can read it. A copy of your own you can change."}
          </p>
        </header>
        <ul className="shared-people-list">
          {people.people.map((person) => (
            <li key={person.accountId}>
              <span className="shared-people-face" aria-hidden>
                {person.avatarUrl ? <Image src={person.avatarUrl} alt="" width={26} height={26} unoptimized /> : <Users className="size-3.5" />}
              </span>
              <span className="shared-people-who">
                <span className="shared-people-name">{person.name}</span>
                <span className="shared-people-meta">
                  {[person.through ? `Through ${person.through}` : null, person.edited ? "Has made changes" : null].filter(Boolean).join(". ")}
                </span>
              </span>
              <span className="shared-people-role" data-role={person.role}>
                {ROLE[person.role]}
              </span>
            </li>
          ))}
        </ul>
        {people.schoolWide ? (
          <p className="shared-people-school">
            Everyone at your school {people.schoolWide.level === "modify" ? "can edit" : "can view"}
            {people.schoolWide.through ? `, through ${people.schoolWide.through}` : ""}.
          </p>
        ) : null}
        {people.canShare ? (
          <footer className="shared-people-foot">
            {others.length ? (
              <label className="share-switch-row">
                <span>
                  Everyone can edit
                  <span className="share-quiet">Makes everyone here a collaborator.</span>
                </span>
                <Switch checked={everyoneEdits} disabled={busy} onCheckedChange={(next) => void toggle(next)} />
              </label>
            ) : null}
            {onShare ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onShare();
                }}
              >
                <Share2 className="size-3.5" /> Share…
              </Button>
            ) : null}
          </footer>
        ) : people.myLevel !== "modify" && onCopy ? (
          <footer className="shared-people-foot">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpen(false);
                onCopy();
              }}
            >
              <Copy className="size-3.5" /> Make a copy
            </Button>
          </footer>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
