/**
 * AI completion must wait for a real gateway durable acknowledgement, not only
 * Hocuspocus transport cleanliness. Capture an epoch before the local
 * transaction; only the matching pending/ack cycle advances it. A clean
 * transport before `spectra.durable_pending` arrives is still dirty.
 */
export class AiDurableAckGate {
  private requiredEpoch = 0;
  private ackedEpoch = 0;
  private readonly pendingIds = new Set<string>();
  private readonly epochIds = new Map<number, Set<string>>();

  beginTransaction() {
    this.requiredEpoch += 1;
    this.epochIds.set(this.requiredEpoch, new Set());
  }

  get isDirty() {
    return this.ackedEpoch < this.requiredEpoch;
  }

  handleGatewayMessage(type: string, updateIds: readonly string[]) {
    if (type === "spectra.durable_pending") {
      const ids = this.epochIds.get(this.requiredEpoch);
      if (!ids) return;
      for (const updateId of updateIds) {
        ids.add(updateId);
        this.pendingIds.add(updateId);
      }
      return;
    }
    if (type !== "spectra.durable_ack") return;
    for (const updateId of updateIds) this.pendingIds.delete(updateId);
    const ids = this.epochIds.get(this.requiredEpoch);
    if (!ids || ids.size === 0) return;
    for (const updateId of ids) {
      if (this.pendingIds.has(updateId)) return;
    }
    this.ackedEpoch = this.requiredEpoch;
  }
}
