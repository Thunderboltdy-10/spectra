import { getSpectraModelId } from "@/features/spectra/ai/model-config";
import { applyAiArtifactMutation } from "@/features/spectra/ai/yjs-artifact-operation";
import { withSpectraRequestLog } from "@/features/spectra/ai/run-log";
import { prepareAttachments as prepareRunAttachments } from "@/features/spectra/compute/files/attachment-preprocessor";
import {
  attachmentBytesAsInput,
  attachmentInputBytes,
  attachmentSha256,
} from "@/features/spectra/compute/files/attachment-retention";
import { createNdjsonResponse } from "@/features/spectra/runs/streaming/ndjson-response";
import { requireActor } from "@/lib/auth-server";
import { withWorkerConvexToken } from "@/lib/convex-worker-context";
import { errorStatus } from "@/lib/route-handler";
import { createClerkClient } from "@clerk/backend";
import { NextRequest } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { runHarnessAttempt, type AttemptMode, type AttemptParams } from "./harness/attempt";
import type {
  AttachmentInput,
  Body,
  PreparedAttachment,
  RetryReset,
  RunDetail,
  RunState,
  Surface,
} from "./harness/contract";
import { act, mutate, query } from "./harness/io";
import { latestCard, publicError, streamCard } from "./harness/report";
import { handleUiObserverRequest, uiObserverSchema } from "./harness/ui-observer-request";

/*
 * The Spectra run route. One harness loop does the work (harness/attempt.ts);
 * this file admits requests, owns the run lifecycle actions (run, answer,
 * steer, stop, retry, undo) and dispatches attempts inline or to a scheduled
 * worker. See docs/ai/HARNESS.md.
 */

function ndjson(task: (emit: (event: unknown) => void) => Promise<void>) {
  return createNdjsonResponse(task, publicError);
}

const scheduledExecution = () =>
  process.env.SPECTRA_TEST_INLINE_RUNS !== "1" && Boolean(process.env.SPECTRA_APP_URL?.trim());

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

async function inferWorkspaceForRun(actorClerkId: string, body: Body) {
  if (body.workspaceId) return body.workspaceId;
  if (!body.artifactId) return undefined;
  try {
    const artifact = await query<unknown & object, { placements?: Array<{ workspaceId?: string }> }>("spectraArtifacts:get", {
      actorClerkId,
      artifactId: body.artifactId,
    });
    const workspaceIds = [
      ...new Set((artifact.placements ?? []).flatMap((placement) => (typeof placement.workspaceId === "string" ? [placement.workspaceId] : []))),
    ];
    return workspaceIds.length === 1 ? workspaceIds[0] : undefined;
  } catch {
    return undefined;
  }
}

function surfaceFromRun(run: RunState): Surface {
  if (run.sourceSurface === "artifact") return run.artifactId ? "artifact" : "artifacts";
  return run.sourceSurface;
}

