import type { SyncPolicyPreset } from "./sync-policy";

export type StorageStrategyFacts = {
  hasCloud: boolean;
  cloudHasPayload: boolean;
  hasActiveLocal: boolean;
  localIsVerified: boolean;
  replicasAgree: boolean;
  hasProtectedPending: boolean;
};

export type StorageStrategyPlan = {
  requiresLocal: boolean;
  requiresCloud: boolean;
  localAction: "retain" | "materialize" | "unlink";
  cloudAction: "retain" | "metadata-only";
  protectedOriginal: boolean;
  completion: "verified" | "pending";
  requiresCloudMaterialization: boolean;
};

export function planStorageStrategyTransition(
  toPreset: SyncPolicyPreset,
  facts: StorageStrategyFacts,
): StorageStrategyPlan {
  const requiresLocal = toPreset === "device" || toPreset === "both" || toPreset === "linked";
  const requiresCloud = toPreset !== "device";
  // A local-only work can gain its first cloud replica as part of the
  // transition. The Bridge upload is the operation that creates/verifies that
  // replica, so requiring it here would make F6 impossible in this direction.
  const canCreateCloudFromLocal =
    !facts.hasCloud && facts.hasActiveLocal && toPreset !== "device";
  if (requiresLocal && !facts.hasActiveLocal && !facts.hasCloud)
    throw new Error("STORAGE_STRATEGY_LOCAL_TARGET_REQUIRED");
  if (requiresLocal && facts.hasActiveLocal && !facts.localIsVerified)
    throw new Error("STORAGE_STRATEGY_LOCAL_NOT_VERIFIED");
  if (
    facts.hasCloud &&
    facts.cloudHasPayload &&
    facts.hasActiveLocal &&
    !facts.replicasAgree
  )
    throw new Error("STORAGE_STRATEGY_RECONCILIATION_REQUIRED");
  if (requiresCloud && !facts.hasCloud && !canCreateCloudFromLocal)
    throw new Error("STORAGE_STRATEGY_CLOUD_REPLICA_REQUIRED");
  const requiresCloudMaterialization =
    (toPreset === "spectra" || toPreset === "both") && !facts.cloudHasPayload;
  if (requiresCloudMaterialization && !facts.hasActiveLocal)
    throw new Error("STORAGE_STRATEGY_CLOUD_PAYLOAD_REQUIRED");
  if (toPreset === "spectra" && facts.hasProtectedPending)
    throw new Error("STORAGE_STRATEGY_PENDING_CHANGES");
  const needsMaterialization = requiresLocal && !facts.hasActiveLocal;
  return {
    requiresLocal,
    requiresCloud,
    localAction:
      toPreset === "spectra"
        ? requiresCloudMaterialization
          ? "retain"
          : "unlink"
        : needsMaterialization
          ? "materialize"
          : "retain",
    cloudAction:
      toPreset === "device" || toPreset === "linked"
        ? "metadata-only"
        : "retain",
    protectedOriginal: toPreset === "linked",
    completion:
      needsMaterialization || requiresCloudMaterialization ? "pending" : "verified",
    requiresCloudMaterialization,
  };
}
