"use client";

import { useConvex } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { toast } from "@/components/ui/toast";
import { describeFailure } from "@/components/ui/truthful-state";
import { copySpectraArtifact } from "../data/api";
import { spectraBus } from "../events";
import { treeFailureMessage, useTreeActions, type TreeNode } from "./tree-client";

/*
 * Sending folders and works to another workspace from their menu (LIBRARY.md,
 * "Workspaces"). Moving keeps everything as it is, a Bridge folder still tied
 * to its folder on disk. Duplicating leaves the original where it was and
 * builds the same folders there, with a copy of each work: copies are plain
 * Spectra artifacts, tied to no file on disk.
 */

/** Where things can be sent: a workspace's own place, or the Library outside every workspace. */
export type Destination = { nodeId: string | null; name: string; workspaceId?: string };

/** The kinds a copy can be made of; anything else is placed as a reference. */
const COPYABLE = new Set(["document", "flashcard_deck", "quiz", "presentation", "sheets", "code", "whiteboard"]);

/** More than this in one duplicate is better done as a move, or in parts. */
const MOST_COPIED = 200;

export function useWorkspaceTransfer() {
  const convex = useConvex();
  const actions = useTreeActions();

  const moveTo = async (nodes: readonly TreeNode[], to: Destination) => {
    try {
      await actions.move(nodes.map((node) => node.nodeId), to.nodeId);
      toast.success(`Moved to ${to.name}.`);
    } catch (error) {
      toast.error(treeFailureMessage(error, "That move did not go through."));
    }
  };

  const duplicateTo = async (nodes: readonly TreeNode[], to: Destination) => {
    const id = `duplicate:${nodes.map((node) => node.nodeId).join(",")}`;
    toast.message(`Duplicating to ${to.name}…`, { id, duration: Infinity });
    let made = 0;
    let skipped = 0;
    let referenced = 0;
    const copyWork = async (node: TreeNode, parentNodeId: string | null, keepTitle: boolean) => {
      try {
        // An uploaded file is one file wherever it shows: the copy refers to it.
        if (!node.sourceId || !COPYABLE.has(node.typeKey ?? "")) {
          await actions.createReference(node.nodeId, parentNodeId);
          referenced += 1;
          return;
        }
        await copySpectraArtifact(node.sourceId, { workspaceId: to.workspaceId, parentNodeId: parentNodeId ?? "root", keepTitle });
        made += 1;
      } catch {
        skipped += 1;
      }
    };
    try {
      for (const picked of nodes) {
        // A reference duplicates what it stands for, under the reference's name.
        const node: TreeNode =
          picked.kind === "link" && picked.target?.available
            ? { ...picked, kind: picked.target.kind, nodeId: picked.target.nodeId, sourceId: picked.target.sourceId }
            : picked;
        if (node.kind === "work") {
          await copyWork(node, to.nodeId, false);
          continue;
        }
        if (node.kind !== "folder") {
          skipped += 1;
          continue;
        }
        const tree = await convex.query(api.orgTree.subtree, { nodeId: node.nodeId, limit: MOST_COPIED + 1 });
        if (!tree) throw new Error("That folder is no longer there.");
        if (tree.truncated || tree.nodes.length > MOST_COPIED)
          throw new Error(`${node.name} holds more than ${MOST_COPIED} items. Move it instead, or duplicate its folders one at a time.`);
        const inside = tree.nodes as unknown as TreeNode[];
        const childrenOf = new Map<string, TreeNode[]>();
        for (const child of inside) {
          if (!child.parentId) continue;
          childrenOf.set(child.parentId, [...(childrenOf.get(child.parentId) ?? []), child]);
        }
        const copyFolder = async (folder: TreeNode, parentId: string | null) => {
          const created = await actions.createFolder(folder.name, parentId);
          made += 1;
          for (const child of childrenOf.get(folder.nodeId) ?? []) {
            if (child.kind === "folder") await copyFolder(child, created.nodeId);
            else if (child.kind === "work") await copyWork(child, created.nodeId, true);
            else skipped += 1;
          }
        };
        await copyFolder(node, to.nodeId);
      }
      spectraBus.emit("workspace.refreshRequested", {});
      toast.success(`Duplicated to ${to.name}.`, {
        id,
        duration: 6000,
        description:
          [
            referenced ? `${referenced} uploaded ${referenced === 1 ? "file shows" : "files show"} there as a reference to the original.` : "",
            skipped ? `${skipped} ${skipped === 1 ? "item" : "items"} could not be copied (references, tasks and agents stay where they are).` : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined,
      });
    } catch (error) {
      toast.error(describeFailure(error, { fallback: "The duplicate was not finished." }).message, {
        id,
        duration: 6000,
        description: made ? `${made} ${made === 1 ? "item was" : "items were"} already copied to ${to.name}.` : undefined,
      });
    }
  };

  return { moveTo, duplicateTo };
}
