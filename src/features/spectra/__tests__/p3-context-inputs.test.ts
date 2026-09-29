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

import { buildAgentOrientation, executeAgentReadTool } from "@/app/api/spectra/run/loop/plan";

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

describe("the orientation says when earlier conversation was left out", () => {
  it("passes the omitted-history note to the model", () => {
    const orientation = buildAgentOrientation({
      conversation: [{ role: "user", content: "turn" }],
      conversationHistory: { shownMessages: 1, earlierMessagesOmitted: true },
    }, "Continue");
    expect(orientation.conversationHistory).toEqual({ shownMessages: 1, earlierMessagesOmitted: true });
  });
});

describe("read_embeds honours each embed's contextPolicy", () => {
  const secret = "SECRET BODY TEXT";
  const blocks = Array.from({ length: 400 }, (_, index) => ({
    id: `b${index}`, type: "paragraph", text: `${index === 0 ? secret : "filler"} ${"x".repeat(300)}`,
  }));
  const embed = (embedId: string, contextPolicy: string, versionPolicy = "live") => ({
    embedId, containerType: "artifact", containerId: "host", containerRegionId: "r", sourceArtifactId: `src-${embedId}`,
    mode: "compact", interaction: "read", versionPolicy, contextPolicy, state: "ready", canConfigure: true,
    runtimeResources: { signedUrl: "https://example.invalid/x" },
    source: { artifactId: `src-${embedId}`, title: `Source ${embedId}`, summary: "A chapter summary", blueprintKey: "document",
      tags: [], updatedAt: 1, snapshot: { title: `Source ${embedId}`, summary: "A chapter summary", tags: [], content: { blocks } } },
  });
  const readEmbeds = async () => {
    seams.readQuery.mockResolvedValue({ ok: true, value: { canConfigure: true, embeds: [
      embed("none", "none"), embed("summary", "summary"), embed("visible", "visible_region"), embed("pinned", "summary", "pinned"),
    ] } });
    return (await executeAgentReadTool("actor", { name: "read_embeds", arguments: JSON.stringify({ hostWorkId: "host" }) })) as unknown as {
      embeds: Array<Record<string, unknown> & { source: Record<string, unknown> }>;
    };
  };

  it("withholds the content of a none embed", async () => {
    const { embeds } = await readEmbeds();
    const none = embeds.find((item) => item.embedId === "none")!;
    expect(JSON.stringify(none)).not.toContain(secret);
    expect(JSON.stringify(none)).not.toContain("A chapter summary");
    expect(none.contentWithheld).toEqual(expect.any(String));
    expect(none.source).toMatchObject({ title: "Source none" });
  });

  it("gives a summary embed its summary card and how to read the rest, not the whole snapshot", async () => {
    const { embeds } = await readEmbeds();
    const summary = embeds.find((item) => item.embedId === "summary")!;
    expect(summary.source).toMatchObject({ summary: "A chapter summary", excerpt: expect.stringContaining(secret) });
    expect(JSON.stringify(summary).length).toBeLessThan(20_000);
    expect(summary.fullContent).toContain("read_artifact");
    expect(embeds.find((item) => item.embedId === "pinned")!.fullContent).toContain("pinned version");
  });

  it("gives a visible_region embed a bounded, labelled read of what it renders", async () => {
    const { embeds } = await readEmbeds();
    const visible = embeds.find((item) => item.embedId === "visible")!;
    expect(JSON.stringify(visible).length).toBeLessThan(80_000);
    expect(visible.source.contentCoverage).toMatchObject({ complete: false });
    expect(JSON.stringify(embeds)).not.toContain("signedUrl");
  });
});

