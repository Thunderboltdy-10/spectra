// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSpectraContext } from "../hooks/use-spectra-context";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import type { SpectraArtifact } from "../data/api";

vi.mock("../data/api", () => ({
  getSpectraThreads: vi.fn(async () => ({ threads: [{ _id: "thread-1", title: "Biology chat" }] })),
  getSpectraThread: vi.fn(async () => ({ thread: { _id: "thread-1", title: "Biology chat" } })),
  postSpectra: vi.fn(async () => ({})),
}));
vi.mock("sonner", () => ({ toast: { message: vi.fn() } }));

afterEach(() => {
  cleanup();
  useSpectraContextStore.setState({ continuation: null, visible: [], selectionDraft: [] });
});

describe("what is open, for the run", () => {
  it("names open work by id, its type and title, and leaves out the conversation the message continues", async () => {
    const artifacts = [{ _id: "doc-1", title: "Cell notes", blueprintKey: "document" }] as unknown as SpectraArtifact[];
    const workspaces: never[] = [];
    const { result } = renderHook(() => useSpectraContext(artifacts, workspaces));
    await act(async () => {
      useSpectraContextStore.getState().setContinuation({ id: "thread-1", title: "Biology chat" });
      result.current.setVisibleObjects([
        { type: "artifact", id: "doc-1", label: "Cell notes", source: "visible" },
        { type: "artifact", id: "doc-1", label: "Cell notes", source: "visible" },
        { type: "workspace", id: "ws-1", label: "Biology", source: "visible" },
        { type: "thread", id: "thread-1", label: "Biology chat", source: "visible" },
      ]);
    });
    expect(result.current.open).toEqual([
      { id: "doc-1", type: "document", title: "Cell notes" },
      { id: "ws-1", type: "workspace", title: "Biology" },
    ]);
    expect(result.current).not.toHaveProperty("explicitContextObjects");
  });
});
