import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { allowSpectraProviderFallbacks, assertPrimarySpectraRouting, getSpectraModelId, getSpectraProviderRouting } from "@/features/spectra/ai/model-config";
import { readOpenRouterResponse, type OpenRouterUsage } from "@/features/spectra/ai/openrouter-stream";
import { buildBoundedContextPacket, type EffectiveFocusMode } from "@/features/spectra/ai/context-builder";
import { activeToolContractPrompt } from "@/features/spectra/ai/tool-contract";
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
  action?: "run" | "retry" | "confirm" | "cancel" | "stop";
  prompt?: string;
  surface?: Surface;
  workspaceId?: string;
  artifactId?: string;
  threadId?: string;
  runId?: string;
  attachments?: AttachmentInput[];
  focusMode?: EffectiveFocusMode;
  selectedArtifactIds?: string[];
  currentView?: string;
};

type AttachmentInput = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  handling?: "pdf" | "text" | "docx" | "unsupported_image";
  data?: string;
};

type PreparedAttachment = {
  name: string;
  mimeType: string;
  size: number;
  handling: "pdf" | "text" | "docx";
  data?: string;
  extractedText?: string;
};

type StoredOperation = { _id: string; type: string; input: unknown; status: "proposed" | "executing" | "executed" | "failed" | "cancelled"; requiresConfirmation?: boolean };
type ResultAction = { key: string; label: string; targetType?: "artifact" | "thread" | "run" | "workspace"; targetId?: string };
type Card = { _id: string; runId: string; status: "queued" | "running" | "awaiting_confirmation" | "completed" | "failed" | "cancelled"; title: string; summary?: string; variant: "status" | "artifact" | "thread" | "operation" | "error"; actions: ResultAction[]; provenance?: unknown; updatedAt: number };
type RunState = { status: Card["status"]; sourceSurface: "chat" | "workspace" | "artifact"; threadId?: string; workspaceId?: string; artifactId?: string; userPrompt: string; finalSummary?: string; decision?: SpectraPlan["decision"]; planIntent?: unknown; contextSnapshot?: { focusMode?: EffectiveFocusMode; selectedObjectIds?: string[]; currentView?: string } };
type RunDetail = { run: RunState; cards: Card[]; operations: StoredOperation[] };