describe("a read the tool already bounded reaches the model whole", () => {
  it("returns every block of a mid-sized document, not the first 40", async () => {
    const blocks = Array.from({ length: 60 }, (_, index) => ({ id: `b${index}`, type: "paragraph", text: `P${index} ${"y".repeat(450)}` }));
    seams.readQuery.mockResolvedValue({ ok: true, value: { _id: "d", blueprintKey: "document", title: "Essay", accessLevel: "modify", ownership: "owned", content: { blocks } } });
    seams.readLive.mockResolvedValue(null);
    const result = (await readArtifact({ artifactId: "d" })) as unknown as { artifact: { content: { blocks: unknown[] }; currentVersionId?: unknown } };
    expect(result.artifact.content.blocks).toHaveLength(60);
    expect(JSON.stringify(result)).toContain("P59");
    expect(result.artifact).not.toHaveProperty("currentVersionId");
  });

  it("keeps a whole long code file and a sheet's cells past the 80th", async () => {
    const source = `export const x = 1;\n${"// line\n".repeat(1_500)}export const END = true;`;
    const cells = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`A${index + 1}`, { value: index }]));
    seams.readLive.mockResolvedValue(null);
    seams.readQuery.mockResolvedValue({ ok: true, value: { _id: "c", blueprintKey: "code", title: "App", accessLevel: "modify", ownership: "owned", content: { files: [{ path: "a.ts", content: source }] } } });
    expect(JSON.stringify(await readArtifact({ artifactId: "c" }))).toContain("END = true");
    seams.readQuery.mockResolvedValue({ ok: true, value: { _id: "s", blueprintKey: "spreadsheet", title: "Budget", accessLevel: "modify", ownership: "owned", content: { sheets: [{ id: "s1", name: "S", cells }] } } });
    const sheet = (await readArtifact({ artifactId: "s" })) as unknown as { artifact: { content: { sheets: Array<{ cells: Record<string, { value: number }> }> } } };
    expect(sheet.artifact.content.sheets[0]!.cells.A120).toEqual({ value: 119 });
  });

  it("labels every cut the generic bound still makes", async () => {
    const { boundedToolData } = await import("../tools/execution/tool-result");
    const bounded = boundedToolData({ list: Array.from({ length: 50 }, (_, index) => index), text: "z".repeat(5_000), gone: undefined }) as Record<string, unknown>;
    expect((bounded.list as unknown[]).at(-1)).toBe("[10 more items not shown]");
    expect(bounded.text).toContain("[1,000 more characters not shown]");
    expect(bounded).not.toHaveProperty("gone");
  });
});

describe("a document too large for one read can be navigated", () => {
  const blocks = Array.from({ length: 500 }, (_, index) => ({
    id: `blk-${index}`, type: index % 50 === 0 ? "heading" : "paragraph",
    ...(index % 50 === 0 ? { heading: `Section ${index / 50}` } : {}), text: `Para ${index} ${"w".repeat(280)}`,
  }));
  const essay = { _id: "big", blueprintKey: "document", title: "Thesis", content: { blocks } };

  it("lists the id of every block the read did not return", async () => {
    const { boundedArtifactRead } = await import("../ai/bounded-artifact-read");
    const read = boundedArtifactRead(essay) as unknown as {
      content: { blocks: Array<{ id: string }> }; blockOutline: Array<{ id: string }>;
      contentCoverage: { complete: boolean; totalBlocks: number; shownBlocks: number };
    };
    const seen = new Set([...read.content.blocks, ...read.blockOutline].map((block) => block.id));
    expect(seen.has("blk-499")).toBe(true);
    expect(seen.size).toBe(500);
    expect(read.contentCoverage).toMatchObject({ complete: false, totalBlocks: 500, shownBlocks: read.content.blocks.length });
    expect(new TextEncoder().encode(JSON.stringify(read)).byteLength).toBeLessThan(72 * 1024);
  });

  it("returns a requested long block instead of silently dropping it", async () => {
    const { boundedArtifactRead } = await import("../ai/bounded-artifact-read");
    const long = { id: "long", type: "paragraph", text: "L".repeat(5_000) };
    const read = boundedArtifactRead({ ...essay, content: { blocks: [...blocks, long] } }, { blockIds: ["long", "blk-420"] }) as unknown as {
      content: { blocks: Array<{ id: string }> };
    };
    expect(read.content.blocks.map((block) => block.id)).toEqual(["blk-420", "long"]);
  });
});

describe("a region the user picked as context reaches the model", () => {
  it("keeps the picked region's label, captured text and anchor in the orientation", () => {
    const target = { id: "region-7", label: "Paragraph 3", summary: "The treaty was signed in 1648.",
      anchor: { workId: "doc", kind: "block", path: ["blocks", "b3"] } };
    const orientation = buildAgentOrientation({ semanticTargets: [target] }, "Explain this part");
    expect(orientation.semanticTargets).toEqual([target]);
  });
});
