import type { CollaborationPolicy } from "../../realtime/policies";
import { z } from "zod";

export const SMART_COMPLETION_TARGET = "/settings/writing/smartCompletion";

/** A server-derived action point, never a client-issued write permit. The
 * existing application operation and its receipt remain authoritative. */
export const observedActionIdentitySchema = z.object({
  runId: z.string().min(1).max(200),
  executionId: z.string().min(1).max(200),
  operationId: z.string().min(1).max(200),
  operationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  epoch: z.number().int().positive(),
  sequence: z.literal(0),
}).strict();

export type ObservedActionIdentity = z.infer<typeof observedActionIdentitySchema>;

export const settingsToggleActionSchema = observedActionIdentitySchema.extend({
  kind: z.literal("settings_toggle"),
  target: z.literal(SMART_COMPLETION_TARGET),
  checked: z.boolean(),
  expiresAt: z.number().int().positive(),
}).strict();

export type SettingsToggleAction = z.infer<typeof settingsToggleActionSchema>;

export type UiObservationFence = Pick<ObservedActionIdentity, "epoch" | "operationDigest" | "sequence">;
export const uiObservationSnapshotSchema = z.object({
  phase: z.enum(["waiting", "sealed", "headless", "committed"]),
  action: settingsToggleActionSchema.optional(),
  ownerClientId: z.string().min(1).max(120).optional(),
  participants: z.array(z.object({
    clientId: z.string().min(1).max(120),
    mode: z.enum(["ordinary", "follow"]),
    outcome: z.enum(["target_ready", "invisible", "released"]).optional(),
  }).strict()).max(8).optional(),
  result: z.unknown().optional(),
}).strict();
export type UiObservationSnapshot = z.infer<typeof uiObservationSnapshotSchema>;

/** Only this exact patch has a real control adapter. A larger settings command
 * must not masquerade as a single toggle or discard its other effects. */
export function smartCompletionValue(patch: unknown): boolean | undefined {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  const sections = Object.keys(patch);
  if (sections.length !== 1 || sections[0] !== "writing") return;
  const writing = (patch as Record<string, unknown>).writing;
  if (!writing || typeof writing !== "object" || Array.isArray(writing)) return;
  const keys = Object.keys(writing);
  if (keys.length !== 1 || keys[0] !== "smartCompletion") return;
  const value = (writing as Record<string, unknown>).smartCompletion;
  return typeof value === "boolean" ? value : undefined;
}

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
