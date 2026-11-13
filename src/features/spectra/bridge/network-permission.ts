"use client";

import { useEffect, useState } from "react";

/*
 * Chrome and Edge ask before a site may reach apps on this computer (Local
 * Network Access). Bridge answers on this computer, so a "Block" there looks
 * exactly like Bridge not running unless Spectra asks the browser itself.
 */

export type NetworkPermission = "granted" | "denied" | "prompt" | "unknown";

const NAMES = ["local-network-access", "loopback-network"];

async function queryPermission(): Promise<NetworkPermission> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
  for (const name of NAMES) {
    try {
      const status = await navigator.permissions.query({ name } as unknown as PermissionDescriptor);
      return status.state;
    } catch {
      // This browser doesn't know that name; try the next, or it has no such question.
    }
  }
  return "unknown";
}

/** The browser's answer for reaching this computer, kept current while the page is open. */
export function useNetworkPermission() {
  const [state, setState] = useState<NetworkPermission>("unknown");
  useEffect(() => {
    let live = true;
    const read = () => void queryPermission().then((next) => live && setState(next));
    read();
    window.addEventListener("focus", read);
    return () => {
      live = false;
      window.removeEventListener("focus", read);
    };
  }, []);
  return state;
}

/** Where to change the answer, in the words of the browser's own menus. */
export const NETWORK_PERMISSION_FIX =
  "Click the icon at the left of the address bar, open Site settings, and set Local network access to Allow. Then come back to this page.";
