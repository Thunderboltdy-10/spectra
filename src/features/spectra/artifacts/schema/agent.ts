import { z } from "zod";
import { normalizeFoundryContent } from "../../agents/foundry";

const id = z.string().trim().min(1).max(180);
const text = z.string().max(250_000);

export const agentContentSchema = z
  .object({
    profile: z.object({
      purpose: z.string().max(4_000),
      outcomes: z.array(z.string().min(1).max(500)).max(30),
      audienceIntent: z.string().max(1_000),
      inScope: z.array(z.string().min(1).max(500)).max(100),
      outOfScope: z.array(z.string().min(1).max(500)).max(100),
    }),
    instructions: z.object({ regionId: id, text }),
    skills: z.array(
      z.object({
        id,
        name: z.string().min(1).max(100),
        instructions: text,
        enabled: z.boolean(),
      }),
    ),
    tools: z.array(
      z.object({
        id,
        key: z.string().min(1).max(100),
        enabled: z.boolean(),
        approval: z.enum(["never", "consequential", "always"]),
      }),
    ),
    resources: z.array(
      z.object({
        id,
        artifactId: id,
        mode: z.enum(["read", "use"]),
        label: z.string().max(160),
        versionPolicy: z.enum(["reviewed", "latest"]),
        pinnedVersionId: id.optional(),
      }),
    ),
    routing: z.object({
      enabled: z.boolean(),
      description: z.string().max(4_000),
      examples: z.array(z.string().max(500)).max(50),
      negativeExamples: z.array(z.string().max(500)).max(50),
    }),
    behavior: z.object({
      clarification: z.enum(["ask_when_needed", "confirm", "never_ask"]),
      tone: z.enum(["warm", "direct", "socratic", "formal", "playful"]),
      responseLength: z.enum(["concise", "balanced", "detailed"]),
      boundaries: z.array(z.string().min(1).max(500)).max(100),
    }),
    modelPolicy: z.object({
      mode: z.enum(["spectra_default", "reasoning", "fast"]),
      allowFallback: z.boolean(),
    }),
    runtimeBudget: z
      .object({
        maxTurns: z.number().int().min(4).max(40),
        maxToolCalls: z.number().int().min(4).max(100),
        maxElapsedMs: z.number().int().min(30_000).max(600_000),
        maxTotalTokens: z.number().int().min(20_000).max(500_000),
      })
      .optional(),
    evals: z
      .array(
        z.object({
          id,
          prompt: z.string().max(4_000),
          expected: z.string().max(4_000),
          category: z.string().min(1).max(100),
          required: z.boolean(),
        }),
      )
      .max(200),
    releaseNotes: z.string().max(4_000),
    mission: z.object({ objective: text }).passthrough().optional(),
    foundationSections: z
      .array(
        z
          .object({
            id,
            type: z.string().min(1).max(100),
            question: text.optional(),
            answer: text.optional(),
          })
          .passthrough(),
      )
      .max(500)
      .optional(),
    evidenceBindings: z
      .array(
        z
          .object({
            id,
            title: z.string().max(500),
            description: text.optional(),
          })
          .passthrough(),
      )
      .max(2_000)
      .optional(),
    releaseDrafts: z
      .array(
        z
          .object({
            id,
            releaseSummary: text.optional(),
            status: z.string().max(100).optional(),
          })
          .passthrough(),
      )
      .max(500)
      .optional(),
    foundry: z
      .object({
        schemaVersion: z.number().int().positive(),
        mission: z.object({ objective: z.string().max(20_000) }).passthrough(),
        state: z.object({}).passthrough(),
        evidenceBindings: z.array(z.unknown()).max(2_000),
        skills: z.array(z.unknown()).max(500),
        draftReleaseNotes: z.string().max(20_000),
        foundationEstablished: z.boolean(),
      })
      .passthrough()
      .optional(),
  })
  .strict();

/** Explicit v1 -> v2 normalization. It preserves compatibility fields while
 * materializing the Foundry document that now owns mission, evidence and skill
 * authoring. Re-running it is idempotent at the artifact-schema boundary. */
export function migrateAgentContentV1ToV2(value: unknown) {
  return normalizeFoundryContent(value);
}

export function normalizeAgentArtifactContent(value: unknown) {
  return migrateAgentContentV1ToV2(value);
}
