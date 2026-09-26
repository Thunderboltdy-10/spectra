import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyCommittedOutcomes } from "@/app/api/spectra/run/loop/verify";
import { normalizeArtifactContent } from "@/features/spectra/ai/content-normalization";
import { applyDocumentAcademicOperations } from "@/features/spectra/commands/office/document-academic-operations";
import { parseModelOperation } from "@/features/spectra/operations/schema";
import { enforceAiPresentationContentPolicy } from "@/features/spectra/presentation/ai-content-policy";
import { normalizePresentationContent } from "@/features/spectra/presentation/model";

const mocks = vi.hoisted(() => ({ query: vi.fn(), readLive: vi.fn() }));
vi.mock("@/app/api/spectra/run/loop/io", () => ({ query: mocks.query }));
vi.mock("@/features/spectra/ai/yjs-artifact-operation", () => ({
  readLiveArtifactValue: mocks.readLive,
}));

const requested = {
  blocks: [
    { id: "intro", type: "paragraph", text: "Photosynthesis stores light energy in glucose." },
    { id: "detail", type: "paragraph", text: "Chlorophyll absorbs light in the chloroplast." },
  ],
  properties: { topic: "Photosynthesis", level: "secondary" },
};

function update(overrides: Record<string, unknown> = {}) {
  return parseModelOperation({
    type: "artifact.update",
    input: {
      artifactId: "artifact-real", blueprintKey: "document",
      title: null, summary: null, tags: null, contentPatch: null,
      content: requested, ...overrides,
    },
  });
}

function saved(content: unknown, blueprintKey = "document") {
  return { _id: "artifact-real", blueprintKey, content };
}

function verify(operation = update(), options: { prompt?: string } = {}) {
  return verifyCommittedOutcomes("actor", [{
    operation, affected: [{ type: "artifact", id: "artifact-real" }],
  }], options);
}

