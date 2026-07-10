import { after, NextRequest } from "next/server";
import { ZodError } from "zod";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { allowSpectraProviderFallbacks, assertPrimarySpectraRouting, getSpectraModelId, getSpectraProviderRouting } from "@/features/spectra/ai/model-config";
import { extractCompleteJsonArrayItems, readOpenRouterResponse, type OpenRouterUsage } from "@/features/spectra/ai/openrouter-stream";
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
export const maxDuration = 300;

// The viewer may detach, navigate, or reconnect without cancelling the work.
// Explicit stop requests target the run-owned controller instead.
const activeRunControllers = new Map<string, AbortController>();

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
  explicitContextObjects?: Array<{ type?: string; id?: string; label?: string; workspaceId?: string }>;
  currentView?: string;
  submissionKey?: string;
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

type StoredOperation = { _id: string; executionId?: string; type: string; input: unknown; status: "proposed" | "executing" | "executed" | "failed" | "cancelled"; requiresConfirmation?: boolean; pendingArtifactId?: string; pendingWorkspaceId?: string };
type ResultAction = { key: string; label: string; targetType?: "artifact" | "thread" | "run" | "workspace"; targetId?: string };
type Card = { _id: string; runId: string; status: "queued" | "running" | "awaiting_confirmation" | "completed" | "failed" | "cancelled"; title: string; summary?: string; variant: "status" | "artifact" | "thread" | "operation" | "error"; actions: ResultAction[]; provenance?: unknown; updatedAt: number };
type RunState = { status: Card["status"]; sourceSurface: "chat" | "workspace" | "artifact"; threadId?: string; workspaceId?: string; artifactId?: string; userPrompt: string; finalSummary?: string; decision?: SpectraPlan["decision"]; planIntent?: unknown; executionId?: string; contextSnapshot?: { focusMode?: EffectiveFocusMode; selectedObjectIds?: string[]; explicitContextObjects?: Body["explicitContextObjects"]; currentView?: string } };
type RunDetail = { run: RunState; cards: Card[]; operations: StoredOperation[] };
type RetryReset = { runId: string; resultCardId?: string; prompt: string; workspaceId?: string; artifactId?: string; sourceSurface: RunState["sourceSurface"]; executionId: string; created: boolean; contextSnapshot?: RunState["contextSnapshot"] };

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
    if (row.handling === "unsupported_image") throw new Error("Spectra cannot inspect image attachments yet. Use PDF, DOCX, or text for this run.");
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

For the first exchange, provide a specific conversationTitle of 2 to 4 words and a one-sentence conversationSummary. Avoid generic titles such as "Biology Question" or "New Conversation". On later exchanges, refresh conversationSummary when useful. Set conversationTitle again only if the conversation's purpose has materially clarified or changed; otherwise use null. Never rename for minor topic drift.

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

