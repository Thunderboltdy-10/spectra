import { getSpectraModelId } from "@/features/spectra/ai/model-config";
import { applyAiArtifactMutation } from "@/features/spectra/ai/yjs-artifact-operation";
import { withSpectraRequestLog } from "@/features/spectra/ai/run-log";
import { prepareAttachments as prepareRunAttachments } from "@/features/spectra/compute/files/attachment-preprocessor";
import { createNdjsonResponse } from "@/features/spectra/runs/streaming/ndjson-response";
import { requireActor } from "@/lib/auth-server";
import { withWorkerConvexToken } from "@/lib/convex-worker-context";
import { errorStatus } from "@/lib/route-handler";
import { createClerkClient } from "@clerk/backend";
import { NextRequest } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { runHarnessAttempt, type AttemptMode, type AttemptParams } from "./harness/attempt";
import { loadRunAttachments, persistRunAttachments } from "./harness/attachments";
import type {
  AttachmentInput,
  Body,
  Card,
  PreparedAttachment,
  RetryReset,
  RunDetail,
  RunState,
  Surface,
} from "./harness/contract";
import { normalizePointers } from "./harness/environment";
import { mutate, query } from "./harness/io";
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
    ...normalizePointers(payload),
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
    ...normalizePointers(run.contextSnapshot),
    timeZone,
    agentId: run.selectedAgentId,
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
      // A start that came without files skips the read.
      const withoutFiles = payload.mode === "resume" || (body.payload as Record<string, unknown> | undefined)?.withAttachments === false;
      const attachments = withoutFiles ? [] : await loadRunAttachments(runId, executionId);
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
      payload: { ...input.payload, ...(input.attachments ? { withAttachments: input.attachments.length > 0 } : {}) },
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

/** A message (and files) that joins a run instead of starting one. */
type JoiningMessage = {
  text: string;
  attachments?: { input: AttachmentInput[] | undefined; prepared: PreparedAttachment[] };
};

/**
 * Queues a message for the run's next turn. Files are stored first as this
 * attempt's run attachments, so whichever worker runs the turn can read them.
 */
async function queueSteer(actorClerkId: string, runId: string, executionId: string, message: JoiningMessage) {
  const attachmentIds = message.attachments?.prepared.length
    ? await persistRunAttachments(runId, executionId, message.attachments.input, message.attachments.prepared, { steer: true })
    : [];
  const text = message.text.trim().slice(0, 8_000);
  if (!text && !attachmentIds.length) return null;
  return mutate<unknown & object, { queued: boolean; threadId: string | null }>("spectraHarness:queueSteer", {
    actorClerkId,
    runId,
    executionId,
    text,
    ...(attachmentIds.length ? { attachmentIds } : {}),
  });
}

/** Keeps a joining message in its thread, so it is there after a reload. */
async function keepJoiningMessage(input: {
  actorClerkId: string;
  threadId?: string | null;
  runId: string;
  executionId: string;
  text: string;
  submissionKey?: string;
  prepared: PreparedAttachment[];
  metadata: Record<string, unknown>;
}) {
  if (!input.threadId) return;
  await mutate("spectraThreads:appendMessage", {
    actorClerkId: input.actorClerkId,
    threadId: input.threadId,
    role: "user",
    content: input.text,
    runId: input.runId,
    executionId: input.executionId,
    ...(input.submissionKey?.trim() ? { clientMessageId: input.submissionKey.trim() } : {}),
    metadata: {
      ...input.metadata,
      ...(input.prepared.length
        ? { attachments: input.prepared.map(({ name, mimeType, size, handling }) => ({ name, mimeType, size, handling })) }
        : {}),
    },
  }).catch(() => null);
}

/**
 * Records the answer to a paused run's open question or approval and resumes
 * it. A message given with the answer ("not like that: ...") and any files
 * join the next turn.
 */
