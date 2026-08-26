"use client";

import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

/**
 * Product-wide connectivity (UX-3). One source: the browser's online signal.
 * Collaboration transport and Bridge health are separate truths that the
 * presenter may layer on; they must not impersonate this one.
 */
export function useProductOnline() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
