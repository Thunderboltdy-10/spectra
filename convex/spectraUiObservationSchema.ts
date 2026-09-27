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
export const vDocumentParagraphTarget = v.object({
  kind: v.literal("artifact_paragraph"),
  artifactId: v.id("spectraArtifacts"),
  blockId: v.string(),
  expectedText: v.string(),
  index: v.number(),
  baseRevision: v.object({
    roomId: v.id("collaborationRooms"), nextSequence: v.number(), sourceContentIdentity: v.string(),
  }),
});
export const vUiObservation = v.object({
  version: v.literal(1),
  epoch: v.number(),
  operationDigest: v.string(),
  target: v.union(v.literal("/settings/writing/smartCompletion"), vDocumentParagraphTarget),
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
