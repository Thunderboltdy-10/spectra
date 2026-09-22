import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Document } from "@ariadng/office/docx";
import { docxLens } from "@/features/spectra/lenses/docx-lens";

const convexMutation = vi.fn();
const convexQuery = vi.fn();
const fetchVerifiedNativePayload = vi.fn();
const fetchStoredNativeBase = vi.fn();
const uploadNativePayload = vi.fn();

vi.mock("@/lib/convex-server", () => ({
  convexMutation,
  convexQuery,
  hydrateContentForWrite: async (_artifactId:string,content:unknown)=>content,
}));
vi.mock("@/features/spectra/lenses/native-payload-server", () => ({
  fetchVerifiedNativePayload,
  fetchStoredNativeBase,
  uploadNativePayload,
  ensureImportedNativePayload: async ()=>undefined,
}));

const artifactId = "artifact-route-docx";
const assetId = "asset-route-image";
const imageBytes = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
const imageHash = createHash("sha256").update(imageBytes).digest("hex");

let sourcePayload: Uint8Array;
let storedPayload: Uint8Array | undefined;

async function routePost(content: unknown) {
  const { POST } = await import("./route");
  return POST(
    new NextRequest("http://localhost/api/spectra/lenses/docx", {
      method: "POST",
      body: JSON.stringify({ action: "materialize", artifactId, content }),
    }),
  );
}

async function baseProjection() {
  const opened = await docxLens.open(sourcePayload, "strict-native");
  return { opened, block: opened.projection.blocks.find((entry) => entry.type === "paragraph")! };
}

