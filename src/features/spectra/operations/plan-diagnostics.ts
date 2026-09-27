import { ZodError } from "zod";
import { humanizePublicFailure } from "@/features/spectra/bridge/humanize";
import { alignIntentWithCreates } from "./intent-alignment";

/**
 * Bounded model-side plan repair is appropriate for syntax/schema slips that
 * still preserve the user's requested meaning. Ownership/policy failures are
 * not repairable by regenerating JSON alone.
 *
 * Also covers one-shot recoveries for provider idle stalls and live-artifact
 * sync races where a careful second pass (or a short finalize wait) succeeds
 * without changing the user's request.
 */
export function isRepairablePlanFailure(error: unknown) {
  if (error instanceof SyntaxError || error instanceof ZodError) return true;
  return /PRESENTATION_CITATION_EVIDENCE_REQUIRED|plan|JSON|schema|structured|truncated|empty|incomplete|hollow|no meaningful stream|stall|outer object|closing|unexpected character|position \d+|artifact quality critique|shared (?:presentation|sheets|document) rubric|generated (?:deck|quiz|planner task|timetable|code artifact|document|presentation|workbook|whiteboard|agent).*(?:must|omitted|hollow|no scheduled|incomplete)|requested (?:cards|questions|subtasks|due date|events)|more visible artifacts|unrelated to the interpreted request|does not match the interpreted request|Author (?:concrete time blocks|real source files)|Content patch index is out of range|did not contain the requested content change|reliability (?:context|time|token spend) budget|paused this agent after its reliability|stopped this agent after \d+ (?:model turns|tool calls)|update-only request names every exact target|outside that scope/i.test(
    error instanceof Error ? error.message : "",
  );
}

function quietRetryFailureMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return String(error);
  } catch {
    return "";
  }
}

/** Apply-time misses that a quiet second attempt (or short wait) can clear. */
export function isQuietRetryableApplyFailure(error: unknown) {
  if (isRepairablePlanFailure(error)) return true;
  // Sheets/presentation region materialization and sparse Yjs trees can throw a
  // raw TypeError before our path helpers rewrite it into a typed AI error.
  if (error instanceof TypeError) return true;
  return /has not finished synchronizing|synchronized AI version is unavailable|AI_ARTIFACT_(?:CONNECT|SYNC|CONNECTION|INITIALIZATION|BASELINE|LIVE_STATE|SCHEMA)|ARTIFACT_REGION_PATH_INVALID|live artifact model is unavailable|Cannot set propert(?:y|ies) .*\bundefined\b|undefined is not an object|Invalid input(?: at [\w.[\]"]+)?:|expected string, received undefined|rowIdentities|columnIdentities/i.test(
    quietRetryFailureMessage(error),
  );
}

/**
 * Zod reports a failed blueprint union as one `invalid_union` issue. That hides
 * the useful nested reason from both the repair prompt and local diagnostics.
 * Prefer the branch whose blueprint discriminator matched, then retain a
 * bounded set of actionable leaf paths.
 */
export function describeZodPlanIssues(error: ZodError, limit = 12) {
  type IssueLike = {
    code?: string;
    message?: string;
    path?: Array<string | number>;
    errors?: unknown;
  };
  const flattened: Array<{ path: string; code: string; message: string }> = [];
  const visit = (issues: unknown[]) => {
    for (const value of issues) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const issue = value as IssueLike;
      const nested = Array.isArray(issue.errors)
        ? issue.errors.filter(Array.isArray) as unknown[][]
        : [];
      if (issue.code === "invalid_union" && nested.length) {
        const matchingBlueprintBranches = nested.filter((branch) =>
          !branch.some((candidate) => {
            if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
            const child = candidate as IssueLike;
            return child.code === "invalid_value" && child.path?.at(-1) === "blueprintKey";
          }),
        );
        const branches = matchingBlueprintBranches.length
          ? matchingBlueprintBranches
          : [...nested].sort((left, right) => left.length - right.length).slice(0, 2);
        for (const branch of branches) visit(branch);
        continue;
      }
      flattened.push({
        path: (issue.path ?? []).map(String).join("."),
        code: issue.code ?? "unknown",
        message: issue.message ?? "Invalid value",
      });
    }
  };
  visit(error.issues);
  return flattened.slice(0, Math.max(1, limit));
}