function fallbackThreadTitle(prompt: string) {
  const stop = new Set(["please", "can", "could", "would", "spectra", "help", "me", "with", "about", "the", "a", "an", "to", "for", "from", "into", "this", "that", "these", "those", "make", "create"]);
  const words = prompt
    .replace(/[`*_#[\](){}<>]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word && !stop.has(word.toLowerCase()))
    .slice(0, 4);
  if (words.length === 0) return "New thread";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ").slice(0, 48);
}

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
  return { id: card._id, runId: card.runId, status: card.status, title: card.title, summary: card.summary, variant: card.variant, actions: card.actions, provenance: card.provenance, updatedAt: card.updatedAt };
}

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "string" && item.length > 4_000) return `${item.slice(0, 4_000)}…`;
    if (Array.isArray(item) && item.length > 200) return [...item.slice(0, 200), "…"];
    return item;
  });
}

async function prepareAttachments(input: AttachmentInput[] | undefined): Promise<PreparedAttachment[]> {
  const rows = Array.isArray(input) ? input.slice(0, 4) : [];
  let extractedCharacters = 0;
  const prepared: PreparedAttachment[] = [];
  for (const row of rows) {
    const name = typeof row.name === "string" ? row.name.replace(/[\u0000-\u001f]/g, "").slice(0, 180) : "attachment";
    const mimeType = typeof row.mimeType === "string" ? row.mimeType.slice(0, 120) : "application/octet-stream";
    const size = typeof row.size === "number" && Number.isFinite(row.size) ? row.size : 0;
    if (row.handling === "unsupported_image") throw new Error("The fixed DeepSeek route cannot inspect image attachments yet.");
    if (row.handling === "pdf") {
      if (size > 10 * 1024 * 1024 || typeof row.data !== "string" || !row.data.startsWith("data:application/pdf;base64,")) throw new Error(`Invalid PDF attachment: ${name}`);
      prepared.push({ name, mimeType: "application/pdf", size, handling: "pdf", data: row.data });
      continue;
    }
    if (row.handling === "text") {
      if (size > 2 * 1024 * 1024 || typeof row.data !== "string") throw new Error(`Invalid text attachment: ${name}`);
      const remaining = Math.max(0, 80_000 - extractedCharacters);
      const extractedText = row.data.replace(/\u0000/g, "").slice(0, Math.min(40_000, remaining));
      extractedCharacters += extractedText.length;
      prepared.push({ name, mimeType, size, handling: "text", extractedText });
      continue;
    }
    if (row.handling === "docx") {
      if (size > 8 * 1024 * 1024 || typeof row.data !== "string") throw new Error(`Invalid DOCX attachment: ${name}`);
      const encoded = row.data.split(",", 2)[1];
      if (!encoded) throw new Error(`Invalid DOCX attachment: ${name}`);
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: Buffer.from(encoded, "base64") });
      const remaining = Math.max(0, 80_000 - extractedCharacters);
      const extractedText = result.value.replace(/\u0000/g, "").slice(0, Math.min(40_000, remaining));
      extractedCharacters += extractedText.length;
      prepared.push({ name, mimeType, size, handling: "docx", extractedText });
      continue;
    }
    throw new Error(`Unsupported attachment type: ${name}`);
  }
  return prepared;
}

function systemPrompt(surface: Surface) {
  const common = `You are Spectra's controlled school-work planner. Return only the strict JSON plan.

Available actions in this wave:\n${activeToolContractPrompt()}\nUse an action only when it materially advances the user's request. Do not call tools for small explanatory steps.

First classify the request as answer, operate, clarify, or refuse. The intent mode must describe the requested operation; focus is only a hint. Advice, explanation, and questions use decision=answer with zero operations. Ambiguous targets use clarify with zero operations. Unsupported or unsafe work uses refuse with zero operations.

When one bounded user choice would unblock the work, use decision=clarify and include choices with 2–4 distinct options. Each option needs a short title and may include one concise description. Do not use choices for ordinary rhetorical questions or confirmations already represented by operation policy. Otherwise choices must be null.

The owned context is a bounded packet. effectiveFocus states the user's explicit primary context. selectedObjects are intentional and take priority over relevant/catalog objects. A continued thread supplies conversation history while focusedArtifact/workspace may remain additional working focus. Never imply access to omitted or full workspace content.

For the first exchange, provide a specific conversationTitle of at most 7 words and a one-sentence conversationSummary. Avoid generic titles such as "Biology Question" or "New Conversation". On later exchanges, refresh conversationSummary when useful. Set conversationTitle again only if the conversation's purpose has materially clarified or changed; otherwise use null. Never rename for minor topic drift.

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

async function buildContext(actorClerkId: string, body: Pick<Body, "workspaceId" | "artifactId" | "threadId" | "focusMode" | "selectedArtifactIds" | "currentView">, prompt = "") {
  const selectedArtifactIds = Array.isArray(body.selectedArtifactIds) ? [...new Set(body.selectedArtifactIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 12) : [];
  const focusMode = body.focusMode ?? (body.threadId ? "thread" : selectedArtifactIds.length ? "selection" : body.artifactId ? "artifact" : body.workspaceId ? "workspace" : "global");
  const broadContextRequest = /\b(all|everything|search|find|across|compare|related|workspace|library|catalog|inbox)\b/i.test(prompt);
  const shouldLoadArtifactCatalog = focusMode === "global" || focusMode === "workspace" || focusMode === "selection" || broadContextRequest;
  const [artifactRows, workspaceRows, workspace, focusedArtifact, threadDetail, recentRuns] = await Promise.all([
    shouldLoadArtifactCatalog ? query<unknown & object, unknown>("spectraArtifacts:list", { actorClerkId, placement: "all", limit: 36 }) : Promise.resolve([]),
    query<unknown & object, unknown>("spectraWorkspaces:list", { actorClerkId, includeArchived: false, limit: 30 }),
    body.workspaceId ? query<unknown & object, unknown>("spectraWorkspaceItems:listForWorkspace", { actorClerkId, workspaceId: body.workspaceId }).catch(() => null) : Promise.resolve(null),
    body.artifactId ? query<unknown & object, unknown>("spectraArtifacts:get", { actorClerkId, artifactId: body.artifactId }).catch(() => null) : Promise.resolve(null),
    body.threadId ? query<unknown & object, unknown>("spectraThreads:get", { actorClerkId, threadId: body.threadId }).catch(() => null) : Promise.resolve(null),
    query<unknown & object, unknown>("spectraRuns:listRecent", { actorClerkId, limit: 12 }).catch(() => []),
  ]);
  const selectedRows = await Promise.all(selectedArtifactIds.map((artifactId) => query<unknown & object, unknown>("spectraArtifacts:get", { actorClerkId, artifactId }).catch(() => null)));
  const artifacts = [...rows(artifactRows), ...selectedRows.flatMap((row) => row && typeof row === "object" ? [row as Record<string, unknown>] : [])]
    .filter((artifact, index, all) => all.findIndex((candidate) => candidate._id === artifact._id) === index);
  const ownedArtifactIdSet = new Set(artifacts.flatMap((artifact) => typeof artifact._id === "string" ? [artifact._id] : []));
  const ownedSelectedArtifactIds = selectedArtifactIds.filter((id) => ownedArtifactIdSet.has(id));
  const linkedContextIds = [...new Set([...ownedSelectedArtifactIds, ...(body.artifactId ? [body.artifactId] : [])])].slice(0, 12);
  const linkRows = await Promise.all(linkedContextIds.map(async (artifactId) => ({
    artifactId,
    links: rows(await query<unknown & object, unknown>("spectraArtifactLinks:listForArtifact", { actorClerkId, artifactId, limit: 8 }).catch(() => []))
      .map((link) => ({ relationType: link.relationType, direction: link.direction, artifact: link.artifact })),
  })));
  const linksByArtifact = Object.fromEntries(linkRows.map((row) => [row.artifactId, row.links]));
  const workspaces = rows(workspaceRows).map((item) => ({ id: item._id, title: item.title, description: item.description }));
  const workspaceRecord = workspace && typeof workspace === "object" ? workspace as Record<string, unknown> : null;
  const focusedRecord = focusedArtifact && typeof focusedArtifact === "object" ? focusedArtifact as Record<string, unknown> : null;
  const conversation = threadDetail && typeof threadDetail === "object"
    ? rows((threadDetail as Record<string, unknown>).messages).slice(-24).map((message) => ({ role: message.role, content: typeof message.content === "string" ? message.content.slice(0, 8_000) : "" }))
    : [];
  const currentWorkspace = workspaceRecord ? workspaceRecord.workspace as Record<string, unknown> | undefined : undefined;
  const contextPacket = buildBoundedContextPacket({
    prompt,
    focusMode,
    workspace: focusMode === "global" ? null : currentWorkspace,
    artifacts,
    focusedArtifact: focusMode === "artifact" || focusMode === "thread" || focusMode === "selection" ? focusedRecord : null,
    selectedArtifactIds: ownedSelectedArtifactIds,
    conversation,
    currentView: body.currentView,
    linksByArtifact,
    recentActivity: rows(recentRuns).filter((run) => !body.workspaceId || run.workspaceId === body.workspaceId).slice(0, 8).map((run) => ({ id: run._id, prompt: typeof run.userPrompt === "string" ? run.userPrompt.slice(0, 240) : "", status: run.status, finalSummary: typeof run.finalSummary === "string" ? run.finalSummary.slice(0, 320) : undefined, updatedAt: run.updatedAt })),
  });
  return {
    workspaces,
    currentWorkspace: workspaceRecord ? {
      id: (workspaceRecord.workspace as Record<string, unknown> | undefined)?._id,
      title: (workspaceRecord.workspace as Record<string, unknown> | undefined)?.title,
      items: rows(workspaceRecord.items).map((item) => ({ id: item._id, workspaceId: item.workspaceId, sourceType: item.sourceType, sourceId: item.sourceId, artifact: item.artifact && typeof item.artifact === "object" ? summarizeArtifact(item.artifact as Record<string, unknown>) : null })),
    } : null,
    focusedArtifact: focusedRecord ? summarizeArtifact(focusedRecord, true) : null,
    artifacts: artifacts.map((artifact) => summarizeArtifact(artifact)),
    conversation,
    currentThreadId: body.threadId ?? null,
    selectedArtifactIds: ownedSelectedArtifactIds,
    focusMode,
    packet: contextPacket,
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
  return { artifactIds, artifactBlueprints, workspaceIds, workspaceItems, threadIds: new Set(context.currentThreadId ? [context.currentThreadId] : []) };
}

async function callModel(surface: Surface, prompt: string, context: unknown, attachments: PreparedAttachment[], onPublicText?: (content: string, mode?: "delta" | "replace") => void, onReasoningText?: (delta: string) => void, signal?: AbortSignal) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OpenRouter is not configured for Spectra runs.");
  const textAttachments = attachments.filter((attachment) => attachment.extractedText).map((attachment) => `\n\nAttachment: ${attachment.name}\n${attachment.extractedText}`).join("");
  const userText = `User request:\n${prompt}${textAttachments}\n\nOwned context (valid JSON):\n${safeJson(context)}`;
  const pdfs = attachments.filter((attachment) => attachment.handling === "pdf" && attachment.data);
  const userContent = pdfs.length === 0 ? userText : [
    { type: "text", text: userText },
    ...pdfs.map((attachment) => ({ type: "file", file: { filename: attachment.name, file_data: attachment.data } })),
  ];
  const primaryRouting = getSpectraProviderRouting("primary");
  assertPrimarySpectraRouting(primaryRouting);
  const baseBody = {
    model: getSpectraModelId(),
    temperature: 0.1,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: systemPrompt(surface) },
      { role: "user", content: userContent },
    ],
    ...(pdfs.length > 0 ? { plugins: [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }] } : {}),
  };
  const request = (provider: ReturnType<typeof getSpectraProviderRouting>, strictOutput: boolean) => fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      "X-OpenRouter-Title": "Spectra AI Operation Engine",
    },
    body: JSON.stringify({
      ...baseBody,
      provider,
      ...(strictOutput ? { response_format: { type: "json_schema", json_schema: { name: "spectra_operation_plan", strict: true, schema: SPECTRA_PLAN_JSON_SCHEMA } } } : {}),
    }),
    signal,
  });
  console.info("[spectra.openrouter.request]", { model: baseBody.model, provider: primaryRouting, mode: "native-primary" });
  let response = await request(primaryRouting, false);
  let emittedPublicText = "";
  const emitPublic = (delta: string) => { emittedPublicText += delta; onPublicText?.(delta, "delta"); };
  const replacePublic = (content: string) => { emittedPublicText = content; onPublicText?.(content, "replace"); };
  let result: Awaited<ReturnType<typeof readOpenRouterResponse>> | undefined;
  let plan: SpectraPlan | undefined;
  let primaryFailure: unknown;
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    primaryFailure = new Error(`DeepSeek provider request failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  } else {
    try {
      result = await readOpenRouterResponse(response, emitPublic, onReasoningText);
      if (!result.text.trim()) throw new Error("The Spectra model returned an empty plan.");
      const normalizedText = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      plan = parseSpectraPlan(JSON.parse(normalizedText));
    } catch (error) {
      primaryFailure = error;
    }
  }
  if (primaryFailure) {
    if (!allowSpectraProviderFallbacks()) {
      if (emittedPublicText) replacePublic("");
      throw primaryFailure;
    }
    if (emittedPublicText) replacePublic("");
    const fallbackRouting = getSpectraProviderRouting("fallback");
    console.warn("[spectra.openrouter.fallback]", {
      model: baseBody.model,
      primaryStatus: response.status,
      primaryError: publicError(primaryFailure),
      provider: fallbackRouting,
    });
    response = await request(fallbackRouting, true);
    if (!response.ok) {
      const fallbackDetail = await response.text().catch(() => "");
      throw new Error(`OpenRouter fallback request failed (${response.status})${fallbackDetail ? `: ${fallbackDetail.slice(0, 240)}` : ""}`);
    }
    result = await readOpenRouterResponse(response, emitPublic, onReasoningText);
    if (!result.text.trim()) throw new Error("The Spectra fallback model returned an empty plan.");
    const normalizedText = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    plan = parseSpectraPlan(JSON.parse(normalizedText));
  }
  if (!result || !plan) throw new Error("The Spectra model did not return a valid plan.");
  const usedProvider = result.provider?.toLowerCase();
  const usedFallback = usedProvider && usedProvider !== "deepseek";
  if (usedFallback && !allowSpectraProviderFallbacks()) throw new Error(`Unexpected OpenRouter provider: ${result.provider}`);
  console.info("[spectra.openrouter.response]", { model: result.model, provider: result.provider, fallback: Boolean(usedFallback) });
  if (!emittedPublicText) onPublicText?.(plan.finalResponse);
  else if (plan.finalResponse.startsWith(emittedPublicText)) onPublicText?.(plan.finalResponse.slice(emittedPublicText.length));
  return { plan, model: result.model, provider: result.provider, usage: result.usage };
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
  if (operation.type === "workspace.update") return "Updating workspace";
  if (operation.type === "artifact.link") return "Linking artifacts";
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

function safeOperationPreview(operation: ModelOperation) {
  if (operation.type === "artifact.create") return { action: "create" as const, title: operation.input.title, blueprintKey: operation.input.blueprintKey };
  if (operation.type === "artifact.update") return { action: "update" as const, title: "Updating focused artifact", blueprintKey: operation.input.blueprintKey, targetId: operation.input.artifactId };
  if (operation.type === "artifact.link") return { action: "link" as const, title: "Linking artifacts", targetId: operation.input.sourceArtifactId };
  if (operation.type === "workspaceItem.add") return { action: "place" as const, title: "Adding artifact to workspace", targetId: operation.input.artifactId };
  if (operation.type === "workspaceItem.hide") return { action: "remove" as const, title: "Removing workspace placement", targetId: operation.input.workspaceItemId };
  return { action: "workspace" as const, title: operation.type === "workspace.create" ? operation.input.title : "Updating workspace", targetId: operation.type === "workspace.update" ? operation.input.workspaceId : undefined };
}

function publicError(error: unknown) {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.join(".") ?? "";
    if (/artifactId|workspaceId|threadId|plannerItemId|operationId|sourceId|targetId|_id/i.test(path)) {
      return "Spectra could not match that request to an open or selected object. Choose the document or workspace you want to use, then try again.";
    }
    return "Spectra could not safely apply that plan. Try again with the relevant document or workspace selected.";
  }
  if (error instanceof SyntaxError) return "Spectra could not safely read the response. Retry the run.";
  const message = error instanceof Error ? error.message : "Spectra run failed.";
  if (/\b(artifactId|workspaceId|threadId|plannerItemId|operationId|sourceId|targetId|object ID|database id)\b/i.test(message)) {
    return "Spectra could not match that request to an open or selected object. Choose the document or workspace you want to use, then try again.";
  }
  if (/\bJSON|schema|Zod|planner|operation|structured output|FunctionPathNotFound|Convex\b/i.test(message)) {
    return "Spectra could not safely complete that request. Try again, or choose the object you want Spectra to use.";
  }
  return message.length > 240 ? `${message.slice(0, 237)}…` : message;
}

async function executeOperation(actorClerkId: string, runId: string, operationId: string, operation: ModelOperation, context: { surface: Surface; threadId?: string; workspaceId?: string; selectedArtifactIds?: string[]; attachmentNames?: string[]; contextSummary?: string }) {
  await mutate("spectraOperations:claim", { actorClerkId, operationId });
  let output: Record<string, unknown> = {};
  let affected: Array<{ type: string; id: string }> = [];
  if (operation.type === "artifact.create") {
    const input = operation.input;
    const workspaceId = input.placement === "inbox" ? undefined : input.workspaceId ?? ((context.surface === "workspace" || context.surface === "artifact") ? context.workspaceId : undefined);
    output = await mutate("spectraArtifacts:create", {
      actorClerkId, blueprintKey: input.blueprintKey, title: input.title, summary: input.summary ?? undefined, content: input.content,
      tags: input.tags, workspaceId, source: context.surface === "chat" ? "chat" : "ai", runId,
      threadId: context.threadId,
      sourceArtifactIds: context.selectedArtifactIds,
      sourceThreadIds: context.threadId ? [context.threadId] : undefined,
      sourceAttachmentNames: context.attachmentNames,
      contextSummary: context.contextSummary,
    }) as Record<string, unknown>;
    if (typeof output.artifactId === "string") affected.push({ type: "artifact", id: output.artifactId });
    if (typeof output.workspaceItemId === "string") affected.push({ type: "workspaceItem", id: output.workspaceItemId });
    if (typeof output.artifactId === "string") {
      for (const sourceArtifactId of context.selectedArtifactIds ?? []) {
        await mutate("spectraArtifactLinks:create", {
          actorClerkId,
          sourceArtifactId: output.artifactId,
          targetArtifactId: sourceArtifactId,
          relationType: "generated_from",
          workspaceId,
          createdBy: "ai",
          runId,
          explanation: "Created from explicit selected-object context",
        });
      }
    }
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
      source: "ai",
      runId,
    }) as Record<string, unknown>;
    affected = [{ type: "artifact", id: input.artifactId }];
  } else if (operation.type === "workspaceItem.add") {
    output = await mutate("spectraWorkspaceItems:addArtifact", { actorClerkId, ...operation.input }) as Record<string, unknown>;
    affected = [{ type: "artifact", id: operation.input.artifactId }, { type: "workspace", id: operation.input.workspaceId }];
  } else if (operation.type === "workspaceItem.hide") {
    output = await mutate("spectraWorkspaceItems:hide", { actorClerkId, workspaceItemId: operation.input.workspaceItemId }) as Record<string, unknown>;
    affected = [{ type: "workspaceItem", id: operation.input.workspaceItemId }];
    if (typeof output.workspaceId === "string") affected.push({ type: "workspace", id: output.workspaceId });
    if (typeof output.sourceId === "string" && output.sourceType === "artifact") affected.push({ type: "artifact", id: output.sourceId });
  } else if (operation.type === "workspace.create") {
    const workspaceId = await mutate("spectraWorkspaces:create", { actorClerkId, title: operation.input.title, description: operation.input.description ?? undefined, icon: operation.input.icon ?? undefined, color: operation.input.color ?? undefined }) as string;
    output = { workspaceId };
    affected = [{ type: "workspace", id: workspaceId }];
  } else if (operation.type === "workspace.update") {
    output = await mutate("spectraWorkspaces:update", {
      actorClerkId,
      workspaceId: operation.input.workspaceId,
      title: operation.input.title ?? undefined,
      description: operation.input.description ?? undefined,
      icon: operation.input.icon ?? undefined,
      color: operation.input.color ?? undefined,
    }) as Record<string, unknown>;
    affected = [{ type: "workspace", id: operation.input.workspaceId }];
  } else if (operation.type === "artifact.link") {
    output = await mutate("spectraArtifactLinks:create", {
      actorClerkId,
      sourceArtifactId: operation.input.sourceArtifactId,
      targetArtifactId: operation.input.targetArtifactId,
      relationType: operation.input.relationType,
      label: operation.input.label ?? undefined,
      explanation: operation.input.explanation ?? undefined,
      workspaceId: operation.input.workspaceId ?? undefined,
      createdBy: "ai",
      runId,
    }) as Record<string, unknown>;
    affected = [{ type: "artifact", id: operation.input.sourceArtifactId }, { type: "artifact", id: operation.input.targetArtifactId }];
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

async function saveAssistantMessage(params: {
  actorClerkId: string;
  threadId?: string;
  runId: string;
  content: string;
  decision?: SpectraPlan["decision"];
  affected?: Array<{ type: string; id: string }>;
  awaitingConfirmation?: boolean;
  model?: string;
  provider?: string;
  usage?: OpenRouterUsage;
  choices?: SpectraPlan["choices"];
}) {
  if (!params.threadId || !params.content.trim()) return;
  await mutate("spectraThreads:appendMessage", {
    actorClerkId: params.actorClerkId,
    threadId: params.threadId,
    role: "assistant",
    content: params.content,
    runId: params.runId,
    metadata: {
      decision: params.decision,
      hasOperationalTrace: true,
      awaitingConfirmation: params.awaitingConfirmation === true,
      affected: params.affected ?? [],
      model: params.model,
      provider: params.provider,
      usage: params.usage,
      choices: params.choices ?? null,
    },
  });
}

async function inferWorkspaceForRun(actorClerkId: string, body: Body) {
  if (body.workspaceId) return body.workspaceId;
  if (!body.artifactId) return undefined;
  try {
    const artifact = await query<unknown & object, { placements?: Array<{ workspaceId?: string }> }>("spectraArtifacts:get", {
      actorClerkId,
      artifactId: body.artifactId,
    });
    const workspaceIds = [...new Set((artifact.placements ?? []).flatMap((placement) => typeof placement.workspaceId === "string" ? [placement.workspaceId] : []))];
    return workspaceIds.length === 1 ? workspaceIds[0] : undefined;
  } catch {
    return undefined;
  }
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

async function runAttempt(params: { actorClerkId: string; runId: string; resultCardId: string; prompt: string; surface: Surface; threadId?: string; workspaceId?: string; artifactId?: string; focusMode?: EffectiveFocusMode; selectedArtifactIds?: string[]; currentView?: string; attachments?: PreparedAttachment[]; signal?: AbortSignal }, emit: (event: unknown) => void) {
  let card = await latestCard(params.actorClerkId, params.runId);
  let commitStarted = false;
  emit({ type: "run_created", runId: params.runId, card: streamCard(card) });
  if (params.threadId) emit({ type: "thread_ready", runId: params.runId, threadId: params.threadId });
  try {
    await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, status: "running", resultTitle: "Thinking", resultSummary: "Analysing request", resultActions: [] });
    emit({ type: "status", runId: params.runId, message: "Analysing request" });
    const context = await buildContext(params.actorClerkId, { workspaceId: params.workspaceId, artifactId: params.artifactId, threadId: params.threadId, focusMode: params.focusMode, selectedArtifactIds: params.selectedArtifactIds, currentView: params.currentView }, params.prompt);
    const persistedConversation = context.conversation.at(-1)?.role === "user" && context.conversation.at(-1)?.content === params.prompt
      ? context.conversation.slice(0, -1)
      : context.conversation;
    const conversation = persistedConversation.slice(-30);
    await mutate("spectraRuns:setContextSnapshot", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      contextSnapshot: {
        workspaceId: params.workspaceId,
        artifactId: params.artifactId,
        threadId: params.threadId,
        focusMode: context.focusMode,
        selectedObjectIds: context.selectedArtifactIds,
        currentView: params.currentView,
        packetVersion: 1,
        capturedAt: Date.now(),
      },
    });
    const workspaceTitle = context.currentWorkspace?.title;
    const provenance = {
      artifactIds: context.selectedArtifactIds,
      artifactTitles: context.packet.selectedObjects.map((item) => item.title),
      threadId: params.threadId,
      workspaceId: params.workspaceId,
      workspaceTitle,
      attachmentNames: params.attachments?.map((attachment) => attachment.name) ?? [],
      focusMode: context.focusMode,
    };
    if (params.artifactId && context.focusedArtifact?.title) emit({ type: "status", runId: params.runId, message: `Reviewing ${context.focusedArtifact.title}` });
    else if (workspaceTitle) emit({ type: "status", runId: params.runId, message: `Reviewing ${workspaceTitle} context` });
    const modelResult = await callModel(
      params.surface,
      params.prompt,
      { ...context.packet, conversation },
      params.attachments ?? [],
      (content, mode) => emit({ type: mode === "replace" ? "text_replace" : "text_delta", runId: params.runId, content }),
      undefined,
      params.signal,
    );
    const plan = validatePlanAgainstIntent(modelResult.plan, ownedReferences(context));
    if (!params.threadId && (plan.conversationTitle || plan.conversationSummary)) {
      await mutate("spectraRuns:setSuggestedThreadMetadata", { actorClerkId: params.actorClerkId, runId: params.runId, title: plan.conversationTitle ?? undefined, summary: plan.conversationSummary ?? undefined });
    }
    if (params.threadId && (plan.conversationTitle || plan.conversationSummary)) {
      await mutate("spectraThreads:applyGeneratedMetadata", {
        actorClerkId: params.actorClerkId,
        threadId: params.threadId,
        title: plan.conversationTitle ?? undefined,
        summary: plan.conversationSummary ?? undefined,
      });
    }
    const policy = evaluatePlanPolicy(plan.operations, { intent: plan.intent });
    const stored = await mutate<{ actorClerkId: string; runId: string; operations: Array<{ type: string; input: unknown; requiresConfirmation: boolean }> }, { operationIds: string[] }>("spectraOperations:recordPlan", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      operations: plan.operations.map((operation) => ({ type: operation.type, input: operation.input, requiresConfirmation: policy.requiresConfirmation })),
    });
    stored.operationIds.forEach((operationId, index) => { const operation = plan.operations[index]; emit({ type: "operation_preview", runId: params.runId, operationId, operationType: operation?.type ?? "unknown", preview: operation ? safeOperationPreview(operation) : undefined }); });

    if (plan.decision !== "operate") {
      const title = plan.decision === "clarify" ? "Needs clarification" : plan.decision === "refuse" ? "Unable to apply" : "Answer";
      await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, status: "completed", decision: plan.decision, planIntent: plan.intent, finalSummary: plan.finalResponse, resultTitle: title, resultSummary: plan.finalResponse, resultVariant: "status", resultActions: [], provenance, modelUsed: modelResult.model, providerUsed: modelResult.provider, usage: modelResult.usage });
      await saveAssistantMessage({ actorClerkId: params.actorClerkId, threadId: params.threadId, runId: params.runId, content: plan.finalResponse, decision: plan.decision, model: modelResult.model, provider: modelResult.provider, usage: modelResult.usage, choices: plan.choices });
      card = await latestCard(params.actorClerkId, params.runId);
      emit({ type: "final", runId: params.runId, summary: plan.finalResponse, card: streamCard(card) });
      return;
    }

    if (policy.requiresConfirmation) {
      const actions: ResultAction[] = [
        { key: "confirm", label: "Confirm", targetType: "run", targetId: params.runId },
        { key: "cancel", label: "Cancel", targetType: "run", targetId: params.runId },
      ];
      await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, status: "awaiting_confirmation", decision: plan.decision, planIntent: plan.intent, finalSummary: plan.finalResponse, resultTitle: "Confirmation required", resultSummary: policy.reasons.join(" · "), resultVariant: "operation", resultActions: actions, provenance, modelUsed: modelResult.model, providerUsed: modelResult.provider, usage: modelResult.usage });
      await saveAssistantMessage({ actorClerkId: params.actorClerkId, threadId: params.threadId, runId: params.runId, content: plan.finalResponse, decision: plan.decision, awaitingConfirmation: true, model: modelResult.model, provider: modelResult.provider, usage: modelResult.usage });
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
        const affected = await executeOperation(params.actorClerkId, params.runId, operationId, operation, {
          surface: params.surface,
          threadId: params.threadId,
          workspaceId: params.workspaceId,
          selectedArtifactIds: context.selectedArtifactIds,
          attachmentNames: params.attachments?.map((attachment) => attachment.name),
          contextSummary: context.selectedArtifactIds.length
            ? `Based on ${context.selectedArtifactIds.length} selected artifact${context.selectedArtifactIds.length === 1 ? "" : "s"}${params.threadId ? " and a continued thread" : ""}`
            : params.threadId ? "Based on a continued thread and visible focus" : params.artifactId ? "Based on the open artifact" : params.workspaceId ? "Based on workspace context" : "Based on global context",
        });
        allAffected.push(...affected);
        emit({ type: "operation_result", runId: params.runId, operationId, affected });
      } catch (error) {
        await mutate("spectraOperations:markFailed", { actorClerkId: params.actorClerkId, operationId, error: publicError(error) }).catch(() => null);
        throw error;
      }
    }
    const artifact = allAffected.find((item) => item.type === "artifact");
    const actions: ResultAction[] = artifact ? [{ key: "open", label: "Open", targetType: "artifact", targetId: artifact.id }] : [];
    await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, status: "completed", decision: plan.decision, planIntent: plan.intent, finalSummary: plan.finalResponse, resultTitle: "Done", resultSummary: plan.finalResponse, resultVariant: artifact ? "artifact" : "status", resultActions: actions, provenance, modelUsed: modelResult.model, providerUsed: modelResult.provider, usage: modelResult.usage });
    await saveAssistantMessage({ actorClerkId: params.actorClerkId, threadId: params.threadId, runId: params.runId, content: plan.finalResponse, decision: plan.decision, affected: allAffected, model: modelResult.model, provider: modelResult.provider, usage: modelResult.usage });
    card = await latestCard(params.actorClerkId, params.runId);
    emit({ type: "final", runId: params.runId, summary: plan.finalResponse, card: streamCard(card) });
  } catch (error) {
    if ((error instanceof DOMException && error.name === "AbortError") || params.signal?.aborted) {
      await mutate("spectraOperations:cancelPending", { actorClerkId: params.actorClerkId, runId: params.runId }).catch(() => null);
      await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, status: "cancelled", resultTitle: "Stopped", resultSummary: "Generation stopped before a final answer was saved.", resultActions: [{ key: "retry", label: "Retry", targetType: "run", targetId: params.runId }] }).catch(() => null);
      return;
    }
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
	    const attachments = await prepareAttachments(body.attachments);
	    const placementWorkspaceId = await inferWorkspaceForRun(actor.clerkId, body);
	    let threadId = body.threadId?.trim() || undefined;
	    if (!threadId) {
	      threadId = await mutate<unknown & object, string>("spectraThreads:create", { actorClerkId: actor.clerkId, title: fallbackThreadTitle(prompt), origin: sourceSurface, workspaceId: placementWorkspaceId, artifactId: body.artifactId });
	    }
	    const created = await mutate<unknown & object, { runId: string; resultCardId: string }>("spectraRuns:create", { actorClerkId: actor.clerkId, sourceSurface, userPrompt: prompt, threadId, workspaceId: placementWorkspaceId, artifactId: body.artifactId, modelUsed: getSpectraModelId() });
    if (threadId) {
      await mutate("spectraThreads:appendMessage", { actorClerkId: actor.clerkId, threadId, role: "user", content: prompt, runId: created.runId, clientMessageId: `user:${created.runId}`, metadata: { attachments: attachments.map(({ name, mimeType, size, handling }) => ({ name, mimeType, size, handling })) } });
    }
    return ndjson((emit) => runAttempt({
      actorClerkId: actor.clerkId,
      runId: created.runId,
      resultCardId: created.resultCardId,
      prompt,
      surface,
      threadId,
	      workspaceId: placementWorkspaceId,
      artifactId: body.artifactId,
      focusMode: body.focusMode,
      selectedArtifactIds: body.selectedArtifactIds,
      currentView: body.currentView,
      attachments,
      signal: request.signal,
    }, emit));
  }

  const runId = body.runId?.trim();
  if (!runId) return new Response("runId is required", { status: 400 });

  if (action === "stop") {
    const state = await query<{ actorClerkId: string; runId: string }, RunDetail>("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    if (state.run.status !== "queued" && state.run.status !== "running") return new Response("Run is not active", { status: 409 });
    if (state.operations.some((operation) => operation.status === "executing" || operation.status === "executed")) return new Response("This run has already started applying changes", { status: 409 });
    await mutate("spectraOperations:cancelPending", { actorClerkId: actor.clerkId, runId });
    await mutate("spectraRuns:updateStatus", { actorClerkId: actor.clerkId, runId, status: "cancelled", resultTitle: "Stopped", resultSummary: "Generation stopped before a final answer was saved.", resultActions: [{ key: "retry", label: "Retry", targetType: "run", targetId: runId }] });
    return new Response(null, { status: 204 });
  }

  if (action === "retry") {
    await mutate("spectraOperations:cancelPending", { actorClerkId: actor.clerkId, runId }).catch(() => null);
    const reset = await mutate<unknown & object, { runId: string; resultCardId?: string; prompt: string; workspaceId?: string; artifactId?: string; sourceSurface: RunState["sourceSurface"]; contextSnapshot?: { focusMode?: EffectiveFocusMode; selectedObjectIds?: string[]; currentView?: string } }>("spectraRuns:resetForRetry", { actorClerkId: actor.clerkId, runId });
    if (!reset.resultCardId) return new Response("Result card not found", { status: 409 });
    const run: RunState = { status: "queued", sourceSurface: reset.sourceSurface, workspaceId: reset.workspaceId, artifactId: reset.artifactId, userPrompt: reset.prompt };
    const state = await query<{ actorClerkId: string; runId: string }, RunDetail>("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    return ndjson((emit) => runAttempt({ actorClerkId: actor.clerkId, runId, resultCardId: reset.resultCardId!, prompt: reset.prompt, surface: surfaceFromRun(run), threadId: state.run.threadId, workspaceId: reset.workspaceId, artifactId: reset.artifactId, focusMode: reset.contextSnapshot?.focusMode, selectedArtifactIds: reset.contextSnapshot?.selectedObjectIds, currentView: reset.contextSnapshot?.currentView, attachments: [] }, emit));
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
    const contextBody = { workspaceId: state.run.workspaceId, artifactId: state.run.artifactId, threadId: state.run.threadId, focusMode: state.run.contextSnapshot?.focusMode, selectedArtifactIds: state.run.contextSnapshot?.selectedObjectIds, currentView: state.run.contextSnapshot?.currentView };
    const context = await buildContext(actor.clerkId, contextBody, state.run.userPrompt);
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
          const affected = await executeOperation(actor.clerkId, runId, row._id, operation, { surface: surfaceFromRun(state.run), threadId: state.run.threadId, workspaceId: state.run.workspaceId, selectedArtifactIds: context.selectedArtifactIds, contextSummary: context.selectedArtifactIds.length ? `Based on ${context.selectedArtifactIds.length} selected artifacts` : undefined });
          allAffected.push(...affected);
          emit({ type: "operation_result", runId, operationId: row._id, affected });
        }
        const summary = state.run.finalSummary || "Confirmed changes completed.";
        const artifact = allAffected.find((item) => item.type === "artifact");
        await mutate("spectraRuns:updateStatus", { actorClerkId: actor.clerkId, runId, status: "completed", finalSummary: summary, resultTitle: "Done", resultSummary: summary, resultVariant: artifact ? "artifact" : "status", resultActions: artifact ? [{ key: "open", label: "Open", targetType: "artifact", targetId: artifact.id }] : [] });
        await saveAssistantMessage({ actorClerkId: actor.clerkId, threadId: state.run.threadId, runId, content: summary, decision: state.run.decision, affected: allAffected });
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
