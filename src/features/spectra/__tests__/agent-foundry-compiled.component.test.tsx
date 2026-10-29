// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSkill, normalizeFoundryContent, projectFoundryToLegacy, type AgentFoundryContent } from "../agents/foundry";

const mocks = vi.hoisted(() => ({ job: vi.fn(), runs: vi.fn(), evaluate: vi.fn() }));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => ({})), useQuery: () => undefined }));
vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  getSpectraAgentReleases: vi.fn(async () => ({ releases: [] })),
  getSpectraAgentEvalRuns: mocks.runs,
  evaluateSpectraAgent: mocks.evaluate,
  getSpectraAgentAnalytics: vi.fn(async () => ({ analytics: null })),
  getSpectraFoundryCompilerJob: mocks.job,
}));
vi.mock("../data/agent-bench", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/agent-bench")>()),
  getAgentBench: vi.fn(async () => ({ cases: [], runs: [], release: null })),
}));
vi.mock("../settings/preference-store", () => ({
  useSpectraPreferences: () => ({
    preferences: { workbar: {}, writing: { smartCompletion: false } },
    hydrated: true,
    update: () => {},
    replace: () => {},
    reset: () => {},
  }),
}));

import { AgentFoundry } from "../components/agent-foundry";
import { StudioContractProvider, useStudioContractValue } from "../components/artifact-studio-shell";
import { spectraBus } from "../events";

const drafted = [
  createSkill({ id: "mark", name: "Mark an essay", purpose: "Marks against the rubric" }, 10),
  createSkill({ id: "plan", name: "Plan a revision", purpose: "Plans what to fix" }, 10),
];

function initial(): AgentFoundryContent {
  return projectFoundryToLegacy(normalizeFoundryContent({
    foundry: { foundationEstablished: true, mission: { objective: "Give students precise essay feedback." } },
  }));
}

const held: { content?: AgentFoundryContent } = {};

function Host() {
  const [content, setContent] = useState<unknown>(initial);
  held.content = content as AgentFoundryContent;
  const contract = useStudioContractValue({
    artifactId: "agent_1",
    type: "agent",
    role: "edit",
    surface: "full",
    sync: { state: "saved", label: "Saved" },
    density: "comfortable",
    inspector: { open: null, show: () => {}, hide: () => {} },
  });
  return (
    <StudioContractProvider value={contract}>
      <AgentFoundry artifactId="agent_1" artifactTitle="Essay coach" mode="tab" artifacts={[]} content={content} onChange={setContent} />
    </StudioContractProvider>
  );
}

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  mocks.job.mockResolvedValue({ job: null });
  mocks.runs.mockResolvedValue({ runs: [], currentContentHash: "hash" });
  mocks.evaluate.mockResolvedValue({ status: "passed", passedCount: 1, caseCount: 1 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the agent studio when Spectra compiles the agent", () => {
  it("invalidates a run's draft match on an edit, even if a refresh still reads the older saved head", async () => {
    mocks.runs.mockResolvedValue({
      currentContentHash: "hash",
      runs: [{ _id: "run-1", status: "passed", contentHash: "hash", startedAt: 1, completedAt: 2, modelId: "model", caseCount: 1, passedCount: 1, averageScore: 1, threshold: 0.8, results: [] }],
    });
    render(<Host />);
    fireEvent.click(screen.getByRole("tab", { name: /^Checks$/ }));
    expect(await screen.findByText(/this draft/)).toBeTruthy();
    mocks.job.mockResolvedValue({ job: {
      jobId: "job", runId: "build", status: "completed", stages: [], startedAt: 1, updatedAt: 2, stale: false,
      result: { skills: drafted, routing: { description: "New routing", examples: [], negativeExamples: [] }, releaseNotes: "New skills." },
    } });
    act(() => spectraBus.emit("agent.compiled", { agentId: "agent_1" }));
    expect(await screen.findByText(/draft match not confirmed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Refresh runs$/ }));
    await waitFor(() => expect(mocks.runs).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/this draft/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Run checks$/ }));
    expect(await screen.findByText(/this draft/)).toBeTruthy();
  });

  it("shows the drafted skills for approval, applies the compiled routing, and drops a skill once approved", async () => {
    render(<Host />);
    await waitFor(() => expect(mocks.job).toHaveBeenCalledTimes(1));

    mocks.job.mockResolvedValue({
      job: {
        jobId: "job", runId: "run", status: "completed", stages: [], startedAt: 1, updatedAt: 2, stale: false,
        result: { skills: drafted, routing: { description: "Essay feedback", examples: ["Mark my essay"], negativeExamples: [] }, releaseNotes: "Two skills." },
      },
    });
    act(() => spectraBus.emit("agent.compiled", { agentId: "other" }));
    expect(mocks.job).toHaveBeenCalledTimes(1);
    act(() => spectraBus.emit("agent.compiled", { agentId: "agent_1" }));

    expect(await screen.findByText("Mark an essay")).toBeTruthy();
    expect(screen.getByText("Plan a revision")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("2 skills drafted");
    expect(held.content!.routing.description).toBe("Essay feedback");
    expect(held.content!.foundry.draftReleaseNotes).toBe("Two skills.");

    // Approving one (here, or Spectra's approve_agent_skills) leaves the other waiting.
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0]!);
    await waitFor(() => expect(held.content!.foundry.skills.map((skill) => skill.id)).toEqual(["mark"]));
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
  });
});
