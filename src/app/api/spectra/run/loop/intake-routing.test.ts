import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultMission, createEmptyExtraction, createSkill, activateSkills,
} from "@/features/spectra/agents/foundry";
import type { EvidenceBinding } from "@/features/spectra/agents/foundry";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./io", () => ({ query, act: vi.fn(), mutate: vi.fn() }));
import { foundryRoutingConfidence, selectAgentRuntime } from "./intake";
import type { AgentRoutingDescriptor, SelectedAgentRuntime } from "./intake";

const prompt = "Assess this biology essay against the rubric";
const skill = createSkill({
  id: "assessment", name: "Biology assessment", purpose: "Assess biology essays against the published rubric.",
  status: "verified", triggers: [{ kind: "keyword", terms: ["biology essay"] }],
  procedure: [{ order: 1, action: "Read the essay", tools: ["artifact_read"] }],
}, 1);
const mission = { ...createDefaultMission(), objective: "Assess biology essays against the rubric" };
const evaluation = { status: "passed" as const, verificationStrength: "strong" as const,
  caseCount: 5, passedCount: 5, versionId: "release-v1", contentHash: "hash-v1" };

function fixture(overrides: Partial<AgentRoutingDescriptor> = {}) {
  const descriptor: AgentRoutingDescriptor = {
    agentId: "agent", versionId: "release-v1", title: "Biology assessor", updatedAt: 1,
    description: "Assess biology essay against rubric", examples: [prompt],
    foundry: { mission, skills: [skill], evidenceBindings: [] },
    evaluation, availableToolKeys: ["artifact_read"], ...overrides,
  };
  const runtime: SelectedAgentRuntime = {
    agentId: descriptor.agentId, versionId: descriptor.versionId, title: descriptor.title,
    instructions: "Assess the supplied biology essay.", skills: [], resources: [],
    tools: [{ key: "artifact_read" }], foundry: descriptor.foundry, evaluation: descriptor.evaluation,
    routing: { enabled: true, description: descriptor.description, examples: descriptor.examples,
      negativeExamples: descriptor.negativeExamples ?? [] },
  };
  query.mockImplementation(async (name: string) => name.endsWith(":listAgentRoutingDescriptors") ? [descriptor] : runtime);
  return { descriptor, runtime };
}

beforeEach(() => { query.mockReset(); });

describe("specialist routing through runtime intake", () => {
  it("selects a relevant evaluated specialist through the real adapter", async () => {
    fixture();
    expect(await selectAgentRuntime({ actorClerkId: "actor", prompt })).toMatchObject({
      source: "automatic", runtime: { agentId: "agent" },
    });
  });

  it.each(["Hello!", "Why is the sky blue?", "Draft a document about medieval history"])(
    "keeps ordinary Spectra for %j even with many verified skills and training sources", async (request) => {
      const extraction = createEmptyExtraction("source", "rubric", 1);
      extraction.criteria = Array.from({ length: 8 }, (_, i) => ({
        id: String(i), name: "Criterion", description: "Assess carefully", levels: [], evidenceSpanIds: [],
      }));
      fixture({ foundry: {
        mission: { ...mission, expectedOutputs: [{ kind: "document", description: "document" }] },
        skills: Array.from({ length: 6 }, (_, i) => ({ ...skill, id: String(i), triggers: [{ kind: "always" }] })),
        evidenceBindings: [{ id: "source", sourceId: "source", label: "Rubric", kind: "rubric", confirmed: true, extraction }],
      } });
      expect(await selectAgentRuntime({ actorClerkId: "actor", prompt: request, workTypes: ["document"] })).toBeNull();
    },
  );

  it("never activates a verified skill whose triggers did not match", () => {
    expect(activateSkills([skill], { request: "Explain the causes of rainfall" })).toEqual([]);
  });

  it.each(["negative", "no evaluation", "failed evaluation", "old evaluation", "missing tool", "missing evidence"])(
    "does not bypass %s rejection through lexical routing", async (reason) => {
      const f = fixture();
      if (reason === "negative") f.descriptor.negativeExamples = [prompt];
      if (reason === "no evaluation") f.descriptor.evaluation = null;
      if (reason === "failed evaluation") f.descriptor.evaluation = { ...evaluation, status: "failed" };
      if (reason === "old evaluation") f.descriptor.evaluation = { ...evaluation, versionId: "old-version" };
      if (reason === "missing tool") f.descriptor.availableToolKeys = [];
      if (reason === "missing evidence") f.descriptor.foundry = {
        mission, skills: [{ ...skill, evidenceBindings: [{ bindingId: "missing", usedFor: ["criteria"] }] }], evidenceBindings: [],
      };
      expect(await selectAgentRuntime({ actorClerkId: "actor", prompt })).toBeNull();
      expect(query.mock.calls.map(([name]) => name)).toEqual(["spectraArtifacts:listAgentRoutingDescriptors"]);
    },
  );

  it("allows medium confidence only for a still-relevant continued specialist", async () => {
    const f = fixture({ description: "", examples: [], foundry: {
      mission: { ...mission, domains: ["biology"] }, skills: [skill], evidenceBindings: [],
    } });
    expect(foundryRoutingConfidence(prompt, f.descriptor, {})).toMatchObject({ confidence: 0.66 });
    expect(await selectAgentRuntime({ actorClerkId: "actor", prompt })).toBeNull();
    expect(await selectAgentRuntime({ actorClerkId: "actor", prompt, retainedAgentId: "agent" })).toMatchObject({ source: "continued" });
    expect(await selectAgentRuntime({ actorClerkId: "actor", prompt: "Why is the sky blue?", retainedAgentId: "agent" })).toBeNull();
  });

  it.each(["release changed", "tool revoked", "routing disabled", "access revoked"])(
    "revalidates invocation after listing when %s", async (change) => {
      const f = fixture();
      if (change === "release changed") {
        f.runtime.versionId = "release-v2";
        f.runtime.evaluation = null;
      }
      if (change === "tool revoked") f.runtime.tools = [];
      if (change === "routing disabled") f.runtime.routing!.enabled = false;
      if (change === "access revoked") query.mockImplementation(async (name: string) => {
        if (name.endsWith(":listAgentRoutingDescriptors")) return [f.descriptor];
        throw new Error("forbidden");
      });
      expect(await selectAgentRuntime({ actorClerkId: "actor", prompt })).toBeNull();
    },
  );

  it("preserves explicit selection without automatic-fit or evaluation requirements", async () => {
    fixture({ evaluation: null });
    expect(await selectAgentRuntime({ actorClerkId: "actor", prompt: "Explain this differently", requestedAgentId: "agent" }))
      .toMatchObject({ source: "explicit", runtime: { agentId: "agent" } });
    expect(query.mock.calls.map(([name]) => name)).toEqual(["spectraArtifacts:getAgentRuntime"]);
  });

  it("requires actual published extraction for a training prerequisite", async () => {
    const binding: EvidenceBinding = { id: "rubric", sourceId: "source", kind: "rubric", label: "Biology rubric", confirmed: true };
    const f = fixture({ foundry: {
      mission, skills: [{ ...skill, evidenceBindings: [{ bindingId: "rubric", usedFor: ["criteria"] }] }],
      evidenceBindings: [binding],
    } });
    expect(foundryRoutingConfidence(prompt, f.descriptor, {})).toBeNull();
    binding.extraction = createEmptyExtraction("source", "rubric", 1);
    expect(foundryRoutingConfidence(prompt, f.descriptor, {})?.confidence).toBeGreaterThan(0.8);
  });
});
