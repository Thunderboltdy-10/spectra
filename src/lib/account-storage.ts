import { useSpectraContextStore } from "@/stores/spectra-context-store";
import { clearRunLedger } from "@/features/spectra/collaboration/run-ledger";

const ACCOUNT_LOCAL_PREFIXES = [
  "spectra.context.",
  "spectra:shared-workbench:",
  "spectra.library.",
  "spectra.workspace.",
  "spectra:compute:",
  "spectra:preferences:",
  "spectra.bridge.",
];

function removeMatching(storage: Storage, prefixes: readonly string[]) {
  for (const key of Object.keys(storage))
    if (prefixes.some((prefix) => key.startsWith(prefix))) storage.removeItem(key);
}

export function clearAccountScopedStorage() {
  if (typeof window === "undefined") return;
  try {
    useSpectraContextStore.setState(useSpectraContextStore.getInitialState(), true);
    removeMatching(window.localStorage, ACCOUNT_LOCAL_PREFIXES);
    for (const key of Object.keys(window.sessionStorage))
      if (key.startsWith("spectra.") || key.startsWith("spectra:"))
        window.sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
  clearRunLedger();
  try {
    if (typeof indexedDB !== "undefined")
      indexedDB.deleteDatabase("spectra-yjs-room-v1");
  } catch {
    // A blocked database is retried by the next account transition.
  }
  try {
    if (typeof caches !== "undefined")
      void caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("spectra-"))
            .map((key) => caches.delete(key)),
        ),
      );
  } catch {
    // Cache storage is optional and must not block sign-out.
  }
}

/** Persisted database IDs can be restored only by their deployment/account. */
export function bindAccountStorageScope(scope: string) {
  if (typeof window === "undefined") return;
  const key = "spectra:account-storage-scope:v1";
  try {
    if (window.localStorage.getItem(key) === scope) return;
    clearAccountScopedStorage();
    window.localStorage.setItem(key, scope);
  } catch {
    clearAccountScopedStorage();
  }
}
