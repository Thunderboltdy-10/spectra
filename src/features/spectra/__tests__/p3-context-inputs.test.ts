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
    const result = (await readArtifact({ artifactId: "doc" })) as unknown as {
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
    const result = (await readArtifact({ artifactId: "doc" })) as unknown as {
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
    const result = (await readArtifact({ artifactId: "quiz" })) as unknown as {
      artifact: { content: unknown };
    };
    expect(JSON.stringify(result.artifact.content)).not.toContain("correctAnswer");
  });
});

describe("several attached files all reach the model, labelled", () => {
  const textFile = (name: string, text: string) => ({
    id: name, name, mimeType: "text/plain", size: text.length, handling: "text" as const, data: text,
  });

  it("gives a later file its share instead of starving it behind a long first file", async () => {
    const { prepareAttachments } = await import("../compute/files/attachment-preprocessor");
    const prepared = await prepareAttachments([
      textFile("long.txt", "a".repeat(45_000)),
      textFile("longer.txt", "b".repeat(45_000)),
      textFile("notes.txt", "The key date is 1914."),
    ]);
    expect(prepared[2]!.extractedText).toBe("The key date is 1914.");
    const total = prepared.reduce((sum, item) => sum + (item.extractedText?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(80_000);
  });

  it("says when a text or Office file was cut, with how much was read", async () => {
    const { prepareAttachments } = await import("../compute/files/attachment-preprocessor");
    const [prepared] = await prepareAttachments([textFile("book.txt", "c".repeat(55_000))]);
    expect(prepared!.warnings).toEqual([
      expect.objectContaining({ code: "extraction_truncated", message: expect.stringContaining("55,000") }),
    ]);
  });

  it("does not send an Office file twice (as text and as a text-only PDF rendering)", async () => {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Budget").addRow(["Rent", 900]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const { prepareAttachments } = await import("../compute/files/attachment-preprocessor");
    const { nativeOpenRouterAttachmentContent } = await import("../compute/files/model-attachment-bundle");
    const prepared = await prepareAttachments([{
      id: "xlsx", name: "budget.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: bytes.length, handling: "xlsx",
      data: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${bytes.toString("base64")}`,
    }]);
    expect(prepared[0]!.extractedText).toContain("Rent");
    expect(nativeOpenRouterAttachmentContent("Summarise", prepared)).toEqual([
      { type: "text", text: "Summarise" },
    ]);
  });

  it("lists every attachment for the model, including one with no extractable text", async () => {
    const { attachmentManifestPrompt } = await import("../ai/attachment-evidence");
    const manifest = attachmentManifestPrompt([
      { name: "photo.png", mimeType: "image/png", size: 2048, handling: "image", data: "data:image/png;base64,AA" },
      { name: "scan.pdf", mimeType: "application/pdf", size: 4096, handling: "pdf", data: "data:application/pdf;base64,AA", extractedText: "", pageCount: 3,
        warnings: [{ code: "ocr_not_performed", message: "No extractable PDF text was found." }] },
      { name: "essay.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 9000, handling: "docx", extractedText: "Intro" },
      { name: "book.txt", mimeType: "text/plain", size: 90_000, handling: "text", extractedText: "x".repeat(40_000),
        warnings: [{ code: "extraction_truncated", message: "Only the first 40,000 of 90,000 characters were read." }] },
    ]);
    for (const name of ["photo.png", "scan.pdf", "essay.docx", "book.txt"]) expect(manifest).toContain(name);
    expect(manifest).toContain("Only the first 40,000 of 90,000 characters were read.");
    expect(manifest).toContain("No extractable PDF text was found.");
  });
});