function verifyScheduledCallback(request: NextRequest, rawBody: string) {
  const base = process.env.SPECTRA_COLLAB_BRIDGE_KEY?.trim();
  if (!base || base.length < 32) return false;
  const key = createHmac("sha256", base).update("spectra-event-callback:v1").digest("base64url");
  const timestampText = request.headers.get("x-spectra-scheduler-timestamp") ?? "";
  const signature = request.headers.get("x-spectra-scheduler-signature") ?? "";
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 30_000) return false;
  const digest = createHash("sha256").update(rawBody).digest("base64url");
  const expected = createHmac("sha256", key).update(`${timestamp}.${digest}`).digest();
  const received = Buffer.from(signature, "base64url");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function persistRunAttachments(
  runId: string,
  executionId: string,
  input: AttachmentInput[] | undefined,
  prepared: PreparedAttachment[],
) {
  const rows = Array.isArray(input) ? input.slice(0, 4) : [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const preparedRow = prepared[index];
    if (!preparedRow || !row.handling) throw new Error("ATTACHMENT_SERIALIZATION_INVALID");
    const bytes = attachmentInputBytes(row);
    const beginning = await mutate<
      Record<string, unknown>,
      { runAttachmentId: string; reused: boolean; uploadReceipt?: string; uploadUrl?: string }
    >("spectraRuns:beginRunAttachmentUpload", {
      runId,
      executionId,
      originalFileId: preparedRow.id ?? row.assetId ?? row.importId ?? `file:${preparedRow.name}:${bytes.byteLength}`,
      name: preparedRow.name,
      mimeType: preparedRow.mimeType,
      size: bytes.byteLength,
      handling: row.handling,
      sha256: attachmentSha256(bytes),
      sourceMap: preparedRow.sourceMap,
      provenance: { ...preparedRow.provenance, ...(row.sourceRef ? { sourceRef: row.sourceRef } : {}) },
    });
    if (beginning.reused) continue;
    if (!beginning.uploadUrl || !beginning.uploadReceipt) throw new Error("ATTACHMENT_UPLOAD_INTENT_MISSING");
    const uploaded = await fetch(beginning.uploadUrl, {
      method: "POST",
      headers: { "Content-Type": preparedRow.mimeType, "Content-Length": String(bytes.byteLength) },
      body: bytes,
    });
    if (!uploaded.ok) throw new Error("ATTACHMENT_STORAGE_UPLOAD_FAILED");
    const payload = (await uploaded.json()) as { storageId?: string };
    if (!payload.storageId) throw new Error("ATTACHMENT_STORAGE_ID_MISSING");
    const stored = await act<
      { runAttachmentId: string; storageId: string; uploadReceipt: string },
      { status?: string; errorCode?: string }
    >("artifactIntakeActions:verifyUploadedRunAttachment", {
      runAttachmentId: beginning.runAttachmentId,
      storageId: payload.storageId,
      uploadReceipt: beginning.uploadReceipt,
    });
    if (stored.status !== "active") throw new Error(stored.errorCode ?? "ATTACHMENT_UPLOAD_INTEGRITY_FAILED");
  }
}

async function loadPersistedRunAttachments(runId: string, executionId: string) {
  const rows = await query<
    { runId: string; executionId: string },
    Array<{
      runAttachmentId: string;
      originalFileId?: string;
      name: string;
      mimeType: string;
      size: number;
      handling: PreparedAttachment["handling"];
      sourceMap?: PreparedAttachment["sourceMap"];
      provenance?: PreparedAttachment["provenance"];
      url: string | null;
    }>
  >("spectraRuns:listRunAttachments", { runId, executionId });
  const raw = await Promise.all(
    rows.map(async (row) => {
      if (!row.url) throw new Error("ATTACHMENT_STORAGE_URL_EXPIRED");
      const response = await fetch(row.url);
      if (!response.ok) throw new Error("ATTACHMENT_STORAGE_READ_FAILED");
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        row,
        input: attachmentBytesAsInput(bytes, {
          id: row.originalFileId ?? row.runAttachmentId,
          name: row.name,
          mimeType: row.mimeType,
          handling: row.handling,
        }),
      };
    }),
  );
  const prepared = await prepareRunAttachments(raw.map(({ input }) => input));
  return prepared.map((attachment, index) => ({
    ...attachment,
    id: raw[index]!.row.originalFileId ?? raw[index]!.row.runAttachmentId,
    sourceMap: raw[index]!.row.sourceMap ?? attachment.sourceMap,
    provenance: raw[index]!.row.provenance ?? attachment.provenance,
  }));
}

/** Scheduled workers act as the owner, with a short-lived session token. */
async function asOwner<T>(actorClerkId: string, task: () => Promise<T>) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("Scheduled execution authentication is unavailable.");
  const clerk = createClerkClient({ secretKey });
  const sessions = await clerk.sessions.getSessionList({ userId: actorClerkId, status: "active", limit: 10 });
  const session = sessions.data.sort((left, right) => right.lastActiveAt - left.lastActiveAt)[0];
  if (!session) throw new Error("The owner has no active session for this scheduled run.");
  const token = await clerk.sessions.getToken(session.id, "convex", 1_800);
  return withWorkerConvexToken(token.jwt, task);
}

type RunPayload = Omit<AttemptParams, "actorClerkId" | "runId" | "resultCardId" | "executionId" | "workerId" | "signal" | "scheduled">;

