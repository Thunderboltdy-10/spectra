"use client";

import { useCallback } from "react";
import { useConvex } from "convex/react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { runLocalDeviceAction } from "../devices/device-actions";
import { DEVICES_HREF, type BridgeFile, type BridgeFilesSelected } from "./client";
import { placeWhenSynced } from "./place-synced";
import { useBridgeHealth } from "./use-bridge";

/*
 * Syncing from the computer the student is on, from wherever they make things
 * (the Library's New menu). With Bridge connected here the native picker opens
 * on the desktop; otherwise Devices opens to connect this computer first.
 * Syncing keeps the files on the computer and in Spectra, unlike importing,
 * which copies a file into Spectra once.
 *
 * Asked from inside a workspace or folder, what was chosen ends up there too,
 * whether it just arrived or was already in Spectra.
 */
export function useFolderSync() {
  const bridge = useBridgeHealth();
  const router = useRouter();
  const convex = useConvex();
  const connected = bridge.state === "connected";
  const sync = useCallback(
    async (targetNodeId?: string | null) => {
      if (!connected) return router.push(`${DEVICES_HREF}?connect=1`);
      toast("Choose a folder in the window that opened on your computer.");
      const outcome = await runLocalDeviceAction({ action: "add_folder" });
      if (outcome.status === "failed") return void toast.error(outcome.message);
      if (outcome.status !== "completed") return;
      const grantId = (outcome.data as { grantId?: string | null } | undefined)?.grantId;
      if (targetNodeId && grantId) void placeWhenSynced(convex, [{ grantId, relativePath: "" }], targetNodeId);
      toast.success(
        targetNodeId
          ? "The folder is syncing and will appear here."
          : "The folder is syncing. Its files appear in your Library as they arrive.",
      );
    },
    [connected, convex, router],
  );
  const syncFiles = useCallback(
    async (targetNodeId?: string | null) => {
      if (!connected) return router.push(`${DEVICES_HREF}?connect=1&select=files`);
      toast("Choose one or more files in the window that opened on your computer.");
      const outcome = await runLocalDeviceAction({ action: "add_files" });
      if (outcome.status === "failed") return void toast.error(outcome.message);
      if (outcome.status !== "completed") return;
      const files = outcome.data as BridgeFilesSelected | undefined;
      const chosen: BridgeFile[] = files ? [...files.added, ...files.existing] : [];
      if (!targetNodeId || !chosen.length) return void toast.success(outcome.message);
      toast.success(chosen.length === 1 ? "That file will appear here." : `Those ${chosen.length} files will appear here.`);
      void placeWhenSynced(convex, chosen, targetNodeId);
    },
    [connected, convex, router],
  );
  return { connected, sync, syncFiles };
}