async function expectMismatch(operation = update()) {
  const result = expect(verify(operation)).rejects.toThrow(
    "The saved artifact did not contain the requested content change.",
  );
  await vi.runAllTimersAsync();
  await result;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T10:00:00Z"));
  mocks.query.mockReset();
  mocks.readLive.mockReset().mockResolvedValue(null);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("full replacement verification", () => {
  it.each([
    ["unrelated valid content", { blocks: [{ id: "other", type: "paragraph", text: "Respiration releases stored energy." }] }],
    ["missing array element", { ...requested, blocks: [requested.blocks[0]] }],
    ["extra array element", { ...requested, blocks: [...requested.blocks, { id: "stale", type: "paragraph", text: "This paragraph should have been deleted." }] }],
    ["reordered array", { ...requested, blocks: [...requested.blocks].reverse() }],
    ["changed array element", { ...requested, blocks: [requested.blocks[0], { ...requested.blocks[1], text: "The wrong replacement." }] }],
    ["missing map key", { ...requested, properties: { topic: "Photosynthesis" } }],
    ["extra map key", { ...requested, properties: { ...requested.properties, obsolete: "Should be removed" } }],
    ["changed map value", { ...requested, properties: { ...requested.properties, level: "primary" } }],
    ["unexpected native metadata", { ...requested, nativeBinding: { packageHash: "different" } }],
  ])("rejects %s after saved, live and projection readback", async (_label, content) => {
    mocks.query.mockResolvedValue(saved(content));
    mocks.readLive.mockResolvedValue({ content });
    await expectMismatch();
    expect(mocks.readLive).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledTimes(11);
  });

  it("accepts reordered object keys and write-normalized defaults without a live read", async () => {
    const content = { blocks: [{ id: "heading", type: "heading", text: "Photosynthesis" }], properties: { topic: "Biology", level: "secondary" } };
    mocks.query.mockResolvedValue(saved({
      properties: { level: "secondary", topic: "Biology" },
      blocks: [{ text: "Photosynthesis", attrs: { level: 2 }, type: "heading", id: "heading" }],
    }));
    await verify(update({ content }));
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.readLive).not.toHaveBeenCalled();
  });

  it("accepts matching live content while the saved projection is stale", async () => {
    mocks.query.mockResolvedValue(saved({ blocks: [requested.blocks[0]] }));
    mocks.readLive.mockResolvedValue({ content: requested });
    await verify();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.readLive).toHaveBeenCalledTimes(1);
  });

  it("accepts the projection once the complete replacement arrives", async () => {
    mocks.query.mockResolvedValueOnce(saved({ blocks: [requested.blocks[0]] }))
      .mockResolvedValue(saved(requested));
    const result = verify();
    await vi.runAllTimersAsync();
    await result;
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("keeps metadata-only updates independent of content equality", async () => {
    mocks.query.mockResolvedValue({ ...saved({ blocks: [requested.blocks[0]] }), title: "New title" });
    await verify(update({ title: "New title", content: null }));
    expect(mocks.readLive).not.toHaveBeenCalled();
  });

  it("keeps patch verification scoped to the requested paths", async () => {
    mocks.query.mockResolvedValue(saved({ blocks: [requested.blocks[0]], extra: "A disjoint collaborator change" }));
    await verify(update({ content: null, contentPatch: { changes: [{
      op: "replace", path: "/blocks/0/text", value: requested.blocks[0]!.text,
    }] } }));
    expect(mocks.readLive).not.toHaveBeenCalled();
  });

  it("keeps academic operation verification on its existing predicate", async () => {
    const documentOperations = [{
      kind: "insert-note", noteType: "footnote", noteId: "41",
      anchor: { regionId: "intro", expectedText: requested.blocks[0]!.text, start: 0, end: 0 },
      content: [[{ text: "A source note" }]],
    }];
    const content = applyDocumentAcademicOperations(requested, documentOperations);
    mocks.query.mockResolvedValue(saved(content));
    await verify(update({ content: null, documentOperations }));
    expect(mocks.readLive).not.toHaveBeenCalled();
  });

  it("applies presentation reading-order policy to expected content only", async () => {
    const content = normalizePresentationContent({ slides: [{
      id: "slide-1", title: "Photosynthesis", objects: [
        { id: "title", type: "text", content: { text: "How plants store energy" }, x: 10, y: 10 },
      ],
    }] });
    const actual = enforceAiPresentationContentPolicy(structuredClone(content), "");
    mocks.query.mockResolvedValue(saved(actual, "presentation"));
    await verify(update({ blueprintKey: "presentation", content }));
    expect(mocks.readLive).not.toHaveBeenCalled();

    const incomplete = structuredClone(actual);
    incomplete.slides[0]!.accessibility!.readingOrder = [];
    mocks.query.mockResolvedValue(saved(incomplete, "presentation"));
    await expectMismatch(update({ blueprintKey: "presentation", content }));
    expect(incomplete.slides[0]!.accessibility!.readingOrder).toEqual([]);
  });

  it("rejects a missing generated bibliography rather than reconstructing observed content", async () => {
    const content = normalizePresentationContent({ slides: [{
      id: "slide-1", title: "Photosynthesis evidence", objects: [],
      citations: [{ id: "citation-1", label: "Biology reference", sourceRefs: ["evidence:source-1"] }],
    }] });
    const complete = enforceAiPresentationContentPolicy(structuredClone(content), "");
    expect(complete.slides.length).toBeGreaterThan(content.slides.length);
    mocks.query.mockResolvedValue(saved(complete, "presentation"));
    await verify(update({ blueprintKey: "presentation", content }));
    mocks.query.mockResolvedValue(saved({ ...complete, slides: complete.slides.slice(0, 1) }, "presentation"));
    await expectMismatch(update({ blueprintKey: "presentation", content }));
  });

  it("accepts stable Foundry timestamp defaults without ignoring explicit dates", async () => {
    const content = normalizeArtifactContent("agent", {
      profile: { purpose: "A biology study assistant" },
      instructions: { regionId: "instructions", text: "Explain the biology evidence clearly and cite the supplied sources." },
      foundry: { state: { history: [{ id: "history-1", action: "section_added", summary: "Added evidence" }] } },
    });
    const withoutDate = structuredClone(content);
    const state = (withoutDate.foundry as { state: { history: Array<{ at?: number }> } }).state;
    delete state.history[0]!.at;
    mocks.query.mockResolvedValue(saved(content, "agent"));
    await verify(update({ blueprintKey: "agent", content }));
    vi.setSystemTime(Date.now() + 1_000);
    await verify(update({ blueprintKey: "agent", content: withoutDate }));
    const withDate = structuredClone(content);
    (withDate.foundry as { state: { history: Array<{ at: number }> } }).state.history[0]!.at = Date.now();
    mocks.query.mockResolvedValue(saved(withDate, "agent"));
    await expectMismatch(update({ blueprintKey: "agent", content: withoutDate }));
  });
});
