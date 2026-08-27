export type NativeWriteProgress =
  | { state: "queueing" }
  | { state: "pending"; hash: string };

type NativeLocalReplica = {
  state: string;
  contentHash?: string;
};

/** In-flight native writes retire when Bridge verifies them, or when disk
 * moved (Word save / failed write) so Syncing cannot hide Keep Spectra. */
export function nativeMaterializationVerified(
  materialization: NativeWriteProgress | undefined,
  local: NativeLocalReplica | undefined,
) {
  return Boolean(
    materialization?.state === "pending" &&
      local?.state === "current" &&
      local.contentHash === materialization.hash,
  );
}

export function nativeMaterializationStale(
  materialization: NativeWriteProgress | undefined,
  local: NativeLocalReplica | undefined,
) {
  if (!materialization || materialization.state !== "pending" || !local) return false;
  if (local.state === "error" || local.state === "diverged" || local.state === "ahead")
    return true;
  return Boolean(local.contentHash && local.contentHash !== materialization.hash);
}
