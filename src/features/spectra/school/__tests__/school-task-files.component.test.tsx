// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  load: vi.fn(),
  handOff: vi.fn(),
  push: vi.fn(),
  open: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) => mocks.data[getFunctionName(reference)],
  useConvexAuth: () => ({ isAuthenticated: true }),
  useConvex: () => ({ query: async (reference: Parameters<typeof getFunctionName>[0]) => mocks.data[getFunctionName(reference)] }),
}));
vi.mock("../../data/use-authed-args", () => ({ useAuthedArgs: <T,>(args: T) => args }));
vi.mock("@/features/spectra/hooks/use-spectra-router", () => ({ useSpectraRouter: () => ({ push: mocks.push }) }));
vi.mock("../../workbench/library-handoff", () => ({ handOffToLibrary: mocks.handOff }));
vi.mock("../../files/office-preview-client", async (original) => ({
  ...(await original<typeof import("../../files/office-preview-client")>()),
  loadOfficePreview: mocks.load,
}));

import { SchoolTaskNotice } from "../school-task-details";

function file(providerFileId: string, filename: string, mimeType: string) {
  return { providerFileId, filename, mimeType, bytes: 4096, tooLarge: false, state: "cached", schoolFileId: `kept-${providerFileId}` };
}

beforeAll(async () => {
  await import("../../files/office-view");
}, 30_000);

beforeEach(() => {
  mocks.load.mockReset();
  mocks.handOff.mockReset();
  mocks.open.mockReset();
  vi.stubGlobal("open", mocks.open);
  mocks.data = {
    "school:taskOfWork": {
      title: "Enzymes lab",
      className: "Biology HL",
      past: false,
      dueAt: Date.now() + 86_400_000,
      taskType: null,
      status: null,
      term: null,
      provenanceUrl: null,
      brief: null,
      grade: null,
      resources: [],
      submission: {
        recordId: "submission-1",
        submittedAt: Date.now(),
        files: [
          file("f-deck", "Enzymes.pptx", "application/octet-stream"),
          file("f-old", "Notes.doc", "application/msword"),
          file("f-zip", "Data.zip", "application/zip"),
        ],
      },
    },
    "school:fileUrl": { url: "https://files.example/kept", filename: "Enzymes.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("A task's handed-in files", () => {
  it("open a PowerPoint deck inside Spectra, with Copy into Library still the next step", async () => {
    mocks.load.mockResolvedValue({
      kind: "slides",
      media: [],
      deck: { theme: { id: "native-pptx", name: "PowerPoint theme" }, settings: { aspectRatio: "16:9" }, slides: [{ id: "s1", title: "Catalase", objects: [] }] },
    });
    render(<SchoolTaskNotice artifactId="work-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Open Enzymes.pptx" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Enzymes.pptx")).toBeTruthy();
    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith({ kind: "slides", url: "https://files.example/kept", bytes: 4096 }, expect.any(AbortSignal)));
    // The dialog's body is rebuilt once the kept copy's address arrives.
    const ready = screen.getByRole("dialog");
    expect(await within(ready).findByRole("button", { name: "Slide 1: Catalase" })).toBeTruthy();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(within(ready).getByRole("button", { name: "Copy into Library" })).toBeTruthy();
    expect(within(ready).getByRole("link", { name: "Open in a new tab" }).getAttribute("href")).toBe("https://files.example/kept");
  });

  it("say plainly that an older Office file can't show, without a viewer", async () => {
    render(<SchoolTaskNotice artifactId="work-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Open Notes.doc" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Notes.doc is an older Office file.")).toBeTruthy();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Copy into Library" })).toBeTruthy();
  });

  it("send a file Spectra has no reader for to a new tab, as before", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    mocks.open.mockReturnValue(tab);
    render(<SchoolTaskNotice artifactId="work-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Open Data.zip" }));
    await waitFor(() => expect(tab.location.href).toBe("https://files.example/kept"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
