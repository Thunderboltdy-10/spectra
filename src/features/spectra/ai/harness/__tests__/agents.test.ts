import { describe, expect, it } from "vitest";
import { MemoryBackend } from "../memory-backend";
import { environmentBlock } from "../prompt";
import { buildHarnessTools, createSession } from "../tools";

const agents = [{ id: "agent-1", title: "IB Biology coach", description: "Feedback on IB Biology internal assessments" }];

class AgentBackend extends MemoryBackend {
  used: string[] = [];
  async useAgent(agentId: string) {
    this.used.push(agentId);
    return agentId === "agent-1" ? { title: "IB Biology coach", instructions: "Quote the IA criteria." } : null;
  }
}

describe("the user's agents", () => {
  it("lists the agents for the model only while none is active", () => {
    const base = { now: 0, timeZone: "UTC", permissions: "Ask first" };
    expect(environmentBlock({ ...base, agents })).toContain("IB Biology coach: Feedback on IB Biology internal assessments (id agent-1)");
    const active = environmentBlock({ ...base, agents, agent: { title: "IB Biology coach", instructions: "Quote the IA criteria." } });
    expect(active).toContain("This conversation uses the user's agent");
    expect(active).not.toContain("call use_agent");
  });

  it("offers use_agent only when there is an agent to hand to", () => {
    const names = (backend: MemoryBackend, list = agents) =>
      buildHarnessTools(createSession({ backend, prompt: "x", agents: list })).map((tool) => tool.name);
    expect(names(new AgentBackend())).toContain("use_agent");
    expect(names(new AgentBackend(), [])).not.toContain("use_agent");
    expect(names(new MemoryBackend())).not.toContain("use_agent");
  });

  it("hands the request over with the agent's instructions, and refuses unknown ids", async () => {
    const backend = new AgentBackend();
    const tool = buildHarnessTools(createSession({ backend, prompt: "x", agents })).find((entry) => entry.name === "use_agent")!;
    expect(() => tool.parse!({ agentId: "someone-else" })).toThrow(/user's agents/);
    const args = tool.parse!({ agentId: "agent-1" });
    expect(tool.label(args)).toBe("Calling on *IB Biology coach*");
    const outcome = await tool.execute(args, { signal: new AbortController().signal, runId: "r", toolCallId: "t" });
    expect(outcome.ok).toBe(true);
    expect(outcome.content).toContain("Quote the IA criteria.");
    expect(backend.used).toEqual(["agent-1"]);
  });
});