export function formatZodPlanPublicError(error: ZodError) {
  const issue = error.issues[0];
  const path = issue?.path.join(".") ?? "";
  const message = issue?.message ?? "";

  if (
    /artifactId|workspaceId|threadId|plannerItemId|operationId|sourceId|targetId|_id/i.test(
      path,
    )
  ) {
    return "Spectra could not match that request to an open or selected object. Choose the document or workspace you want to use, then try again.";
  }
  if (/operations$/.test(path) && /cannot contain operations/i.test(message)) {
    return "Spectra mixed an answer with an edit. Ask it as a question, or name one change to make in the work you have open.";
  }
  if (
    /operations$/.test(path) &&
    /require at least one operation/i.test(message)
  ) {
    return "Spectra planned an edit but did not name a concrete change. Open the work you want changed and describe the exact update.";
  }
  if (/operations(\.\d+)?\.type/i.test(path)) {
    return "Spectra drafted a change it cannot make. Rephrase the request or open the work you want changed, then try again.";
  }
  if (
    /operations(\.\d+)?\.input\.(content|contentPatch|blueprintKey|title|tags)/i.test(
      path,
    )
  ) {
    return "Spectra drafted an incomplete edit. Keep the work open and try a more specific request.";
  }
  if (/operations(\.\d+)?\.input/i.test(path)) {
    return "Spectra drafted an incomplete edit. Keep the work open and try a more specific request.";
  }
  if (
    /intent\.(mode|requestedArtifactTypes|targetArtifactId|targetWorkspaceId)/i.test(
      path,
    )
  ) {
    return "Spectra was not sure what you meant. Name the work or workspace, or open it first, then try again.";
  }
  if (/choices(\.|$)/i.test(path)) {
    return "Spectra needs a clearer choice from you. Reply with one of the options, or name the object to use.";
  }
  if (/conversationTitle|conversationSummary/i.test(path)) {
    return "Spectra returned an incomplete response plan. Your work is unchanged — try again in a moment.";
  }
  if (/decision|finalResponse|blueprintKey/i.test(path)) {
    return "Spectra returned an incomplete response plan. Your work is unchanged — try again in a moment.";
  }
  // The failing schema path is logged by the caller; it is not a sentence.
  return "Spectra could not finish this response. Your work is unchanged; try again when you are ready.";
}

export function formatPlanApplicationPublicError(error: unknown, options?: { explanationOnly?: boolean }) {
  const explanationOnly = options?.explanationOnly === true;
  if (error instanceof ZodError) return explanationOnly
    ? "The response did not pass validation."
    : formatZodPlanPublicError(error);
  if (error instanceof SyntaxError)
    return explanationOnly ? "The response could not be parsed."
      : "I couldn't finish that response yet. Your work is unchanged, and you can try once more.";
  if (error instanceof TypeError)
    return explanationOnly ? "The run could not finish its remaining steps."
      : "Spectra could not finish its remaining steps. Your saved work is safe, and you can retry this run.";
  const message =
    error instanceof Error ? error.message : "Spectra run failed.";
  if (/PRESENTATION_CITATION_EVIDENCE_REQUIRED/i.test(message)) {
    return explanationOnly
      ? "This presentation needs verified citations on its narrative slides. Keep the cited sources in this conversation for the citation repair."
      : "This presentation needs verified citations on its narrative slides. Keep the cited sources in this conversation and ask Spectra to restore the citations; no change was saved.";
  }
  if (/AI_ARTIFACT_REGION_BUSY/i.test(message)) {
    return explanationOnly ? "That control is still being edited. Finish the active edit before continuing."
      : "That control is still being edited. Spectra left it untouched; finish the active edit and retry.";
  }
  // Convex ArgumentValidationError "Path: .operationId" and REGION_CLAIM_* are
  // apply machinery, not a missing selected object. Mapping those to targeting
  // hid live Undo: restore sent a synthetic revert id into v.id("spectraOperations").
  const isApplyMachinery =
    /ArgumentValidationError|Validator:|Path:\s*\.|REGION_CLAIM_/i.test(
      message,
    );
  if (
    !isApplyMachinery &&
    /\b(artifactId|workspaceId|threadId|plannerItemId|operationId|sourceId|targetId|object ID|database id|owned id)\b/i.test(
      message,
    )
  ) {
    return "Spectra could not match that request to an open or selected object. Choose the document or workspace you want to use, then try again.";
  }
  if (isApplyMachinery) {
    return explanationOnly ? "The change could not be fully processed."
      : "Spectra could not apply that change. Your saved work is unchanged; retry when ready.";
  }
  if (
    /unrelated to the interpreted request|does not match the interpreted request|more visible artifacts/i.test(
      message,
    )
  ) {
    return "Spectra's draft did not match what you selected or asked for. Open the work or workspace you meant and try a more specific request.";
  }
  if (/hollow\/incomplete|no scheduled events|empty <main>/i.test(message)) {
    return explanationOnly ? "The result did not pass its completeness check."
      : "Spectra's draft was empty or incomplete, so nothing was saved. Try again with a clearer request.";
  }
  if (
    /\bJSON|schema|Zod|planner|operation|structured output|FunctionPathNotFound\b/i.test(
      message,
    )
  ) {
    return explanationOnly ? "The response did not pass its operation or format checks."
      : "Spectra paused after trying to repair the response. Your saved work is unchanged; retry when ready.";
  }
  if (
    /\b(OpenRouter|provider|network|fetch failed|connection|stream failed|no meaningful stream data)\b/i.test(
      message,
    )
  ) {
    return explanationOnly ? "The model connection ended before the run could finish."
      : "Spectra lost its model connection before the run could finish. Your saved context is intact; retry when the connection is stable.";
  }
  // The general Bridge map also asserts save/native outcomes from error codes.
  // Failure reporting supplies those facts separately from durable receipts.
  return explanationOnly ? "The remaining step could not be completed."
    : humanizePublicFailure(message);
}

