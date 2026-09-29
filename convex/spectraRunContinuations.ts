import { query } from "./functions";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./orgNodeMutation";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";
import { applicationOperationScope } from "./spectraApplicationWriteScope";
import { requireArtifactCapability, requireWorkspaceCapability } from "./spectraShared";
import type { ModelOperation } from "../src/features/spectra/operations/schema";
import {
  mapOperationArtifactReferences,
  validateOperationDependencies,
} from "../src/features/spectra/operations/dependencies";

/**
 * Durable state of one request that paused for a clarification question.
 *
 * The complete original request and every consumed answer travel with each
 * continuation run, so a second or third question cannot shrink the goal to
 * the latest answer. Staged candidates are unexecuted model proposals: they
 * are never operations, approvals or receipts, and every later effect still
 * passes the ordinary plan validation, approval and write guards.
 *
 * Each candidate keeps the source revisions it was validated against. A
 * candidate carried unchanged through a later question keeps its original
 * evidence, so a source edited in between can never be re-stamped as fresh.
 */
export type ClarificationDisposition = "accepted" | "needs_revalidation" | "withdrawn";
type StoredCandidate = {
  operation: { type: string; input: unknown };
  disposition: ClarificationDisposition;
  sources: Record<string, string>;
};
type ClarificationContinuation = {
  version: 1;
  originalRequest: string;
  responses: string[];
  sourceRunId?: Id<"spectraAiRuns">;
  candidates: StoredCandidate[];
  candidatesOmitted?: boolean;
};

const MAX_CANDIDATES = 100;
// The run document shares Convex's 1 MB limit with its other state.
const MAX_CANDIDATE_CHARACTERS = 600_000;
const MAX_RESPONSES = 32;
const MAX_RESPONSE_CHARACTERS = 200_000;
const UNAVAILABLE = "unavailable";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readContinuation(run: Doc<"spectraAiRuns">): ClarificationContinuation | null {
  const value = record(run.clarificationContinuation);
  if (value.version !== 1 || typeof value.originalRequest !== "string") return null;
  return {
    version: 1,
    originalRequest: value.originalRequest,
    responses: Array.isArray(value.responses)
      ? value.responses.filter((entry): entry is string => typeof entry === "string")
      : [],
    sourceRunId: typeof value.sourceRunId === "string" ? (value.sourceRunId as Id<"spectraAiRuns">) : undefined,
    candidates: Array.isArray(value.candidates) ? (value.candidates as StoredCandidate[]) : [],
    candidatesOmitted: value.candidatesOmitted === true,
  };
}

function candidateOperation(value: unknown) {
  const operation = record(value);
  if (typeof operation.type !== "string" || !operation.type || !operation.input || typeof operation.input !== "object")
    throw new Error("A staged clarification candidate is not a typed operation.");
  return { type: operation.type, input: operation.input };
}

/** Readable source identity only. Revision evidence is never a write grant. */
async function currentSources(ctx: QueryCtx | MutationCtx, operation: { type: string; input: unknown }) {
  const artifactIds = new Set<string>();
  const workspaceIds = new Set<string>();
  try {
    mapOperationArtifactReferences(operation as ModelOperation, (id) => {
      if (!id.startsWith("@created:")) artifactIds.add(id);
      return id;
    });
  } catch {
    throw new Error("A staged clarification candidate has malformed artifact references.");
  }
  const input = record(operation.input);
  const args = record(input.args);
  if (typeof input.workspaceId === "string") workspaceIds.add(input.workspaceId);
  if (operation.type === "app.command" && args.destination === "workspace" && typeof args.targetId === "string")
    workspaceIds.add(args.targetId);
  if (operation.type === "app.command" && args.resourceType === "workspace" && typeof args.resourceId === "string")
    workspaceIds.add(args.resourceId);
  const sources: Record<string, string> = {};
  for (const id of artifactIds) {
    const artifactId = ctx.db.normalizeId("spectraArtifacts", id);
    sources[`artifact:${id}`] = artifactId
      ? await requireArtifactCapability(ctx, artifactId).then(
          ({ artifact }) => artifact.status === "deleted" ? UNAVAILABLE : applicationOperationScope({ type: "revision", input: {
            updatedAt: artifact.updatedAt, currentVersionId: artifact.currentVersionId,
            contentHash: artifact.contentHash, liveStateVectorHash: artifact.liveStateVectorHash,
          } }),
          () => UNAVAILABLE,
        )
      : UNAVAILABLE;
  }
  for (const id of workspaceIds) {
    const workspaceId = ctx.db.normalizeId("spectraWorkspaces", id);
    sources[`workspace:${id}`] = workspaceId
      ? await requireWorkspaceCapability(ctx, workspaceId).then(
          ({ workspace }) => `${workspace.status}:${workspace.updatedAt}`,
          () => UNAVAILABLE,
        )
      : UNAVAILABLE;
  }
  return sources;
}

function sameSources(stored: Record<string, string>, current: Record<string, string>) {
  const keys = Object.keys(current);
  return keys.length === Object.keys(stored).length &&
    keys.every((key) => current[key] !== UNAVAILABLE && stored[key] === current[key]);
}

