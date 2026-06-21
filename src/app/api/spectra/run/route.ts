import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { getSpectraModelId, SPECTRA_OPENROUTER_PROVIDER_ROUTING } from "@/features/spectra/ai/model-config";
import { evaluatePlanPolicy } from "@/features/spectra/operations/policy";
import {
  parseModelOperation,
  parseSpectraPlan,
  requestIntentSchema,
  SPECTRA_PLAN_JSON_SCHEMA,
  type ModelOperation,
  type SpectraPlan,
} from "@/features/spectra/operations/schema";
import { validatePlanAgainstIntent, type OwnedOperationReferences } from "@/features/spectra/operations/validate-plan";
import { validateBlueprintContent } from "@/features/spectra/blueprints/registry";

export const runtime = "nodejs";

type Surface = "chat" | "workspace" | "artifacts" | "artifact";
type Body = {
  action?: "run" | "retry" | "confirm" | "cancel";
  prompt?: string;
  surface?: Surface;
  workspaceId?: string;
  artifactId?: string;
  runId?: string;
};

type StoredOperation = { _id: string; type: string; input: unknown; status: "proposed" | "executing" | "executed" | "failed" | "cancelled"; requiresConfirmation?: boolean };
type ResultAction = { key: string; label: string; targetType?: "artifact" | "thread" | "run" | "workspace"; targetId?: string };
type Card = { _id: string; runId: string; status: "queued" | "running" | "awaiting_confirmation" | "completed" | "failed" | "cancelled"; title: string; summary?: string; variant: "status" | "artifact" | "thread" | "operation" | "error"; actions: ResultAction[]; updatedAt: number };
type RunState = { status: Card["status"]; sourceSurface: "chat" | "workspace" | "artifact"; workspaceId?: string; artifactId?: string; userPrompt: string; finalSummary?: string; decision?: SpectraPlan["decision"]; planIntent?: unknown };
type RunDetail = { run: RunState; cards: Card[]; operations: StoredOperation[] };

function withJsExtension(functionName: string) {
  const [moduleName, exportName] = functionName.split(":");
  return !moduleName || !exportName || moduleName.endsWith(".js") ? functionName : `${moduleName}.js:${exportName}`;
}

function missingFunction(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("FunctionPathNotFound") || message.includes("Could not find public function");
}

async function query<TArgs extends object, TResult>(name: string, args: TArgs) {
  try { return await convexQuery<TArgs, TResult>(name, args); }
  catch (error) { if (!missingFunction(error)) throw error; return convexQuery<TArgs, TResult>(withJsExtension(name), args); }
}

async function mutate<TArgs extends object, TResult>(name: string, args: TArgs) {
  try { return await convexMutation<TArgs, TResult>(name, args); }
  catch (error) { if (!missingFunction(error)) throw error; return convexMutation<TArgs, TResult>(withJsExtension(name), args); }
}

function streamCard(card: Card) {
  return { id: card._id, runId: card.runId, status: card.status, title: card.title, summary: card.summary, variant: card.variant, actions: card.actions, updatedAt: card.updatedAt };
}

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "string" && item.length > 4_000) return `${item.slice(0, 4_000)}…`;
    if (Array.isArray(item) && item.length > 200) return [...item.slice(0, 200), "…"];
    return item;
  });
}

