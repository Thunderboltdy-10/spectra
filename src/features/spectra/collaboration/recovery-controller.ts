import type { DurableRoomAnchor } from "./types";

export type RecoveryBranch = {
  id: string;
  createdAt: number;
  bytes: number;
  generation: string;
  reason: "native_overlap" | "unknown_ancestor" | "retained";
  regionIds: string[];
  canReadCurrent: boolean;
  canReapply: boolean;
  currentAnchor?: DurableRoomAnchor;
};

export type LocalRecoveryState = {
  state: "loading" | "review_required" | "ready" | "saving" | "error";
  branches: RecoveryBranch[];
  activeBranchId?: string;
  /** Changes only after an explicit archived adoption, never on Retry. */
  adoptionId?: string;
  error?: string;
};

export type LocalRecoveryInspection = {
  branch: RecoveryBranch;
  previews: Array<{ regionId: string; label: string; draft: string; current?: string }>;
};

export type LocalRecoveryAction = {
  branchId: string;
  expectedGeneration: string;
  expectedCurrentAnchor: DurableRoomAnchor;
  signal?: AbortSignal;
};

/** Existing conflict/notice UI consumes this controller. Source authority is
 * rechecked by actions; displayed capabilities are not an authorization grant.
 * Inspect/export operate on retained local bytes and do not clear pending work.
 * Stale witnesses fail with LOCAL_RECOVERY_GENERATION_CHANGED or
 * LOCAL_RECOVERY_CURRENT_CHANGED, never an automatic retry with a new witness.
 */
export type LocalRecoveryController = {
  recovery: LocalRecoveryState;
  inspectLocalRecovery: (branchId: string, options?: { signal?: AbortSignal }) => Promise<LocalRecoveryInspection>;
  exportLocalRecovery: (branchId: string, options?: { signal?: AbortSignal }) => Promise<{ fileName: string; blob: Blob }>;
  /** Archives the exact old branch before adopting a fresh authorized current
   * baseline. Resolves after the replacement live model is ready. UI must not
   * separately write content/baseline into React or Yjs. A closed view after
   * local commit cannot discard the retained branch or roll that commit back.
   */
  archiveAndAdoptCurrent: (action: LocalRecoveryAction) => Promise<{ archivedBranchId: string; adoptionId: string }>;
  /** Applies explicitly selected semantic regions through the normal edit and
   * current-source checks. The original recovery branch remains inspectable.
   */
  reapplyLocalRecovery: (action: LocalRecoveryAction & { regionIds: string[] }) => Promise<void>;
};
