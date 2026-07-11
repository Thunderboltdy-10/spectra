import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.OPENROUTER_API_KEY;
});

function deckPlan() {
  return {
    decision: "operate",
    intent: { mode: "create", requestedArtifactTypes: ["flashcard_deck"], requestedVisibleArtifactCount: 1, targetArtifactId: null, targetWorkspaceId: "workspace-real" },
    finalResponse: "Created a 6-card photosynthesis deck with memory cues.",
    operations: [{
      type: "artifact.create",
      input: {
        blueprintKey: "flashcard_deck",
        title: "Photosynthesis memory cues",
        summary: "Six recall cards.",
        content: {
          cards: Array.from({ length: 6 }, (_, index) => ({ id: `card-${index + 1}`, front: `Prompt ${index + 1}`, back: `Answer ${index + 1}`, hint: `Memory cue ${index + 1}`, sourceRefs: [], confidence: "unknown" })),
          settings: { shuffle: true, revealMode: "click" },
        },
        tags: ["biology", "photosynthesis"],
        workspaceId: "workspace-real",
        placement: "context",
      },
    }],
  };
}

function setup(plan: unknown, initialStatus: "queued" | "failed" = "queued") {
  const card: { _id: string; runId: string; status: string; title: string; summary: string; variant: string; actions: Array<Record<string, unknown>>; updatedAt: number } = { _id: "card-real", runId: "run-real", status: initialStatus, title: initialStatus === "failed" ? "Run failed" : "Queued", summary: "", variant: initialStatus === "failed" ? "error" : "status", actions: [], updatedAt: 1 };
  const run: Record<string, unknown> & { status: string; sourceSurface: "workspace" | "chat"; workspaceId?: string; userPrompt: string; attemptCount: number } = { _id: "run-real", status: initialStatus, sourceSurface: "workspace", workspaceId: "workspace-real", threadId: "thread-real", executionId: "execution-1", userPrompt: "Create a flashcard deck about photosynthesis with 6 cards. Include memory cues.", attemptCount: 1 };
  const operations: Array<Record<string, unknown>> = [];
  const requireActor = vi.fn().mockResolvedValue({ clerkId: "actor" });
  const convexQuery = vi.fn(async (name: string) => {
    if (name.includes("spectraRuns:get")) return { run, cards: [card], operations };
    if (name.includes("spectraArtifacts:list")) return [];
    if (name.includes("spectraWorkspaces:list")) return [{ _id: "workspace-real", title: "Biology" }];
    if (name.includes("spectraWorkspaceItems:listForWorkspace")) return { workspace: { _id: "workspace-real", title: "Biology" }, items: [] };
    if (name.includes("spectraThreads:get")) return { thread: { _id: "thread-real", title: "New thread" }, messages: [], traces: [] };
    throw new Error(`Unexpected query: ${name}`);
  });
  const convexMutation = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name.includes("spectraRuns:beginRun")) {
      run.sourceSurface = args.sourceSurface as "workspace" | "chat";
      run.workspaceId = args.workspaceId as string | undefined;
      run.userPrompt = args.userPrompt as string;
      return { runId: "run-real", resultCardId: "card-real", threadId: "thread-real", executionId: "execution-1", created: true };
    }
    if (name.includes("spectraRuns:claimExecution")) return { claimed: true };
    if (name.includes("spectraThreads:appendMessage")) return "message-real";
    if (name.includes("spectraThreads:applyGeneratedMetadata")) return { threadId: "thread-real" };
    if (name.includes("spectraRuns:setSuggestedThreadMetadata")) return { runId: "run-real" };
    if (name.includes("spectraRuns:setContextSnapshot")) return { runId: "run-real" };
    if (name.includes("spectraRuns:resetForRetry")) {
      run.status = "queued";
      run.attemptCount = 2;
      run.executionId = "execution-2";
      card.status = "queued";
      return { runId: "run-real", resultCardId: "card-real", prompt: run.userPrompt, workspaceId: run.workspaceId, sourceSurface: "workspace", executionId: "execution-2", created: true };
    }
    if (name.includes("spectraRuns:updateStatus")) {
      run.status = args.status as typeof run.status;
      card.status = args.status as typeof card.status;
      card.title = typeof args.resultTitle === "string" ? args.resultTitle : card.title;
      card.summary = typeof args.resultSummary === "string" ? args.resultSummary : card.summary;
      card.variant = typeof args.resultVariant === "string" ? args.resultVariant : card.variant;
      card.actions = Array.isArray(args.resultActions) ? args.resultActions : card.actions;
      card.updatedAt += 1;
      if (args.decision !== undefined) run.decision = args.decision;
      if (args.planIntent !== undefined) run.planIntent = args.planIntent;
      if (args.finalSummary !== undefined) run.finalSummary = args.finalSummary;
      return { runId: "run-real" };
    }
    if (name.includes("spectraRuns:patchResultCard")) {
      card.title = typeof args.title === "string" ? args.title : card.title;
      card.summary = typeof args.summary === "string" ? args.summary : card.summary;
      card.updatedAt += 1;
      return { resultCardId: "card-real" };
    }
    if (name.includes("spectraOperations:recordPlan")) {
      const next = args.operations as Array<Record<string, unknown>>;
      operations.push(...next.map((operation, index) => ({ _id: `operation-${index + 1}`, runId: "run-real", status: "proposed", affected: [], ...operation })));
      return { operationIds: next.map((_operation, index) => `operation-${index + 1}`) };
    }
    if (name.includes("spectraArtifacts:createPending")) return { artifactId: "artifact-pending" };
    if (name.includes("spectraArtifacts:finalizePending")) return { artifactId: "artifact-real", workspaceItemId: "item-real" };
    if (name.includes("spectraArtifacts:create")) return { artifactId: "artifact-real", workspaceItemId: "item-real" };
    if (name.includes("spectraWorkspaces:createPending")) return { workspaceId: "workspace-pending" };
    if (name.includes("spectraRuns:rejectConfirmation")) {
      run.status = "cancelled";
      card.status = "cancelled";
      card.title = "Cancelled";
      card.summary = "No proposed changes were applied.";
      card.actions = [];
      return { alreadyRejected: false };
    }
    if (name.includes("spectraOperations:claim") || name.includes("spectraOperations:assertClaimed") || name.includes("spectraOperations:markExecuted") || name.includes("spectraOperations:cancelPending") || name.includes("spectraOperations:attachPendingArtifact") || name.includes("spectraOperations:attachPendingWorkspace")) return {};
    if (name.includes("spectraRuns:appendEvent") || name.includes("spectraRuns:markTraceDegraded")) return {};
    if (name.includes("spectraArtifacts:patchPendingContent") || name.includes("spectraArtifacts:discardPendingForRun") || name.includes("spectraArtifacts:failPendingForRun") || name.includes("spectraArtifacts:settleStagedForRun") || name.includes("spectraWorkspaces:settleForRun")) return {};
    throw new Error(`Unexpected mutation: ${name}`);
  });

  vi.doMock("@/lib/auth-server", () => ({ requireActor }));
  vi.doMock("@/lib/convex-server", () => ({ convexQuery, convexMutation }));
  process.env.OPENROUTER_API_KEY = "test-key";
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: "deepseek/deepseek-v4-pro-20260423", provider: "DeepSeek", choices: [{ message: { content: JSON.stringify(plan) } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return { convexMutation, fetchMock };
}

describe("Spectra run route", () => {
  it("creates one six-card deck and does not emit unrelated placement removal", async () => {
    const { convexMutation, fetchMock } = setup(deckPlan());
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", prompt: "Create a flashcard deck about photosynthesis with 6 cards. Include memory cues." }) }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; message?: string });

    const createCall = convexMutation.mock.calls.find(([name]) => String(name).includes("spectraArtifacts:finalizePending"));
    expect(createCall).toBeTruthy();
    expect((createCall?.[1] as { content: { cards: unknown[] } }).content.cards).toHaveLength(6);
    expect(convexMutation.mock.calls.some(([name]) => String(name).includes("spectraWorkspaceItems:hide"))).toBe(false);
    const beginRunCall = convexMutation.mock.calls.find(([name]) => String(name).includes("spectraRuns:beginRun"));
    expect(beginRunCall?.[1]).toMatchObject({ sourceSurface: "workspace", workspaceId: "workspace-real" });
    expect(events.some((event) => event.type === "confirmation_required")).toBe(false);
    expect(events.some((event) => event.message === "Validating 6 cards")).toBe(true);
    expect(events.some((event) => event.message === "Saving deck to Biology")).toBe(true);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as { model: string; provider: { order: string[]; only: string[]; allow_fallbacks: boolean }; stream: boolean; response_format?: unknown };
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(payload.model).toBe("deepseek/deepseek-v4-pro");
    expect(payload.provider).toEqual({ order: ["deepseek"], only: ["deepseek"], allow_fallbacks: false });
    expect(payload.response_format).toBeUndefined();
    expect(payload.stream).toBe(true);
    expect(new Headers(request.headers).get("X-OpenRouter-Title")).toBe("Spectra AI Operation Engine");
    const completedCall = convexMutation.mock.calls.find(([name, args]) => String(name).includes("spectraRuns:updateStatus") && (args as { status?: string }).status === "completed");
    expect(completedCall?.[1]).toMatchObject({ providerUsed: "DeepSeek", modelUsed: "deepseek/deepseek-v4-pro-20260423" });
  });

  it("uses the explicit structured-output fallback only after the native DeepSeek call fails", async () => {
    const answerPlan = { decision: "answer", intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null }, finalResponse: "Fallback worked.", operations: [] };
    const { fetchMock } = setup(answerPlan);
    fetchMock.mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "native unavailable" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "deepseek/deepseek-v4-pro-20260423", provider: "Baidu", choices: [{ message: { content: JSON.stringify(answerPlan) } }] }), { status: 200 }));
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", prompt: "Answer briefly." }) }));
    expect(response.status).toBe(200);
    await response.text();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const primary = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    const fallback = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as { provider: unknown; response_format?: unknown };
    expect(primary).not.toHaveProperty("response_format");
    expect(fallback.provider).toEqual({ order: ["baidu", "streamlake", "deepinfra"], only: ["baidu", "streamlake", "deepinfra"], allow_fallbacks: true, require_parameters: true });
    expect(fallback.response_format).toBeTruthy();
  });

  it("retries the same failed run and result card", async () => {
    const answerPlan = { decision: "answer", intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null }, finalResponse: "Here is the answer.", operations: [] };
    const { convexMutation } = setup(answerPlan, "failed");
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "retry", runId: "run-real", executionId: "execution-1" }) }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; runId?: string; card?: { id: string } });

    expect(convexMutation.mock.calls.some(([name]) => String(name).includes("spectraRuns:resetForRetry"))).toBe(true);
    expect(convexMutation.mock.calls.some(([name]) => String(name).includes("spectraRuns:beginRun"))).toBe(false);
    expect(events.find((event) => event.type === "run_created")).toMatchObject({ runId: "run-real", card: { id: "card-real" } });
  });

  it("creates a durable chat thread and persists only clean user-facing messages", async () => {
    const answerPlan = { decision: "answer", intent: { mode: "answer", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null }, conversationTitle: "Photosynthesis in plain language", conversationSummary: "A simple explanation of how plants store light energy.", finalResponse: "Photosynthesis stores light energy as chemical energy.", operations: [] };
    const { convexMutation } = setup(answerPlan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify({ action: "run", surface: "chat", workspaceId: "workspace-real", prompt: "Explain photosynthesis simply." }) }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; threadId?: string });

    expect(events).toContainEqual(expect.objectContaining({ type: "thread_ready", threadId: "thread-real" }));
    const beginRunCall = convexMutation.mock.calls.find(([name]) => String(name).includes("spectraRuns:beginRun"));
    expect(beginRunCall?.[1]).toMatchObject({ sourceSurface: "chat", workspaceId: "workspace-real", userPrompt: "Explain photosynthesis simply." });
    const metadataCall = convexMutation.mock.calls.find(([name]) => String(name).includes("spectraThreads:applyGeneratedMetadata"));
    expect(metadataCall?.[1]).toMatchObject({ title: "Photosynthesis in plain language", summary: "A simple explanation of how plants store light energy." });
    const messageCalls = convexMutation.mock.calls.filter(([name]) => String(name).includes("spectraThreads:appendMessage"));
    expect(messageCalls.length).toBeGreaterThanOrEqual(1);
    expect(messageCalls.every(([, args]) => (args as { role?: string }).role === "assistant")).toBe(true);
    expect(messageCalls.at(-1)?.[1]).toMatchObject({ role: "assistant", content: answerPlan.finalResponse, runId: "run-real" });
    expect(messageCalls.some(([, args]) => (args as { metadata?: { partial?: boolean } }).metadata?.partial === true)).toBe(true);
    expect(JSON.stringify(messageCalls)).not.toContain("Analysing request");
  });

  it("sanitizes invalid operation errors before streaming them to the client", async () => {
    const invalidPlan = {
      decision: "operate",
      intent: { mode: "update", requestedArtifactTypes: ["document"], requestedVisibleArtifactCount: 0, targetArtifactId: "missing-artifact", targetWorkspaceId: null },
      finalResponse: "I could not safely update that document.",
      operations: [{
        type: "artifact.update",
        input: {
          artifactId: "missing-artifact",
          blueprintKey: "document",
          title: "Internal id leak check",
          summary: null,
          content: null,
          tags: null,
        },
      }],
    };
    setup(invalidPlan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", prompt: "Update this document." }),
    }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; message?: string });
    const error = events.find((event) => event.type === "error");

    expect(error?.message).toBe("Spectra could not safely complete that request. Try again, or choose the object you want Spectra to use.");
    expect(error?.message).not.toMatch(/artifactId|workspaceId|threadId|operation|schema|JSON|Convex/i);
  });

  it("keeps confirmation operations proposed until the user accepts or rejects them", async () => {
    const workspacePlan = {
      decision: "operate",
      intent: { mode: "create_workspace", requestedArtifactTypes: [], requestedVisibleArtifactCount: 0, targetArtifactId: null, targetWorkspaceId: null },
      finalResponse: "I can create a workspace for the exhibition.",
      operations: [{
        type: "workspace.create",
        input: {
          title: "TOK Exhibition",
          description: "Planning and evidence for the exhibition.",
          icon: "BookOpen",
          color: null,
        },
      }],
    };
    const { convexMutation } = setup(workspacePlan);
    const route = await import("@/app/api/spectra/run/route");
    const response = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({ action: "run", surface: "workspace", workspaceId: "workspace-real", prompt: "Create a new TOK Exhibition workspace." }),
    }));
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; card?: { actions?: Array<{ key: string }> } });

    expect(events.some((event) => event.type === "confirmation_required")).toBe(true);
    expect(events.find((event) => event.type === "confirmation_required")?.card?.actions?.map((action) => action.key)).toEqual(["confirm", "cancel"]);
    expect(convexMutation.mock.calls.some(([name]) => String(name) === "spectraWorkspaces:create")).toBe(false);

    const cancelResponse = await route.POST(new NextRequest("http://localhost/api/spectra/run", {
      method: "POST",
      body: JSON.stringify({ action: "cancel", runId: "run-real", executionId: "execution-1" }),
    }));
    const cancelEvents = (await cancelResponse.text()).trim().split("\n").map((line) => JSON.parse(line) as { type: string; summary?: string });
    expect(cancelEvents).toContainEqual(expect.objectContaining({ type: "final", summary: "No proposed changes were applied." }));
    expect(convexMutation.mock.calls.some(([name]) => String(name).includes("spectraRuns:rejectConfirmation"))).toBe(true);
  });
});
