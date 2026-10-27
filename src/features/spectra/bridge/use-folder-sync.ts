"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { runLocalDeviceAction } from "../devices/device-actions";
import { DEVICES_HREF } from "./client";
import { useBridgeHealth } from "./use-bridge";

/*
 * Syncing a folder from the computer the student is on, from wherever they
 * make things (the Library's New menu). With Bridge connected here the folder
 * picker opens on the desktop; otherwise Devices opens to connect this
 * computer first. Syncing keeps the files on the computer and in Spectra,
 * unlike importing, which copies a file into Spectra once.
 */
export function useFolderSync() {
  const bridge = useBridgeHealth();
  const router = useRouter();
  const connected = bridge.state === "connected";
  const sync = useCallback(async () => {
    if (!connected) return router.push(`${DEVICES_HREF}?connect=1`);
    toast("Choose a folder in the window that opened on your computer.");
    const outcome = await runLocalDeviceAction({ action: "add_folder" });
    if (outcome.status === "failed") toast.error(outcome.message);
    else toast.success("The folder is syncing. Its files appear in your Library as they arrive.");
  }, [connected, router]);
  const syncFiles = useCallback(async () => {
    if (!connected) return router.push(`${DEVICES_HREF}?connect=1&select=files`);
    toast("Choose one or more files in the window that opened on your computer.");
    const outcome = await runLocalDeviceAction({ action: "add_files" });
    if (outcome.status === "failed") toast.error(outcome.message);
    else if (outcome.status === "completed") toast.success(outcome.message);
  }, [connected, router]);
  return { connected, sync, syncFiles };
}