async function requireCurrentRun(
  ctx: QueryCtx | MutationCtx,
  runId: Id<"spectraAiRuns">,
  executionId: string,
) {
  const actor = await getAuthenticatedActor(ctx);
  const run = await ctx.db.get(runId);
  if (!actor || !run || run.ownerAccountId !== actor._id || run.schoolId !== actor.schoolId ||
    run.executionId !== executionId || (run.status !== "queued" && run.status !== "running"))
    throw new Error("This clarification continuation is unavailable for the current request.");
  return run;
}

/** Store the staged graph of a run that is about to ask the user a question. */
export const park = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    candidates: v.array(v.object({
      operation: v.any(),
      disposition: v.union(v.literal("accepted"), v.literal("needs_revalidation"), v.literal("withdrawn")),
      carried: v.optional(v.boolean()),
    })),
    /** The attempt could not reload earlier staged work under the current schema. */
    omitted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const run = await requireCurrentRun(ctx, args.runId, args.executionId);
    if (run.status !== "running") throw new Error("This request is not preparing a clarification.");
    const prior = readContinuation(run);
    const operations = args.candidates.map((candidate) => candidateOperation(candidate.operation));
    const oversized = operations.length > MAX_CANDIDATES ||
      JSON.stringify(operations).length > MAX_CANDIDATE_CHARACTERS;
    const candidates: StoredCandidate[] = [];
    if (!oversized) {
      validateOperationDependencies(operations as ModelOperation[]);
      for (const [index, operation] of operations.entries()) {
        const requested = args.candidates[index]!;
        const previous = prior?.candidates[index];
        // Carried identity is exact: the same position and the same typed
        // bytes. Anything else is a new proposal validated in this attempt.
        const carried = requested.carried === true && previous &&
          applicationOperationScope(previous.operation) === applicationOperationScope(operation);
        const disposition: ClarificationDisposition = requested.disposition === "withdrawn"
          ? "withdrawn"
          : requested.disposition === "needs_revalidation" || (carried && previous.disposition !== "accepted")
            ? "needs_revalidation"
            : "accepted";
        const sources = carried ? previous.sources : await currentSources(ctx, operation);
        candidates.push({
          operation,
          sources,
          disposition: disposition === "accepted" && Object.values(sources).includes(UNAVAILABLE)
            ? "needs_revalidation" : disposition,
        });
      }
    }
    const continuation: ClarificationContinuation = {
      version: 1,
      originalRequest: prior?.originalRequest ?? run.userPrompt,
      responses: prior?.responses ?? [],
      ...(prior?.sourceRunId ? { sourceRunId: prior.sourceRunId } : {}),
      candidates,
      // Oversized staged work is not truncated. The request survives and the
      // continuation is told to prepare that work again.
      ...(oversized || args.omitted || prior?.candidatesOmitted ? { candidatesOmitted: true } : {}),
    };
    await ctx.db.patch(run._id, { clarificationContinuation: continuation, updatedAt: Date.now() });
    return { parked: candidates.length, omitted: oversized };
  },
});

/** Authenticated server restoration for the current attempt of a continuation run. */
export const restore = query({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const run = await requireCurrentRun(ctx, args.runId, args.executionId);
    const continuation = readContinuation(run);
    if (!continuation) return null;
    const candidates = [];
    for (const candidate of continuation.candidates) {
      const disposition: ClarificationDisposition = candidate.disposition === "withdrawn"
        ? "withdrawn"
        : candidate.disposition === "accepted" && sameSources(candidate.sources, await currentSources(ctx, candidate.operation))
          ? "accepted"
          : "needs_revalidation";
      candidates.push({ operation: candidate.operation, disposition });
    }
    return {
      originalRequest: continuation.originalRequest,
      clarificationResponses: continuation.responses,
      candidates,
      candidatesOmitted: continuation.candidatesOmitted === true,
    };
  },
});

/**
 * Called only inside beginRun's authenticated transaction that consumes the
 * answer. The new run owns the durable request; the answered run keeps none,
 * so retention of the old run cannot delete active work and nothing is copied
 * twice.
 */
export async function transferClarificationContinuation(
  ctx: MutationCtx,
  source: Doc<"spectraAiRuns">,
  destination: Doc<"spectraAiRuns">,
) {
  if (source.status !== "awaiting_resolution" || source.ownerAccountId !== destination.ownerAccountId ||
    source.schoolId !== destination.schoolId || !source.threadId || source.threadId !== destination.threadId)
    throw new Error("This clarification cannot be continued in another conversation.");
  const prior = readContinuation(source);
  const question = (source.finalSummary ?? "").trim().slice(0, 2_000);
  const responses = [
    ...(prior?.responses ?? []),
    question ? `Spectra asked: ${question}\nUser answered: ${destination.userPrompt}` : destination.userPrompt,
  ];
  if (responses.length > MAX_RESPONSES || responses.join("").length > MAX_RESPONSE_CHARACTERS)
    throw new Error("This request has been clarified too many times to continue safely. Start a new request with the full details.");
  const continuation: ClarificationContinuation = {
    version: 1,
    originalRequest: prior?.originalRequest ?? source.userPrompt,
    responses,
    sourceRunId: source._id,
    candidates: prior?.candidates ?? [],
    ...(prior?.candidatesOmitted ? { candidatesOmitted: true } : {}),
  };
  await ctx.db.patch(destination._id, { clarificationContinuation: continuation });
  if (prior) await ctx.db.patch(source._id, { clarificationContinuation: undefined });
}
