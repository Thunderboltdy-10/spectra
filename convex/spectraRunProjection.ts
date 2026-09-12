import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const RUN_TAB_PROJECTION_VERSION = 3;
export const RESULT_CARD_SUMMARY_READ_MODEL_VERSION = 2;

const RUN_PROMPT_CHARS = 2_000;
const RUN_SUMMARY_CHARS = 1_200;
const RUN_ERROR_CHARS = 1_200;
const RUN_STEP_CHARS = 320;
const RUN_STEP_COUNT = 6;
const RUN_INPUT_PROMPT_CHARS = 600;
const RUN_INPUT_OPTION_CHARS = 160;

function bounded(value: unknown, limit: number) {
  return typeof value === "string" ? value.slice(0, limit) : undefined;
}

function exactString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function compactChoiceOption(option: Record<string, unknown>) {
  const title = exactString(option.title) ?? "Option";
  return {
    // Keys and titles are selection payload, not display copy. Keep them
    // byte-for-byte so a continuation can round-trip the offered identity.
    key: exactString(option.key),
    title,
    description: bounded(option.description, RUN_INPUT_OPTION_CHARS),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function compactInputRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const source = value as Record<string, unknown>;
  const kind = source.kind;
  if (kind === "choice") {
    const options = Array.isArray(source.options)
      ? source.options
          .filter(
            (option): option is Record<string, unknown> =>
              Boolean(option && typeof option === "object" && !Array.isArray(option)),
          )
          .map(compactChoiceOption)
      : [];
    const messageId = exactString(source.messageId);
    if (!messageId) return undefined;
    return {
      kind,
      messageId,
      clarificationId: exactString(source.clarificationId),
      executionId: exactString(source.executionId),
      prompt: bounded(source.prompt, RUN_INPUT_PROMPT_CHARS) ?? "Choose an option.",
      options,
    };
  }
  if (kind === "choice_batch") {
    const questions = Array.isArray(source.questions)
      ? source.questions
          .filter(
            (question): question is Record<string, unknown> =>
              Boolean(question && typeof question === "object" && !Array.isArray(question)),
          )
          .map((question) => ({
            id: exactString(question.id) ?? "question",
            prompt: bounded(question.prompt, RUN_INPUT_PROMPT_CHARS) ?? "Choose an option.",
            options: Array.isArray(question.options)
              ? question.options
                  .filter(
                    (option): option is Record<string, unknown> =>
                      Boolean(option && typeof option === "object" && !Array.isArray(option)),
                  )
                  .map(compactChoiceOption)
              : [],
          }))
      : [];
    const messageId = exactString(source.messageId);
    if (!messageId) return undefined;
    return {
      kind,
      messageId,
      clarificationId: exactString(source.clarificationId),
      executionId: exactString(source.executionId),
      questions,
    };
  }
  return undefined;
}

function compactDockSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const dockSummary = value as Record<string, unknown>;
  const recentSteps = Array.isArray(dockSummary.recentSteps)
    ? dockSummary.recentSteps
        .filter((step): step is string => typeof step === "string")
        .slice(-RUN_STEP_COUNT)
        .map((step) => step.slice(0, RUN_STEP_CHARS))
    : [];
  return {
    checkpointSummary: bounded(dockSummary.checkpointSummary, 600),
    recentSteps,
    inputRequest: compactInputRequest(dockSummary.inputRequest),
  };
}

/**
 * The Live Dock polls this shape. Keep it deliberately smaller than the run
 * document: context snapshots, plans, usage payloads, routing reasons and
 * approval detail belong to the run detail query, not the tab index.
 */
