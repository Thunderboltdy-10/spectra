"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import { useAuthedArgs } from "../../data/use-authed-args";
import type { ShareAccess } from "./use-share-access";

/*
 * What sharing a workspace shares (workspaceSharing): its people see only the
 * works shared with it, each chosen in the Library, never everything at once
 * by accident. New work can start shared instead. A ManageBac class can be
 * invited whole; each student then sees the shared works inside their own
 * copy of the class.
 */
export function ShareWorkspaceWorks({
  workspaceId,
  access,
  level = "read",
}: {
  workspaceId: string;
  access: ShareAccess;
  /** What the class may do: view, unless everyone here can edit. */
  level?: "read" | "modify";
}) {
  const id = workspaceId as Id<"spectraWorkspaces">;
  const links = useQuery(api.workspaceSharing.links, useAuthedArgs({ workspaceId: id }));
  const setShareNewWork = useMutation(api.workspaceSharing.setShareNewWork);
  const inviteClass = useMutation(api.workspaceSharing.inviteClass);
  const [inviting, setInviting] = useState(false);
  if (!links?.own) return null;

  const toggle = async (shareNewWork: boolean) => {
    try {
      await setShareNewWork({ workspaceId: id, shareNewWork });
    } catch (error) {
      toast.error(describeFailure(error, { fallback: "The setting did not change." }).message);
    }
  };
  const invite = async () => {
    setInviting(true);
    try {
      const result = await inviteClass({ workspaceId: id, level });
      if (result.invited)
        toast.success(`Invited ${result.invited} ${result.invited === 1 ? "person" : "people"} from the class.`);
      else if (result.classSize) toast.success("Everyone in the class is already invited.");
      else toast.error("No one from this class is on Spectra yet.");
      await access.refresh(true);
    } catch (error) {
      toast.error(describeFailure(error, { fallback: "The class was not invited." }).message);
    } finally {
      setInviting(false);
    }
  };

  return (
    <section className="share-section">
      <h3 className="share-section-title">What they see</h3>
      <p className="share-quiet">
        Only the artifacts you share with this workspace. Pick them in the Library and choose Share; the rest stay yours.
      </p>
      <label className="share-switch-row">
        <span>
          New artifacts here start shared
          <span className="share-quiet">Off: each new artifact is private until you share it.</span>
        </span>
        <Switch checked={links.shareNewWork} onCheckedChange={(next) => void toggle(next)} />
      </label>
      {links.isClass ? (
        <div className="share-switch-row">
          <span>
            Invite the whole class
            <span className="share-quiet">{`Everyone in this ManageBac class, ${level === "modify" ? "able to edit" : "view only"}. It shows inside their own class.`}</span>
          </span>
          <Button variant="secondary" size="sm" disabled={inviting} onClick={() => void invite()}>
            {inviting ? "Inviting…" : "Invite the class"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