function payloadFrom(value: unknown): RunPayload {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const surface = payload.surface === "workspace" || payload.surface === "artifact" || payload.surface === "artifacts" ? payload.surface : "chat";
  const mode: AttemptMode = payload.mode === "resume" || payload.mode === "retry" ? payload.mode : "start";
  return {
    mode,
    prompt: typeof payload.prompt === "string" ? payload.prompt : "",
    surface,
    threadId: text(payload.threadId),
    workspaceId: text(payload.workspaceId),
    scopeNodeId: text(payload.scopeNodeId),
    artifactId: text(payload.artifactId),
    currentView: text(payload.currentView),
    timeZone: text(payload.timeZone),
    agentId: text(payload.agentId),
  };
}

/** The payload that continues an existing run from its durable state. */
function payloadForRun(run: RunState, mode: AttemptMode, timeZone?: string): RunPayload {
  return {
    mode,
    prompt: run.userPrompt,
    surface: surfaceFromRun(run),
    threadId: run.threadId,
    workspaceId: run.workspaceId,
    scopeNodeId: run.scopeNodeId ?? run.contextSnapshot?.scopeNodeId,
    artifactId: run.artifactId,
    currentView: run.contextSnapshot?.currentView,
    timeZone,
    agentId: run.selectedAgentId ?? run.contextSnapshot?.requestedAgentId,
  };
}

async function executeScheduledRun(body: Body) {
  const required = (value: string | undefined, name: string) => {
    const normalized = value?.trim();
    if (!normalized) throw new Error(`Scheduled run ${name} is required.`);
    return normalized;
  };
  const actorClerkId = required(body.actorClerkId, "actorClerkId");
  const runId = required(body.runId, "runId");
  const executionId = required(body.executionId, "executionId");
  const resultCardId = required(body.resultCardId, "resultCardId");
  const payload = payloadFrom(body.payload);
  await asOwner(actorClerkId, async () => {
    try {
      const attachments = payload.mode === "resume" ? [] : await loadPersistedRunAttachments(runId, executionId);
      await runHarnessAttempt(
        {
          ...payload,
          actorClerkId,
          runId,
          resultCardId,
          executionId,
          workerId: `scheduled:${crypto.randomUUID()}`,
          attachments,
          scheduled: true,
        },
        () => undefined,
      );
    } catch (error) {
      // Claiming the lease or reading attachments failed before the attempt's
      // own failure boundary: leave a retryable result, not a queued run.
      const current = await query<{ actorClerkId: string; runId: string }, RunDetail>("spectraRuns:get", { actorClerkId, runId }).catch(() => null);
      if (!current || (current.run.status !== "queued" && current.run.status !== "running")) return;
      const message = publicError(error);
      await mutate("spectraRuns:updateStatus", {
        actorClerkId,
        runId,
        executionId,
        status: "failed",
        error: message,
        finalSummary: message,
        resultTitle: "Paused",
        resultSummary: `${message} You can retry when ready.`,
        resultVariant: "status",
        resultActions: [{ key: "retry", label: "Retry", targetType: "run", targetId: runId }],
        recoveryState: "interrupted",
        retryable: true,
        preservedPartial: false,
      }).catch(() => null);
    }
  });
}

/** Drop provisional work of an attempt that will not finish. */
async function settleForRun(actorClerkId: string, runId: string, executionId: string | undefined, outcome: "failed" | "clear") {
  await mutate("spectraArtifacts:discardPendingForRun", { actorClerkId, runId, executionId }).catch(() => null);
  await mutate("spectraArtifacts:settleStagedForRun", { actorClerkId, runId, executionId, outcome }).catch(() => null);
  await mutate("spectraWorkspaces:settleForRun", { actorClerkId, runId, executionId, outcome }).catch(() => null);
}

