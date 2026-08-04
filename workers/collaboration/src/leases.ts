import type { InteractionLease } from "./protocol";

export class InteractionLeaseRegistry {
  private leases = new Map<string, InteractionLease>();

  acquire(lease: InteractionLease, now = Date.now()) {
    this.expire(now);
    const conflict = [...this.leases.values()].find(
      (current) =>
        current.target === lease.target &&
        current.owner.clientId !== lease.owner.clientId,
    );
    if (conflict) return { ok: false as const, conflict };
    this.leases.set(lease.id, lease);
    return { ok: true as const, lease };
  }

  renew(leaseId: string, clientId: string, expiresAt: number) {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.owner.clientId !== clientId) return false;
    this.leases.set(leaseId, { ...lease, expiresAt, sequence: lease.sequence + 1 });
    return true;
  }

  release(leaseId: string, clientId?: string) {
    const lease = this.leases.get(leaseId);
    if (!lease || (clientId && lease.owner.clientId !== clientId)) return null;
    this.leases.delete(leaseId);
    return lease;
  }

  releaseOwner(clientId: string) {
    const released: InteractionLease[] = [];
    for (const [id, lease] of this.leases)
      if (lease.owner.clientId === clientId) {
        this.leases.delete(id);
        released.push(lease);
      }
    return released;
  }

  expire(now = Date.now()) {
    const released: InteractionLease[] = [];
    for (const [id, lease] of this.leases)
      if (lease.expiresAt <= now) {
        this.leases.delete(id);
        released.push(lease);
      }
    return released;
  }

  list(now = Date.now()) {
    this.expire(now);
    return [...this.leases.values()];
  }
}
