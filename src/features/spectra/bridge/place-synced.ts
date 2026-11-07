import type { ConvexReactClient } from "convex/react";
import { toast } from "@/components/ui/toast";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { treeFailureMessage } from "../organization/tree-client";
import type { BridgeFile } from "./client";

const POLL_MS = 2_500;
const GIVE_UP_MS = 5 * 60_000;

/**
 * Put files that sync through Bridge in a workspace or folder. Those already in
 * Spectra go straight there. Those still arriving are placed as they appear:
 * they get read on the computer first, so nothing can name them yet. Leaving
 * the page does not cancel this, and a file that never arrives is still in the
 * Library when it does, just not placed.
 */
export async function placeWhenSynced(
  convex: ConvexReactClient,
  files: readonly BridgeFile[],
  targetNodeId: string,
): Promise<void> {
  let waiting = files.slice(0, 100);
  const startedAt = Date.now();
  while (waiting.length && Date.now() - startedAt < GIVE_UP_MS) {
    const found = await convex.query(api.bridge.syncedNodes, { items: waiting }).catch(() => null);
    const stillWaiting: BridgeFile[] = [];
    for (const [index, file] of waiting.entries()) {
      const node = found?.[index];
      if (!node) {
        stillWaiting.push(file);
        continue;
      }
      try {
        await convex.mutation(api.orgTree.createReference, {
          targetNodeId: node.nodeId as Id<"orgNodes">,
          parentId: targetNodeId,
        });
      } catch (error) {
        toast.error(treeFailureMessage(error, `Couldn't add ${node.name} here.`));
      }
    }
    waiting = stillWaiting;
    if (waiting.length) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