/** Start or continue an attempt: on a scheduled worker, or inline in this stream. */
async function dispatch(input: {
  actorClerkId: string;
  runId: string;
  resultCardId: string;
  executionId: string;
  threadId?: string;
  payload: RunPayload;
  attachments?: PreparedAttachment[];
  prelude: (emit: (event: unknown) => void) => void;
}) {
  if (scheduledExecution()) {
    await mutate("spectraRuns:scheduleExecution", {
      runId: input.runId,
      resultCardId: input.resultCardId,
      executionId: input.executionId,
      payload: input.payload,
    });
    return ndjson(async (emit) => input.prelude(emit));
  }
  return ndjson(async (emit) => {
    input.prelude(emit);
    await runHarnessAttempt(
      {
        ...input.payload,
        actorClerkId: input.actorClerkId,
        runId: input.runId,
        resultCardId: input.resultCardId,
        executionId: input.executionId,
        workerId: `inline:${crypto.randomUUID()}`,
        attachments: input.attachments,
      },
      emit,
    );
  });
}

type HarnessAnswer = NonNullable<Body["answer"]>;

/**
 * Records the answer to a paused run's open question or approval and resumes
 * it. Feedback given with the answer ("not like that: ...") joins the next turn.
 */
async function answerAndResume(input: {
  actorClerkId: string;
  runId: string;
  executionId: string;
  toolCallId: string;
  answer: HarnessAnswer;
  feedback?: string;
  uiObserver?: unknown;
  timeZone?: string;
  /** The reply was typed in the composer: the stream opens like a new run. */
  asNewTurn?: boolean;
}) {
  const { actorClerkId, runId, executionId } = input;
  let answered: { alreadyAnswered: boolean; label?: string };
  try {
    answered = await mutate<unknown & object, typeof answered>("spectraHarness:answer", {
      actorClerkId,
      runId,
      executionId,
      toolCallId: input.toolCallId,
      answer: input.answer,
      ...(input.uiObserver ? { uiObserver: uiObserverSchema.parse(input.uiObserver) } : {}),
    });
  } catch (error) {
    return new Response(publicError(error), { status: 409 });
  }
  if (answered.alreadyAnswered) return new Response("This was already answered in another view.", { status: 409 });
  const feedback = input.feedback?.trim();
  if (feedback)
    await mutate("spectraHarness:queueSteer", { actorClerkId, runId, executionId, text: feedback.slice(0, 8_000) }).catch(() => null);
  const detail = await query<unknown & object, RunDetail>("spectraRuns:get", { actorClerkId, runId });
  const card = detail.cards[0];
  if (!card) return new Response("Result card not found", { status: 409 });
  return dispatch({
    actorClerkId,
    runId,
    resultCardId: card._id,
    executionId,
    payload: payloadForRun(detail.run, "resume", input.timeZone),
    prelude: (emit) => {
      if (input.asNewTurn) {
        emit({ type: "run_created", runId, card: streamCard(card) });
        if (detail.run.threadId) emit({ type: "thread_ready", runId, threadId: detail.run.threadId });
      } else emit({ type: "result_card", runId, card: streamCard(card) });
    },
  });
}

/**
 * A thread whose last run is paused on a question or approval. A message typed
 * there answers it, as in Claude Code, instead of starting a separate run that
 * would lose the paused work: the text answers a question, and turns down an
 * approval with the text as what to do instead.
 */
async function pausedRunInThread(actorClerkId: string, threadId: string | undefined) {
  if (!threadId) return null;
  const active = await query<unknown & object, { run?: { _id: string; executionId?: string; status: string } } | null>(
    "spectraThreads:getActiveExecution",
    { actorClerkId, threadId },
  ).catch(() => null);
  const run = active?.run;
  if (!run?.executionId || (run.status !== "awaiting_resolution" && run.status !== "awaiting_confirmation")) return null;
  const loaded = await query<unknown & object, { executionId?: string; pending?: { toolCallId?: string; kind?: string } | null } | null>(
    "spectraHarness:load",
    { actorClerkId, runId: run._id },
  ).catch(() => null);
  const pending = loaded?.pending;
  if (!pending?.toolCallId || loaded?.executionId !== run.executionId) return null;
  return { runId: run._id, executionId: run.executionId, toolCallId: pending.toolCallId, kind: pending.kind === "approval" ? "approval" : "question" } as const;
}

export function handleSpectraRunRequest(request: NextRequest) {
  return withSpectraRequestLog({ method: request.method, path: request.nextUrl.pathname }, () => handleSpectraRunRequestInLog(request));
}

