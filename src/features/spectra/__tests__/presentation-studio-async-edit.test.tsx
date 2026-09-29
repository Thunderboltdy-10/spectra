// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationStudio } from "../components/presentation-studio";
import {
  StudioContractProvider,
  type StudioContract,
} from "../components/artifact-studio-shell";
import { normalizePresentationContent } from "../presentation/model";

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
  artifactId: "deck-1",
  type: "presentation",
  role: "edit",
  can: () => true,
  modes: [{ id: "slides", label: "Slides" } as never],
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

function textObject(id: string, text: string) {
  return { id, type: "text", x: 80, y: 80, width: 600, height: 120, content: { text } };
}
const initialDeck = normalizePresentationContent({
  slides: [
    { id: "slide-1", title: "One", objects: [textObject("text-1", "Hello")] },
    { id: "slide-2", title: "Two", objects: [textObject("text-2", "Second")] },
  ],
});

type Harness = { content: unknown; setContent: (next: unknown) => void; changes: number };
function Host({ harness }: { harness: Harness }) {
  const [content, setContent] = useState<unknown>(initialDeck);
  harness.content = content;
  harness.setContent = setContent;
  return (
    <StudioContractProvider value={contract}>
      <PresentationStudio
        artifactId="deck-1"
        artifacts={[]}
        content={content}
        onChange={(next) => {
          harness.changes += 1;
          setContent(next);
        }}
        readOnly={false}
        synchronizationReady
      />
    </StudioContractProvider>
  );
}

function slideText(content: unknown, slide: number) {
  const deck = normalizePresentationContent(content);
  return (deck.slides[slide]!.objects[0]!.content as { text: string }).text;
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

describe("presentation edits that finish after an upload", () => {
  it("keeps a collaborator's edit made while a picture uploads", async () => {
    const harness: Harness = { content: null, setContent: () => {}, changes: 0 };
    render(<Host harness={harness} />);
    const input = document.querySelector('input[type="file"][accept*="video/mp4"]') as HTMLInputElement;
    const picture = new File(["png"], "diagram.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [picture] } });
    await waitFor(() => expect(finishUpload).toBeDefined());

    act(() => {
      const deck = normalizePresentationContent(harness.content);
      harness.setContent({
        ...deck,
        slides: deck.slides.map((slide) =>
          slide.id === "slide-2"
            ? { ...slide, objects: [textObject("text-2", "Second, by a peer")] }
            : slide,
        ),
      });
    });
    await act(async () => {
      finishUpload!({ assetId: "asset-1" });
    });

    await waitFor(() =>
      expect(normalizePresentationContent(harness.content).slides[0]!.objects).toHaveLength(2),
    );
    expect(slideText(harness.content, 1)).toBe("Second, by a peer");
  });
});
