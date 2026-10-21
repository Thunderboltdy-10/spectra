"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { Copy, ExternalLink } from "@/components/icons/glyph-icons";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import { copySpectraArtifact } from "../data/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { spectraBus } from "../events";
import { LibraryNote, pickable, type WorkPicking } from "./library-note";
import type { TreeNode } from "./tree-client";

/*
 * Works other people shared into this place (workspaceSharing.sharedWorks):
 * a teacher's Physics shown inside the student's own Physics class, or a
 * workspace shared with you, opened. Each author's works sit under their
 * name. They open like any work, read-only unless the author gave edit. Their
 * menu has only what a reader may do: open, or make a copy of their own.
 */

type SharedGroup = {
  workspaceId: string;
  title: string;
  author: string;
  level: "read" | "modify";
  works: Array<TreeNode & { author: string; accessLevel: "read" | "modify" }>;
};

export function useSharedWorks(workspaceId: string | undefined) {
  const groups = useQuery(
    api.workspaceSharing.sharedWorks,
    useAuthedArgs(workspaceId ? { workspaceId: workspaceId as Id<"spectraWorkspaces"> } : "skip"),
  ) as SharedGroup[] | undefined;
  return groups ?? [];
}

/** Copy a work as the reader's own, into the place they are looking at. */
export async function copyWorkHere(artifactId: string, place: { workspaceId?: string; parentNodeId?: string } = {}) {
  try {
    await copySpectraArtifact(artifactId, place);
    spectraBus.emit("workspace.refreshRequested", {});
    toast.success("Copied. The copy is yours alone.");
  } catch (error) {
    toast.error(describeFailure(error, { fallback: "The copy was not made." }).message);
  }
}

export function SharedWorkGroups({
  groups,
  place,
  workspaceId,
  now,
  onOpen,
  picking,
}: {
  groups: readonly SharedGroup[];
  workspaceId?: string;
  /** The place these show in; a group from a workspace of another name says which. */
  place: string;
  now: number;
  onOpen: (node: TreeNode) => void;
  picking?: WorkPicking;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  return (
    <>
      {menu ? (
        <DropdownMenu open onOpenChange={(open) => (open ? undefined : setMenu(null))}>
          <DropdownMenuTrigger asChild>
            <span aria-hidden style={{ position: "fixed", left: menu.x, top: menu.y, width: 0, height: 0 }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" sideOffset={2} className="w-[200px]">
            <DropdownMenuItem onSelect={() => onOpen(menu.node)}>
              <ExternalLink className="size-3.5 text-[var(--text-tertiary)]" />
              Open
            </DropdownMenuItem>
            {menu.node.sourceId ? (
              <DropdownMenuItem onSelect={() => void copyWorkHere(menu.node.sourceId as string, { workspaceId })}>
                <Copy className="size-3.5 text-[var(--text-tertiary)]" />
                Make a copy
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {groups.map((group) => (
        <section key={group.workspaceId} aria-label={`From ${group.author}`} className="shared-works">
          <h3 className="library-shelf-heading">
            From {group.author} {group.works.length ? <span className="school-heading-count">{group.works.length}</span> : null}
          </h3>
          <p className="shared-works-note">
            {group.title !== place ? `Shared in ${group.title}. ` : ""}
            {group.level === "modify" ? "You can edit what is shared here." : "Read only."}
          </p>
          {group.works.length ? (
            <ul className="library-notes">
              {group.works.map((node) => (
                <li key={node.nodeId}>
                  <LibraryNote
                    node={node}
                    place={null}
                    where={node.accessLevel === "modify" ? "You can edit" : undefined}
                    now={now}
                    onOpen={picking && pickable(node) ? picking.toggle : onOpen}
                    onMenu={(event, node) => {
                      event.preventDefault();
                      setMenu({ x: event.clientX, y: event.clientY, node });
                    }}
                    picked={picking && pickable(node) ? picking.has(node) : undefined}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="class-shelf-quiet">Nothing shared yet. What {group.author} shares in {group.title} shows here.</p>
          )}
        </section>
      ))}
    </>
  );
}