export function projectRunTabSummary(run: Doc<"spectraAiRuns">) {
  return {
    _id: run._id,
    executionId: run.executionId,
    attemptId: run.attemptId,
    outcome: run.outcome,
    status: run.status,
    phase: run.phase,
    sourceSurface: run.sourceSurface,
    threadId: run.threadId,
    workspaceId: run.workspaceId,
    artifactId: run.artifactId,
    userPrompt: run.userPrompt.slice(0, RUN_PROMPT_CHARS),
    decision: run.decision,
    finalSummary: run.finalSummary?.slice(0, RUN_SUMMARY_CHARS),
    error: run.error?.slice(0, RUN_ERROR_CHARS),
    modelUsed: run.modelUsed?.slice(0, 120),
    providerUsed: run.providerUsed?.slice(0, 120),
    attemptCount: run.attemptCount,
    recoveryState: run.recoveryState,
    retryable: run.retryable,
    traceDegraded: run.traceDegraded,
    selectedAgentId: run.selectedAgentId,
    selectedAgentVersionId: run.selectedAgentVersionId,
    dockSummary: compactDockSummary(run.dockSummary),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

/** Rebound old v1 rows before they cross the query/HTTP boundary. */
export function compactStoredRunTabSummary(
  summary: NonNullable<Doc<"spectraRunTabs">["runSummary"]>,
) {
  return {
    _id: summary._id,
    executionId: summary.executionId,
    attemptId: summary.attemptId,
    outcome: summary.outcome,
    status: summary.status,
    phase: summary.phase,
    sourceSurface: summary.sourceSurface,
    threadId: summary.threadId,
    workspaceId: summary.workspaceId,
    artifactId: summary.artifactId,
    userPrompt:
      typeof summary.userPrompt === "string"
        ? summary.userPrompt.slice(0, RUN_PROMPT_CHARS)
        : "",
    decision: summary.decision,
    finalSummary: bounded(summary.finalSummary, RUN_SUMMARY_CHARS),
    error: bounded(summary.error, RUN_ERROR_CHARS),
    modelUsed: bounded(summary.modelUsed, 120),
    providerUsed: bounded(summary.providerUsed, 120),
    attemptCount: summary.attemptCount,
    recoveryState: summary.recoveryState,
    retryable: summary.retryable,
    traceDegraded: summary.traceDegraded,
    selectedAgentId: summary.selectedAgentId,
    selectedAgentVersionId: summary.selectedAgentVersionId,
    dockSummary: compactDockSummary(summary.dockSummary),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

function compactResultCardRunSummary(
  summary: NonNullable<Doc<"spectraRunTabs">["runSummary"]>,
) {
  const { dockSummary: _dockSummary, ...cardRunSummary } =
    compactStoredRunTabSummary(summary);
  return cardRunSummary;
}

export function projectResultCardRunSummary(run: Doc<"spectraAiRuns">) {
  return compactResultCardRunSummary(projectRunTabSummary(run));
}

function compactProvenance(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const source = value as Record<string, unknown>;
  return {
    artifactIds: Array.isArray(source.artifactIds)
      ? source.artifactIds.filter((id): id is string => typeof id === "string").slice(0, 24)
      : undefined,
    artifactTitles: Array.isArray(source.artifactTitles)
      ? source.artifactTitles.filter((title): title is string => typeof title === "string").slice(0, 24).map((title) => title.slice(0, 240))
      : undefined,
    threadId: bounded(source.threadId, 160),
    workspaceId: bounded(source.workspaceId, 160),
    workspaceTitle: bounded(source.workspaceTitle, 240),
    attachmentNames: Array.isArray(source.attachmentNames)
      ? source.attachmentNames.filter((name): name is string => typeof name === "string").slice(0, 24).map((name) => name.slice(0, 160))
      : undefined,
    focusMode: bounded(source.focusMode, 40),
    agentId: bounded(source.agentId, 160),
    agentVersionId: bounded(source.agentVersionId, 160),
    agentTitle: bounded(source.agentTitle, 240),
    agentRoutingReason: bounded(source.agentRoutingReason, 400),
    agentRoutingSource: bounded(source.agentRoutingSource, 40),
  };
}

/** Result cards are metadata, but provenance is still untrusted `any`. */
export function compactResultCardForRead(card: Doc<"spectraResultCards">) {
  return {
    _id: card._id,
    runId: card.runId,
    surface: card.surface,
    workspaceId: card.workspaceId,
    artifactId: card.artifactId,
    status: card.status,
    variant: card.variant,
    title: card.title.slice(0, 240),
    summary: card.summary?.slice(0, 1_200),
    actions: card.actions.slice(0, 16).map((action) => ({
      key: action.key,
      label: action.label.slice(0, 240),
      targetType: action.targetType,
      targetId: action.targetId,
    })),
    hiddenAt: card.hiddenAt,
    keptAt: card.keptAt,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    provenance: compactProvenance(card.provenance),
  };
}

type ResultCardSummaryWriteCtx = Pick<MutationCtx, "db">;

/** Store the bounded card shape beside the canonical result card. */
export async function upsertResultCardSummary(
  ctx: ResultCardSummaryWriteCtx,
  card: Doc<"spectraResultCards">,
) {
  const compact = compactResultCardForRead(card);
  const candidateRunSummary =
    card.runSummary &&
    typeof card.runSummary === "object" &&
    !Array.isArray(card.runSummary)
      ? compactResultCardRunSummary(
          card.runSummary as NonNullable<Doc<"spectraRunTabs">["runSummary"]>,
        )
      : undefined;
  const existing = await ctx.db
    .query("spectraResultCardSummaries")
    .withIndex("by_card", (q) => q.eq("cardId", card._id))
    .unique();
  const storedRunSummary =
    existing?.runSummary &&
    typeof existing.runSummary === "object" &&
    !Array.isArray(existing.runSummary) &&
    existing.runSummary._id === card.runId
      ? compactResultCardRunSummary(
          existing.runSummary as NonNullable<Doc<"spectraRunTabs">["runSummary"]>,
        )
      : undefined;
  const candidateUpdatedAt =
    typeof candidateRunSummary?.updatedAt === "number"
      ? candidateRunSummary.updatedAt
      : 0;
  const storedUpdatedAt =
    typeof storedRunSummary?.updatedAt === "number"
      ? storedRunSummary.updatedAt
      : 0;
  // A card patch can follow a run-only trigger patch. In that case the
  // canonical card still carries its older embedded runSummary; keep the
  // newer compact value so card metadata writes cannot roll status backward.
  const runSummary =
    storedRunSummary && storedUpdatedAt > candidateUpdatedAt
      ? storedRunSummary
      : candidateRunSummary;
  const value = {
    readModelVersion: RESULT_CARD_SUMMARY_READ_MODEL_VERSION,
    cardId: card._id,
    runId: card.runId,
    ownerAccountId: card.ownerAccountId,
    schoolId: card.schoolId,
    surface: card.surface,
    workspaceId: card.workspaceId,
    artifactId: card.artifactId,
    status: card.status,
    variant: card.variant,
    title: compact.title,
    summary: compact.summary,
    actions: compact.actions,
    runSummary,
    provenance: compact.provenance,
    hiddenAt: compact.hiddenAt,
    keptAt: compact.keptAt,
    createdAt: compact.createdAt,
    updatedAt: compact.updatedAt,
  };
  if (existing) {
    const { _id: _summaryId, _creationTime: _created, ...previous } = existing;
    if (stableJson(previous) === stableJson(value)) return false;
    await ctx.db.patch(existing._id, value);
    return true;
  }
  await ctx.db.insert("spectraResultCardSummaries", value);
  return true;
}

export async function deleteResultCardSummary(
  ctx: ResultCardSummaryWriteCtx,
  cardId: Doc<"spectraResultCards">["_id"],
) {
  const existing = await ctx.db
    .query("spectraResultCardSummaries")
    .withIndex("by_card", (q) => q.eq("cardId", cardId))
    .unique();
  if (existing) await ctx.db.delete(existing._id);
}

export function compactStoredResultCardSummary(
  summary: Doc<"spectraResultCardSummaries">,
) {
  return {
    _id: summary.cardId,
    runId: summary.runId,
    surface: summary.surface,
    workspaceId: summary.workspaceId,
    artifactId: summary.artifactId,
    status: summary.status,
    variant: summary.variant,
    title: summary.title,
    summary: summary.summary,
    actions: summary.actions,
    hiddenAt: summary.hiddenAt,
    keptAt: summary.keptAt,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    provenance: summary.provenance,
  };
}
