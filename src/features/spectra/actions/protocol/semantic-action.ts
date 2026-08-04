import type { CollaborationPolicy } from "../../realtime/policies";

export type SemanticActionAnchor = {
  workId: string;
  workType: string;
  kind: string;
  path: string[];
  stableIds?: Record<string, string>;
  relativePosition?: Uint8Array;
  schemaVersion: number;
};

export type ActionCondition = {
  id: string;
  description: string;
  verify(context: unknown): boolean | Promise<boolean>;
};

export type RecoverableAction = {
  id: string;
  intent: { kind: string; description: string; payload?: Record<string, unknown> };
  target: SemanticActionAnchor;
  preconditions: ActionCondition[];
  collaborationPolicy: CollaborationPolicy;
  choreography: Array<{ kind: string; target?: SemanticActionAnchor; payload?: Record<string, unknown> }>;
  postconditions: ActionCondition[];
  retryPolicy: { maxAttempts: number; backoffMs: number; replanOn: string[] };
  fallbackStrategies: Array<{ id: string; description: string }>;
  checkpointPolicy: "before" | "after" | "both" | "none";
};

export type ActionOutcome =
  | { kind: "completed"; attempts: number }
  | { kind: "wait"; reason: string; recoverable: true }
  | { kind: "replan"; reason: string; attempts: number }
  | { kind: "failed"; reason: string; terminal: true };

export async function performRecoverableAction(
  action: RecoverableAction,
  context: unknown,
  apply: (action: RecoverableAction, attempt: number) => Promise<void>,
): Promise<ActionOutcome> {
  for (const condition of action.preconditions)
    if (!(await condition.verify(context))) return { kind: "replan", reason: `precondition:${condition.id}`, attempts: 0 };
  const maximum = Math.max(1, action.retryPolicy.maxAttempts);
  for (let attempt = 1; attempt <= maximum; attempt += 1) {
    try {
      await apply(action, attempt);
      const failed = [];
      for (const condition of action.postconditions)
        if (!(await condition.verify(context))) failed.push(condition.id);
      if (failed.length === 0) return { kind: "completed", attempts: attempt };
      if (attempt === maximum) return { kind: "replan", reason: `postcondition:${failed.join(",")}`, attempts: attempt };
    } catch (error) {
      const code = error instanceof Error ? error.message : "action_failed";
      if (/WAIT|LEASE|CLAIM_QUEUED/i.test(code)) return { kind: "wait", reason: code, recoverable: true };
      if (attempt === maximum) return { kind: "failed", reason: code, terminal: true };
    }
    if (action.retryPolicy.backoffMs > 0)
      await new Promise<void>((resolve) => setTimeout(resolve, action.retryPolicy.backoffMs));
  }
  return { kind: "failed", reason: "action_attempts_exhausted", terminal: true };
}
