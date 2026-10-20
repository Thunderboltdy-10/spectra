// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuizStudio } from "../components/quiz-studio";
import { FlashcardStudio } from "../components/flashcard-studio";
import {
  StudioContractProvider,
  type StudioContract,
} from "../components/artifact-studio-shell";
import { revokeArtifactAsset } from "../data/api";

// An in-editor delete must leave the asset alive: the item can come back
// through undo or a History restore, and every retained version still
// references it. Assets are released with the artifact (artifact deletion
// purge), or by the code studio's explicit "Revoke everywhere".
vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => ({})), useQuery: () => undefined }));
vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  getArtifactAssets: vi.fn(async () => ({
    assets: [
      { assetId: "asset-1", status: "active", downloadUrl: "https://files.test/asset-1.png" },
      { assetId: "asset-2", status: "active", downloadUrl: "https://files.test/asset-2.png" },
    ],
  })),
  uploadArtifactAsset: vi.fn(async () => ({ assetId: "asset-2" })),
  revokeArtifactAsset: vi.fn(async () => ({ ok: true, revoked: true })),
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

function contract(type: string, artifactId: string): StudioContract {
  return {
    artifactId,
    type,
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
  } as StudioContract;
}

const media = { assetId: "asset-1", name: "cell.png", mediaType: "image/png", altText: "" };
const initialQuiz = {
  questions: [
    { id: "q1", type: "multiple_choice", prompt: "One", options: ["A", "B"], answer: "A", media },
    { id: "q2", type: "multiple_choice", prompt: "Two", options: ["A", "B"], answer: "A" },
  ],
};
const initialDeck = {
  cards: [
    { id: "c1", front: "One", back: "Answer", media: { ...media, placement: "front" } },
    { id: "c2", front: "Two", back: "Answer" },
  ],
};

type Harness = { content: unknown; setContent: (next: unknown) => void };
function Host({ harness, kind }: { harness: Harness; kind: "quiz" | "deck" }) {
  const [content, setContent] = useState<unknown>(kind === "quiz" ? initialQuiz : initialDeck);
  harness.content = content;
  harness.setContent = setContent;
  return kind === "quiz" ? (
    <StudioContractProvider value={contract("quiz", "quiz-1")}>
      <QuizStudio artifactId="quiz-1" mode="tab" content={content} onChange={setContent} />
    </StudioContractProvider>
  ) : (
    <StudioContractProvider value={contract("flashcard_deck", "deck-1")}>
      <FlashcardStudio artifactId="deck-1" mode="tab" content={content} onChange={setContent} />
    </StudioContractProvider>
  );
}

function renderStudio(kind: "quiz" | "deck") {
  const harness = { content: undefined, setContent: () => {} } as Harness;
  render(<Host harness={harness} kind={kind} />);
  return harness;
}

const imageShown = (src: string) =>
  [...document.querySelectorAll("img")].some((image) => image.getAttribute("src") === src);

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.mocked(revokeArtifactAsset).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function undoTo(harness: Harness, value: unknown) {
  await act(async () => {
    harness.setContent(value);
  });
}

describe("quiz media survives an in-editor delete", () => {
  it("keeps a deleted question's image for undo", async () => {
    const harness = renderStudio("quiz");
    await waitFor(() => expect(imageShown("https://files.test/asset-1.png")).toBe(true));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Remove question" })[0]!);
    });
    await undoTo(harness, initialQuiz);
    const rail = screen.getByRole("complementary", { name: "Questions" });
    await act(async () => {
      fireEvent.click(within(rail).getAllByText("One")[0]!);
    });
    expect(revokeArtifactAsset).not.toHaveBeenCalled();
    await waitFor(() => expect(imageShown("https://files.test/asset-1.png")).toBe(true));
  });

  it("keeps a removed image for undo", async () => {
    const harness = renderStudio("quiz");
    await waitFor(() => expect(imageShown("https://files.test/asset-1.png")).toBe(true));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove image/ }));
    });
    await undoTo(harness, initialQuiz);
    expect(revokeArtifactAsset).not.toHaveBeenCalled();
    await waitFor(() => expect(imageShown("https://files.test/asset-1.png")).toBe(true));
  });

  it("keeps a replaced image for undo", async () => {
    const harness = renderStudio("quiz");
    await waitFor(() => expect(imageShown("https://files.test/asset-1.png")).toBe(true));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Remove image/ }));
    });
    const input = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["png"], "b.png", { type: "image/png" })] } });
    });
    await waitFor(() =>
      expect((harness.content as typeof initialQuiz).questions[0]!.media?.assetId).toBe("asset-2"),
    );
    expect(revokeArtifactAsset).not.toHaveBeenCalled();
  });
});

describe("flashcard media survives an in-editor delete", () => {
  it("keeps a deleted card's image for undo", async () => {
    const harness = renderStudio("deck");
    await waitFor(() => expect(imageShown("https://files.test/asset-1.png")).toBe(true));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove card" }));
    });
    await undoTo(harness, initialDeck);
    expect(revokeArtifactAsset).not.toHaveBeenCalled();
    await waitFor(() => expect(imageShown("https://files.test/asset-1.png")).toBe(true));
  });

  it("keeps a removed card image for undo", async () => {
    const harness = renderStudio("deck");
    await waitFor(() => expect(imageShown("https://files.test/asset-1.png")).toBe(true));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove card image" }));
    });
    await undoTo(harness, initialDeck);
    expect(revokeArtifactAsset).not.toHaveBeenCalled();
    await waitFor(() => expect(imageShown("https://files.test/asset-1.png")).toBe(true));
  });
});
