"use client";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { api } from "../../../../convex/_generated/api";
import type { BridgeFile } from "../bridge/client";
import { useAuthedArgs } from "../data/use-authed-args";
import { PlaceInMenu } from "./place-in-menu";

/** Files chosen that Spectra already has: nothing to redo, only where to put them. */
export function AlreadySyncedNotice({ files, onDismiss }: { files: BridgeFile[]; onDismiss: () => void }) {
  const found = useQuery(api.bridge.syncedNodes, useAuthedArgs({ items: files }));
  const items = (found ?? []).flatMap((node) => (node ? [{ nodeId: node.nodeId, name: node.name }] : []));
  const name = files.length === 1 ? (files[0]!.relativePath.split("/").pop() ?? "That file") : `${files.length} of those files`;
  return (
    <div role="status" className="device-already">
      <p className="min-w-0 flex-1 text-ui text-[var(--text-primary)]">
        {name} {files.length === 1 ? "is" : "are"} already in Spectra. Add {files.length === 1 ? "it" : "them"} anywhere you like.
      </p>
      <PlaceInMenu items={items} emptyHint="Still syncing. Try again in a moment." onPlaced={onDismiss}>
        <Button variant="primary" size="sm">
          Add to…
        </Button>
      </PlaceInMenu>
      <IconButton icon="close" label="Dismiss" size="compact" onClick={onDismiss} />
    </div>
  );
}
