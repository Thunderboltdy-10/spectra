import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateArtifactResources } from "@/lib/artifacts";

const { convexMutation } = vi.hoisted(() => ({
  convexMutation: vi.fn(),
}));

vi.mock("@/lib/convex-server", () => ({
  convexMutation,
}));

class ParagraphMock {
  constructor() {}
}

class TextRunMock {
  constructor() {}
}

class DocumentMock {
  constructor() {}
}

const PackerMock = {
  toBuffer: vi.fn(async () => Buffer.from("docx")),
};

vi.mock("docx", () => ({
  Document: DocumentMock,
  HeadingLevel: {
    TITLE: "TITLE",
    HEADING_1: "HEADING_1",
    HEADING_2: "HEADING_2",
    HEADING_3: "HEADING_3",
  },
  Packer: PackerMock,
  Paragraph: ParagraphMock,
  TextRun: TextRunMock,
}));

class SlideMock {
  background?: unknown;
  addShape = vi.fn();
  addText = vi.fn();
  addNotes = vi.fn();
}

class PptxGenJSMock {
  layout = "";
  author = "";
  subject = "";
  title = "";
  ShapeType = { rect: "rect" };
  addSlide() {
    return new SlideMock();
  }
  async write() {
    return new Uint8Array([1, 2, 3]).buffer;
  }
}

vi.mock("pptxgenjs", () => ({
  default: PptxGenJSMock,
}));

class JsPdfMock {
  internal = {
    pageSize: {
      getWidth: () => 612,
      getHeight: () => 792,
    },
  };
  setFont = vi.fn();
  setFontSize = vi.fn();
  splitTextToSize(value: string) {
    return [value];
  }
  text = vi.fn();
  addPage = vi.fn();
  output() {
    return new Uint8Array([9, 9, 9]).buffer;
  }
}

vi.mock("jspdf", () => ({
  jsPDF: JsPdfMock,
}));

describe("generateArtifactResources", () => {
  beforeEach(() => {
    let resourceIndex = 0;
    convexMutation.mockReset();
    convexMutation.mockImplementation(async (name: string) => {
      if (name === "resources:createUploadUrl") {
        return "https://upload.local/resource";
      }
      if (name === "resources:registerResource") {
        resourceIndex += 1;
        return { resourceId: `resource_${resourceIndex}` };
      }
      if (name === "resources:finalizeGeneratedResource") {
        return { ok: true };
      }
      throw new Error(`Unexpected mutation ${name}`);
    });
    vi.stubGlobal("fetch", vi.fn(async () => (
      new Response(JSON.stringify({ storageId: "storage_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )));
  });

  it("returns empty results when no document block exists", async () => {
    const result = await generateArtifactResources({
      actorClerkId: "user_123",
      content: "Just a normal answer.",
    });

    expect(result.attachments).toEqual([]);
    expect(result.attachmentResourceIds).toEqual([]);
    expect(result.markdownBlock).toBe("");
    expect(convexMutation).not.toHaveBeenCalled();
  });

  it("defaults study-guide artifacts to a single docx file", async () => {
    const result = await generateArtifactResources({
      actorClerkId: "user_123",
      content: `
Here is your study guide.

<<DOCUMENT_START>>
{"type":"study_guide","title":"Cell Respiration","summary":"Core review","sections":[{"heading":"Overview","content":"Cell respiration converts glucose into ATP."}]}
<<DOCUMENT_END>>
`,
    });

    expect(result.attachments).toEqual(["Cell Respiration.docx"]);
    expect(result.attachmentResourceIds).toEqual(["resource_1"]);
    expect(result.markdownBlock).toContain("[Cell Respiration.docx](/api/resources/resource_1/download)");
  });

  it("creates only the explicitly requested formats", async () => {
    const result = await generateArtifactResources({
      actorClerkId: "user_123",
      requestedFormats: ["docx", "pdf"],
      content: `
Here is your study guide.

<<DOCUMENT_START>>
{"type":"study_guide","title":"Cell Respiration","summary":"Core review","sections":[{"heading":"Overview","content":"Cell respiration converts glucose into ATP."}]}
<<DOCUMENT_END>>
`,
    });

    expect(result.attachments).toEqual([
      "Cell Respiration.docx",
      "Cell Respiration.pdf",
    ]);
    expect(result.attachmentResourceIds).toEqual([
      "resource_1",
      "resource_2",
    ]);
    expect(convexMutation).toHaveBeenCalledWith(
      "resources:finalizeGeneratedResource",
      expect.objectContaining({ resourceId: "resource_2" }),
    );
  });
});
