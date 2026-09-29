import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  readQuery: vi.fn(),
  act: vi.fn(),
  query: vi.fn(),
  readLive: vi.fn(),
}));
vi.mock("@/app/api/spectra/run/loop/io", () => ({
  readQuery: seams.readQuery,
  act: seams.act,
  query: seams.query,
  mutate: vi.fn(),
  safeJson: JSON.stringify,
}));
vi.mock("@/features/spectra/ai/yjs-artifact-operation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readLiveArtifactValue: seams.readLive,
}));

import { executeAgentReadTool } from "@/app/api/spectra/run/loop/plan";

const readArtifact = (args: Record<string, unknown>) =>
  executeAgentReadTool("actor", {
    name: "read_artifact",
    arguments: JSON.stringify(args),
  });

beforeEach(() => vi.clearAllMocks());

describe("read_artifact sees what the user just edited", () => {
  const stored = {
    _id: "doc",
    blueprintKey: "document",
    title: "Essay",
    summary: "Old",
    accessLevel: "modify",
    ownership: "owned",
    content: { blocks: [{ id: "b1", type: "paragraph", text: "checkpointed text" }] },
  };

  it("overlays the live collaboration state on the checkpointed Convex copy", async () => {
    seams.readQuery.mockResolvedValue({ ok: true, value: stored });
    seams.readLive.mockResolvedValue({
      title: "Essay",
      summary: "Old",
      tags: [],
      content: { blocks: [{ id: "b1", type: "paragraph", text: "typed a second ago" }] },
    });
    const result = (await readArtifact({ artifactId: "doc" })) as {
      artifact: { content: unknown };
    };
    expect(seams.readLive).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: "doc" }),
    );
    expect(JSON.stringify(result.artifact.content)).toContain("typed a second ago");
  });

  it("keeps the stored projection when the room is unreachable", async () => {
    seams.readQuery.mockResolvedValue({ ok: true, value: stored });
    seams.readLive.mockResolvedValue(null);
    const result = (await readArtifact({ artifactId: "doc" })) as {
      artifact: { content: unknown };
    };
    expect(JSON.stringify(result.artifact.content)).toContain("checkpointed text");
  });

  it("never replaces a withheld quiz key with the live room state for a reader", async () => {
    seams.readQuery.mockResolvedValue({
      ok: true,
      value: {
        ...stored,
        _id: "quiz",
        blueprintKey: "quiz",
        accessLevel: "read",
        ownership: "shared",
        content: { questions: [{ id: "q1", prompt: "2+2?" }] },
      },
    });
    seams.readLive.mockResolvedValue({
      title: "Quiz",
      tags: [],
      content: { questions: [{ id: "q1", prompt: "2+2?", correctAnswer: "4" }] },
    });
    const result = (await readArtifact({ artifactId: "quiz" })) as {
      artifact: { content: unknown };
    };
    expect(JSON.stringify(result.artifact.content)).not.toContain("correctAnswer");
  });
});
