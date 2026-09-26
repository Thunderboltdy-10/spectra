export type DurableRoomAnchor = { roomId: string; nextSequence: number; frontierHash: string };
export type RecoveryAncestry = { recoveryAnchor?: DurableRoomAnchor; authoredRegionIds?: string[]; pendingRemoteSync?: boolean };
export function readDurableRoomAnchor(value: unknown): DurableRoomAnchor | null;
export function recoveryRegionIds(values: unknown): string[];
export function mergeRecoveryAncestry(previous: RecoveryAncestry | null, incoming: RecoveryAncestry, previousCovered: boolean): {
  recoveryAnchor: DurableRoomAnchor | undefined; authoredRegionIds: string[];
};
