export type AppSurface =
  "library" | "workspace" | "settings" | "calendar" | "school" | "artifact" | "none";

export type AppViewportSnapshot = {
  visibleSurfaces: readonly AppSurface[];
  focusedSurface?: AppSurface;
  recentSurface?: AppSurface;
  followingActor: boolean;
  /** Optional actor identity keeps arbitration deterministic when several AI
   * runs are visible; only the followed actor may change the route. */
  followedActorId?: string | null;
  actorId?: string;
  /** Exact control visibility, when measured. A mounted page alone is not proof. */
  targetVisible?: boolean;
};

export type AppChoreographyDecision = {
  surface: AppSurface;
  navigate: boolean;
  animate: boolean;
  reason: string;
};

/** Pure arbitration for non-artifact operations. The semantic operation is
 * independent; this only chooses whether a performer gets a body. */
export function arbitrateAppSurface(
  target: AppSurface,
  viewport: AppViewportSnapshot,
): AppChoreographyDecision {
  const actorIsFollowed =
    viewport.followingActor &&
    (!viewport.followedActorId || viewport.followedActorId === viewport.actorId);
  if (target === "none")
    return { surface: "none", navigate: false, animate: false, reason: "No action target is available." };
  if (viewport.targetVisible ?? viewport.visibleSurfaces.includes(target))
    return {
      surface: target,
      navigate: false,
      animate: true,
      reason: "The target is already visible.",
    };
  if (
    viewport.recentSurface &&
    viewport.recentSurface === target &&
    actorIsFollowed
  )
    return {
      surface: target,
      navigate: true,
      animate: true,
      reason:
        "Follow AI permits a deliberate route change to the recent target.",
    };
  if (actorIsFollowed)
    return {
      surface: target,
      navigate: true,
      animate: true,
      reason: "Follow AI permits navigation to the target.",
    };
  return {
    surface: "none",
    navigate: false,
    animate: false,
    reason: "The actor is not followed and the target is off-screen.",
  };
}

/** Resolve one performance when the same semantic action is represented on
 * several visible surfaces. Primary visibility wins, then recent interaction;
 * the result is singular by construction. */
export function resolveAppChoreographySurface(
  candidates: readonly AppSurface[],
  primary: AppSurface,
  viewport: AppViewportSnapshot,
): AppChoreographyDecision {
  const unique = [...new Set(candidates.filter((candidate): candidate is Exclude<AppSurface, "none"> => candidate !== "none"))];
  const visible = unique.filter((candidate) => viewport.visibleSurfaces.includes(candidate));
  const fallbackPrimary: Exclude<AppSurface, "none"> =
    primary === "none" ? (unique[0] ?? "library") : primary;
  const recent = viewport.recentSurface === "none" ? undefined : viewport.recentSurface;
  const target = visible.includes(fallbackPrimary)
    ? fallbackPrimary
    : recent && visible.includes(recent)
      ? recent
      : visible[0] ?? fallbackPrimary;
  return arbitrateAppSurface(target, viewport);
}

export const APP_CHOREOGRAPHY_CLAIM_TTL_MS = 8_000;

export type AppChoreographyRequest = {
  actorId: string;
  operationId: string;
  target: AppSurface;
  targetKey?: string;
  summary: string;
};

export type AppChoreographyStatus = "queued" | "performing" | "blocked" | "completed" | "failed" | "cancelled";

export type AppChoreographyEntry = AppChoreographyRequest & {
  status: AppChoreographyStatus;
  reason?: string;
};

/**
 * One coordinator for every non-artifact surface. The semantic operation is
 * committed elsewhere; this class only owns visible bodies and target claims.
 * Each actor has an independent FIFO queue, while a target claim is shared so
 * two actors cannot perform the same local control at once. These are local
 * presentation claims, not authority to write: server revision/region fences
 * still protect canonical effects. Only an execution acknowledgement completes
 * an entry; elapsed animation time never establishes success.
 */
export class AppChoreographyCoordinator {
  private readonly queues = new Map<string, AppChoreographyEntry[]>();
  private readonly active = new Map<string, AppChoreographyEntry>();
  private readonly claims = new Map<string, string>();
  private readonly expiresAt = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly claimTtlMs: number;

