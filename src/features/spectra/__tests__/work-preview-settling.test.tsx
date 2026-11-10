// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../data/api", () => ({ getSpectraArtifact: api.read, getSpectraThreadMessages: vi.fn() }));
vi.mock("../files/office-preview-client", () => ({ readOfficeBytes: vi.fn() }));

import { useWorkPreview, useWorkPreviews, type PreviewSource } from "../artifacts/use-work-previews";
import { publishArtifactAiActivity } from "../collaboration/artifact-ai-activity";
import { readOfficeBytes } from "../files/office-preview-client";
import { richContentAst } from "../rich-content/ast";

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
  api.read.mockReset().mockResolvedValue({ artifact: { content: { blocks: [{ type: "paragraph", text: "Original notes" }] } } });
});

describe.each([false, true])("Word file face with legacy cache %s", (cached) => {
  it("reads semantic words from structured blocks and replaces old serialized faces", async () => {
    const work: PreviewSource = { _id: `word-face-${cached}`, blueprintKey: "resource", title: "Notes.docx", updatedAt: 1 };
    const fetchFile = vi.fn(async () => new Response(new Uint8Array([1])));
    vi.stubGlobal("fetch", fetchFile);
    const oldUrl = `/__work-face/${work._id}`;
    const put = vi.fn();
    vi.stubGlobal("caches", { open: async () => ({
      match: async (url: string) => cached && url === oldUrl ? Response.json({ updatedAt: 1, preview: { kind: "text", lines: ['{"type":"paragraph"}'] } }) : undefined,
      put, keys: async () => [],
    }) });
    vi.mocked(readOfficeBytes).mockResolvedValue({ kind: "document", ast: richContentAst([
      { type: "heading", level: 1, content: [{ type: "text", text: "Title #1" }] },
      { type: "paragraph", content: [{ type: "text", text: "Keep x_2 and y* literal", marks: ["bold"] }] },
      { type: "list", kind: "bullet", items: [{ blocks: richContentAst([{ type: "paragraph", content: [{ type: "text", text: "Second item" }] }]).blocks }] },
    ]), media: [], comments: [], unshown: [] });
    const hook = renderHook(() => useWorkPreview(work, { current: document.createElement("div") }));
    await waitFor(() => expect(hook.result.current).toEqual({ kind: "text", heading: "Title #1", lines: ["Keep x_2 and y* literal", "Second item"] }));
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    hook.rerender();
    expect(fetchFile).toHaveBeenCalledTimes(1);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe.each(["single", "list"] as const)("%s card previews", (kind) => {
  it("keeps the finished face through repeated AI edits and reads the result once", async () => {
    const work: PreviewSource = { _id: `settling-${kind}`, blueprintKey: "document", updatedAt: 1 };
    const target = { current: document.createElement("div") };
    const hook = renderHook(({ version }) => {
      const item = { ...work, updatedAt: version };
      // Each parameter exercises the public hook used by its actual card surface.
      return kind === "single" ? useWorkPreview(item, target) : useWorkPreviews([item])(item);
    }, { initialProps: { version: 1 } });
    await waitFor(() => expect(hook.result.current).toMatchObject({ kind: "text", lines: ["Original notes"] }));
    const original = hook.result.current;
    act(() => publishArtifactAiActivity(work._id, "test-run", { phase: "editing" }));
    hook.rerender({ version: 2 });
    hook.rerender({ version: 3 });
    hook.rerender({ version: 4 });
    expect(hook.result.current).toBe(original);
    expect(api.read).toHaveBeenCalledTimes(1);
    api.read.mockResolvedValue({ artifact: { content: { blocks: [{ type: "paragraph", text: "Finished revision notes" }] } } });
    act(() => publishArtifactAiActivity(work._id, "test-run", null));
    await waitFor(() => expect(hook.result.current).toMatchObject({ kind: "text", lines: ["Finished revision notes"] }));
    expect(api.read).toHaveBeenCalledTimes(2);
  });
});
