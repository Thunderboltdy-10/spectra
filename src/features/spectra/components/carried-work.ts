import { spectraObjectKey, useSpectraContextStore } from "@/stores/spectra-context-store";

/**
 * The work open beside the page, if any. It stays open when the page changes
 * (another page, or a thread going full screen): the next page opens it again
 * beside itself instead of starting empty.
 */
export function carriedSplitWorkId(): string | null {
  const state = useSpectraContextStore.getState();
  const active = state.openObjects.find(
    (row) => spectraObjectKey(row) === state.activeOpenObjectKey,
  );
  if (active?.type === "artifact" && active.presentation === "split") return active.id;
  const split = state.openObjects.find((row) => row.type === "artifact" && row.presentation === "split");
  return split?.id ?? null;
}