/** Prompt context and top-level reply fields are not part of strict intent. */
export function stripNonIntentContextFields<T>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const plan = value as Record<string, unknown>;
  const intent = plan.intent;
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) return value;
  delete (intent as Record<string, unknown>).focus;
  delete (intent as Record<string, unknown>).activeGoal;
  delete (intent as Record<string, unknown>).finalResponse;
  return value;
}

/** Harmless envelope slips models emit that Zod would otherwise reject. */
export function coerceCommonPlanSchemaSlips(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  let source = value as Record<string, unknown>;
  // Terminal tool envelopes often look like `{ workSummary, plan }`. Unwrap
  // before stripping unknown keys so nested decision/intent/operations survive.
  if (
    source.plan &&
    typeof source.plan === "object" &&
    !Array.isArray(source.plan)
  ) {
    const nested = source.plan as Record<string, unknown>;
    const outerLooksLikePlan =
      typeof source.decision === "string" && Array.isArray(source.operations);
    if (!outerLooksLikePlan) source = nested;
  }
  const allowed = new Set([
    "decision",
    "intent",
    "conversationTitle",
    "conversationSummary",
    "choices",
    "finalResponse",
    "presentedArtifactIds",
    "operations",
  ]);
  const plan: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (allowed.has(key)) plan[key] = entry;
  }
  if (
    typeof plan.finalResponse === "number" ||
    typeof plan.finalResponse === "boolean"
  )
    plan.finalResponse = String(plan.finalResponse);
  if (plan.finalResponse == null) plan.finalResponse = "";
  if (typeof plan.finalResponse === "string" && !plan.finalResponse.trim()) {
    const ops = Array.isArray(plan.operations) ? plan.operations : [];
    plan.finalResponse = ops.length
      ? "Done — the requested changes are ready."
      : "Done.";
  }
  if (!Array.isArray(plan.operations)) plan.operations = [];
  if (!Array.isArray(plan.presentedArtifactIds)) plan.presentedArtifactIds = [];
  if (plan.choices === undefined) plan.choices = null;
  if (plan.conversationTitle === undefined) plan.conversationTitle = null;
  if (
    typeof plan.conversationTitle === "string" &&
    !plan.conversationTitle.trim()
  )
    plan.conversationTitle = null;
  if (plan.conversationSummary === undefined) plan.conversationSummary = null;
  if (
    typeof plan.conversationSummary === "string" &&
    !plan.conversationSummary.trim()
  )
    plan.conversationSummary = null;
  if (
    typeof plan.decision !== "string" ||
    !["operate", "answer", "clarify", "refuse"].includes(plan.decision)
  ) {
    plan.decision =
      Array.isArray(plan.operations) && plan.operations.length > 0
        ? "operate"
        : "answer";
  }
  if (
    !plan.intent ||
    typeof plan.intent !== "object" ||
    Array.isArray(plan.intent)
  ) {
    const ops = Array.isArray(plan.operations) ? plan.operations : [];
    const create = ops.some(
      (operation) =>
        operation &&
        typeof operation === "object" &&
        !Array.isArray(operation) &&
        (operation as Record<string, unknown>).type === "artifact.create",
    );
    plan.intent = {
      mode:
        plan.decision === "operate" ? (create ? "create" : "update") : "answer",
      requestedArtifactTypes: [],
      requestedVisibleArtifactCount: 0,
      targetArtifactId: null,
      targetWorkspaceId: null,
    };
  } else {
    const intent = { ...(plan.intent as Record<string, unknown>) };
    if (!Array.isArray(intent.requestedArtifactTypes))
      intent.requestedArtifactTypes = [];
    if (typeof intent.requestedVisibleArtifactCount !== "number")
      intent.requestedVisibleArtifactCount = 0;
    if (!("targetArtifactId" in intent)) intent.targetArtifactId = null;
    if (!("targetWorkspaceId" in intent)) intent.targetWorkspaceId = null;
    plan.intent = intent;
  }
  if (
    plan.decision === "operate" &&
    Array.isArray(plan.operations) &&
    plan.operations.length === 0 &&
    typeof plan.finalResponse === "string" &&
    /\?|which|what|clarify|choose|pick|select/i.test(plan.finalResponse)
  ) {
    plan.decision = "clarify";
  }
  if (
    plan.decision !== "operate" &&
    plan.intent &&
    typeof plan.intent === "object" &&
    !Array.isArray(plan.intent)
  ) {
    // Operation indexes have no meaning once this plan becomes a reply,
    // clarification, or refusal. Target resolution can discard an edit plan
    // when it needs the user to choose between otherwise valid targets.
    delete (plan.intent as Record<string, unknown>).obligations;
  }
  if (
    (plan.decision === "answer" ||
      plan.decision === "clarify" ||
      plan.decision === "refuse") &&
    Array.isArray(plan.operations) &&
    plan.operations.length > 0 &&
    typeof plan.finalResponse === "string" &&
    plan.finalResponse.trim()
  ) {
    // Prefer the conversational reply over a contradictory operate envelope.
    plan.operations = [];
  }
  const operationList = plan.operations;
  if (
    plan.decision === "operate" &&
    Array.isArray(operationList) &&
    operationList.length > 0 &&
    plan.intent &&
    typeof plan.intent === "object" &&
    !Array.isArray(plan.intent)
  ) {
    const intent = plan.intent as Record<string, unknown>;
    const obligations = Array.isArray(intent.obligations)
      ? intent.obligations.filter(
          (obligation): obligation is Record<string, unknown> =>
            Boolean(obligation) &&
            typeof obligation === "object" &&
            !Array.isArray(obligation),
        )
      : [];
    const missing = obligations.filter(
      (obligation) =>
        !Array.isArray(obligation.operationIndexes) ||
        obligation.operationIndexes.length === 0,
    );
    const covered = new Set(
      obligations.flatMap((obligation) =>
        Array.isArray(obligation.operationIndexes)
          ? obligation.operationIndexes.filter(
              (index): index is number =>
                Number.isInteger(index) &&
                index >= 0 &&
                index < operationList.length,
            )
          : [],
      ),
    );
    const unassigned = operationList
      .map((_, index) => index)
      .filter((index) => !covered.has(index));
    // Operation indexes are bookkeeping, not target authority. Repair only a
    // mapping that is unambiguous: one empty obligation can own all remaining
    // operations, or multiple empty obligations each have exactly one.
    if (missing.length === 1 && unassigned.length > 0) {
      missing[0]!.operationIndexes = unassigned;
    } else if (
      missing.length > 1 &&
      missing.length === unassigned.length
    ) {
      missing.forEach((obligation, index) => {
        obligation.operationIndexes = [unassigned[index]!];
      });
    }
  }
  return alignIntentWithCreates(plan);
}
