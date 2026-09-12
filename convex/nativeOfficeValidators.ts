import { v } from "convex/values";

/**
 * Receipts cross a public mutation boundary, so keep the wire shape strict.
 * Semantic and package validation still belongs to the format route; this
 * validator only prevents an untyped caller from inventing ownership facts.
 */
export const nativeSaveReceiptValidator = v.object({
  kind: v.literal("native-office-save"),
  format: v.union(v.literal("docx"), v.literal("xlsx"), v.literal("pptx")),
  operationId: v.string(),
  artifactId: v.string(),
  basePayloadHash: v.string(),
  resultPayloadHash: v.string(),
  baseRevision: v.string(),
  resultRevision: v.string(),
  targets: v.object({
    regionIds: v.array(v.string()),
    partNames: v.array(v.string()),
  }),
  semantic: v.object({
    baseDigest: v.optional(v.string()),
    resultDigest: v.string(),
    readbackDigest: v.string(),
  }),
  preservedPartNames: v.array(v.string()),
  state: v.union(
    v.literal("pending"),
    v.literal("applied"),
    v.literal("unchanged"),
    v.literal("cloud_saved"),
    v.literal("conflicted"),
    v.literal("failed"),
  ),
  acknowledgedAt: v.optional(v.number()),
  errorCode: v.optional(v.string()),
});
