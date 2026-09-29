// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhiteboardStudio } from "../components/whiteboard-studio";
import {
  StudioContractProvider,
  type StudioContract,
} from "../components/artifact-studio-shell";
import { normalizeWhiteboardContent, whiteboardNodeText } from "../whiteboard/model";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => ({})) }));
vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  getArtifactAssets: vi.fn(async () => ({ assets: [] })),
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

function clipboardData(initial = "") {
  const store = new Map<string, string>([["text/plain", initial]]);
  return {
    files: [] as File[],
    getData: (type: string) => store.get(type) ?? "",
    setData: (type: string, value: string) => void store.set(type, value),
    store,
  };
}

const canvas = () => document.querySelector(".whiteboard-canvas") as HTMLElement;
const texts = (content: unknown) =>
  normalizeWhiteboardContent(content).nodes.map((node) => whiteboardNodeText(node));

describe("whiteboard clipboard", () => {
  it("copies selected objects as text and pastes them back as objects", () => {
    const harness: Harness = { content: null, setContent: () => {} };
    render(<Host harness={harness} />);
    fireEvent.keyDown(canvas(), { key: "a", ctrlKey: true });
    const copied = clipboardData();
    fireEvent.copy(canvas(), { clipboardData: copied });
    expect(copied.store.get("text/plain")).toBe("Mine\nTheirs");

    fireEvent.paste(canvas(), { clipboardData: clipboardData("Mine\r\nTheirs") });
    expect(texts(harness.content)).toEqual(["Mine", "Theirs", "Mine", "Theirs"]);
  });

  it("pastes text copied elsewhere as a new object", () => {
    const harness: Harness = { content: null, setContent: () => {} };
    render(<Host harness={harness} />);
    fireEvent.paste(canvas(), { clipboardData: clipboardData("Photosynthesis") });
    const board = normalizeWhiteboardContent(harness.content);
    expect(board.nodes).toHaveLength(3);
    expect(whiteboardNodeText(board.nodes[2]!)).toBe("Photosynthesis");
  });
});
