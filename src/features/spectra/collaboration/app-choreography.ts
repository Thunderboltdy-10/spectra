export type AppSurface =
  "library" | "workspace" | "settings" | "calendar" | "artifact" | "none";

export type AppViewportSnapshot = {
  visibleSurfaces: readonly AppSurface[];
  focusedSurface?: AppSurface;
  recentSurface?: AppSurface;
  followingActor: boolean;
  /** Optional actor identity keeps arbitration deterministic when several AI
   * runs are visible; only the followed actor may change the route. */
  followedActorId?: string | null;
  actorId?: string;
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
    (!viewport.followedActorId || !viewport.actorId || viewport.followedActorId === viewport.actorId);
  if (viewport.visibleSurfaces.includes(target))
    return {
      surface: target,
      navigate: false,
      animate: true,
      reason: "The target is already visible.",
    };
  if (
    viewport.focusedSurface &&
    viewport.visibleSurfaces.includes(viewport.focusedSurface) &&
    viewport.focusedSurface === target
  )
    return {
      surface: target,
      navigate: false,
      animate: true,
      reason: "The target owns the current focus.",
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
export const APP_CHOREOGRAPHY_SETTLE_MS = 280;

export type AppChoreographyRequest = {
  actorId: string;
  operationId: string;
  target: AppSurface;
  targetKey?: string;
  summary: string;
};

export type AppChoreographyStatus = "queued" | "performing" | "blocked" | "completed" | "cancelled";

export type AppChoreographyEntry = AppChoreographyRequest & {
  status: AppChoreographyStatus;
  reason?: string;
};

/**
 * One coordinator for every non-artifact surface. The semantic operation is
 * committed elsewhere; this class only owns visible bodies and target claims.
 * Each actor has an independent FIFO queue, while a target claim is shared so
 * two actors cannot animate or overwrite the same control at once.
 */
export class AppChoreographyCoordinator {
  private readonly queues = new Map<string, AppChoreographyEntry[]>();
  private readonly active = new Map<string, AppChoreographyEntry>();
  private readonly claims = new Map<string, { actorId: string; expiresAt: number }>();
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
    const entry: AppChoreographyEntry = { ...request, status: "queued" };
    const queue = this.queues.get(request.actorId) ?? [];
    queue.push(entry);
    this.queues.set(request.actorId, queue);
    this.pump(request.actorId);
    return entry;
  }

  complete(actorId: string, operationId: string): boolean {
    const entry = this.active.get(actorId);
    if (!entry || entry.operationId !== operationId) return false;
    entry.status = "completed";
    this.active.delete(actorId);
    this.releaseClaim(entry);
    this.pump(actorId);
    this.pumpAllBlocked();
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
    this.queues.set(actorId, queue.filter((entry) => entry.status === "queued"));
    this.pump(actorId);
    this.pumpAllBlocked();
    return count;
  }

  snapshot(): AppChoreographyEntry[] {
    return [
      ...this.active.values(),
      ...[...this.queues.values()].flat(),
    ].map((entry) => ({ ...entry }));
  }

  /** Drop claims whose TTL elapsed so a crashed performer cannot deadlock a control. */
  expireClaims(now = this.now()): number {
    let released = 0;
    for (const [key, claim] of [...this.claims.entries()]) {
      if (claim.expiresAt > now) continue;
      this.claims.delete(key);
      released += 1;
      const holder = this.active.get(claim.actorId);
      if (holder && this.claimKey(holder) === key) {
        holder.status = "cancelled";
        holder.reason = "The control claim expired.";
        this.active.delete(claim.actorId);
      }
    }
    if (released) this.pumpAllBlocked();
    return released;
  }

  private pump(actorId: string): void {
    this.expireClaims();
    if (this.active.has(actorId)) return;
    const queue = this.queues.get(actorId) ?? [];
    while (queue.length && queue[0]!.status !== "queued") queue.shift();
    const next = queue[0];
    if (!next) return;
    const key = this.claimKey(next);
    const owner = key ? this.claims.get(key) : undefined;
    if (owner && owner.actorId !== actorId) {
      next.status = "blocked";
      next.reason = `Waiting for ${owner.actorId} to release ${key}`;
      return;
    }
    queue.shift();
    next.status = "performing";
    if (key) {
      this.claims.set(key, {
        actorId,
        expiresAt: this.now() + this.claimTtlMs,
      });
    }
    this.active.set(actorId, next);
  }

  private pumpAllBlocked(): void {
    for (const actorId of this.queues.keys()) {
      const queue = this.queues.get(actorId) ?? [];
      const blocked = queue.find((entry) => entry.status === "blocked");
      if (blocked) blocked.status = "queued";
      this.pump(actorId);
    }
  }

  private claimKey(entry: AppChoreographyEntry): string | null {
    return entry.targetKey ? `${entry.target}:${entry.targetKey}` : null;
  }

  private releaseClaim(entry: AppChoreographyEntry): void {
    const key = this.claimKey(entry);
    if (key && this.claims.get(key)?.actorId === entry.actorId) {
      this.claims.delete(key);
    }
  }
}

export function appSurfaceFromPathname(pathname: string): AppSurface {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/calendar")) return "calendar";
  if (pathname.startsWith("/workspace") || pathname.startsWith("/library"))
    return "library";
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
    destination === "artifact"
    ? destination
    : null;
}

export function choreographyDisabledResult<T>(operation: () => T): T {
  return operation();
}
