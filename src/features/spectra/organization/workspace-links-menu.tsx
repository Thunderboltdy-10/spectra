"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { OverflowMenu, type OverflowItem } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import { useAuthedArgs } from "../data/use-authed-args";

/*
 * Which shared workspaces show inside this one, changed at any time
 * (workspaceSharing.links). In your own workspace: show a workspace someone
 * shared with you here, or stop. In a workspace shared with you: show it
 * inside one of yours, or on its own again. Nothing is copied either way.
 */
export function WorkspaceLinksMenu({ workspaceId, size = 32 }: { workspaceId: string; size?: number }) {
  const router = useRouter();
  const links = useQuery(api.workspaceSharing.links, useAuthedArgs({ workspaceId: workspaceId as Id<"spectraWorkspaces"> }));
  const link = useMutation(api.workspaceSharing.link);
  const unlink = useMutation(api.workspaceSharing.unlink);
  if (!links) return null;

  const items: OverflowItem[] = [];
  if (links.own) {
    for (const row of links.linked)
      items.push({ key: `unlink:${row.workspaceId}`, label: `Stop showing ${row.title} here`, icon: "close", hint: row.author });
    for (const row of links.candidates)
      items.push({
        key: `link:${row.workspaceId}`,
        label: `Show ${row.title} here`,
        icon: "link",
        hint: row.linkedInto ? `now in ${row.linkedInto}` : row.author,
      });
    // Nothing shared with you yet: no control until there is something to show here.
    if (!items.length) return null;
  } else if (links.linkedInto) {
    items.push({ key: `open:${links.linkedInto.workspaceId}`, label: `Showing inside ${links.linkedInto.title}`, icon: "arrowRight" });
    items.push({ key: `unlink:${workspaceId}`, label: "Show on its own instead", icon: "close" });
  } else {
    for (const place of links.places.slice(0, 8))
      items.push({ key: `into:${place.workspaceId}`, label: `Show inside ${place.title}`, icon: "link", hint: place.sameClass ? "same class" : undefined });
  }

  const choose = async (key: string) => {
    const [action, id] = key.split(":") as [string, string];
    try {
      if (action === "open") router.push(`/workspace/${id}`);
      else if (action === "unlink") {
        await unlink({ linkedWorkspaceId: id as Id<"spectraWorkspaces"> });
        toast.success("It shows on its own again.");
      } else if (action === "link") {
        await link({ workspaceId: workspaceId as Id<"spectraWorkspaces">, linkedWorkspaceId: id as Id<"spectraWorkspaces"> });
        toast.success("Its shared works show here now.");
      } else if (action === "into") {
        await link({ workspaceId: id as Id<"spectraWorkspaces">, linkedWorkspaceId: workspaceId as Id<"spectraWorkspaces"> });
        toast.success("Its shared works show inside your workspace now.");
      }
    } catch (error) {
      toast.error(describeFailure(error, { fallback: "The link did not change." }).message);
    }
  };

  return (
    <OverflowMenu
      label={links.own ? "Shared workspaces shown here" : "Where this shows"}
      icon="link"
      items={items}
      onSelect={(key) => void choose(key)}
      active={links.own ? links.linked.length > 0 : Boolean(links.linkedInto)}
      size={size}
    />
  );
}
