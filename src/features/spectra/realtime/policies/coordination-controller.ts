import type { ArtifactCollaborationTransport } from "../../collaboration/types";
import type { CollaborationPolicyTarget } from "./collaboration-policy-registry";
import { collaborationPolicyRegistry } from "./collaboration-policy-registry";
import {
  leaseReleaseSubscriptions,
  waitForActorRelease,
  type WaitForActorOptions,
  type WaitResumeResult,
} from "./wait-resume";

export type CoordinationHandle =
  | { kind: "mergeable" }
  | {
      kind: "lease";
      status: "acquired";
      leaseId: string;
      targetId: string;
      renew(): void;
      release(): void;
    }
  | {
      kind: "lease";
      status: "blocked";
      targetId: string;
      conflictLeaseId: string;
    }
  | {
      kind: "claim";
      status: "active" | "queued";
      claimId: string;
      targetId: string;
      release(): void;
    }
  | { kind: "compatibility"; policy: "lease" | "claim" };

export type BeginCoordinationOptions = CollaborationPolicyTarget & {
  targetId: string;
  operationId?: string;
  signal?: AbortSignal;
  now?: () => number;
};

/**
 * One executable entry point for human controls and AI semantic actions. It is
 * intentionally policy-driven: callers name the semantic target and do not
 * contain their own lease/claim rules.
 */
export class CollaborationCoordinationController {
  constructor(private readonly transport: ArtifactCollaborationTransport) {}

  async begin(options: BeginCoordinationOptions): Promise<CoordinationHandle> {
    const policy = collaborationPolicyRegistry.resolve(options);
    if (policy.mode === "mergeable") return { kind: "mergeable" };
    const now = options.now ?? Date.now;
    if (policy.mode === "interaction_lease") {
      if (!this.transport.acquireInteractionLease)
        return { kind: "compatibility", policy: "lease" };
      const acquiredAt = now();
      const leaseId = crypto.randomUUID();
      const leaseDuration = 12_000;
      const result = await this.transport.acquireInteractionLease(
        {
          id: leaseId,
          target: options.targetId,
          scope: policy.leaseScope,
          ...(options.operationId ? { operationId: options.operationId } : {}),
          acquiredAt,
          expiresAt: acquiredAt + leaseDuration,
          releaseCondition: policy.release,
          sequence: 0,
        },
        options.signal,
      );
      if (!result.ok)
        return {
          kind: "lease",
          status: "blocked",
          targetId: options.targetId,
          conflictLeaseId: result.conflict.id,
        };
      return {
        kind: "lease",
        status: "acquired",
        leaseId,
        targetId: options.targetId,
        renew: () =>
          this.transport.renewInteractionLease?.(
            leaseId,
            (options.now ?? Date.now)() + leaseDuration,
          ),
        release: () =>
          this.transport.releaseInteractionLease?.(leaseId, policy.release),
      };
    }
    if (!this.transport.acquireStructuralClaim)
      return { kind: "compatibility", policy: "claim" };
    const acquiredAt = now();
    const claim = await this.transport.acquireStructuralClaim(
      {
        id: crypto.randomUUID(),
        target: options.targetId,
        ...(options.operationId ? { operationId: options.operationId } : {}),
        acquiredAt,
        expiresAt: acquiredAt + 60_000,
      },
      options.signal,
    );
    return {
      kind: "claim",
      status: claim.state,
      claimId: claim.id,
      targetId: claim.target,
      release: () => this.transport.releaseStructuralClaim?.(claim.id),
    };
  }

  waitForRelease<TTarget>(
    options: WaitForActorOptions<TTarget>,
  ): Promise<WaitResumeResult<TTarget>> {
    return waitForActorRelease(leaseReleaseSubscriptions, options);
  }
}