async function handleSpectraRunRequestInLog(request: NextRequest) {
  const rawBody = await request.text();
  let body: Body;
  try {
    body = JSON.parse(rawBody) as Body;
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }
  const action = body.action ?? "run";

  if (action === "scheduled_run" || action === "scheduled_resume") {
    if (!verifyScheduledCallback(request, rawBody)) return new Response("Forbidden", { status: 403 });
    try {
      await executeScheduledRun(action === "scheduled_resume" ? { ...body, payload: { ...(body.payload ?? {}), mode: "resume" } } : body);
      return Response.json({ completed: true });
    } catch (error) {
      return Response.json({ completed: false, error: publicError(error) }, { status: 500 });
    }
  }

  let actor: Awaited<ReturnType<typeof requireActor>>;
  try {
    actor = await requireActor();
  } catch (error) {
    return new Response(publicError(error), { status: errorStatus(error) });
  }

  if (action === "ui_observer" || action === "ui_observer_ack") return handleUiObserverRequest(action, body.payload);

  if (action === "clear_agent") {
    const runId = body.runId?.trim();
    if (!runId) return new Response("runId is required", { status: 400 });
    try {
      return Response.json(await mutate("spectraRuns:clearRetainedAgent", { runId }));
    } catch (error) {
      return new Response(publicError(error), { status: 409 });
    }
  }

  if (action === "run") {
    const prompt = body.prompt?.trim();
    const surface = body.surface;
    if (!prompt) return new Response("Invalid prompt", { status: 400 });
    if (!surface || !["chat", "workspace", "artifacts", "artifact"].includes(surface)) return new Response("Invalid surface", { status: 400 });
    let attachments: PreparedAttachment[];
    try {
      attachments = await prepareRunAttachments(body.attachments);
    } catch (error) {
      return new Response(publicError(error), { status: 400 });
    }
    if (attachments.length === 0) {
      const paused = await pausedRunInThread(actor.clerkId, body.threadId?.trim() || undefined);
      if (paused) {
        if (body.threadId)
          await mutate("spectraThreads:appendMessage", {
            actorClerkId: actor.clerkId,
            threadId: body.threadId.trim(),
            role: "user",
            content: prompt,
            runId: paused.runId,
            executionId: paused.executionId,
            ...(body.submissionKey?.trim() ? { clientMessageId: body.submissionKey.trim() } : {}),
            metadata: { answersInput: paused.toolCallId },
          }).catch(() => null);
        return answerAndResume({
          actorClerkId: actor.clerkId,
          runId: paused.runId,
          executionId: paused.executionId,
          toolCallId: paused.toolCallId,
          answer: paused.kind === "approval" ? { kind: "approval", allowed: false } : { kind: "question", text: prompt },
          ...(paused.kind === "approval" ? { feedback: prompt } : {}),
          timeZone: body.timeZone,
          asNewTurn: true,
        });
      }
    }
    const workspaceId = await inferWorkspaceForRun(actor.clerkId, body);
    let created: { runId: string; resultCardId: string; threadId: string; executionId: string; created: boolean };
    try {
      created = await mutate<unknown & object, typeof created>("spectraRuns:beginRun", {
        actorClerkId: actor.clerkId,
        sourceSurface: surface === "artifacts" ? "artifact" : surface,
        userPrompt: prompt,
        submissionKey: body.submissionKey?.trim() || crypto.randomUUID(),
        threadId: body.threadId?.trim() || undefined,
        workspaceId,
        artifactId: body.artifactId,
        modelUsed: getSpectraModelId(),
        messageMetadata: {
          attachments: attachments.map(({ name, mimeType, size, handling }) => ({ name, mimeType, size, handling })),
        },
      });
    } catch (error) {
      return new Response(publicError(error), { status: 409 });
    }
    if (created.created && attachments.length > 0) {
      try {
        await persistRunAttachments(created.runId, created.executionId, body.attachments, attachments);
      } catch (error) {
        return new Response(publicError(error), { status: 409 });
      }
    }
    const initialCard = await latestCard(actor.clerkId, created.runId);
    const prelude = (emit: (event: unknown) => void) => {
      emit({ type: "run_created", runId: created.runId, card: streamCard(initialCard) });
      emit({ type: "thread_ready", runId: created.runId, threadId: created.threadId });
    };
    // A repeated submission joins the run it already started.
    if (!created.created) return ndjson(async (emit) => prelude(emit));
    return dispatch({
      actorClerkId: actor.clerkId,
      runId: created.runId,
      resultCardId: created.resultCardId,
      executionId: created.executionId,
      payload: {
        mode: "start",
        prompt,
        surface,
        threadId: created.threadId,
        workspaceId,
        scopeNodeId: body.scopeNodeId,
        artifactId: body.artifactId,
        currentView: body.currentView,
        timeZone: body.timeZone,
        agentId: body.agentId,
      },
      attachments,
      prelude,
    });
  }

  let runId = body.runId?.trim();
  const resolvedPendingSubmission = action === "stop" && !runId && Boolean(body.submissionKey?.trim());
  if (resolvedPendingSubmission) {
    const resolved = await query<{ submissionKey: string }, { runId: string } | null>("spectraRuns:resolveBySubmissionKey", {
      submissionKey: body.submissionKey!.trim(),
    }).catch(() => null);
    runId = resolved?.runId;
  }
  if (!runId) return new Response("runId is required", { status: 400 });
  // Controls carry the attempt they showed, so a stale view can never act on
  // a newer attempt. Only Stop before the first acknowledgement resolves it.
  let expectedExecutionId = body.executionId?.trim();
  if (!expectedExecutionId && resolvedPendingSubmission) {
    const detail = await query<unknown & object, RunDetail>("spectraRuns:get", { actorClerkId: actor.clerkId, runId }).catch(() => null);
    expectedExecutionId = detail?.run.executionId;
  }
  if (!expectedExecutionId)
    return new Response("This run control is missing the displayed attempt. Refresh it and try again.", { status: 409 });

  if (action === "stop") {
    let stopped: { alreadyStopped: boolean; executionId?: string };
    try {
      stopped = await mutate<unknown & object, typeof stopped>("spectraRuns:stopRun", {
        actorClerkId: actor.clerkId,
        runId,
        executionId: expectedExecutionId,
      });
    } catch (error) {
      return new Response(publicError(error), { status: 409 });
    }
    await settleForRun(actor.clerkId, runId, stopped.executionId, "failed");
    return new Response(null, { status: 204 });
  }

  if (action === "steer") {
    const steer = body.text?.trim();
    if (!steer) return new Response("Write a message first.", { status: 400 });
    try {
      await mutate("spectraHarness:queueSteer", { actorClerkId: actor.clerkId, runId, executionId: expectedExecutionId, text: steer.slice(0, 8_000) });
      return Response.json({ queued: true });
    } catch (error) {
      // The run already finished: the client sends the message as a new turn.
      return new Response(publicError(error), { status: 409 });
    }
  }

  if (action === "answer" || action === "confirm" || action === "cancel") {
    let toolCallId = body.toolCallId?.trim();
    const answer = action === "answer" ? body.answer : { kind: "approval" as const, allowed: action === "confirm" };
    // Controls that show only the run (a Dock card) answer its open question.
    if (!toolCallId) {
      const loaded = await query<unknown & object, { pending?: { toolCallId?: string } | null } | null>("spectraHarness:load", {
        actorClerkId: actor.clerkId,
        runId,
      }).catch(() => null);
      toolCallId = loaded?.pending?.toolCallId;
    }
    if (!toolCallId || !answer) return new Response("This question is no longer open.", { status: 409 });
    return answerAndResume({
      actorClerkId: actor.clerkId,
      runId,
      executionId: expectedExecutionId,
      toolCallId,
      answer,
      feedback: body.text,
      uiObserver: body.uiObserver,
      timeZone: body.timeZone,
    });
  }

  if (action === "retry") {
    const current = await query<{ actorClerkId: string; runId: string }, RunDetail>("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    if (current.run.executionId !== expectedExecutionId)
      return new Response("This run attempt is no longer current. Refresh it and try again.", { status: 409 });
    await mutate("spectraOperations:cancelPending", { actorClerkId: actor.clerkId, runId, executionId: expectedExecutionId }).catch(() => null);
    await settleForRun(actor.clerkId, runId, expectedExecutionId, "clear");
    let reset: RetryReset;
    try {
      reset = await mutate<unknown & object, RetryReset>("spectraRuns:resetForRetry", {
        actorClerkId: actor.clerkId,
        runId,
        executionId: expectedExecutionId,
        retryKey: body.submissionKey?.trim() || crypto.randomUUID(),
      });
    } catch (error) {
      return new Response(publicError(error), { status: 409 });
    }
    if (!reset.resultCardId) return new Response("Result card not found", { status: 409 });
    const card = await latestCard(actor.clerkId, runId);
    const prelude = (emit: (event: unknown) => void) => {
      emit({ type: "run_created", runId: runId!, card: streamCard(card) });
      if (current.run.threadId) emit({ type: "thread_ready", runId: runId!, threadId: current.run.threadId });
    };
    if (!reset.created) return ndjson(async (emit) => prelude(emit));
    return dispatch({
      actorClerkId: actor.clerkId,
      runId,
      resultCardId: reset.resultCardId,
      executionId: reset.executionId,
      payload: payloadForRun({ ...current.run, userPrompt: reset.prompt }, "retry", body.timeZone),
      attachments: scheduledExecution() ? undefined : await loadPersistedRunAttachments(runId, reset.executionId).catch(() => []),
      prelude,
    });
  }

  if (action === "revert") {
    let state: RunDetail;
    try {
      state = await query<{ actorClerkId: string; runId: string }, RunDetail>("spectraRuns:get", { actorClerkId: actor.clerkId, runId });
    } catch (error) {
      return new Response(publicError(error), { status: errorStatus(error) });
    }
    if (!["completed", "failed", "cancelled"].includes(state.run.status))
      return new Response("Undo is available after Spectra finishes this run.", { status: 409 });
    let plan: {
      restored: Array<{ artifactId: string; snapshot: { title?: string; summary?: string | null; content?: unknown; tags?: string[] } }>;
      blocked: Array<{ artifactId: string; reason: string }>;
    };
    try {
      plan = await mutate<{ runId: string }, typeof plan>("changeGroups:revertPlanForRun", { runId });
    } catch (error) {
      return new Response(publicError(error), { status: errorStatus(error) });
    }
    if (plan.restored.length === 0)
      return new Response(
        plan.blocked[0]?.reason ??
          "This run did not keep a snapshot that can be undone. Archive created work from Library if you want to remove it.",
        { status: 409 },
      );
    const restored: string[] = [];
    const failed: string[] = [];
    for (const item of plan.restored) {
      const snapshot = item.snapshot ?? {};
      try {
        await applyAiArtifactMutation({
          artifactId: item.artifactId,
          runId,
          // restore:* ids are human Undo fencing, never AI claim identities.
          operationId: `restore:${runId}:${item.artifactId}`,
          executionId: expectedExecutionId,
          checkpointBeforeAi: false,
          claimActorKind: "human",
          resolveDesired: (current) => ({
            title: snapshot.title ?? current.title,
            summary: typeof snapshot.summary === "string" ? snapshot.summary : current.summary,
            content: snapshot.content ?? current.content,
            tags: snapshot.tags ?? current.tags,
          }),
        });
        restored.push(item.artifactId);
      } catch (error) {
        failed.push(error instanceof Error ? publicError(error) : "Spectra could not restore that earlier copy.");
      }
    }
    if (restored.length === 0)
      return new Response(failed[0] ?? plan.blocked[0]?.reason ?? "Spectra could not undo this run.", { status: 409 });
    await Promise.all(
      state.cards.map((card) =>
        mutate("spectraRuns:patchResultCard", {
          resultCardId: card._id,
          executionId: expectedExecutionId,
          summary: "Restored the earlier copy of this work.",
          actions: [...card.actions.filter((entry) => entry.key !== "revert"), { key: "undone", label: "Undone" }].filter(
            (entry, index, all) => all.findIndex((candidate) => candidate.key === entry.key) === index,
          ),
        }).catch(() => null),
      ),
    );
    return Response.json({ restored: restored.length, blocked: plan.blocked, failed });
  }

  return new Response("Unknown action", { status: 400 });
}
