// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("whiteboard undo with collaborators", () => {
  it("undoes this student's sticky edit and keeps a collaborator's later edit", async () => {
    const harness: Harness = { content: null, setContent: () => {} };
    render(<Host harness={harness} />);
    const mine = screen.getAllByRole("textbox").find((element) => (element as HTMLTextAreaElement).value === "Mine")!;
    fireEvent.doubleClick(mine);
    fireEvent.change(mine, { target: { value: "Mine, edited" } });
    expect(nodeText(harness.content, "mine")).toBe("Mine, edited");
    act(() => {
      const board = normalizeWhiteboardContent(harness.content);
      harness.setContent({
        ...board,
        nodes: board.nodes.map((node) => (node.id === "theirs" ? { ...node, content: { text: "Theirs, edited" } } : node)),
      });
    });
    const canvas = document.querySelector(".whiteboard-canvas") as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    });
    expect(nodeText(harness.content, "mine")).toBe("Mine");
    expect(nodeText(harness.content, "theirs")).toBe("Theirs, edited");
  });

  it("undoes a drag without reverting a collaborator's edit made during it", async () => {
    const harness: Harness = { content: null, setContent: () => {} };
    render(<Host harness={harness} />);
    Element.prototype.setPointerCapture ??= () => {};
    const mine = screen.getAllByRole("textbox").find((element) => (element as HTMLTextAreaElement).value === "Mine")!;
    const node = mine.closest(".whiteboard-node") as HTMLElement;
    const canvas = document.querySelector(".whiteboard-canvas") as HTMLElement;
    const nodeX = (id: string) =>
      normalizeWhiteboardContent(harness.content).nodes.find((item) => item.id === id)!.x;
    fireEvent.pointerDown(node, { pointerId: 7, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 160, clientY: 100 });
    act(() => {
      const board = normalizeWhiteboardContent(harness.content);
      harness.setContent({
        ...board,
        nodes: board.nodes.map((item) => (item.id === "theirs" ? { ...item, content: { text: "Theirs, edited" } } : item)),
      });
    });
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 220, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 7, clientX: 220, clientY: 100 });
    expect(nodeX("mine")).not.toBe(40);
    await act(async () => {
      fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    });
    expect(nodeX("mine")).toBe(40);
    expect(nodeText(harness.content, "theirs")).toBe("Theirs, edited");
  });

  it("undoes a sticky typing session as one step", async () => {
    const harness: Harness = { content: null, setContent: () => {} };
    render(<Host harness={harness} />);
    const mine = screen.getAllByRole("textbox").find((element) => (element as HTMLTextAreaElement).value === "Mine")!;
    fireEvent.doubleClick(mine);
    fireEvent.focus(mine);
    for (const value of ["Mine!", "Mine!!", "Mine!!!"]) fireEvent.change(mine, { target: { value } });
    fireEvent.blur(mine);
    expect(nodeText(harness.content, "mine")).toBe("Mine!!!");
    const canvas = document.querySelector(".whiteboard-canvas") as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    });
    expect(nodeText(harness.content, "mine")).toBe("Mine");
  });
});
