import { ZodError } from "zod";
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
  return /plan|JSON|schema|structured|truncated|empty|incomplete|hollow|no meaningful stream|stall|timeout|synchroniz|AI_ARTIFACT_(?:SCHEMA|BASELINE|CONNECT|SYNC|CONNECTION)|outer object|closing|unexpected character|position \d+|generated (?:deck|quiz|planner task|timetable|code artifact|document|presentation|workbook|whiteboard|agent).*(?:must|omitted|hollow|no scheduled|incomplete)|requested (?:cards|questions|subtasks|due date|events)|more visible artifacts|unrelated to the interpreted request|does not match the interpreted request|Author (?:concrete time blocks|real source files)|Content patch index is out of range|did not contain the requested content change|reliability (?:context|time|token spend) budget|paused this agent after its reliability|stopped this agent after \d+ (?:model turns|tool calls)/i.test(
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
    return "Spectra mixed an answer with edit operations. Rephrase as either a question or a specific change to one open artifact.";
  }
  if (
    /operations$/.test(path) &&
    /require at least one operation/i.test(message)
  ) {
    return "Spectra planned an edit but did not name a concrete change. Open the target artifact and describe the exact update.";
  }
  if (/operations(\.\d+)?\.type/i.test(path)) {
    return "Spectra drafted an unsupported operation. Rephrase the request or open the artifact you want changed, then try again.";
  }
  if (
    /operations(\.\d+)?\.input\.(content|contentPatch|blueprintKey|title|tags)/i.test(
      path,
    )
  ) {
    return "Spectra drafted an incomplete edit plan. Keep the relevant artifact open and try a more specific request.";
  }
  if (/operations(\.\d+)?\.input/i.test(path)) {
    return "Spectra drafted an incomplete edit plan. Keep the relevant artifact open and try a more specific request.";
  }
  if (
    /intent\.(mode|requestedArtifactTypes|targetArtifactId|targetWorkspaceId)/i.test(
      path,
    )
  ) {
    return "Spectra misread the request intent. Name the artifact or workspace explicitly, or open it first, then try again.";
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
  return path
    ? `Spectra paused after its recovery passes (${path}). Your work is unchanged; retry when ready.`
    : "Spectra paused after its recovery passes. Your work is unchanged; retry when ready.";
}

export function formatPlanApplicationPublicError(error: unknown) {
  if (error instanceof ZodError) return formatZodPlanPublicError(error);
  if (error instanceof SyntaxError)
    return "I couldn't finish that response yet. Your work is unchanged, and you can try once more.";
  if (error instanceof TypeError)
    return "Spectra paused after its recovery passes. Your saved work is safe, and this run can be retried.";
  const message =
    error instanceof Error ? error.message : "Spectra run failed.";
  if (/AI_ARTIFACT_REGION_BUSY/i.test(message)) {
    return "That control is still being edited. Spectra left it untouched; finish the active edit and retry.";
  }
  if (
    /\b(artifactId|workspaceId|threadId|plannerItemId|operationId|sourceId|targetId|object ID|database id|owned id)\b/i.test(
      message,
    )
  ) {
    return "Spectra could not match that request to an open or selected object. Choose the document or workspace you want to use, then try again.";
  }
  if (
    /unrelated to the interpreted request|does not match the interpreted request|more visible artifacts/i.test(
      message,
    )
  ) {
    return "Spectra's draft did not match the selected object or request. Open the intended artifact or workspace and try a more specific prompt.";
  }
  if (/hollow\/incomplete|no scheduled events|empty <main>/i.test(message)) {
    return "Spectra's draft was empty or incomplete, so nothing was saved. Try again with a clearer request.";
  }
  if (
    /\bJSON|schema|Zod|planner|operation|structured output|FunctionPathNotFound|Convex\b/i.test(
      message,
    )
  ) {
    return "Spectra paused after trying to repair the response. Your saved work is unchanged; retry when ready.";
  }
  if (
    /\b(OpenRouter|provider|network|fetch failed|connection|stream failed|no meaningful stream data)\b/i.test(
      message,
    )
  ) {
    return "Spectra lost its model connection before the run could finish. Your saved context is intact; retry when the connection is stable.";
  }
  return message.length > 240 ? `${message.slice(0, 237)}…` : message;
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
  return alignIntentWithCreates(plan);
}
