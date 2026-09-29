import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createRunItem,
  performRecoverableAction,
  runItemSchema,
  UserInputStore,
  type UserInputRequest,
} from "@/features/spectra/actions/protocol";
import { RunStateMachine } from "@/features/spectra/runs/state";
import {
  createInternalRun,
  shouldShowInLiveDock,
} from "@/features/spectra/runs/background/internal-run-policy";
import {
  APPLICATION_AGENT_TOOL_IDS,
  spectraToolRegistry,
} from "@/features/spectra/tools/registry";
import { SpectraToolExecutor } from "@/features/spectra/tools/execution";
import {
  conductParallelResearch,
  openRouterParallelSearch,
  PARALLEL_SEARCH_TIMEOUT_MS,
  type ParallelSearchResult,
} from "@/features/spectra/sources/research";
import {
  createEvidenceSpan,
  createVerifiedSource,
  verifyCitation,
} from "@/features/spectra/sources/records";
import { getSpectraModelProfile } from "@/features/spectra/ai/model-config";
import { nativeOpenRouterAttachmentContent } from "@/features/spectra/compute/files/model-attachment-bundle";
import { adaptLegacyRunEvent } from "@/features/spectra/migrations/compatibility";

describe("AI Action Protocol V2", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("validates every versioned run item without hidden reasoning channels", () => {
    const payloads = [
      { type: "title", text: "Research brief", final: true },
      { type: "progress", summary: "Reading primary sources" },
      { type: "text_delta", channel: "answer", text: "Result" },
      { type: "tool_start", call: { id: "call-1" } },
      {
        type: "tool_progress",
        callId: "call-1",
        progress: { summary: "Reading" },
      },
      { type: "tool_result", callId: "call-1", result: { ok: true } },
      { type: "action_start", action: { id: "action-1" } },
      {
        type: "action_progress",
        actionId: "action-1",
        step: { kind: "moving" },
      },
      { type: "patch", patch: { path: "/title" } },
      { type: "wait", reason: { kind: "actor" } },
      { type: "question", request: { id: "question-1" } },
      { type: "approval", request: { id: "approval-1" } },
      { type: "steer_queued", steer: { id: "steer-1" } },
      { type: "checkpoint", checkpoint: { id: "checkpoint-1" } },
      { type: "final", result: { summary: "Done" } },
      { type: "degraded", state: { reason: "partial source" } },
      { type: "error", error: { code: "terminal" } },
    ] as const;
    payloads.forEach((payload, sequence) => {
      expect(runItemSchema.parse(payload)).toEqual(payload);
      expect(createRunItem("run-1", sequence, payload).protocolVersion).toBe(2);
    });
    expect(JSON.stringify(payloads)).not.toMatch(
      /chain.of.thought|reasoning_delta/i,
    );
  });

  it("keeps waits recoverable and resumes the explicit run state machine", () => {
    const machine = new RunStateMachine();
    machine.transition("planning");
    machine.transition("running_model");
    machine.transition("waiting_for_actor", "Human is editing the target");
    expect(machine.isRecoverableWait()).toBe(true);
    expect(machine.isTerminal()).toBe(false);
    machine.transition("resuming");
    machine.transition("performing_action");
    machine.transition("completed");
    expect(machine.isTerminal()).toBe(true);
    expect(() => machine.transition("running_model")).toThrow(
      /TRANSITION_INVALID/,
    );
  });

  it("persists all protocol-native input shapes and resumes idempotently", () => {
    const store = new UserInputStore();
    const requests: UserInputRequest[] = [
      {
        id: "choice",
        kind: "choice",
        prompt: "Choose",
        cancellation: "skip",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B", recommended: true },
        ],
      },
      {
        id: "multi",
        kind: "multiple_choice",
        prompt: "Choose several",
        cancellation: "skip",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        minSelections: 0,
      },
      {
        id: "answer",
        kind: "short_answer",
        prompt: "Answer",
        cancellation: "cancel_run",
        maxLength: 2000,
      },
      {
        id: "file",
        kind: "file",
        prompt: "Attach",
        cancellation: "skip",
        accept: ["application/pdf"],
        multiple: false,
      },
      {
        id: "target",
        kind: "context_target",
        prompt: "Pick",
        cancellation: "skip",
        targetKinds: ["work"],
        multiple: false,
      },
      {
        id: "confirm",
        kind: "confirmation",
        prompt: "Confirm",
        cancellation: "cancel_run",
        confirmLabel: "Continue",
        destructive: false,
      },
      {
        id: "permission",
        kind: "permission",
        prompt: "Allow",
        cancellation: "cancel_run",
        capability: "read_sources",
      },
      {
        id: "compare",
        kind: "comparison",
        prompt: "Compare",
        cancellation: "skip",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        multiSelect: false,
      },
    ];
    requests.forEach((request) => store.request(request));
    expect(store.pending()).toHaveLength(8);
    const response = { requestId: "choice", value: "b", respondedAt: 10 };
    expect(store.respond(response)).toEqual(response);
    expect(store.respond({ ...response, value: "a" })).toEqual(response);
    expect(() =>
      store.respond({ requestId: "confirm", value: "yes", respondedAt: 11 }),
    ).toThrow(/BOOLEAN_INVALID/);
    expect(UserInputStore.restore(store.snapshot()).response("choice")).toEqual(
      response,
    );
  });

  it("retries semantic postconditions and never reports false completion", async () => {
    let landed = false;
    const outcome = await performRecoverableAction(
      {
        id: "action-1",
        intent: { kind: "set", description: "Set status" },
        target: {
          workId: "work-1",
          workType: "planner_task",
          kind: "field",
          path: ["tasks", "task-1", "status"],
          schemaVersion: 2,
        },
        preconditions: [
          { id: "exists", description: "Target exists", verify: () => true },
        ],
        collaborationPolicy: {
          mode: "interaction_lease",
          leaseScope: "field",
          release: "commit",
        },
        choreography: [],
        postconditions: [
          { id: "landed", description: "Value landed", verify: () => landed },
        ],
        retryPolicy: { maxAttempts: 2, backoffMs: 0, replanOn: [] },
        fallbackStrategies: [],
        checkpointPolicy: "both",
      },
      {},
      async (_action, attempt) => {
        landed = attempt === 2;
      },
    );
    expect(outcome).toEqual({ kind: "completed", attempts: 2 });
  });

  it("registers every application and input tool with complete policy metadata", () => {
    for (const id of [
      ...APPLICATION_AGENT_TOOL_IDS,
      "ask_user_choice",
      "request_file",
      "request_permission",
      "present_comparison",
      "create_document",
      "create_code",
    ]) {
      const definition = spectraToolRegistry.require(id);
      expect(definition.version).toBe(2);
      expect(definition.retryPolicy.maxAttempts).toBeGreaterThan(0);
      expect(definition.summarizeOutput).toBeTypeOf("function");
      expect(
        spectraToolRegistry.providerTool(id).function.parameters,
      ).toBeTruthy();
    }
    expect(
      spectraToolRegistry.require("read_artifact").hardSafetyLimit,
    ).toBeUndefined();
    expect(spectraToolRegistry.require("web_search").hardSafetyLimit).toBe(
      60_000,
    );
  });

  it("batches independent reads while serializing a mutation domain", async () => {
    let activeReads = 0;
    let maximumReads = 0;
    let activeWrites = 0;
    let maximumWrites = 0;
    const register = (
      id: string,
      parallelSafe: boolean,
      domain: string | undefined,
      execute: () => Promise<string>,
    ) => {
      if (spectraToolRegistry.has(id)) return;
      spectraToolRegistry.register({
        id,
        version: 2,
        title: id,
        description: id,
        inputSchema: z.object({}),
        outputSchema: z.string(),
        capability: "test",
        category: parallelSafe ? "read" : "write",
        risk: "low",
        approval: "never",
        parallelSafe,
        idempotent: true,
        ...(domain ? { concurrencyDomain: domain } : {}),
        retryPolicy: { maxAttempts: 1, backoffMs: 0, retryableCodes: [] },
        cancellable: true,
        resumable: true,
        summarizeOutput: (output) => ({ text: output }),
        execute,
      });
    };
    register("test.parallel.a", true, undefined, async () => {
      activeReads += 1;
      maximumReads = Math.max(maximumReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeReads -= 1;
      return "a";
    });
    register("test.parallel.b", true, undefined, async () => {
      activeReads += 1;
      maximumReads = Math.max(maximumReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeReads -= 1;
      return "b";
    });
    register("test.write.a", false, "same-work", async () => {
      activeWrites += 1;
      maximumWrites = Math.max(maximumWrites, activeWrites);
      await new Promise((resolve) => setTimeout(resolve, 8));
      activeWrites -= 1;
      return "a";
    });
    register("test.write.b", false, "same-work", async () => {
      activeWrites += 1;
      maximumWrites = Math.max(maximumWrites, activeWrites);
      await new Promise((resolve) => setTimeout(resolve, 8));
      activeWrites -= 1;
      return "b";
    });
    const executor = new SpectraToolExecutor();
    const results = await executor.executeBatch([
      { id: "1", name: "test.parallel.a", input: {} },
      { id: "2", name: "test.parallel.b", input: {} },
      { id: "3", name: "test.write.a", input: {} },
      { id: "4", name: "test.write.b", input: {} },
    ]);
    expect(results.map((result) => result.ok)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(maximumReads).toBe(2);
    expect(maximumWrites).toBe(1);
  });

  it("validates, retries, cancels, and bounds tool execution by each tool's own policy", async () => {
    let attempts = 0;
    if (!spectraToolRegistry.has("test.recoverable"))
      spectraToolRegistry.register({
        id: "test.recoverable",
        version: 2,
        title: "Recoverable",
        description: "Recoverable",
        inputSchema: z.object({ value: z.string() }),
        outputSchema: z.object({ payload: z.string() }),
        capability: "test",
        category: "read",
        risk: "low",
        approval: "never",
        parallelSafe: true,
        idempotent: true,
        retryPolicy: {
          maxAttempts: 2,
          backoffMs: 0,
          retryableCodes: ["provider_unavailable"],
        },
        cancellable: true,
        resumable: true,
        summarizeOutput: () => ({ text: "Recovered" }),
        execute: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("PROVIDER_UNAVAILABLE: retry");
          return { payload: "x".repeat(40_000) };
        },
      });
    const executor = new SpectraToolExecutor();
    expect(
      await executor.execute({
        id: "bad",
        name: "test.recoverable",
        input: {},
      }),
    ).toMatchObject({ ok: false, code: "invalid_arguments" });
    const recovered = await executor.execute({
      id: "ok",
      name: "test.recoverable",
      input: { value: "go" },
    });
    expect(recovered).toMatchObject({
      ok: true,
      summary: "Recovered",
      telemetry: { attempts: 2 },
    });
    expect(JSON.stringify(recovered).length).toBeLessThan(26_000);
    const controller = new AbortController();
    controller.abort();
    expect(
      await executor.execute(
        { id: "cancel", name: "test.recoverable", input: { value: "go" } },
        { signal: controller.signal },
      ),
    ).toMatchObject({ ok: false, code: "tool_cancelled" });
  });

  it("refuses prohibited authority before invoking a tool", async () => {
    if (!spectraToolRegistry.has("test.prohibited"))
      spectraToolRegistry.register({
        id: "test.prohibited",
        version: 1,
        title: "Prohibited",
        description: "Prohibited",
        inputSchema: z.object({}),
        outputSchema: z.string(),
        capability: "test",
        category: "write",
        risk: "high",
        approval: "never",
        aiAvailability: "prohibited",
        prohibitionReason: "This action is never available to AI.",
        parallelSafe: false,
        idempotent: true,
        retryPolicy: { maxAttempts: 1, backoffMs: 0, retryableCodes: [] },
        cancellable: true,
        resumable: true,
        summarizeOutput: (output) => ({ text: output }),
        execute: async () => "should not run",
      });
    expect(await new SpectraToolExecutor().execute({ id: "blocked", name: "test.prohibited", input: {} })).toMatchObject({
      ok: false,
      code: "authority_prohibited",
      message: "This action is never available to AI.",
    });
  });

  it("uses OpenRouter's Parallel server-search tool with one full-result call", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  annotations: [
                    {
                      type: "url_citation",
                      url_citation: {
                        url: "https://example.edu/report",
                        title: "Report",
                        content: "Evidence",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const results = await openRouterParallelSearch(
      { purpose: "Find primary evidence", query: "verified topic" },
      { maxResults: 20 },
    );
    const request = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as {
      tools: Array<{ type: string; parameters: Record<string, unknown> }>;
      max_tool_calls: number;
    };
    expect(request.tools[0]).toMatchObject({
      type: "openrouter:web_search",
      parameters: {
        engine: "parallel",
        max_results: 20,
        max_total_results: 20,
        max_uses: 1,
      },
    });
    expect(request.max_tool_calls).toBe(1);
    expect(results).toMatchObject([
      { url: "https://example.edu/report", authority: "primary" },
    ]);
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  });

  it("gives a silent Parallel search its own deadline and keeps Stop distinct", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    // A provider that accepts the request and never answers until aborted.
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })));
    const deadlines: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      deadlines.push(controller);
      return controller.signal;
    });
    const search = { purpose: "Find primary evidence", query: "verified topic" };

    const silent = openRouterParallelSearch(search, { maxResults: 5, signal: new AbortController().signal });
    expect(timeout).toHaveBeenCalledWith(PARALLEL_SEARCH_TIMEOUT_MS);
    deadlines[0]!.abort(new DOMException("The operation timed out.", "TimeoutError"));
    await expect(silent).rejects.toThrow("PROVIDER_UNAVAILABLE: Parallel search did not answer in time.");

    const run = new AbortController();
    const stopped = openRouterParallelSearch(search, { maxResults: 5, signal: run.signal });
    run.abort(new Error("RUN_CANCELLED"));
    await expect(stopped).rejects.toThrow("RUN_CANCELLED");
    timeout.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("enforces purposeful research depth, full result requests, and early stop", async () => {
    const calls: number[] = [];
    const empty = await conductParallelResearch({
      mode: "deep",
      searches: Array.from({ length: 7 }, (_, index) => ({
        purpose: `gap-${index}`,
        query: `query ${index}`,
      })),
      search: async (_search, options) => {
        calls.push(options.maxResults);
        return [];
      },
    });
    expect(empty.calls).toBe(5);
    expect(calls).toEqual([20, 20, 20, 20, 20]);
    const strong: ParallelSearchResult[] = Array.from(
      { length: 6 },
      (_, index) => ({
        title: `Source ${index}`,
        url: `https://example${index}.edu/source`,
        content: "Evidence",
        authority: "primary",
      }),
    );
    const verified = await conductParallelResearch({
      mode: "verified",
      searches: [
        { purpose: "coverage", query: "primary evidence" },
        { purpose: "contradictions", query: "contradictory evidence" },
      ],
      search: async () => strong,
    });
    expect(verified.calls).toBe(1);
    expect(verified.stoppedEarly).toBe(true);
  });

  it("requires verified evidence for citations", () => {
    const source = createVerifiedSource({
      title: "Official source",
      url: "https://example.edu/report?utm_source=test",
      accessedAt: new Date(0).toISOString(),
      sourceType: "web",
      authority: "primary",
      provider: "fixture",
      content: "Supported claim",
    });
    const evidence = createEvidenceSpan(source, "Supported claim");
    expect(
      verifyCitation(
        { sourceId: source.id, evidenceIds: [evidence.id] },
        [source],
        [evidence],
      ),
    ).toBeTruthy();
    expect(() =>
      verifyCitation(
        { sourceId: source.id, evidenceIds: ["missing"] },
        [source],
        [evidence],
      ),
    ).toThrow(/EVIDENCE_MISMATCH/);
    expect(source.canonicalUrl).toBe("https://example.edu/report");
  });

  it("takes the model and reasoning level from the environment and fails loudly without them", () => {
    vi.stubEnv("SPECTRA_MODEL_ID", "vendor/some-model");
    vi.stubEnv("SPECTRA_REASONING_PROFILE", "Medium");
    expect(getSpectraModelProfile()).toMatchObject({
      route: "vendor/some-model",
      reasoningProfile: "medium",
    });
    vi.stubEnv("SPECTRA_REASONING_PROFILE", "extreme");
    expect(() => getSpectraModelProfile()).toThrow(/SPECTRA_REASONING_PROFILE/);
    vi.stubEnv("SPECTRA_REASONING_PROFILE", "xhigh");
    vi.stubEnv("SPECTRA_MODEL_ID", "");
    expect(() => getSpectraModelProfile()).toThrow(/SPECTRA_MODEL_ID is not set/);
    vi.stubEnv("SPECTRA_MODEL_ID", "not a model id");
    expect(() => getSpectraModelProfile()).toThrow(/SPECTRA_MODEL_ID/);
    vi.unstubAllEnvs();
  });

  it("configures native image/PDF input", () => {
    expect(getSpectraModelProfile()).toMatchObject({
      route: process.env.SPECTRA_MODEL_ID,
      reasoningProfile: process.env.SPECTRA_REASONING_PROFILE,
      input: { image: true, pdf: true },
    });
    const content = nativeOpenRouterAttachmentContent("Inspect", [
      {
        name: "image.png",
        mimeType: "image/png",
        size: 10,
        handling: "image",
        data: "data:image/png;base64,AA==",
      },
      {
        name: "paper.pdf",
        mimeType: "application/pdf",
        size: 10,
        handling: "pdf",
        data: "data:application/pdf;base64,AA==",
      },
    ]);
    expect(content.map((entry) => entry.type)).toEqual([
      "text",
      "image_url",
      "file",
    ]);
  });

  it("keeps internal durable jobs out of normal Live Dock tabs and preserves run history compatibility", () => {
    expect(
      createInternalRun({
        runId: "compiler-1",
        ownerSurface: "agent-foundry",
        presentation: "in_surface",
        statusLabel: "Compiling skills",
      }),
    ).toMatchObject({ durable: true, presentation: "in_surface" });
    expect(shouldShowInLiveDock("hidden_internal")).toBe(false);
    expect(
      adaptLegacyRunEvent({
        type: "status",
        runId: "run-1",
        message: "Working",
      }),
    ).toMatchObject({ protocolVersion: 2, runId: "run-1", type: "status" });
  });
});