function systemPrompt(surface: Surface) {
  const common = `You are Spectra's controlled school-work planner. Return only the strict JSON plan.

First classify the request as answer, operate, clarify, or refuse. The intent mode must describe the requested operation; focus is only a hint. Advice, explanation, and questions use decision=answer with zero operations. Ambiguous targets use clarify with zero operations. Unsupported or unsafe work uses refuse with zero operations.

Use operation ids only when the exact id is present in owned context. Never invent, combine, prefix, suffix, or transform an id. Never use an operation key as a database id. A flashcard deck is ONE artifact with content.cards[]. A quiz is ONE artifact with content.questions[]. Memory cues belong in each flashcard's hint. Multiple-choice correctAnswer must exactly match one option. Planner tasks use one planner_task artifact. Thread references use threadId=null when no real owned thread id exists.

artifact.create already places a new artifact according to placement; never add a separate workspaceItem.add for that newly generated artifact. For artifact.update include blueprintKey and return the complete canonical content for that blueprint.

Do not emit workspaceItem.add or workspaceItem.hide unless the user explicitly requested placement or removal. Do not mutate a focused artifact when the user asks for advice, says to ignore it, or asks to create a different object. If more than five visible artifacts are requested, ask to confirm a smaller batch using decision=clarify and zero operations. finalResponse is the clean answer/result, never progress text or future-tense filler.`;
  if (surface === "chat") return `${common}\nThis is conversational chat. New artifacts use placement=inbox unless an owned workspace was explicitly requested.`;
  if (surface === "workspace") return `${common}\nThis is an action-oriented workspace. A newly requested artifact defaults to placement=context and the current workspace. Keep finalResponse compact.`;
  if (surface === "artifacts") return `${common}\nThis is the artifact library. New artifacts default to placement=inbox. A recently focused object is not an implicit mutation target.`;
  return `${common}\nThis is Artifact Studio. The open artifact is a strong context hint only when the prompt refers to it. Keep finalResponse compact.`;
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function summarizeArtifact(artifact: Record<string, unknown>, includeContent = false) {
  return {
    id: artifact._id,
    blueprintKey: artifact.blueprintKey,
    title: artifact.title,
    summary: artifact.summary,
    placements: rows(artifact.placements).map((placement) => ({ workspaceId: placement.workspaceId, workspaceTitle: placement.workspaceTitle, workspaceItemId: placement.workspaceItemId })),
    ...(includeContent ? { content: artifact.content } : {}),
  };
}

async function buildContext(actorClerkId: string, body: Pick<Body, "workspaceId" | "artifactId">) {
  const [artifactRows, workspaceRows, workspace, focusedArtifact] = await Promise.all([
    query<unknown & object, unknown>("spectraArtifacts:list", { actorClerkId, placement: "all", limit: 60 }),
    query<unknown & object, unknown>("spectraWorkspaces:list", { actorClerkId, includeArchived: false, limit: 30 }),
    body.workspaceId ? query<unknown & object, unknown>("spectraWorkspaceItems:listForWorkspace", { actorClerkId, workspaceId: body.workspaceId }).catch(() => null) : Promise.resolve(null),
    body.artifactId ? query<unknown & object, unknown>("spectraArtifacts:get", { actorClerkId, artifactId: body.artifactId }).catch(() => null) : Promise.resolve(null),
  ]);
  const artifacts = rows(artifactRows);
  const workspaces = rows(workspaceRows).map((item) => ({ id: item._id, title: item.title, description: item.description }));
  const workspaceRecord = workspace && typeof workspace === "object" ? workspace as Record<string, unknown> : null;
  const focusedRecord = focusedArtifact && typeof focusedArtifact === "object" ? focusedArtifact as Record<string, unknown> : null;
  return {
    workspaces,
    currentWorkspace: workspaceRecord ? {
      id: (workspaceRecord.workspace as Record<string, unknown> | undefined)?._id,
      title: (workspaceRecord.workspace as Record<string, unknown> | undefined)?.title,
      items: rows(workspaceRecord.items).map((item) => ({ id: item._id, workspaceId: item.workspaceId, sourceType: item.sourceType, sourceId: item.sourceId, artifact: item.artifact && typeof item.artifact === "object" ? summarizeArtifact(item.artifact as Record<string, unknown>) : null })),
    } : null,
    focusedArtifact: focusedRecord ? summarizeArtifact(focusedRecord, true) : null,
    artifacts: artifacts.map((artifact) => summarizeArtifact(artifact)),
  };
}

function ownedReferences(context: Awaited<ReturnType<typeof buildContext>>): OwnedOperationReferences {
  const artifactIds = new Set<string>();
  const artifactBlueprints = new Map<string, string>();
  const workspaceIds = new Set<string>();
  const workspaceItems = new Map<string, { artifactId?: string; workspaceId: string }>();
  for (const workspace of context.workspaces) if (typeof workspace.id === "string") workspaceIds.add(workspace.id);
  for (const artifact of context.artifacts) {
    if (typeof artifact.id === "string") {
      artifactIds.add(artifact.id);
      if (typeof artifact.blueprintKey === "string") artifactBlueprints.set(artifact.id, artifact.blueprintKey);
    }
    for (const placement of artifact.placements) {
      if (typeof placement.workspaceId === "string") workspaceIds.add(placement.workspaceId);
      if (typeof placement.workspaceItemId === "string" && typeof placement.workspaceId === "string") workspaceItems.set(placement.workspaceItemId, { artifactId: typeof artifact.id === "string" ? artifact.id : undefined, workspaceId: placement.workspaceId });
    }
  }
  if (context.focusedArtifact && typeof context.focusedArtifact.id === "string") {
    artifactIds.add(context.focusedArtifact.id);
    if (typeof context.focusedArtifact.blueprintKey === "string") artifactBlueprints.set(context.focusedArtifact.id, context.focusedArtifact.blueprintKey);
  }
  if (context.currentWorkspace?.id && typeof context.currentWorkspace.id === "string") workspaceIds.add(context.currentWorkspace.id);
  for (const item of context.currentWorkspace?.items ?? []) {
    if (typeof item.id === "string" && typeof item.workspaceId === "string") workspaceItems.set(item.id, { artifactId: item.sourceType === "artifact" && typeof item.sourceId === "string" ? item.sourceId : undefined, workspaceId: item.workspaceId });
  }
  return { artifactIds, artifactBlueprints, workspaceIds, workspaceItems, threadIds: new Set() };
}

async function callModel(surface: Surface, prompt: string, context: unknown) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OpenRouter is not configured for Spectra runs.");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      "X-OpenRouter-Title": "Spectra AI Operation Engine",
    },
    body: JSON.stringify({
      model: getSpectraModelId(),
      provider: SPECTRA_OPENROUTER_PROVIDER_ROUTING,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt(surface) },
        { role: "user", content: `User request:\n${prompt}\n\nOwned context (valid JSON):\n${safeJson(context)}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "spectra_operation_plan", strict: true, schema: SPECTRA_PLAN_JSON_SCHEMA } },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenRouter request failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
  const raw = payload.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((part) => part.text ?? "").join("") : "";
  if (!text.trim()) throw new Error("The Spectra model returned an empty plan.");
  return parseSpectraPlan(JSON.parse(text));
}

function operationLabel(operation: ModelOperation) {
  if (operation.type === "artifact.create") {
    if (operation.input.blueprintKey === "flashcard_deck") return "Creating flashcard deck";
    if (operation.input.blueprintKey === "quiz") return "Creating quiz";
    if (operation.input.blueprintKey === "planner_task") return "Creating planner task";
    if (operation.input.blueprintKey === "document") return "Creating document";
    return "Creating thread reference";
  }
  if (operation.type === "artifact.update") return "Updating artifact";
  if (operation.type === "workspaceItem.add") return "Adding workspace placement";
  if (operation.type === "workspaceItem.hide") return "Removing requested workspace placement";
  return "Creating workspace";
}

function operationPhases(operation: ModelOperation, workspaceTitle?: string) {
  if (operation.type === "artifact.create" && operation.input.blueprintKey === "flashcard_deck") {
    return [`Validating ${operation.input.content.cards.length} cards`, `Saving deck${workspaceTitle ? ` to ${workspaceTitle}` : " to Artifacts"}`];
  }
  if (operation.type === "artifact.create" && operation.input.blueprintKey === "quiz") {
    return [`Validating ${operation.input.content.questions.length} questions`, `Saving quiz${workspaceTitle ? ` to ${workspaceTitle}` : " to Artifacts"}`];
  }
  if (operation.type === "artifact.create" && operation.input.blueprintKey === "document") return [`Validating ${operation.input.content.blocks.length} document blocks`, `Saving document${workspaceTitle ? ` to ${workspaceTitle}` : " to Artifacts"}`];
  if (operation.type === "artifact.create" && operation.input.blueprintKey === "planner_task") return ["Validating planner task", `Saving task${workspaceTitle ? ` to ${workspaceTitle}` : " to Artifacts"}`];
  return [operationLabel(operation)];
}

function publicError(error: unknown) {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.length ? issue.path.join(".") : "plan";
    return `Invalid AI plan at ${path}: ${issue?.message ?? "schema mismatch"}`;
  }
  if (error instanceof SyntaxError) return "The AI returned malformed structured output. Retry the run.";
  const message = error instanceof Error ? error.message : "Spectra run failed.";
  return message.length > 360 ? `${message.slice(0, 357)}…` : message;
}

async function executeOperation(actorClerkId: string, runId: string, operationId: string, operation: ModelOperation, context: { surface: Surface; workspaceId?: string }) {
  await mutate("spectraOperations:claim", { actorClerkId, operationId });
  let output: Record<string, unknown> = {};
  let affected: Array<{ type: string; id: string }> = [];
  if (operation.type === "artifact.create") {
    const input = operation.input;
    const workspaceId = input.placement === "inbox" ? undefined : input.workspaceId ?? ((context.surface === "workspace" || context.surface === "artifact") ? context.workspaceId : undefined);
    output = await mutate("spectraArtifacts:create", {
      actorClerkId, blueprintKey: input.blueprintKey, title: input.title, summary: input.summary ?? undefined, content: input.content,
      tags: input.tags, workspaceId, source: "ai", runId,
    }) as Record<string, unknown>;
    if (typeof output.artifactId === "string") affected.push({ type: "artifact", id: output.artifactId });
    if (typeof output.workspaceItemId === "string") affected.push({ type: "workspaceItem", id: output.workspaceItemId });
  } else if (operation.type === "artifact.update") {
    const input = operation.input;
    if (input.content !== null) {
      const artifact = await query<{ actorClerkId: string; artifactId: string }, { blueprintKey: string }>("spectraArtifacts:get", { actorClerkId, artifactId: input.artifactId });
      if (artifact.blueprintKey !== input.blueprintKey) throw new Error("The artifact update blueprint does not match the owned artifact.");
      const validated = validateBlueprintContent(artifact.blueprintKey, input.content);
      if (!validated.success) throw new Error(`Invalid ${artifact.blueprintKey} update: ${validated.error.issues[0]?.message ?? "schema mismatch"}`);
    }
    output = await mutate("spectraArtifacts:update", {
      actorClerkId,
      artifactId: input.artifactId,
      title: input.title ?? undefined,
      summary: input.summary ?? undefined,
      content: input.content ?? undefined,
      tags: input.tags ?? undefined,
    }) as Record<string, unknown>;
    affected = [{ type: "artifact", id: input.artifactId }];
  } else if (operation.type === "workspaceItem.add") {
    output = await mutate("spectraWorkspaceItems:addArtifact", { actorClerkId, ...operation.input }) as Record<string, unknown>;
    affected = [{ type: "artifact", id: operation.input.artifactId }, { type: "workspace", id: operation.input.workspaceId }];
  } else if (operation.type === "workspaceItem.hide") {
    output = await mutate("spectraWorkspaceItems:hide", { actorClerkId, workspaceItemId: operation.input.workspaceItemId }) as Record<string, unknown>;
    affected = [{ type: "workspaceItem", id: operation.input.workspaceItemId }];
  } else if (operation.type === "workspace.create") {
    const workspaceId = await mutate("spectraWorkspaces:create", { actorClerkId, title: operation.input.title, description: operation.input.description ?? undefined }) as string;
    output = { workspaceId };
    affected = [{ type: "workspace", id: workspaceId }];
  }
  await mutate("spectraOperations:markExecuted", { actorClerkId, operationId, output, affected });
  return affected;
}

async function latestCard(actorClerkId: string, runId: string) {
  const value = await query<{ actorClerkId: string; runId: string }, RunDetail>("spectraRuns:get", { actorClerkId, runId });
  const card = value.cards[0];
  if (!card) throw new Error("Result card not found");
  return card;
}

function ndjson(task: (emit: (event: unknown) => void) => Promise<void>) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      const emit = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      void task(emit).catch((error) => emit({ type: "error", message: publicError(error) })).finally(() => controller.close());
    },
  }), { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Content-Type-Options": "nosniff" } });
}

async function runAttempt(params: { actorClerkId: string; runId: string; resultCardId: string; prompt: string; surface: Surface; workspaceId?: string; artifactId?: string }, emit: (event: unknown) => void) {
  let card = await latestCard(params.actorClerkId, params.runId);
  let commitStarted = false;
  emit({ type: "run_created", runId: params.runId, card: streamCard(card) });
  try {
    await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, status: "running", resultTitle: "Thinking", resultSummary: "Analysing request", resultActions: [] });
    emit({ type: "status", runId: params.runId, message: "Analysing request" });
    const context = await buildContext(params.actorClerkId, { workspaceId: params.workspaceId, artifactId: params.artifactId });
    const workspaceTitle = context.currentWorkspace?.title;
    if (params.artifactId && context.focusedArtifact?.title) emit({ type: "status", runId: params.runId, message: `Reviewing ${context.focusedArtifact.title}` });
    else if (workspaceTitle) emit({ type: "status", runId: params.runId, message: `Reviewing ${workspaceTitle} context` });
    const plan = validatePlanAgainstIntent(await callModel(params.surface, params.prompt, context), ownedReferences(context));
    const policy = evaluatePlanPolicy(plan.operations, { intent: plan.intent });
    const stored = await mutate<{ actorClerkId: string; runId: string; operations: Array<{ type: string; input: unknown; requiresConfirmation: boolean }> }, { operationIds: string[] }>("spectraOperations:recordPlan", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      operations: plan.operations.map((operation) => ({ type: operation.type, input: operation.input, requiresConfirmation: policy.requiresConfirmation })),
    });
    stored.operationIds.forEach((operationId, index) => emit({ type: "operation_preview", runId: params.runId, operationId, operationType: plan.operations[index]?.type ?? "unknown" }));

    if (plan.decision !== "operate") {
      const title = plan.decision === "clarify" ? "Needs clarification" : plan.decision === "refuse" ? "Unable to apply" : "Answer";
      await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, status: "completed", decision: plan.decision, planIntent: plan.intent, finalSummary: plan.finalResponse, resultTitle: title, resultSummary: plan.finalResponse, resultVariant: "status", resultActions: [] });
      card = await latestCard(params.actorClerkId, params.runId);
      emit({ type: "final", runId: params.runId, summary: plan.finalResponse, card: streamCard(card) });
      return;
    }

    if (policy.requiresConfirmation) {
      const actions: ResultAction[] = [
        { key: "confirm", label: "Confirm", targetType: "run", targetId: params.runId },
        { key: "cancel", label: "Cancel", targetType: "run", targetId: params.runId },
      ];
      await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, status: "awaiting_confirmation", decision: plan.decision, planIntent: plan.intent, finalSummary: plan.finalResponse, resultTitle: "Confirmation required", resultSummary: policy.reasons.join(" · "), resultVariant: "operation", resultActions: actions });
      card = await latestCard(params.actorClerkId, params.runId);
      emit({ type: "confirmation_required", runId: params.runId, reasons: policy.reasons, card: streamCard(card) });
      return;
    }

    const allAffected: Array<{ type: string; id: string }> = [];
    for (let index = 0; index < plan.operations.length; index += 1) {
      const operation = plan.operations[index]!;
      const operationId = stored.operationIds[index]!;
      for (const phase of operationPhases(operation, typeof workspaceTitle === "string" ? workspaceTitle : undefined)) {
        await mutate("spectraRuns:patchResultCard", { actorClerkId: params.actorClerkId, resultCardId: params.resultCardId, title: operationLabel(operation), summary: phase });
        emit({ type: "status", runId: params.runId, message: phase });
      }
      emit({ type: "operation_commit", runId: params.runId, operationId });
      try {
        commitStarted = true;
        const affected = await executeOperation(params.actorClerkId, params.runId, operationId, operation, { surface: params.surface, workspaceId: params.workspaceId });
        allAffected.push(...affected);
        emit({ type: "operation_result", runId: params.runId, operationId, affected });
      } catch (error) {
        await mutate("spectraOperations:markFailed", { actorClerkId: params.actorClerkId, operationId, error: publicError(error) }).catch(() => null);
        throw error;
      }
    }
    const artifact = allAffected.find((item) => item.type === "artifact");
    const actions: ResultAction[] = artifact ? [{ key: "open", label: "Open", targetType: "artifact", targetId: artifact.id }] : [];
    await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, status: "completed", decision: plan.decision, planIntent: plan.intent, finalSummary: plan.finalResponse, resultTitle: "Done", resultSummary: plan.finalResponse, resultVariant: artifact ? "artifact" : "status", resultActions: actions });
    card = await latestCard(params.actorClerkId, params.runId);
    emit({ type: "final", runId: params.runId, summary: plan.finalResponse, card: streamCard(card) });
  } catch (error) {
    const message = publicError(error);
    await mutate("spectraOperations:cancelPending", { actorClerkId: params.actorClerkId, runId: params.runId }).catch(() => null);
    const resultSummary = commitStarted ? `${message} Review the affected objects before submitting a follow-up command.` : message;
    await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, status: "failed", error: message, resultTitle: "Run failed", resultSummary, resultVariant: "error", resultActions: commitStarted ? [] : [{ key: "retry", label: "Retry", targetType: "run", targetId: params.runId }] }).catch(() => null);
    card = await latestCard(params.actorClerkId, params.runId).catch(() => card);
    emit({ type: "error", runId: params.runId, message, card: card ? streamCard(card) : undefined });
  }
}

function surfaceFromRun(run: RunState): Surface {
  if (run.sourceSurface === "artifact") return run.artifactId ? "artifact" : "artifacts";
  return run.sourceSurface;
}

export async function POST(request: NextRequest) {
  const actor = await requireActor();
  const body = await request.json() as Body;
  const action = body.action ?? "run";

  if (action === "run") {
    const prompt = body.prompt?.trim();
    const surface = body.surface;
    if (!prompt || prompt.length > 12_000) return new Response("Invalid prompt", { status: 400 });
    if (!surface || !["chat", "workspace", "artifacts", "artifact"].includes(surface)) return new Response("Invalid surface", { status: 400 });
    const sourceSurface = surface === "artifacts" ? "artifact" : surface;
    const created = await mutate<unknown & object, { runId: string; resultCardId: string }>("spectraRuns:create", { actorClerkId: actor.clerkId, sourceSurface, userPrompt: prompt, workspaceId: body.workspaceId, artifactId: body.artifactId, modelUsed: getSpectraModelId() });
    return ndjson((emit) => runAttempt({ actorClerkId: actor.clerkId, runId: created.runId, resultCardId: created.resultCardId, prompt, surface, workspaceId: body.workspaceId, artifactId: body.artifactId }, emit));
  }

  const runId = body.runId?.trim();
  if (!runId) return new Response("runId is required", { status: 400 });

  if (action === "retry") {
    await mutate("spectraOperations:cancelPending", { actorClerkId: actor.clerkId, runId }).catch(() => null);
    const reset = await mutate<unknown & object, { runId: string; resultCardId?: string; prompt: string; workspaceId?: string; artifactId?: string; sourceSurface: RunState["sourceSurface"] }>("spectraRuns:resetForRetry", { actorClerkId: actor.clerkId, runId });
    if (!reset.resultCardId) return new Response("Result card not found", { status: 409 });
    const run: RunState = { status: "queued", sourceSurface: reset.sourceSurface, workspaceId: reset.workspaceId, artifactId: reset.artifactId, userPrompt: reset.prompt };
    return ndjson((emit) => runAttempt({ actorClerkId: actor.clerkId, runId, resultCardId: reset.resultCardId!, prompt: reset.prompt, surface: surfaceFromRun(run), workspaceId: reset.workspaceId, artifactId: reset.artifactId }, emit));
  }

  if (action === "cancel") {
    const state = await query<{ actorClerkId: string; runId: string }, RunDetail>("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    if (state.run.status !== "awaiting_confirmation") return new Response("Run is not awaiting confirmation", { status: 409 });
    await mutate("spectraOperations:cancelPending", { actorClerkId: actor.clerkId, runId });
    await mutate("spectraRuns:updateStatus", { actorClerkId: actor.clerkId, runId, status: "cancelled", resultTitle: "Cancelled", resultSummary: "No proposed changes were applied.", resultActions: [] });
    const card = await latestCard(actor.clerkId, runId);
    return ndjson(async (emit) => emit({ type: "final", runId, summary: "No proposed changes were applied.", card: streamCard(card) }));
  }

  if (action === "confirm") {
    const state = await query<{ actorClerkId: string; runId: string }, RunDetail>("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    if (state.run.status !== "awaiting_confirmation") return new Response("Run is not awaiting confirmation", { status: 409 });
    const intent = requestIntentSchema.parse(state.run.planIntent);
    const proposed = state.operations.filter((row) => row.status === "proposed");
    if (!proposed.some((row) => row.requiresConfirmation) || proposed.length === 0) return new Response("No confirmable operations", { status: 409 });
    const operations = proposed.map((row) => parseModelOperation({ type: row.type, input: row.input }));
    const contextBody = { workspaceId: state.run.workspaceId, artifactId: state.run.artifactId };
    const context = await buildContext(actor.clerkId, contextBody);
    validatePlanAgainstIntent({ decision: "operate", intent, finalResponse: state.run.finalSummary ?? "Confirmed changes completed.", operations }, ownedReferences(context));
    evaluatePlanPolicy(operations, { intent });
    return ndjson(async (emit) => {
      let commitStarted = false;
      try {
        await mutate("spectraRuns:updateStatus", { actorClerkId: actor.clerkId, runId, status: "running", resultTitle: "Applying confirmed changes", resultActions: [] });
        const allAffected: Array<{ type: string; id: string }> = [];
        for (let index = 0; index < operations.length; index += 1) {
          const operation = operations[index]!;
          const row = proposed[index]!;
          for (const phase of operationPhases(operation, typeof context.currentWorkspace?.title === "string" ? context.currentWorkspace.title : undefined)) emit({ type: "status", runId, message: phase });
          emit({ type: "operation_commit", runId, operationId: row._id });
          commitStarted = true;
          const affected = await executeOperation(actor.clerkId, runId, row._id, operation, { surface: surfaceFromRun(state.run), workspaceId: state.run.workspaceId });
          allAffected.push(...affected);
          emit({ type: "operation_result", runId, operationId: row._id, affected });
        }
        const summary = state.run.finalSummary || "Confirmed changes completed.";
        const artifact = allAffected.find((item) => item.type === "artifact");
        await mutate("spectraRuns:updateStatus", { actorClerkId: actor.clerkId, runId, status: "completed", finalSummary: summary, resultTitle: "Done", resultSummary: summary, resultVariant: artifact ? "artifact" : "status", resultActions: artifact ? [{ key: "open", label: "Open", targetType: "artifact", targetId: artifact.id }] : [] });
        const card = await latestCard(actor.clerkId, runId);
        emit({ type: "final", runId, summary, card: streamCard(card) });
      } catch (error) {
        const message = publicError(error);
        await mutate("spectraOperations:cancelPending", { actorClerkId: actor.clerkId, runId }).catch(() => null);
        const resultSummary = commitStarted ? `${message} Review the affected objects before submitting a follow-up command.` : message;
        await mutate("spectraRuns:updateStatus", { actorClerkId: actor.clerkId, runId, status: "failed", error: message, resultTitle: "Run failed", resultSummary, resultVariant: "error", resultActions: commitStarted ? [] : [{ key: "retry", label: "Retry", targetType: "run", targetId: runId }] }).catch(() => null);
        const card = await latestCard(actor.clerkId, runId).catch(() => undefined);
        emit({ type: "error", runId, message, card: card ? streamCard(card) : undefined });
      }
    });
  }

  return new Response("Unknown action", { status: 400 });
}
