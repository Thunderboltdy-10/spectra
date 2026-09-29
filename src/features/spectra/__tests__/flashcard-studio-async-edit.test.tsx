// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashcardStudio } from "../components/flashcard-studio";
import {
  StudioContractProvider,
  type StudioContract,
} from "../components/artifact-studio-shell";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => ({})), useQuery: () => undefined }));
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
  type: "flashcard_deck",
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

type Card = { id: string; front: string; back: string; media?: { assetId: string } };
const card = (id: string, front: string) => ({ id, front, back: "Answer" });
const initialDeck = { cards: [card("c1", "One"), card("c2", "Two")] };

type Harness = { content: { cards: Card[] }; setContent: (next: unknown) => void };
function Host({ harness }: { harness: Harness }) {
  const [content, setContent] = useState<unknown>(initialDeck);
  harness.content = content as Harness["content"];
  harness.setContent = setContent;
  return (
    <StudioContractProvider value={contract}>
      <FlashcardStudio artifactId="deck-1" mode="tab" content={content} onChange={setContent} />
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

describe("flashcard edits that finish after an upload", () => {
  it("keeps a collaborator's edit made while a card image uploads", async () => {
    const harness = { setContent: () => {} } as unknown as Harness;
    render(<Host harness={harness} />);
    const input = document.querySelector('input[type="file"][accept="image/png,image/jpeg,image/webp,image/gif"]') as HTMLInputElement;
    const image = new File(["png"], "cell.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [image] } });
    await waitFor(() => expect(finishUpload).toBeDefined());

    act(() => {
      harness.setContent({
        ...harness.content,
        cards: harness.content.cards.map((item) =>
          item.id === "c2" ? { ...item, front: "Two, by a peer" } : item,
        ),
      });
    });
    await act(async () => {
      finishUpload!({ assetId: "asset-1" });
    });

    await waitFor(() => expect(harness.content.cards[0]!.media?.assetId).toBe("asset-1"));
    expect(harness.content.cards[1]!.front).toBe("Two, by a peer");
  });
});
