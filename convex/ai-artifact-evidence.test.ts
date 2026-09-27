import { describe, expect, it } from "vitest";
import { buildAiArtifactContentEvidence } from "./spectraArtifactWriteScope";
import { canonicalArtifactWriteContent, normalizeAiArtifactWriteContent } from "../src/features/spectra/operations/artifact-write-content";
import { normalizePlanContent } from "../src/features/spectra/plan/model";

const identity = { operationDigest: "server-operation-digest", sourceContentIdentity: "server-physical-source", prompt: "Update this work" };
const body = (text: string) => ({ blocks: [{ id: "p", type: "paragraph", text }] });

describe("shared signed AI content evidence", () => {
  it("binds exactly the resolved edit and classifies a real wipe", async () => {
    const evidence = await buildAiArtifactContentEvidence({ ...identity, blueprintKey: "document", input: { content: body("") }, beforeContent: body("Authored explanation"), afterContent: body("") });
    expect(evidence).toMatchObject({ version: 1, operationDigest: identity.operationDigest, sourceContentIdentity: identity.sourceContentIdentity, fullContentDeletion: true });
    expect(evidence.baseContentDigest).not.toEqual(evidence.resultContentDigest);
    await expect(buildAiArtifactContentEvidence({ ...identity, blueprintKey: "document", input: { content: body("") }, beforeContent: body("Authored explanation"), afterContent: body("Different result") })).rejects.toThrow("RESULT_SCOPE_MISMATCH");
  });

  it.each(["beforeContent", "afterContent"] as const)("rejects a durable wrapper in %s instead of treating it as empty content", async field => {
    const ref = { spectraContentRef: { version: 1, artifactId: "artifact", payloadRef: "payload", digest: "a".repeat(64), byteLength: 128, path: "content" } };
    await expect(buildAiArtifactContentEvidence({ ...identity, blueprintKey: "document", input: { content: body("") }, beforeContent: body("Old"), afterContent: body(""), [field]: ref })).rejects.toThrow("CONTENT_NOT_HYDRATED");
  });

  it("does not repair an observed empty presentation into the expected policy-generated content", async () => {
    const raw = { slides: [], theme: { id: "default" } };
    const expected = canonicalArtifactWriteContent("presentation", normalizeAiArtifactWriteContent("presentation", raw, "Explain photosynthesis"));
    await expect(buildAiArtifactContentEvidence({ ...identity, prompt: "Explain photosynthesis", blueprintKey: "presentation", input: { content: raw }, beforeContent: expected, afterContent: raw })).rejects.toThrow("RESULT_SCOPE_MISMATCH");
  });

  it("permits personal planner edits but rejects actual official date or source changes", async () => {
    const before = normalizePlanContent({ taskTitle: "Official essay", status: "todo", dueAt: 1_800_000_000_000,
      source: { provider: "managebac", externalId: "assignment-1", hash: "v1", status: "active", lockedFields: ["taskTitle", "description", "dueAt", "source"] }, sourceRefs: ["managebac:assignment-1"] });
    const personal = structuredClone(before);
    personal.tasks[0].title = "My personal outline";
    expect(await buildAiArtifactContentEvidence({ ...identity, blueprintKey: "planner_task", input: { content: personal }, beforeContent: before, afterContent: personal })).toMatchObject({ fullContentDeletion: false });
    const changedDate = { ...personal, dueAt: before.dueAt! + 1 };
    await expect(buildAiArtifactContentEvidence({ ...identity, blueprintKey: "planner_task", input: { content: changedDate }, beforeContent: before, afterContent: changedDate })).rejects.toThrow("PLANNER_OFFICIAL_DEADLINE_LOCKED");
    const changedSource = { ...personal, source: { ...personal.source, hash: "forged" } };
    await expect(buildAiArtifactContentEvidence({ ...identity, blueprintKey: "planner_task", input: { content: changedSource }, beforeContent: before, afterContent: changedSource })).rejects.toThrow("PLANNER_SOURCE_METADATA_LOCKED");
  });
});
