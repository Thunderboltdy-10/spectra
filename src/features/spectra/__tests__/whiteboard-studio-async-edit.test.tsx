// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhiteboardStudio } from "../components/whiteboard-studio";
import {
  StudioContractProvider,
  type StudioContract,
} from "../components/artifact-studio-shell";
import { normalizeWhiteboardContent, whiteboardNodeText } from "../whiteboard/model";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => ({})) }));
let finishUpload: ((value: { assetId: string }) => void) | undefined;
vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  getArtifactAssets: vi.fn(async () => ({ assets: [] })),
  uploadArtifactAsset: vi.fn(
    () =>
      new Promise<{ assetId: string }>((resolve) => {
        finishUpload = resolve;
      }),
  ),
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

const contract: StudioContract = {
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
};

function sticky(id: string, text: string, x: number) {
  return { id, type: "sticky", pageId: "page-1", layerId: "layer-1", x, y: 40, width: 200, height: 160, content: { text } };
}
const initialBoard = normalizeWhiteboardContent({
  pages: [{ id: "page-1", name: "Canvas" }],
  layers: [{ id: "layer-1", pageId: "page-1", name: "Layer 1", visible: true, locked: false }],
  nodes: [sticky("mine", "Mine", 40), sticky("theirs", "Theirs", 320)],
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
const nodeText = (content: unknown, id: string) =>
  whiteboardNodeText(normalizeWhiteboardContent(content).nodes.find((node) => node.id === id)!);

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

describe("whiteboard edits that finish after an upload", () => {
  it("keeps a collaborator's edit made while a pasted image uploads", async () => {
    const harness: Harness = { content: null, setContent: () => {} };
    render(<Host harness={harness} />);
    const canvas = document.querySelector(".whiteboard-canvas") as HTMLElement;
    const image = new File(["png"], "diagram.png", { type: "image/png" });
    fireEvent.paste(canvas, {
      clipboardData: { files: [image], getData: () => "", setData: () => undefined },
    });
    await waitFor(() => expect(finishUpload).toBeDefined());

    act(() => {
      const board = normalizeWhiteboardContent(harness.content);
      harness.setContent({
        ...board,
        nodes: board.nodes.map((node) =>
          node.id === "theirs" ? { ...node, content: { text: "Theirs, edited" } } : node,
        ),
      });
    });
    await act(async () => {
      finishUpload!({ assetId: "asset-1" });
    });

    await waitFor(() =>
      expect(normalizeWhiteboardContent(harness.content).nodes).toHaveLength(3),
    );
    expect(nodeText(harness.content, "theirs")).toBe("Theirs, edited");
  });
});