async function answerAndResume(input: {
  actorClerkId: string;
  runId: string;
  executionId: string;
  toolCallId: string;
  answer: HarnessAnswer;
  message?: JoiningMessage;
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
  // The answer re-queued the run, so the message and its files can join it.
  const [, detail] = await Promise.all([
    input.message
      ? queueSteer(actorClerkId, runId, executionId, input.message).catch(() => null)
      : Promise.resolve(null),
    query<unknown & object, RunDetail>("spectraRuns:get", { actorClerkId, runId }),
  ]);
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

type JoinableRun = {
  runId: string;
  executionId: string;
  threadId: string | null;
  status: string;
  pending: { toolCallId: string; kind: "question" | "approval" } | null;
};

/**
 * The run a new message joins, as in Claude Code: the run it names, or the
 * thread's active run. A waiting run takes the message as its answer; a
 * working run reads it at its next turn. Files go with the message either way.
 */
async function joinableRun(actorClerkId: string, threadId: string | undefined, steerRunId: string | undefined) {
  if (!threadId && !steerRunId) return null;
  return query<unknown & object, JoinableRun | null>("spectraHarness:joinableRun", {
    actorClerkId,
    ...(steerRunId ? { runId: steerRunId } : { threadId }),
  }).catch(() => null);
}

async function joinRun(input: {
  actorClerkId: string;
  run: JoinableRun;
  prompt: string;
  submissionKey?: string;
  timeZone?: string;
  attachments: { input: AttachmentInput[] | undefined; prepared: PreparedAttachment[] };
}) {
  const { actorClerkId, run, prompt } = input;
  const files = input.attachments.prepared.length ? input.attachments : undefined;
  if (run.pending) {
    await keepJoiningMessage({
      actorClerkId,
      threadId: run.threadId,
      runId: run.runId,
      executionId: run.executionId,
      text: prompt,
      submissionKey: input.submissionKey,
      prepared: input.attachments.prepared,
      metadata: { answersInput: run.pending.toolCallId },
    });
    // The text answers a question; for an approval it says what to do instead.
    const approval = run.pending.kind === "approval";
    return answerAndResume({
      actorClerkId,
      runId: run.runId,
      executionId: run.executionId,
      toolCallId: run.pending.toolCallId,
      answer: approval ? { kind: "approval", allowed: false } : { kind: "question", text: prompt },
      ...(approval || files ? { message: { text: approval ? prompt : "", ...(files ? { attachments: files } : {}) } } : {}),
      timeZone: input.timeZone,
      asNewTurn: true,
    });
  }
  try {
    await queueSteer(actorClerkId, run.runId, run.executionId, { text: prompt, ...(files ? { attachments: files } : {}) });
  } catch (error) {
    return new Response(publicError(error), { status: 409 });
  }
  await keepJoiningMessage({
    actorClerkId,
    threadId: run.threadId,
    runId: run.runId,
    executionId: run.executionId,
    text: prompt,
    submissionKey: input.submissionKey,
    prepared: input.attachments.prepared,
    metadata: { steer: true },
  });
  return ndjson(async (emit) => {
    emit({ type: "steer_queued", runId: run.runId, ...(run.threadId ? { threadId: run.threadId } : {}) });
  });
}

/** Whether the user may still use this agent (it exists, is shared with them and has a published release). */
async function agentIsAvailable(actorClerkId: string, agentId: string) {
  const runtime = await query<unknown & object, { agentId?: unknown } | null>("spectraArtifacts:getAgentRuntime", {
    actorClerkId,
    agentId,
  }).catch(() => null);
  return typeof runtime?.agentId === "string";
}

/** A chosen agent that cannot run: a clear typed error, never a silent fallback to Auto. */
function agentUnavailable() {
  return new Response("The agent you chose is no longer available to you. Choose another agent or switch back to Auto.", {
    status: 409,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Spectra-Error": "AI_AGENT_UNAVAILABLE" },
  });
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
    const threadId = body.threadId?.trim() || undefined;
    const pointers = normalizePointers(body);
    // A string chooses an agent; null switches the thread back to Auto.
    const chosenAgentId = typeof body.agentId === "string" && body.agentId.trim() ? body.agentId.trim() : undefined;
    // Independent checks run together: they sit before the first token.
    const [prepared, joinable, agentAvailable] = await Promise.all([
      prepareRunAttachments(body.attachments).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
      joinableRun(actor.clerkId, threadId, body.steerRunId?.trim() || undefined),
      chosenAgentId ? agentIsAvailable(actor.clerkId, chosenAgentId) : Promise.resolve(true),
    ]);
    if (!prepared.ok) return new Response(publicError(prepared.error), { status: 400 });
    const attachments = prepared.value;
    if (joinable)
      return joinRun({
        actorClerkId: actor.clerkId,
        run: joinable,
        prompt,
        submissionKey: body.submissionKey,
        timeZone: body.timeZone,
        attachments: { input: body.attachments, prepared: attachments },
      });
    if (!agentAvailable) return agentUnavailable();
    let created: {
      runId: string;
      resultCardId: string;
      card: Card | null;
      threadId: string;
      executionId: string;
      workspaceId?: string;
      created: boolean;
    };
    try {
      created = await mutate<unknown & object, typeof created>("spectraRuns:beginRun", {
        actorClerkId: actor.clerkId,
        sourceSurface: surface === "artifacts" ? "artifact" : surface,
        userPrompt: prompt,
        submissionKey: body.submissionKey?.trim() || crypto.randomUUID(),
        threadId,
        workspaceId: body.workspaceId,
        artifactId: body.artifactId,
        modelUsed: getSpectraModelId(),
        ...(Object.keys(pointers).length ? { pointers } : {}),
        ...(body.agentId === null ? { clearRetainedAgent: true } : {}),
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
    const initialCard = created.card ?? (await latestCard(actor.clerkId, created.runId));
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
        workspaceId: created.workspaceId ?? body.workspaceId,
        scopeNodeId: body.scopeNodeId,
        artifactId: body.artifactId,
        ...pointers,
        timeZone: body.timeZone,
        ...(chosenAgentId ? { agentId: chosenAgentId } : {}),
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
    const steer = body.text?.trim() ?? "";
    let prepared: PreparedAttachment[];
    try {
      prepared = await prepareRunAttachments(body.attachments);
    } catch (error) {
      return new Response(publicError(error), { status: 400 });
    }
    if (!steer && !prepared.length) return new Response("Write a message first.", { status: 400 });
    let queued: { threadId: string | null } | null;
    try {
      queued = await queueSteer(actor.clerkId, runId, expectedExecutionId, {
        text: steer,
        ...(prepared.length ? { attachments: { input: body.attachments, prepared } } : {}),
      });
    } catch (error) {
      // The run is waiting or finished: the client sends the message as a new
      // turn, which answers a waiting run or starts the next one.
      return new Response(publicError(error), { status: 409 });
    }
    await keepJoiningMessage({
      actorClerkId: actor.clerkId,
      threadId: queued?.threadId,
      runId,
      executionId: expectedExecutionId,
      text: steer,
      submissionKey: body.submissionKey,
      prepared,
      metadata: { steer: true },
    });
    return Response.json({ queued: true });
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
      ...(body.text?.trim() ? { message: { text: body.text } } : {}),
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
      attachments: scheduledExecution() ? undefined : await loadRunAttachments(runId, reset.executionId).catch(() => []),
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
