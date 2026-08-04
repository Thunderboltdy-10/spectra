import type { ActorIdentity } from "./protocol";

export type AwarenessEntry = {
  actor: ActorIdentity;
  payload: unknown;
  sequence: number;
  expiresAt: number;
};

export class AwarenessRegistry {
  private entries = new Map<string, AwarenessEntry>();

  update(entry: AwarenessEntry) {
    const current = this.entries.get(entry.actor.clientId);
    if (current && current.sequence >= entry.sequence) return false;
    this.entries.set(entry.actor.clientId, entry);
    return true;
  }

  remove(clientId: string) {
    return this.entries.delete(clientId);
  }

  expire(now: number) {
    const removed: string[] = [];
    for (const [clientId, entry] of this.entries)
      if (entry.expiresAt <= now) {
        this.entries.delete(clientId);
        removed.push(clientId);
      }
    return removed;
  }

  list(now = Date.now()) {
    this.expire(now);
    return [...this.entries.values()];
  }
}
