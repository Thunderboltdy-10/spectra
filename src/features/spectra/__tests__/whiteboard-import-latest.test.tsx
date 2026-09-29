// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhiteboardStudio } from "../components/whiteboard-studio";
import { StudioContractProvider, type StudioContract } from "../components/artifact-studio-shell";
import { normalizeWhiteboardContent, whiteboardNodeText } from "../whiteboard/model";

// A board import retains the original (upload) and converts it before it
// lands. It must land on the board as it is then: a collaborator's edit made
// during the upload is kept, not reverted to the board the import began from.

let finishUpload: () => void = () => {};

vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => ({})) }));
vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  getArtifactAssets: vi.fn(async () => ({ assets: [] })),
  beginArtifactImportOriginal: vi.fn(async () => ({ jobId: "job-1" })),
  uploadArtifactImportOriginal: vi.fn(() => new Promise<void>((resolve) => (finishUpload = resolve))),
  completeArtifactImport: vi.fn(async () => ({})),
}));
vi.mock("../components/artifact-studio-file-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/artifact-studio-file-utils")>()),
  artifactBlobSha256: vi.fn(async () => "0".repeat(64)),
}));
vi.mock("../settings/preference-store", () => ({
  useSpectraPreferences: () => ({
    preferences: { workbar: {}, writing: { smartCompletion: false } },
    hydrated: true,
    update: () => {},
    replace: () => {},
    reset: () => {},
  }),
}));

const contract = {
  artifactId: "board-1",
  type: "whiteboard",
  role: "edit",
  can: () => true,
  modes: [],
  readOnly: false,
  surface: "full",
  sync: { state: "saved", label: "Saved" },
  responsive: {
    minInlineSize: 320,
    preferredInlineSize: 960,
    supportsPanel: true,
    supportsTile: true,
    supportsCompact: true,
    toolbarPriorities: [],
    canvasExtent: "infinite",
  },
  density: "comfortable",
  compatibilityProfile: "spectra-native",
  fidelity: { artifact: "NATIVE" },
  inspector: { open: null, show: () => {}, hide: () => {} },
} as unknown as StudioContract;

const sticky = (id: string, text: string, x: number) => ({
  id,
  type: "sticky",
  pageId: "page-1",
  layerId: "layer-1",
  x,
  y: 40,
  width: 200,
  height: 160,
  content: { text },
});
const initialBoard = normalizeWhiteboardContent({
  pages: [{ id: "page-1", name: "Canvas" }],
  layers: [{ id: "layer-1", pageId: "page-1", name: "Layer 1", visible: true, locked: false }],
  nodes: [sticky("theirs", "Theirs", 320)],
  edges: [],
});

type Harness = { content: unknown; setContent: (next: unknown) => void };
function Host({ harness }: { harness: Harness }) {
  const [content, setContent] = useState<unknown>(initialBoard);
  harness.content = content;
  harness.setContent = setContent;
  return (
    <StudioContractProvider value={contract}>
      <WhiteboardStudio artifactId="board-1" artifacts={[]} content={content} onChange={setContent} readOnly={false} />
    </StudioContractProvider>
  );
}

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("whiteboard import", () => {
  it("keeps a collaborator's edit and new sticky made while the original uploaded", async () => {
    const harness: Harness = { content: null, setContent: () => {} };
    const { container } = render(<Host harness={harness} />);
    const input = container.querySelector('input[type="file"][accept*=".csv"]') as HTMLInputElement;
    const file = new File(["Imported idea\n"], "ideas.csv", { type: "text/csv" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      fireEvent.change(input);
    });

    // While the original uploads, a collaborator edits their sticky.
    act(() => {
      const board = normalizeWhiteboardContent(harness.content);
      harness.setContent({
        ...board,
        nodes: [
          ...board.nodes.map((node) => (node.id === "theirs" ? { ...node, content: { text: "Theirs, edited" } } : node)),
          sticky("peer-new", "Peer's new sticky", 640),
        ],
      });
    });

    await act(async () => {
      finishUpload();
    });

    const board = normalizeWhiteboardContent(harness.content);
    expect(whiteboardNodeText(board.nodes.find((node) => node.id === "theirs")!)).toBe("Theirs, edited");
    expect(board.nodes.some((node) => node.id === "peer-new")).toBe(true);
    expect(board.nodes.some((node) => whiteboardNodeText(node) === "Imported idea")).toBe(true);
  });
});
