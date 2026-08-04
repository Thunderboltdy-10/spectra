import type { StructuralClaim } from "./protocol";

export class StructuralClaimRegistry {
  private claims = new Map<string, StructuralClaim>();
  private queue: StructuralClaim[] = [];

  restore(claims: readonly StructuralClaim[]) {
    this.claims.clear();
    this.queue = [];
    for (const claim of claims)
      if (claim.state === "active") this.claims.set(claim.id, claim);
      else this.queue.push(claim);
  }

  get(claimId: string) {
    return this.claims.get(claimId) ?? this.queue.find((claim) => claim.id === claimId);
  }

  acquire(claim: StructuralClaim, now = Date.now()) {
    this.expire(now);
    const conflict = [...this.claims.values()].some(
      (current) => current.target === claim.target,
    );
    if (conflict) {
      const queued = { ...claim, state: "queued" as const };
      this.queue.push(queued);
      return queued;
    }
    const active = { ...claim, state: "active" as const };
    this.claims.set(active.id, active);
    return active;
  }

  release(claimId: string) {
    const released = this.claims.get(claimId);
    if (!released) return null;
    this.claims.delete(claimId);
    const nextIndex = this.queue.findIndex((claim) => claim.target === released.target);
    if (nextIndex < 0) return null;
    const [next] = this.queue.splice(nextIndex, 1);
    const active = { ...next, state: "active" as const };
    this.claims.set(active.id, active);
    return active;
  }

  expire(now = Date.now()) {
    for (const [id, claim] of this.claims)
      if (claim.expiresAt <= now) this.release(id);
    this.queue = this.queue.filter((claim) => claim.expiresAt > now);
  }

  snapshot() {
    return { active: [...this.claims.values()], queued: [...this.queue] };
  }
}
