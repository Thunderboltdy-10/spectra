import { z } from "zod";
import { USER_SKILL_LIMITS } from "../../skills/contracts";
import type {
  RegisteredToolDefinition,
  ToolExecutionContext,
} from "./registry";
import { spectraToolRegistry } from "./registry";

const noRetry = { maxAttempts: 1, backoffMs: 0, retryableCodes: [] } as const;
const retryReads = {
  maxAttempts: 2,
  backoffMs: 250,
  retryableCodes: ["tool_unavailable", "provider_unavailable"],
} as const;

function summarize(output: unknown) {
  const text = JSON.stringify(output);
  return { text: text.slice(0, 4_000), truncated: text.length > 4_000 };
}

function bridge<I>(context: ToolExecutionContext, id: string, input: I) {
  if (!context.executeRegisteredTool)
    throw new Error(`TOOL_HANDLER_UNAVAILABLE: ${id}`);
  return context.executeRegisteredTool(id, input, context);
}

function register<I>(definition: RegisteredToolDefinition<I, unknown>) {
  if (!spectraToolRegistry.has(definition.id))
    spectraToolRegistry.register(definition);
}

export function registerUserSkillTools() {
  register({
    id: "list_skills",
    version: 1,
    title: "List AI skills",
    description:
      "List the capped skill catalog as names, purposes, trigger phrases, versions, and sources only. Skill bodies are deliberately omitted.",
    inputSchema: z.object({}),
    outputSchema: z.unknown(),
    capability: "read_work",
    category: "read",
    risk: "low",
    approval: "never",
    parallelSafe: true,
    idempotent: true,
    expectedDuration: "short",
    softStallAfter: 5_000,
    retryPolicy: retryReads,
    cancellable: true,
    resumable: true,
    summarizeOutput: summarize,
    execute: (context, input) => bridge(context, "list_skills", input),
  });
  register({
    id: "read_skill",
    version: 1,
    title: "Read one AI skill",
    description:
      "Load one skill body by its exact id only when the procedure is explicitly needed.",
    inputSchema: z.object({ skillId: z.string().trim().min(1).max(160) }),
    outputSchema: z.unknown(),
    capability: "read_work",
    category: "read",
    risk: "low",
    approval: "never",
    parallelSafe: true,
    idempotent: true,
    expectedDuration: "short",
    softStallAfter: 5_000,
    retryPolicy: retryReads,
    cancellable: true,
    resumable: true,
    summarizeOutput: summarize,
    execute: (context, input) => bridge(context, "read_skill", input),
  });
  register({
    id: "write_skill",
    version: 1,
    title: "Write AI skill",
    description:
      "Create or update a durable account skill after approval. The first skill always asks; later writes also require confirmation. Secrets and sensitive personal data are refused.",
    inputSchema: z
      .object({
        action: z.enum(["create", "update"]),
        skillId: z.string().trim().min(1).max(160).optional(),
        name: z.string().trim().min(2).max(USER_SKILL_LIMITS.nameCharacters),
        purpose: z
          .string()
          .trim()
          .min(8)
          .max(USER_SKILL_LIMITS.purposeCharacters),
        triggerTerms: z
          .array(
            z.string().trim().min(1).max(USER_SKILL_LIMITS.triggerCharacters),
          )
          .min(1)
          .max(USER_SKILL_LIMITS.triggerCount),
        body: z.string().trim().min(20).max(USER_SKILL_LIMITS.bodyCharacters),
      })
      .superRefine((value, context) => {
        if (value.action === "update" && !value.skillId)
          context.addIssue({
            code: "custom",
            path: ["skillId"],
            message: "Updating requires the exact skill id from list_skills.",
          });
        if (value.action === "create" && value.skillId)
          context.addIssue({
            code: "custom",
            path: ["skillId"],
            message: "Creating a skill does not accept an existing skill id.",
          });
      }),
    outputSchema: z.unknown(),
    capability: "operate_application",
    category: "write",
    risk: "medium",
    approval: "always",
    authorityTarget: "skill",
    parallelSafe: false,
    idempotent: false,
    concurrencyDomain: "user_skills",
    expectedDuration: "short",
    softStallAfter: 5_000,
    retryPolicy: noRetry,
    cancellable: true,
    resumable: true,
    summarizeOutput: summarize,
    execute: (context, input) => bridge(context, "write_skill", input),
  });
}

export const USER_SKILL_AGENT_TOOL_IDS = [
  "list_skills",
  "read_skill",
  "write_skill",
] as const;

registerUserSkillTools();