async function buildContext(actorClerkId: string, body: Pick<Body, "workspaceId" | "artifactId" | "threadId" | "focusMode" | "selectedArtifactIds" | "explicitContextObjects" | "currentView">, prompt = "") {
  const explicitContextObjects = Array.isArray(body.explicitContextObjects) ? body.explicitContextObjects.filter((item) => item && typeof item.id === "string" && ["artifact", "workspace", "thread"].includes(String(item.type))).slice(0, 36) : [];
  const explicitArtifactIdList = explicitContextObjects.filter((item) => item.type === "artifact").flatMap((item) => item.id ? [item.id] : []);
  const selectedArtifactIds = [...new Set([...(Array.isArray(body.selectedArtifactIds) ? body.selectedArtifactIds : []), ...explicitArtifactIdList].filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 24);
  const focusMode = body.focusMode ?? (body.threadId ? "thread" : selectedArtifactIds.length ? "selection" : body.artifactId ? "artifact" : body.workspaceId ? "workspace" : "global");
  const broadContextRequest = /\b(all|everything|search|find|across|compare|related|workspace|library|catalog|inbox)\b/i.test(prompt);
  const shouldLoadArtifactCatalog = focusMode === "global" || focusMode === "workspace" || focusMode === "selection" || broadContextRequest;
  const retrievalTerms = [...new Set(prompt.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4 && !/^(this|that|with|from|into|about|please|could|would|make|create|update|change|help)$/.test(word)))].slice(0, 6);
  const [artifactRows, retrievedRows, workspaceRows, threadRows, workspace, focusedArtifact, threadDetail, recentRuns] = await Promise.all([
    shouldLoadArtifactCatalog ? query<unknown & object, unknown>("spectraArtifacts:list", { actorClerkId, placement: "all", limit: 36 }) : Promise.resolve([]),
    Promise.all(retrievalTerms.map((search) => query<unknown & object, unknown>("spectraArtifacts:list", { actorClerkId, placement: "all", search, limit: 12 }).catch(() => []))),
    query<unknown & object, unknown>("spectraWorkspaces:list", { actorClerkId, includeArchived: false, limit: 30 }),
    query<unknown & object, unknown>("spectraThreads:list", { actorClerkId, includeArchived: false, limit: 80 }).catch(() => []),
    body.workspaceId ? query<unknown & object, unknown>("spectraWorkspaceItems:listForWorkspace", { actorClerkId, workspaceId: body.workspaceId }).catch(() => null) : Promise.resolve(null),
    body.artifactId ? query<unknown & object, unknown>("spectraArtifacts:get", { actorClerkId, artifactId: body.artifactId }).catch(() => null) : Promise.resolve(null),
    body.threadId ? query<unknown & object, unknown>("spectraThreads:get", { actorClerkId, threadId: body.threadId }).catch(() => null) : Promise.resolve(null),
    query<unknown & object, unknown>("spectraRuns:listRecent", { actorClerkId, limit: 12 }).catch(() => []),
  ]);
  const selectedRows = await Promise.all(selectedArtifactIds.map((artifactId) => query<unknown & object, unknown>("spectraArtifacts:get", { actorClerkId, artifactId }).catch(() => null)));
  const artifacts = [...rows(artifactRows), ...retrievedRows.flatMap((result) => rows(result)), ...selectedRows.flatMap((row) => row && typeof row === "object" ? [row as Record<string, unknown>] : [])]
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
  const explicitWorkspaceIds = new Set(explicitContextObjects.filter((item) => item.type === "workspace").map((item) => item.id));
  const explicitWorkspaceDetails = await Promise.all([...explicitWorkspaceIds].filter((id): id is string => typeof id === "string" && id !== body.workspaceId).slice(0, 3).map((workspaceId) => query<unknown & object, unknown>("spectraWorkspaceItems:listForWorkspace", { actorClerkId, workspaceId }).catch(() => null)));
  const explicitWorkspaceObjectsById = new Map(explicitWorkspaceDetails.flatMap((detail) => {
    if (!detail || typeof detail !== "object") return [];
    const record = detail as Record<string, unknown>;
    const workspace = record.workspace as Record<string, unknown> | undefined;
    if (typeof workspace?._id !== "string") return [];
    return [[workspace._id, rows(record.items).slice(0, 14).map((item) => item.artifact && typeof item.artifact === "object" ? summarizeArtifact(item.artifact as Record<string, unknown>) : { type: item.sourceType })] as const];
  }));
  const explicitThreadIds = new Set(explicitContextObjects.filter((item) => item.type === "thread").map((item) => item.id));
  const explicitThreadDetails = await Promise.all([...explicitThreadIds].filter((id): id is string => typeof id === "string" && id !== body.threadId).slice(0, 3).map((threadId) => query<unknown & object, unknown>("spectraThreads:get", { actorClerkId, threadId }).catch(() => null)));
  const explicitThreadExcerptById = new Map(explicitThreadDetails.flatMap((detail) => {
    if (!detail || typeof detail !== "object") return [];
    const record = detail as Record<string, unknown>;
    const thread = record.thread as Record<string, unknown> | undefined;
    if (typeof thread?._id !== "string") return [];
    return [[thread._id, rows(record.messages).slice(-8).map((message) => ({ role: message.role, content: typeof message.content === "string" ? message.content.slice(0, 1_200) : "" }))] as const];
  }));
  const explicitArtifactIds = new Set(explicitContextObjects.filter((item) => item.type === "artifact").map((item) => item.id));
  const contextReasons = Object.fromEntries(ownedSelectedArtifactIds.map((id) => [id, explicitArtifactIds.has(id) ? "explicit" : id === body.artifactId ? "open" : "visible"])) as Record<string, "open" | "selected" | "explicit" | "visible">;
  const workspaces = rows(workspaceRows).map((item) => ({ id: item._id, title: item.title, description: item.description, explicit: explicitWorkspaceIds.has(String(item._id)), objects: explicitWorkspaceObjectsById.get(String(item._id)) }));
  const threads = rows(threadRows).map((item) => ({ id: item._id, title: item.title, summary: item.summaryShort, workspaceId: item.workspaceId, lastMessageAt: item.lastMessageAt, explicit: explicitThreadIds.has(String(item._id)), contextExcerpt: explicitThreadExcerptById.get(String(item._id)) })).slice(0, 24);
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
    workspaceMap: workspaces,
    threadMap: threads,
    inboxMap: artifacts.filter((artifact) => rows(artifact.placements).length === 0).slice(0, 20).map((artifact) => summarizeArtifact(artifact)),
    contextReasons,
    continuationThreadId: body.threadId,
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

async function callModel(surface: Surface, prompt: string, context: unknown, attachments: PreparedAttachment[], onPublicText?: (content: string, mode?: "delta" | "replace") => void, onReasoningText?: (delta: string) => void, signal?: AbortSignal, onPlanOperation?: (operation: unknown, index: number) => void) {
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
  let emittedOperationCount = 0;
  const inspectPlan = (text: string) => {
    const operations = extractCompleteJsonArrayItems(text, "operations");
    while (emittedOperationCount < operations.length) {
      const index = emittedOperationCount;
      emittedOperationCount += 1;
      onPlanOperation?.(operations[index], index);
    }
  };
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    primaryFailure = new Error(`DeepSeek provider request failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  } else {
    try {
      result = await readOpenRouterResponse(response, emitPublic, onReasoningText, inspectPlan);
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
    emittedOperationCount = 0;
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
    result = await readOpenRouterResponse(response, emitPublic, onReasoningText, inspectPlan);
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

function progressiveContentFrames(operation: Extract<ModelOperation, { type: "artifact.create" }>) {
  const content = operation.input.content as Record<string, unknown>;
  const listKey = operation.input.blueprintKey === "document" ? "blocks"
    : operation.input.blueprintKey === "flashcard_deck" ? "cards"
      : operation.input.blueprintKey === "quiz" ? "questions"
        : null;
  if (!listKey || !Array.isArray(content[listKey]) || content[listKey].length === 0) return [{ content, progress: 0.78 }];
  const rows = content[listKey] as unknown[];
  const frameCount = Math.min(5, rows.length);
  return Array.from({ length: frameCount }, (_, index) => {
    const count = Math.max(1, Math.ceil(rows.length * ((index + 1) / frameCount)));
    return { content: { ...content, [listKey]: rows.slice(0, count) }, progress: Math.min(0.92, count / rows.length * 0.92) };
  });
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
  if (/\b(OpenRouter|DeepSeek|provider|network|fetch failed|connection|stream failed)\b/i.test(message)) {
    return "Spectra lost its model connection before the run could finish. Your saved context is intact; retry when the connection is stable.";
  }
  return message.length > 240 ? `${message.slice(0, 237)}…` : message;
}

async function executeOperation(actorClerkId: string, runId: string, operationId: string, operation: ModelOperation, context: { executionId: string; surface: Surface; threadId?: string; workspaceId?: string; selectedArtifactIds?: string[]; attachmentNames?: string[]; contextSummary?: string; pendingArtifactId?: string; pendingWorkspaceId?: string; preclaimed?: boolean }) {
  await mutate(context.preclaimed ? "spectraOperations:assertClaimed" : "spectraOperations:claim", { actorClerkId, operationId });
  let output: Record<string, unknown> = {};
  let affected: Array<{ type: string; id: string }> = [];
  if (operation.type === "artifact.create") {
    const input = operation.input;
    const workspaceId = input.placement === "inbox" ? undefined : input.workspaceId ?? ((context.surface === "workspace" || context.surface === "artifact") ? context.workspaceId : undefined);
    output = context.pendingArtifactId ? await mutate("spectraArtifacts:finalizePending", {
      actorClerkId, artifactId: context.pendingArtifactId, runId, executionId: context.executionId, title: input.title, summary: input.summary ?? undefined, content: input.content, tags: input.tags,
    }) as Record<string, unknown> : await mutate("spectraArtifacts:create", {
      actorClerkId, blueprintKey: input.blueprintKey, title: input.title, summary: input.summary ?? undefined, content: input.content,
      tags: input.tags, workspaceId, source: context.surface === "chat" ? "chat" : "ai", runId,
      threadId: context.threadId, executionId: context.executionId,
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
      executionId: context.executionId,
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
    const workspaceId = context.pendingWorkspaceId ? (await mutate<unknown & object, { workspaceId: string }>("spectraWorkspaces:finalizePending", { actorClerkId, workspaceId: context.pendingWorkspaceId, runId, executionId: context.executionId, title: operation.input.title, description: operation.input.description ?? undefined, icon: operation.input.icon ?? undefined, color: operation.input.color ?? undefined })).workspaceId : await mutate("spectraWorkspaces:create", { actorClerkId, title: operation.input.title, description: operation.input.description ?? undefined, icon: operation.input.icon ?? undefined, color: operation.input.color ?? undefined }) as string;
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
      runId,
      executionId: context.executionId,
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
  executionId?: string;
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
    executionId: params.executionId,
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
      let attached = true;
      const emit = (event: unknown) => {
        if (!attached) return;
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); }
        catch { attached = false; }
      };
      void task(emit).catch((error) => emit({ type: "error", message: publicError(error) })).finally(() => { try { controller.close(); } catch {} });
    },
  }), { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Content-Type-Options": "nosniff" } });
}

function launchRunTask(task: (emit: (event: unknown) => void) => Promise<void>, immediateEvents: unknown[]) {
  // Unit tests execute inline so the worker contract can be asserted synchronously.
  // Production detaches provider work from the viewer response; every later update
  // is consumed from the persisted run-event stream by all surfaces.
  if (process.env.NODE_ENV === "test") return ndjson(task);
  after(async () => {
    await task(() => {}).catch(() => undefined);
  });
  return ndjson(async (emit) => {
    for (const event of immediateEvents) emit(event);
  });
}

async function runAttempt(params: { actorClerkId: string; runId: string; resultCardId: string; executionId: string; prompt: string; surface: Surface; threadId?: string; workspaceId?: string; artifactId?: string; focusMode?: EffectiveFocusMode; selectedArtifactIds?: string[]; explicitContextObjects?: Body["explicitContextObjects"]; currentView?: string; attachments?: PreparedAttachment[]; signal?: AbortSignal }, emit: (event: unknown) => void) {
  let card = await latestCard(params.actorClerkId, params.runId);
  let commitStarted = false;
  let publicText = "";
  let lastPersistedLength = 0;
  let lastPersistedAt = 0;
  let markedStreaming = false;
  let partialWrite: Promise<unknown> = Promise.resolve();
  let eventWrite: Promise<unknown> = Promise.resolve();
  let eventPersistenceFailed = false;
  const leaseController = new AbortController();
  const executionSignal = params.signal ? AbortSignal.any([params.signal, leaseController.signal]) : leaseController.signal;
  const heartbeat = setInterval(() => {
    void mutate<unknown & object, { alive: boolean }>("spectraRuns:heartbeat", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId }).then((result) => { if (!result.alive) leaseController.abort(); }).catch(() => null);
  }, 45_000);
  const publish = (event: Record<string, unknown>) => {
    emit(event);
    eventWrite = eventWrite.then(() => mutate("spectraRuns:appendEvent", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, type: String(event.type ?? "status"), payload: event })).catch(() => { eventPersistenceFailed = true; return null; });
  };
  const flushEvents = async () => {
    await eventWrite;
    if (eventPersistenceFailed) await mutate("spectraRuns:markTraceDegraded", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId }).catch(() => null);
  };
  publish({ type: "run_created", runId: params.runId, card: streamCard(card) });
  if (params.threadId) publish({ type: "thread_ready", runId: params.runId, threadId: params.threadId });
  try {
    await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, status: "running", phase: "planning", resultTitle: "Thinking", resultSummary: "Analysing request", resultActions: [] });
    publish({ type: "status", runId: params.runId, message: "Analysing request" });
    await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, status: "running", phase: "reading", resultTitle: "Reading context", resultSummary: "Reading the visible and selected work", resultActions: [] });
    const context = await buildContext(params.actorClerkId, { workspaceId: params.workspaceId, artifactId: params.artifactId, threadId: params.threadId, focusMode: params.focusMode, selectedArtifactIds: params.selectedArtifactIds, explicitContextObjects: params.explicitContextObjects, currentView: params.currentView }, params.prompt);
    await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, status: "running", phase: "retrieving", resultTitle: "Finding relevant work", resultSummary: "Matching the request to the workspace map", resultActions: [] });
    publish({ type: "status", runId: params.runId, message: "Finding relevant work" });
    const persistedConversation = context.conversation.at(-1)?.role === "user" && context.conversation.at(-1)?.content === params.prompt
      ? context.conversation.slice(0, -1)
      : context.conversation;
    const conversation = persistedConversation.slice(-30);
    await mutate("spectraRuns:setContextSnapshot", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      contextSnapshot: {
        workspaceId: params.workspaceId,
        artifactId: params.artifactId,
        threadId: params.threadId,
        focusMode: context.focusMode,
        selectedObjectIds: context.selectedArtifactIds,
        explicitContextObjects: params.explicitContextObjects,
        currentView: params.currentView,
        packetVersion: 2,
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
    const earlyPendingByIndex = new Map<number, string>();
    const earlyPendingWorkspaceByIndex = new Map<number, string>();
    const earlyUpdatedArtifactIds = new Set<string>();
    const progressiveWrites: Promise<unknown>[] = [];
    const owned = ownedReferences(context);
    if (params.artifactId && context.focusedArtifact?.title) publish({ type: "status", runId: params.runId, message: `Reviewing ${context.focusedArtifact.title}` });
    else if (workspaceTitle) publish({ type: "status", runId: params.runId, message: `Reviewing ${workspaceTitle} context` });
    const modelResult = await callModel(
      params.surface,
      params.prompt,
      { ...context.packet, conversation },
      params.attachments ?? [],
      (content, mode) => {
        if (!markedStreaming) { markedStreaming = true; eventWrite = eventWrite.then(() => mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, status: "running", phase: "streaming", resultTitle: "Writing response" })).catch(() => null); }
        publicText = mode === "replace" ? content : publicText + content;
        publish({ type: mode === "replace" ? "text_replace" : "text_delta", runId: params.runId, content });
        const now = Date.now();
        if (params.threadId && publicText.trim() && (publicText.length - lastPersistedLength >= 120 || now - lastPersistedAt >= 300)) {
          lastPersistedLength = publicText.length;
          lastPersistedAt = now;
          const snapshot = publicText;
          partialWrite = partialWrite.then(() => mutate("spectraThreads:appendMessage", {
            actorClerkId: params.actorClerkId,
            threadId: params.threadId!,
            role: "assistant",
            content: snapshot,
            runId: params.runId,
            executionId: params.executionId,
            metadata: { partial: true, hasOperationalTrace: true },
          })).catch(() => null);
        }
      },
      undefined,
      executionSignal,
      (rawOperation, index) => {
        const progressiveWrite = (async () => {
          let operation: ModelOperation;
          try { operation = parseModelOperation(rawOperation); } catch { return; }
          if (operation.type === "artifact.create") {
            const workspaceId = operation.input.placement === "inbox" ? undefined : operation.input.workspaceId ?? ((params.surface === "workspace" || params.surface === "artifact") ? params.workspaceId : undefined);
            const pending = await mutate<unknown & object, { artifactId: string }>("spectraArtifacts:createPending", { actorClerkId: params.actorClerkId, blueprintKey: operation.input.blueprintKey, title: operation.input.title, workspaceId, runId: params.runId, executionId: params.executionId, threadId: params.threadId });
            earlyPendingByIndex.set(index, pending.artifactId);
            publish({ type: "operation_preview", runId: params.runId, operationId: `preview-${index + 1}`, operationType: operation.type, preview: { ...safeOperationPreview(operation), pendingArtifactId: pending.artifactId } });
            const frames = progressiveContentFrames(operation);
            for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
              const frame = frames[frameIndex]!;
              await mutate("spectraArtifacts:patchPendingContent", { actorClerkId: params.actorClerkId, artifactId: pending.artifactId, runId: params.runId, executionId: params.executionId, content: frame.content, progress: frame.progress, summary: `Building ${operation.input.title} · ${Math.round(frame.progress * 100)}%` });
              publish({ type: "artifact_patch", runId: params.runId, operationId: `preview-${index + 1}`, artifactId: pending.artifactId, patch: { content: frame.content, progress: frame.progress } });
              if (frameIndex < frames.length - 1) await new Promise((resolve) => setTimeout(resolve, 90));
            }
          } else if (operation.type === "artifact.update" && owned.artifactIds.has(operation.input.artifactId)) {
            earlyUpdatedArtifactIds.add(operation.input.artifactId);
            await mutate("spectraArtifacts:stageAiPatch", { actorClerkId: params.actorClerkId, artifactId: operation.input.artifactId, runId: params.runId, executionId: params.executionId, title: operation.input.title ?? undefined, summary: operation.input.summary ?? undefined, content: operation.input.content ?? undefined });
            publish({ type: "artifact_patch", runId: params.runId, operationId: `preview-${index + 1}`, artifactId: operation.input.artifactId, patch: { title: operation.input.title, summary: operation.input.summary, content: operation.input.content } });
          } else if (operation.type === "workspace.create") {
            const pending = await mutate<unknown & object, { workspaceId: string }>("spectraWorkspaces:createPending", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, title: operation.input.title, description: operation.input.description ?? undefined, icon: operation.input.icon ?? undefined, color: operation.input.color ?? undefined });
            earlyPendingWorkspaceByIndex.set(index, pending.workspaceId);
            publish({ type: "operation_preview", runId: params.runId, operationId: `preview-${index + 1}`, operationType: operation.type, preview: safeOperationPreview(operation) });
          } else if (operation.type === "workspace.update" && owned.workspaceIds.has(operation.input.workspaceId)) {
            await mutate("spectraWorkspaces:stageAiPatch", { actorClerkId: params.actorClerkId, workspaceId: operation.input.workspaceId, runId: params.runId, executionId: params.executionId, title: operation.input.title ?? undefined, description: operation.input.description ?? undefined, icon: operation.input.icon ?? undefined, color: operation.input.color ?? undefined });
            publish({ type: "operation_preview", runId: params.runId, operationId: `preview-${index + 1}`, operationType: operation.type, preview: safeOperationPreview(operation) });
          }
        })().catch(() => null);
        progressiveWrites.push(progressiveWrite);
      },
    );
    await partialWrite;
    await Promise.all(progressiveWrites);
    const plan = validatePlanAgainstIntent(modelResult.plan, ownedReferences(context));
    if (!params.threadId && (plan.conversationTitle || plan.conversationSummary)) {
      await mutate("spectraRuns:setSuggestedThreadMetadata", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, title: plan.conversationTitle ?? undefined, summary: plan.conversationSummary ?? undefined });
    }
    if (params.threadId && (plan.conversationTitle || plan.conversationSummary)) {
      await mutate("spectraThreads:applyGeneratedMetadata", {
        actorClerkId: params.actorClerkId,
        threadId: params.threadId,
        runId: params.runId,
        executionId: params.executionId,
        title: plan.conversationTitle ?? undefined,
        summary: plan.conversationSummary ?? undefined,
      });
    }
    const policy = evaluatePlanPolicy(plan.operations, { intent: plan.intent });
    const stored = await mutate<{ actorClerkId: string; runId: string; executionId: string; operations: Array<{ type: string; input: unknown; requiresConfirmation: boolean }> }, { operationIds: string[] }>("spectraOperations:recordPlan", {
      actorClerkId: params.actorClerkId,
      runId: params.runId,
      executionId: params.executionId,
      operations: plan.operations.map((operation) => ({ type: operation.type, input: operation.input, requiresConfirmation: policy.requiresConfirmation })),
    });
    const pendingArtifacts = new Map<string, string>();
    for (let index = 0; index < stored.operationIds.length; index += 1) {
      const operationId = stored.operationIds[index]!;
      const operation = plan.operations[index];
      let pendingArtifactId: string | undefined;
      if (operation?.type === "artifact.create" && !policy.requiresConfirmation) {
        pendingArtifactId = earlyPendingByIndex.get(index);
        if (!pendingArtifactId) {
          const workspaceId = operation.input.placement === "inbox" ? undefined : operation.input.workspaceId ?? ((params.surface === "workspace" || params.surface === "artifact") ? params.workspaceId : undefined);
          const pending = await mutate<unknown & object, { artifactId: string }>("spectraArtifacts:createPending", { actorClerkId: params.actorClerkId, blueprintKey: operation.input.blueprintKey, title: operation.input.title, workspaceId, runId: params.runId, executionId: params.executionId, threadId: params.threadId });
          pendingArtifactId = pending.artifactId;
        }
        pendingArtifacts.set(operationId, pendingArtifactId);
      }
      if (operation?.type === "artifact.create" && earlyPendingByIndex.get(index)) {
        pendingArtifactId = earlyPendingByIndex.get(index);
        pendingArtifacts.set(operationId, pendingArtifactId!);
        await mutate("spectraOperations:attachPendingArtifact", { actorClerkId: params.actorClerkId, operationId, artifactId: pendingArtifactId });
      }
      if (operation?.type === "workspace.create" && earlyPendingWorkspaceByIndex.get(index)) {
        await mutate("spectraOperations:attachPendingWorkspace", { actorClerkId: params.actorClerkId, operationId, workspaceId: earlyPendingWorkspaceByIndex.get(index)! });
      }
      publish({ type: "operation_preview", runId: params.runId, operationId, operationType: operation?.type ?? "unknown", preview: operation ? { ...safeOperationPreview(operation), pendingArtifactId } : undefined });
    }

    if (plan.decision !== "operate") {
      const title = plan.decision === "clarify" ? "Needs clarification" : plan.decision === "refuse" ? "Unable to apply" : "Answer";
      await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, status: "completed", decision: plan.decision, planIntent: plan.intent, finalSummary: plan.finalResponse, resultTitle: title, resultSummary: plan.finalResponse, resultVariant: "status", resultActions: [], provenance, modelUsed: modelResult.model, providerUsed: modelResult.provider, usage: modelResult.usage });
      await saveAssistantMessage({ actorClerkId: params.actorClerkId, threadId: params.threadId, runId: params.runId, executionId: params.executionId, content: plan.finalResponse, decision: plan.decision, model: modelResult.model, provider: modelResult.provider, usage: modelResult.usage, choices: plan.choices });
      card = await latestCard(params.actorClerkId, params.runId);
      publish({ type: "final", runId: params.runId, summary: plan.finalResponse, card: streamCard(card) });
      await flushEvents();
      return;
    }

    if (policy.requiresConfirmation) {
      const actions: ResultAction[] = [
        { key: "confirm", label: "Confirm", targetType: "run", targetId: params.runId },
        { key: "cancel", label: "Cancel", targetType: "run", targetId: params.runId },
      ];
      await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, status: "awaiting_confirmation", phase: "approval", decision: plan.decision, planIntent: plan.intent, finalSummary: plan.finalResponse, resultTitle: "Confirmation required", resultSummary: policy.reasons.join(" · "), resultVariant: "operation", resultActions: actions, provenance, modelUsed: modelResult.model, providerUsed: modelResult.provider, usage: modelResult.usage });
      await saveAssistantMessage({ actorClerkId: params.actorClerkId, threadId: params.threadId, runId: params.runId, executionId: params.executionId, content: plan.finalResponse, decision: plan.decision, awaitingConfirmation: true, model: modelResult.model, provider: modelResult.provider, usage: modelResult.usage });
      card = await latestCard(params.actorClerkId, params.runId);
      publish({ type: "confirmation_required", runId: params.runId, reasons: policy.reasons, card: streamCard(card) });
      await flushEvents();
      return;
    }

    await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, status: "running", phase: "applying", resultTitle: "Applying changes", resultSummary: "Updating the workspace", resultActions: [] });
    const allAffected: Array<{ type: string; id: string }> = [];
    for (let index = 0; index < plan.operations.length; index += 1) {
      const operation = plan.operations[index]!;
      const operationId = stored.operationIds[index]!;
      if (operation.type === "artifact.update") {
        if (!earlyUpdatedArtifactIds.has(operation.input.artifactId)) await mutate("spectraArtifacts:stageAiPatch", { actorClerkId: params.actorClerkId, artifactId: operation.input.artifactId, runId: params.runId, executionId: params.executionId, title: operation.input.title ?? undefined, summary: operation.input.summary ?? undefined, content: operation.input.content ?? undefined });
        publish({ type: "artifact_patch", runId: params.runId, operationId, artifactId: operation.input.artifactId, patch: { title: operation.input.title, summary: operation.input.summary, content: operation.input.content } });
      }
      for (const phase of operationPhases(operation, typeof workspaceTitle === "string" ? workspaceTitle : undefined)) {
        await mutate("spectraRuns:patchResultCard", { actorClerkId: params.actorClerkId, resultCardId: params.resultCardId, executionId: params.executionId, title: operationLabel(operation), summary: phase });
        publish({ type: "status", runId: params.runId, message: phase });
      }
      publish({ type: "operation_commit", runId: params.runId, operationId });
      try {
        commitStarted = true;
        const affected = await executeOperation(params.actorClerkId, params.runId, operationId, operation, {
          executionId: params.executionId,
          surface: params.surface,
          threadId: params.threadId,
          workspaceId: params.workspaceId,
          selectedArtifactIds: context.selectedArtifactIds,
          attachmentNames: params.attachments?.map((attachment) => attachment.name),
          contextSummary: context.selectedArtifactIds.length
            ? `Based on ${context.selectedArtifactIds.length} selected artifact${context.selectedArtifactIds.length === 1 ? "" : "s"}${params.threadId ? " and a continued thread" : ""}`
            : params.threadId ? "Based on a continued thread and visible focus" : params.artifactId ? "Based on the open artifact" : params.workspaceId ? "Based on workspace context" : "Based on global context",
          pendingArtifactId: pendingArtifacts.get(operationId),
          pendingWorkspaceId: earlyPendingWorkspaceByIndex.get(index),
        });
        allAffected.push(...affected);
        publish({ type: "operation_result", runId: params.runId, operationId, affected });
      } catch (error) {
        const pendingArtifactId = pendingArtifacts.get(operationId);
        if (pendingArtifactId) await mutate("spectraArtifacts:markAiState", { actorClerkId: params.actorClerkId, artifactId: pendingArtifactId, runId: params.runId, executionId: params.executionId, state: "failed" }).catch(() => null);
        if (operation.type === "artifact.update") await mutate("spectraArtifacts:markAiState", { actorClerkId: params.actorClerkId, artifactId: operation.input.artifactId, runId: params.runId, executionId: params.executionId, state: "failed" }).catch(() => null);
        await mutate("spectraOperations:markFailed", { actorClerkId: params.actorClerkId, operationId, error: publicError(error) }).catch(() => null);
        throw error;
      }
    }
    const artifact = allAffected.find((item) => item.type === "artifact");
    const actions: ResultAction[] = artifact ? [{ key: "open", label: "Open", targetType: "artifact", targetId: artifact.id }] : [];
    await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, status: "completed", decision: plan.decision, planIntent: plan.intent, finalSummary: plan.finalResponse, resultTitle: "Done", resultSummary: plan.finalResponse, resultVariant: artifact ? "artifact" : "status", resultActions: actions, provenance, modelUsed: modelResult.model, providerUsed: modelResult.provider, usage: modelResult.usage });
    await saveAssistantMessage({ actorClerkId: params.actorClerkId, threadId: params.threadId, runId: params.runId, executionId: params.executionId, content: plan.finalResponse, decision: plan.decision, affected: allAffected, model: modelResult.model, provider: modelResult.provider, usage: modelResult.usage });
    card = await latestCard(params.actorClerkId, params.runId);
    publish({ type: "final", runId: params.runId, summary: plan.finalResponse, card: streamCard(card) });
    await flushEvents();
  } catch (error) {
    if ((error instanceof DOMException && error.name === "AbortError") || executionSignal.aborted) {
      await mutate("spectraOperations:cancelPending", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId }).catch(() => null);
      await mutate("spectraArtifacts:discardPendingForRun", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId }).catch(() => null);
      await mutate("spectraArtifacts:settleStagedForRun", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, outcome: "clear" }).catch(() => null);
      await mutate("spectraWorkspaces:settleForRun", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, outcome: "clear" }).catch(() => null);
      await partialWrite;
      await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, status: "cancelled", resultTitle: "Stopped", resultSummary: publicText.trim() ? "Stopped by you. The partial response is saved in this thread." : "Stopped before the response began. You can retry when ready.", resultActions: [{ key: "retry", label: "Retry", targetType: "run", targetId: params.runId }] }).catch(() => null);
      publish({ type: "stopped", runId: params.runId, partial: Boolean(publicText.trim()) });
      await flushEvents();
      return;
    }
    const message = publicError(error);
    await mutate("spectraOperations:cancelPending", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId }).catch(() => null);
    await mutate("spectraArtifacts:failPendingForRun", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId }).catch(() => null);
    await mutate("spectraArtifacts:settleStagedForRun", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, outcome: "failed" }).catch(() => null);
    await mutate("spectraWorkspaces:settleForRun", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, outcome: "failed" }).catch(() => null);
    const resultSummary = commitStarted ? `${message} Review the affected objects before submitting a follow-up command.` : message;
    await mutate("spectraRuns:updateStatus", { actorClerkId: params.actorClerkId, runId: params.runId, executionId: params.executionId, status: "failed", error: message, resultTitle: "Run failed", resultSummary, resultVariant: "error", resultActions: commitStarted ? [] : [{ key: "retry", label: "Retry", targetType: "run", targetId: params.runId }] }).catch(() => null);
    card = await latestCard(params.actorClerkId, params.runId).catch(() => card);
    publish({ type: "error", runId: params.runId, message, card: card ? streamCard(card) : undefined });
    await flushEvents();
  } finally {
    clearInterval(heartbeat);
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
	    let attachments: PreparedAttachment[];
	    try { attachments = await prepareAttachments(body.attachments); }
	    catch (error) { return new Response(publicError(error), { status: 400 }); }
	    const placementWorkspaceId = await inferWorkspaceForRun(actor.clerkId, body);
	    let created: { runId: string; resultCardId: string; threadId: string; executionId: string; created: boolean };
	    try { created = await mutate<unknown & object, { runId: string; resultCardId: string; threadId: string; executionId: string; created: boolean }>("spectraRuns:beginRun", {
	      actorClerkId: actor.clerkId, sourceSurface, userPrompt: prompt,
	      submissionKey: body.submissionKey?.trim() || crypto.randomUUID(),
	      threadId: body.threadId?.trim() || undefined, workspaceId: placementWorkspaceId,
	      artifactId: body.artifactId, modelUsed: getSpectraModelId(),
	      messageMetadata: { attachments: attachments.map(({ name, mimeType, size, handling }) => ({ name, mimeType, size, handling })) },
	    }); } catch (error) { return new Response(publicError(error), { status: 409 }); }
	    const threadId = created.threadId;
	    if (!created.created) {
	      const card = await latestCard(actor.clerkId, created.runId);
	      return ndjson(async (emit) => { emit({ type: "run_created", runId: created.runId, card: streamCard(card) }); emit({ type: "thread_ready", runId: created.runId, threadId }); });
	    }
	    const executionController = new AbortController();
	    activeRunControllers.set(created.runId, executionController);
	    const task = async (emit: (event: unknown) => void) => {
	      try { await runAttempt({
	      actorClerkId: actor.clerkId,
	      runId: created.runId,
	      resultCardId: created.resultCardId,
	      executionId: created.executionId,
      prompt,
      surface,
      threadId,
	      workspaceId: placementWorkspaceId,
      artifactId: body.artifactId,
      focusMode: body.focusMode,
      selectedArtifactIds: body.selectedArtifactIds,
      explicitContextObjects: body.explicitContextObjects,
      currentView: body.currentView,
      attachments,
      signal: executionController.signal,
    }, emit); } finally { if (activeRunControllers.get(created.runId) === executionController) activeRunControllers.delete(created.runId); }
	    };
	    const initialCard = await latestCard(actor.clerkId, created.runId);
	    return launchRunTask(task, [
	      { type: "run_created", runId: created.runId, card: streamCard(initialCard) },
	      { type: "thread_ready", runId: created.runId, threadId },
	    ]);
  }

  const runId = body.runId?.trim();
  if (!runId) return new Response("runId is required", { status: 400 });

  if (action === "stop") {
    let stopped: { alreadyStopped: boolean; executionId?: string };
    try { stopped = await mutate<unknown & object, { alreadyStopped: boolean; executionId?: string }>("spectraRuns:stopRun", { actorClerkId: actor.clerkId, runId }); }
    catch (error) { return new Response(publicError(error), { status: 409 }); }
    const controller = activeRunControllers.get(runId);
    controller?.abort();
    await mutate("spectraArtifacts:discardPendingForRun", { actorClerkId: actor.clerkId, runId, executionId: stopped.executionId }).catch(() => null);
    await mutate("spectraArtifacts:settleStagedForRun", { actorClerkId: actor.clerkId, runId, executionId: stopped.executionId, outcome: "clear" }).catch(() => null);
    await mutate("spectraWorkspaces:settleForRun", { actorClerkId: actor.clerkId, runId, executionId: stopped.executionId, outcome: "clear" }).catch(() => null);
    if (!controller && !stopped.alreadyStopped && stopped.executionId) await mutate("spectraRuns:appendEvent", { actorClerkId: actor.clerkId, runId, executionId: stopped.executionId, type: "stopped", payload: { type: "stopped", runId, partial: true } });
    return new Response(null, { status: 204 });
  }

  if (action === "retry") {
    const retryKey = body.submissionKey?.trim() || crypto.randomUUID();
    let reset: RetryReset;
    try { reset = await mutate<unknown & object, RetryReset>("spectraRuns:resetForRetry", { actorClerkId: actor.clerkId, runId, retryKey }); }
    catch (error) { return new Response(publicError(error), { status: 409 }); }
    if (!reset.resultCardId) return new Response("Result card not found", { status: 409 });
    if (!reset.created) {
      const card = await latestCard(actor.clerkId, runId);
      return ndjson(async (emit) => emit({ type: "run_created", runId, card: streamCard(card) }));
    }
    await mutate("spectraOperations:cancelPending", { actorClerkId: actor.clerkId, runId }).catch(() => null);
    await mutate("spectraArtifacts:discardPendingForRun", { actorClerkId: actor.clerkId, runId }).catch(() => null);
    await mutate("spectraArtifacts:settleStagedForRun", { actorClerkId: actor.clerkId, runId, outcome: "clear" }).catch(() => null);
    await mutate("spectraWorkspaces:settleForRun", { actorClerkId: actor.clerkId, runId, outcome: "clear" }).catch(() => null);
    const run: RunState = { status: "queued", sourceSurface: reset.sourceSurface, workspaceId: reset.workspaceId, artifactId: reset.artifactId, userPrompt: reset.prompt };
    const state = await query<{ actorClerkId: string; runId: string }, RunDetail>("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    const executionController = new AbortController();
    activeRunControllers.set(runId, executionController);
    const task = async (emit: (event: unknown) => void) => {
      try { await runAttempt({ actorClerkId: actor.clerkId, runId, resultCardId: reset.resultCardId!, executionId: reset.executionId, prompt: reset.prompt, surface: surfaceFromRun(run), threadId: state.run.threadId, workspaceId: reset.workspaceId, artifactId: reset.artifactId, focusMode: reset.contextSnapshot?.focusMode, selectedArtifactIds: reset.contextSnapshot?.selectedObjectIds, explicitContextObjects: reset.contextSnapshot?.explicitContextObjects, currentView: reset.contextSnapshot?.currentView, attachments: [], signal: executionController.signal }, emit); }
      finally { if (activeRunControllers.get(runId) === executionController) activeRunControllers.delete(runId); }
    };
    const initialCard = await latestCard(actor.clerkId, runId);
    return launchRunTask(task, [{ type: "run_created", runId, card: streamCard(initialCard) }, { type: "thread_ready", runId, threadId: state.run.threadId }]);
  }

  if (action === "cancel") {
    const state = await query<{ actorClerkId: string; runId: string }, RunDetail>("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    if (!state.run.executionId) return new Response("This older approval cannot be resumed safely. Start a new thread instead.", { status: 409 });
    if (state.run.status !== "awaiting_confirmation" && state.run.status !== "cancelled") return new Response("This approval was already handled in another view.", { status: 409 });
    let rejection: { alreadyRejected: boolean };
    try { rejection = await mutate<unknown & object, { alreadyRejected: boolean }>("spectraRuns:rejectConfirmation", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId }); }
    catch (error) { return new Response(publicError(error), { status: 409 }); }
    await mutate("spectraArtifacts:discardPendingForRun", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId }).catch(() => null);
    await mutate("spectraArtifacts:settleStagedForRun", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId, outcome: "clear" }).catch(() => null);
    await mutate("spectraWorkspaces:settleForRun", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId, outcome: "clear" }).catch(() => null);
    await saveAssistantMessage({ actorClerkId: actor.clerkId, threadId: state.run.threadId, runId, executionId: state.run.executionId, content: "No proposed changes were applied.", decision: state.run.decision, awaitingConfirmation: false });
    if (!rejection.alreadyRejected && state.run.executionId) await mutate("spectraRuns:appendEvent", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId, type: "approval_rejected", payload: { type: "approval_rejected", runId } });
    const card = await latestCard(actor.clerkId, runId);
    return ndjson(async (emit) => emit({ type: "final", runId, summary: "No proposed changes were applied.", card: streamCard(card) }));
  }

  if (action === "confirm") {
    const state = await query<{ actorClerkId: string; runId: string }, RunDetail>("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    const approvalExecutionId = state.run.executionId;
    if (!approvalExecutionId) return new Response("This older approval cannot be resumed safely. Start a new thread instead.", { status: 409 });
    if (state.run.status !== "awaiting_confirmation") return new Response("Run is not awaiting confirmation", { status: 409 });
    const intent = requestIntentSchema.parse(state.run.planIntent);
    const proposed = state.operations.filter((row) => row.status === "proposed" && (!row.executionId || row.executionId === state.run.executionId));
    if (!proposed.some((row) => row.requiresConfirmation) || proposed.length === 0) return new Response("No confirmable operations", { status: 409 });
    const operations = proposed.map((row) => parseModelOperation({ type: row.type, input: row.input }));
    const contextBody = { workspaceId: state.run.workspaceId, artifactId: state.run.artifactId, threadId: state.run.threadId, focusMode: state.run.contextSnapshot?.focusMode, selectedArtifactIds: state.run.contextSnapshot?.selectedObjectIds, explicitContextObjects: state.run.contextSnapshot?.explicitContextObjects, currentView: state.run.contextSnapshot?.currentView };
    const context = await buildContext(actor.clerkId, contextBody, state.run.userPrompt);
    validatePlanAgainstIntent({ decision: "operate", intent, finalResponse: state.run.finalSummary ?? "Confirmed changes completed.", operations }, ownedReferences(context));
    evaluatePlanPolicy(operations, { intent });
    return ndjson(async (emit) => {
      let commitStarted = false;
      try {
        const claim = await mutate<unknown & object, { operationIds: string[] }>("spectraRuns:claimConfirmation", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId });
        if (state.run.executionId) await mutate("spectraRuns:appendEvent", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId, type: "approval_accepted", payload: { type: "approval_accepted", runId } });
        const allAffected: Array<{ type: string; id: string }> = [];
        for (let index = 0; index < operations.length; index += 1) {
          const operation = operations[index]!;
          const row = proposed[index]!;
          if (!claim.operationIds.includes(row._id)) throw new Error("This approval was already handled in another view.");
          for (const phase of operationPhases(operation, typeof context.currentWorkspace?.title === "string" ? context.currentWorkspace.title : undefined)) {
            const event = { type: "status", runId, message: phase };
            emit(event);
            if (state.run.executionId) await mutate("spectraRuns:appendEvent", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId, type: "status", payload: event });
          }
          const commitEvent = { type: "operation_commit", runId, operationId: row._id };
          emit(commitEvent);
          if (state.run.executionId) await mutate("spectraRuns:appendEvent", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId, type: "operation_commit", payload: commitEvent });
          commitStarted = true;
          const affected = await executeOperation(actor.clerkId, runId, row._id, operation, { executionId: approvalExecutionId, surface: surfaceFromRun(state.run), threadId: state.run.threadId, workspaceId: state.run.workspaceId, selectedArtifactIds: context.selectedArtifactIds, contextSummary: context.selectedArtifactIds.length ? `Based on ${context.selectedArtifactIds.length} selected artifacts` : undefined, pendingArtifactId: row.pendingArtifactId, pendingWorkspaceId: row.pendingWorkspaceId, preclaimed: true });
          allAffected.push(...affected);
          const resultEvent = { type: "operation_result", runId, operationId: row._id, affected };
          emit(resultEvent);
          if (state.run.executionId) await mutate("spectraRuns:appendEvent", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId, type: "operation_result", payload: resultEvent });
        }
        const summary = state.run.finalSummary || "Confirmed changes completed.";
        const artifact = allAffected.find((item) => item.type === "artifact");
        await mutate("spectraRuns:updateStatus", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId, status: "completed", finalSummary: summary, resultTitle: "Done", resultSummary: summary, resultVariant: artifact ? "artifact" : "status", resultActions: artifact ? [{ key: "open", label: "Open", targetType: "artifact", targetId: artifact.id }] : [] });
        if (state.run.executionId) await mutate("spectraRuns:appendEvent", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId, type: "final", payload: { type: "final", runId, summary, card: streamCard(await latestCard(actor.clerkId, runId)) } });
        await saveAssistantMessage({ actorClerkId: actor.clerkId, threadId: state.run.threadId, runId, executionId: state.run.executionId, content: summary, decision: state.run.decision, affected: allAffected });
        const card = await latestCard(actor.clerkId, runId);
        emit({ type: "final", runId, summary, card: streamCard(card) });
      } catch (error) {
        const message = publicError(error);
        if (/already handled in another view/i.test(message)) {
          const card = await latestCard(actor.clerkId, runId).catch(() => undefined);
          emit({ type: "error", runId, message, card: card ? streamCard(card) : undefined });
          return;
        }
        await mutate("spectraOperations:cancelPending", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId }).catch(() => null);
        const resultSummary = commitStarted ? `${message} Review the affected objects before submitting a follow-up command.` : message;
        await mutate("spectraRuns:updateStatus", { actorClerkId: actor.clerkId, runId, executionId: state.run.executionId, status: "failed", error: message, resultTitle: "Run failed", resultSummary, resultVariant: "error", resultActions: commitStarted ? [] : [{ key: "retry", label: "Retry", targetType: "run", targetId: runId }] }).catch(() => null);
        const card = await latestCard(actor.clerkId, runId).catch(() => undefined);
        emit({ type: "error", runId, message, card: card ? streamCard(card) : undefined });
      }
    });
  }

  return new Response("Unknown action", { status: 400 });
}
