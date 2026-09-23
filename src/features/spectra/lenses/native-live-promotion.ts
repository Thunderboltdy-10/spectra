import { hasPendingCloudToLocalWrite } from "./native-reconciliation";

export type NativeLivePromotionOperation = {
  direction?: string;
  state?: string;
};

export function nativeMaterializationRequest(artifactId: string) {
  return { action: "materialize" as const, artifactId };
}

/**
 * A live native body is identified by the authored region text, not by the
 * last Convex checkpoint. Checkpoint agreement is not byte promotion.
 */
export function nativeLiveContentKey(content: unknown): string {
  if (content == null || typeof content !== "object") return "";
  const value = content as Record<string, unknown>;
  if (Array.isArray(value.blocks)) {
    return value.blocks
      .map((block) => {
        const row =
          block && typeof block === "object"
            ? (block as Record<string, unknown>)
            : {};
        return `${String(row.id ?? "")}\t${String(row.text ?? "")}`;
      })
      .join("\n");
  }
  return "";
}

export function nativeLiveNeedsPromotion(input: {
  initialized: boolean;
  dirty: boolean;
  nativeActivity: boolean;
  unsynchronized: boolean;
  localReplicaPending: boolean;
  operations?: readonly NativeLivePromotionOperation[];
  contentKey: string;
  lastAttemptedKey?: string;
  bridgeAvailable?: boolean;
  lastFailedKey?: string;
  protectedOriginal?: boolean;
}): boolean {
  if (input.protectedOriginal) return false;
  if (
    !input.initialized ||
    input.dirty ||
    input.nativeActivity ||
    input.unsynchronized ||
    input.localReplicaPending
  )
    return false;
  if (input.bridgeAvailable === false) return false;
  if (hasPendingCloudToLocalWrite(input.operations)) return false;
  if (!input.contentKey) return false;
  if (input.lastFailedKey === input.contentKey) return false;
  return input.contentKey !== input.lastAttemptedKey;
}