describe("DOCX materialization route", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    storedPayload = undefined;
    const sourceDocument = Document.create();
    sourceDocument.addParagraph("Route paragraph");
    sourcePayload = await sourceDocument.save();
    const sourceHash = createHash("sha256").update(sourcePayload).digest("hex");
    const truth = {
      hash: sourceHash,
      revision: "route-revision-1",
      nativeFormat: "docx",
      payloadRef: "cloud-route-ref",
    };
    fetchVerifiedNativePayload.mockResolvedValue({ truth, payload: sourcePayload });
    convexQuery.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "replicas:forWork")
        return {
          replicas: [
            {
              _id: "local-route-replica",
              kind: "local",
              revision: truth.revision,
              state: "ready",
              payloadRef: "local-route-ref",
            },
          ],
        };
      if (name === "spectraArtifacts:get")
        return { title: "Physics copy", currentVersionId: "saved-v2", content: { blocks: [] } };
      if (name === "artifactAssets:getContent")
        return {
          assetId: args.assetId,
          url: "https://storage.test/route-image.png",
          mediaType: "image/png",
          name: "route-image.png",
          bytes: imageBytes.byteLength,
          sha256: imageHash,
        };
      throw new Error(`Unexpected route query: ${name}`);
    });
    convexMutation.mockResolvedValue({ requestId: "route-request-1", state: "pending" });
    uploadNativePayload.mockImplementation(async (_workId: string, bytes: Uint8Array) => {
      storedPayload = bytes;
      return { payloadRef: "stored-route-ref" };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe("https://storage.test/route-image.png");
        return new Response(imageBytes, { status: 200, headers: { "Content-Type": "image/png" } });
      }),
    );
  });

  it("downloads the saved native revision as a copy without queueing a linked write", async () => {
    const { opened, block } = await baseProjection();
    const savedText = "Saved route paragraph";
    const savedContent = {
      blocks: opened.projection.blocks.map((entry) =>
        entry.id === block.id ? { ...entry, text: savedText, inlineContent: [{ kind: "text", text: savedText }] } : entry,
      ),
      nativeProjectionComplete: true as const,
    };
    const originalQuery = convexQuery.getMockImplementation()!;
    convexQuery.mockImplementation((name: string, args: Record<string, unknown>) =>
      name === "spectraArtifacts:get"
        ? { title: "Physics copy.docx", currentVersionId: "saved-v2", content: savedContent }
        : originalQuery(name, args),
    );
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/spectra/lenses/docx", {
      method: "POST",
      body: JSON.stringify({ action: "download-copy", artifactId }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("Physics%20copy.docx");
    expect(response.headers.get("x-spectra-saved-version")).toBe("saved-v2");
    const output = new Uint8Array(await response.arrayBuffer());
    expect((await docxLens.open(output, "strict-native")).projection.blocks.some((entry) => entry.text === savedText)).toBe(true);
    expect(convexMutation).not.toHaveBeenCalled();
    expect(uploadNativePayload).not.toHaveBeenCalled();
  });

  it("returns an explicit failure instead of downloading an old or missing native base", async () => {
    fetchVerifiedNativePayload.mockRejectedValue(new Error("NATIVE_PAYLOAD_UNAVAILABLE"));
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/spectra/lenses/docx", {
      method: "POST",
      body: JSON.stringify({ action: "download-copy", artifactId }),
    }));
    expect(response.ok).toBe(false);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect((await response.json()).error).toBeTruthy();
    expect(convexMutation).not.toHaveBeenCalled();
  });

  it("materializes a formatting edit and verifies semantic readback", async () => {
    const { opened, block } = await baseProjection();
    const content = {
      blocks: opened.projection.blocks.map((entry) =>
        entry.id === block.id
          ? {
              ...entry,
              inlineContent: [{ kind: "text" as const, text: entry.text, format: { bold: true } }],
            }
          : entry,
      ),
      nativeProjectionComplete: true as const,
    };
    const response = await routePost(content);
    if (response.status !== 200) console.log("format", await response.clone().text());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.receipt.semantic.resultDigest).toBe(result.receipt.semantic.readbackDigest);
    const reopened = await docxLens.open(storedPayload!);
    expect(reopened.projection.blocks.find((entry) => entry.id === block.id)?.inlineContent?.[0]).toMatchObject({
      kind: "text",
      text: "Route paragraph",
      format: { bold: true },
    });
  });

  it("materializes durable image bytes through the route and keeps the image native", async () => {
    const { opened, block } = await baseProjection();
    const content = {
      blocks: opened.projection.blocks.map((entry) =>
        entry.id === block.id
          ? {
              ...entry,
              text: `${entry.text}Route diagram`,
              inlineContent: [
                { kind: "text" as const, text: entry.text },
                {
                  kind: "image" as const,
                  assetId,
                  mediaType: "image/png" as const,
                  altText: "Route diagram",
                  widthEmu: 9_525,
                  heightEmu: 9_525,
                  placement: "inline" as const,
                },
              ],
            }
          : entry,
      ),
      nativeProjectionComplete: true as const,
    };
    const response = await routePost(content);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.receipt.targets.regionIds).toContain(block.id);
    expect(result.receipt.semantic.resultDigest).toBe(result.receipt.semantic.readbackDigest);
    expect(convexQuery).toHaveBeenCalledWith("artifactAssets:getContent", { assetId });
    const document = await Document.open(storedPayload!);
    expect(await document.images()[0]!.data()).toEqual(imageBytes);
    const reopened = await docxLens.open(storedPayload!);
    expect(reopened.projection.blocks.flatMap((entry) => entry.inlineContent ?? [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "image", altText: "Route diagram", mediaType: "image/png" }),
      ]),
    );
  });

  it("materializes a supported equation insertion through the actual DOCX route", async () => {
    const { opened } = await baseProjection();
    const latex = String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}`;
    const content = {
      blocks: [
        ...opened.projection.blocks,
        {
          id: "docx:paragraph:deadbeef",
          type: "equation" as const,
          text: latex,
          latex,
          inlineContent: [{ kind: "equation" as const, latex, display: "block" as const }],
          attrs: { display: "block" as const, alignment: "center" as const },
        },
      ],
      nativeProjectionComplete: true as const,
    };
    const response = await routePost(content);
    if (response.status !== 200) console.log("equation", await response.clone().text());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.receipt.semantic.resultDigest).toBe(result.receipt.semantic.readbackDigest);
    const reopened = await docxLens.open(storedPayload!);
    expect(reopened.projection.blocks.at(-1)).toMatchObject({
      type: "equation",
      attrs: { display: "block", alignment: "center" },
    });
    expect(reopened.projection.blocks.at(-1)?.inlineContent?.[0]).toMatchObject({
      kind: "equation",
      display: "block",
    });
    const equation = reopened.projection.blocks.at(-1)?.inlineContent?.[0];
    if (equation?.kind !== "equation") throw new Error("route equation was not projected");
    expect(equation.ommlXml).toContain("oMathPara");
  });

  it("materializes margins and section header/footer text with semantic readback", async () => {
    const { opened } = await baseProjection();
    const content = {
      blocks: opened.projection.blocks,
      pageSetup: {
        ...(opened.projection.pageSetup ?? {}),
        margins: "narrow",
        header: "Route header",
        footer: "Route footer",
      },
      nativeProjectionComplete: true as const,
    };
    const response = await routePost(content);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.receipt.semantic.resultDigest).toBe(result.receipt.semantic.readbackDigest);
    const reopened = await docxLens.open(storedPayload!);
    expect(reopened.projection.pageSetup).toMatchObject({
      margins: "narrow",
      header: "Route header",
      footer: "Route footer",
    });
  });

  it("soft-opens without a retained native payload (Library import, no Bridge)", async () => {
    fetchVerifiedNativePayload.mockRejectedValue(new Error("NATIVE_PAYLOAD_UNAVAILABLE"));
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/spectra/lenses/docx", {
        method: "POST",
        body: JSON.stringify({ action: "open", artifactId }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      state: "opened",
      deferredNative: true,
    });
  });

  it("defers materialize without toasting when native payload is unavailable", async () => {
    fetchVerifiedNativePayload.mockRejectedValue(new Error("NATIVE_PAYLOAD_UNAVAILABLE"));
    const response = await routePost({ blocks: [] });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.state).toBe("deferred_native");
    expect(result.status).toMatch(/Spectra saved your edit/i);
    expect(uploadNativePayload).not.toHaveBeenCalled();
  });
});