  constructor(
    options: {
      now?: () => number;
      claimTtlMs?: number;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.claimTtlMs = options.claimTtlMs ?? APP_CHOREOGRAPHY_CLAIM_TTL_MS;
  }

  enqueue(request: AppChoreographyRequest): AppChoreographyEntry {
    this.expireClaims();
    const existing = [this.active.get(request.actorId), ...(this.queues.get(request.actorId) ?? [])]
      .find((entry) => entry?.operationId === request.operationId);
    if (existing) {
      if (existing.target !== request.target || existing.targetKey !== request.targetKey)
        throw new Error("An in-flight operation cannot change its choreography target.");
      return existing;
    }
    const entry: AppChoreographyEntry = { ...request, status: "queued" };
    const queue = this.queues.get(request.actorId) ?? [];
    queue.push(entry);
    this.queues.set(request.actorId, queue);
    this.pump(request.actorId);
    this.emit();
    return entry;
  }

  complete(actorId: string, operationId: string): boolean {
    return this.finish(actorId, operationId, "completed");
  }

  fail(actorId: string, operationId: string, reason: string): boolean {
    return this.finish(actorId, operationId, "failed", reason);
  }

  private finish(actorId: string, operationId: string, status: "completed" | "failed", reason?: string): boolean {
    this.expireClaims();
    const entry = this.active.get(actorId);
    if (!entry || entry.operationId !== operationId) return false;
    entry.status = status;
    entry.reason = reason;
    this.active.delete(actorId);
    this.releaseClaim(entry);
    this.pumpAllBlocked();
    this.emit();
    return true;
  }

  cancel(actorId: string, operationId?: string): number {
    let count = 0;
    const active = this.active.get(actorId);
    if (active && (!operationId || active.operationId === operationId)) {
      active.status = "cancelled";
      this.active.delete(actorId);
      this.releaseClaim(active);
      count += 1;
    }
    const queue = this.queues.get(actorId) ?? [];
    for (const entry of queue) {
      if (!operationId || entry.operationId === operationId) {
        entry.status = "cancelled";
        count += 1;
      }
    }
    this.queues.set(actorId, queue.filter((entry) => entry.status !== "cancelled"));
    this.pumpAllBlocked();
    this.emit();
    return count;
  }

  snapshot(): AppChoreographyEntry[] {
    return [
      ...this.active.values(),
      ...[...this.queues.values()].flat(),
    ].map((entry) => ({ ...entry }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** A real performer renews its lease at progress boundaries, never on a timer. */
  renewClaim(actorId: string, operationId: string): boolean {
    this.expireClaims();
    const entry = this.active.get(actorId);
    if (!entry || entry.operationId !== operationId) return false;
    this.expiresAt.set(actorId, this.now() + this.claimTtlMs);
    return true;
  }

  /** Drop claims whose TTL elapsed so a crashed performer cannot deadlock a control. */
  expireClaims(now = this.now()): number {
    let released = 0;
    for (const [actorId, expiresAt] of [...this.expiresAt.entries()]) {
      if (expiresAt > now) continue;
      released += 1;
      const holder = this.active.get(actorId);
      if (holder) {
        holder.status = "cancelled";
        holder.reason = "The control claim expired.";
        this.active.delete(actorId);
        this.releaseClaim(holder);
      }
    }
    if (released) {
      this.pumpAllBlocked();
      this.emit();
    }
    return released;
  }

  private pump(actorId: string): void {
    if (this.active.has(actorId)) return;
    const queue = this.queues.get(actorId) ?? [];
    const next = queue[0];
    if (!next) {
      this.queues.delete(actorId);
      return;
    }
    const key = this.claimKey(next);
    const owner = key ? this.claims.get(key) : undefined;
    if (owner && owner !== actorId) {
      next.status = "blocked";
      next.reason = `Waiting for ${owner} to release ${key}`;
      return;
    }
    queue.shift();
    next.status = "performing";
    delete next.reason;
    if (!queue.length) this.queues.delete(actorId);
    if (key) this.claims.set(key, actorId);
    this.expiresAt.set(actorId, this.now() + this.claimTtlMs);
    this.active.set(actorId, next);
  }

  private pumpAllBlocked(): void {
    for (const actorId of this.queues.keys()) {
      this.pump(actorId);
    }
  }

  private claimKey(entry: AppChoreographyEntry): string | null {
    return entry.targetKey ? `${entry.target}:${entry.targetKey}` : null;
  }

  private releaseClaim(entry: AppChoreographyEntry): void {
    const key = this.claimKey(entry);
    this.expiresAt.delete(entry.actorId);
    if (key && this.claims.get(key) === entry.actorId) {
      this.claims.delete(key);
    }
  }
}

export function appSurfaceFromPathname(pathname: string): AppSurface {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/calendar")) return "calendar";
  if (pathname.startsWith("/school")) return "school";
  if (pathname.startsWith("/workspace")) return "workspace";
  if (pathname.startsWith("/library")) return "library";
  return "workspace";
}

export function appSurfaceFromChoreographyTarget(target: string): AppSurface {
  if (target.includes("library")) return "library";
  if (
    target.includes("settings") ||
    target.includes("sharing") ||
    target === "settings-security"
  )
    return "settings";
  if (target.includes("calendar")) return "calendar";
  if (target.includes("school")) return "school";
  if (
    target.includes("artifact") ||
    target.includes("workbar") ||
    target === "artifact-anchor"
  )
    return "artifact";
  return "workspace";
}

export function appSurfaceForNavigation(destination: string): AppSurface | null {
  return destination === "library" ||
    destination === "workspace" ||
    destination === "settings" ||
    destination === "calendar" ||
    destination === "school" ||
    destination === "artifact"
    ? destination
    : null;
}

export function choreographyDisabledResult<T>(operation: () => T): T {
  return operation();
}
