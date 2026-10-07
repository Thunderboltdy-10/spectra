import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSkill } from "@/features/spectra/agents/foundry";
import { ProviderUnavailableError } from "@/features/spectra/ai/harness/types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  convexQuery: vi.fn(),
  callSpectraModel: vi.fn(),
  admit: vi.fn(),
  meter: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/convex-server", () => ({ convexQuery: mocks.convexQuery }));
vi.mock("@/features/spectra/ai/harness/model", () => ({ callSpectraModel: mocks.callSpectraModel }));
vi.mock("../../model-work", () => ({
  admitAgentModelWork: mocks.admit,
  recordAgentModelWork: mocks.meter,
}));
import { POST } from "./route";

function foundryContent(established = true) {
  return {
    instructions: { text: "Be precise." },
    foundry: {
      foundationEstablished: established,
      mission: {
        objective: "Give precise essay feedback.",
        interactionStyle: { tone: "direct", responseLength: "balanced", clarificationPolicy: "ask_when_needed" },
      },
      skills: [
        createSkill(
          {
            id: "sk_essay_7f3a",
            name: "Essay feedback",
            purpose: "Mark essays",
            status: "verified",
            procedure: [{ order: 1, action: "Read the essay" }],
            outputContract: { shape: "Feedback", mustInclude: [], mustNotInclude: [] },
          },
          1,
        ),
      ],
    },
  };
}

function post(body: unknown) {
  return POST(
    new Request("https://example.test/api/spectra/agents/bench/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const reply = JSON.stringify({
  suggestions: [
    {
      reason: "It never says what to do next.",
      edits: [
        { field: "include", skill: "Essay feedback", value: "one next step" },
        { field: "include", skill: "Lab review", value: "hypothesis" },
      ],
    },
  ],
});

describe("the bench's suggestions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user_1" });
    mocks.admit.mockResolvedValue(undefined);
    mocks.meter.mockResolvedValue(undefined);
    mocks.convexQuery.mockResolvedValue({ title: "Coach", blueprintKey: "agent", content: foundryContent() });
    mocks.callSpectraModel.mockResolvedValue({
      text: `Sure:\n${reply}`,
      toolCalls: [],
      usage: { promptTokens: 300, completionTokens: 40 },
    });
  });

  it("asks the environment's model about one answer, meters it, and returns edits it can apply", async () => {
    const response = await post({
      agentId: "agent_1",
      prompt: " Mark my essay ",
      output: "Nice essay.",
      checks: { mustInclude: ["next step"], mustNotInclude: [] },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      suggestions: [
        {
          key: "include:sk_essay_7f3a:one next step",
          reason: "It never says what to do next.",
          edits: [{ kind: "include", skillId: "sk_essay_7f3a", skillName: "Essay feedback", value: "one next step" }],
        },
      ],
    });
    expect(mocks.convexQuery).toHaveBeenCalledWith("agents:draftForEvaluation", { agentId: "agent_1" });
    expect(mocks.admit).toHaveBeenCalledWith("agent_1");
    expect(mocks.meter).toHaveBeenCalledWith("user_1", "agent_1", "agent_bench", { inputTokens: 300, outputTokens: 40 });
    const request = mocks.callSpectraModel.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
      reasoning?: string;
      maxTokens?: number;
    };
    // Model, provider and reasoning come only from the environment.
    expect(request.reasoning).toBeUndefined();
    expect(request.maxTokens).toBeUndefined();
    expect(request.messages[1]!.content).toContain("Mark my essay");
    expect(request.messages[1]!.content).toContain('Includes "next step": fails');
    expect(request.messages.map((message) => message.content).join("")).not.toContain("sk_essay_7f3a");
  });

  it("reads the editor's unsaved draft when it sends one", async () => {
    const unsaved = foundryContent();
    unsaved.foundry.mission.objective = "Unsaved objective.";
    await post({ agentId: "agent_1", prompt: "Hi", output: "Hello.", content: unsaved });
    const request = mocks.callSpectraModel.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(request.messages[1]!.content).toContain("Unsaved objective.");
  });

  it("refuses before any model work when there is no answer, no skills yet, or no session", async () => {
    expect((await post({ agentId: "agent_1", prompt: "Hi", output: " " })).status).toBe(400);
    mocks.convexQuery.mockResolvedValue({ title: "Coach", blueprintKey: "agent", content: foundryContent(false) });
    const early = await post({ agentId: "agent_1", prompt: "Hi", output: "Hello." });
    expect((await early.json()).error.message).toBe("Compile the agent's skills first, then ask for suggestions.");
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await post({ agentId: "agent_1", prompt: "Hi", output: "Hello." })).status).toBe(401);
    expect(mocks.admit).not.toHaveBeenCalled();
    expect(mocks.callSpectraModel).not.toHaveBeenCalled();
  });

  it("stops at the school's usage limit, and words an unreachable model plainly", async () => {
    mocks.admit.mockRejectedValueOnce(new Error("SCHOOL_MODEL_TOKEN_CEILING: Your school reached its AI usage limit for today."));
    const limited = await post({ agentId: "agent_1", prompt: "Hi", output: "Hello." });
    expect((await limited.json()).error.message).toBe("Your school reached its AI usage limit for today.");
    expect(mocks.callSpectraModel).not.toHaveBeenCalled();
    mocks.callSpectraModel.mockRejectedValueOnce(new ProviderUnavailableError("down"));
    const down = await post({ agentId: "agent_1", prompt: "Hi", output: "Hello." });
    expect(down.status).toBe(503);
    expect((await down.json()).error.message).toBe("Spectra could not reach the AI model. Try again in a moment.");
    expect(mocks.meter).not.toHaveBeenCalled();
  });

  it("returns no suggestions when the model's reply is not usable", async () => {
    mocks.callSpectraModel.mockResolvedValue({ text: "I would not change anything.", toolCalls: [] });
    const response = await post({ agentId: "agent_1", prompt: "Hi", output: "Hello." });
    expect(await response.json()).toEqual({ suggestions: [] });
  });
});
