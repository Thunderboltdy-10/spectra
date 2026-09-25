import { v } from "convex/values";

export const vUiObserverInterest = v.object({
  clientId: v.string(),
  mode: v.union(v.literal("ordinary"), v.literal("follow")),
});
export const vUiObserverInterests = v.object({
  executionId: v.string(),
  clients: v.array(vUiObserverInterest),
});
export const vUiObservationFence = v.object({
  epoch: v.number(), operationDigest: v.string(), sequence: v.literal(0),
});
export const vUiObservation = v.object({
  version: v.literal(1),
  epoch: v.number(),
  operationDigest: v.string(),
  target: v.literal("/settings/writing/smartCompletion"),
  sequence: v.literal(0),
  phase: v.union(v.literal("waiting"), v.literal("sealed"), v.literal("headless")),
  expiresAt: v.number(),
  ownerClientId: v.optional(v.string()),
  participants: v.array(v.object({
    clientId: v.string(),
    mode: v.union(v.literal("ordinary"), v.literal("follow")),
    outcome: v.optional(v.union(v.literal("target_ready"), v.literal("invisible"), v.literal("released"))),
  })),
});
