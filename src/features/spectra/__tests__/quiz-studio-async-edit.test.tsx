// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuizStudio } from "../components/quiz-studio";
import { startSpectraQuizPractice } from "../data/api";
import {
  StudioContractProvider,
  type StudioContract,
} from "../components/artifact-studio-shell";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => ({})), useQuery: () => undefined }));
let finishUpload: ((value: { assetId: string }) => void) | undefined;
vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  getArtifactAssets: vi.fn(async () => ({ assets: [] })),
  getSpectraQuizPracticeAttempts: vi.fn(async () => ({ attempts: [] })),
  startSpectraQuizPractice: vi.fn(),
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
  artifactId: "quiz-1",
  type: "quiz",
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

type Question = { id: string; prompt: string; media?: { assetId: string } };
const question = (id: string, prompt: string) => ({
  id,
  type: "multiple_choice",
  prompt,
  options: ["A", "B"],
  answer: "A",
});
const initialQuiz = { questions: [question("q1", "One"), question("q2", "Two")] };

type Harness = { content: { questions: Question[] }; setContent: (next: unknown) => void };
function Host({ harness, published = false }: { harness: Harness; published?: boolean }) {
  const [content, setContent] = useState<unknown>({ ...initialQuiz, published });
  harness.content = content as Harness["content"];
  harness.setContent = setContent;
  return (
    <StudioContractProvider value={contract}>
      <QuizStudio artifactId="quiz-1" mode="tab" content={content} onChange={setContent} />
    </StudioContractProvider>
  );
}

beforeEach(() => {
  vi.mocked(startSpectraQuizPractice).mockReset();
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

describe("quiz edits that finish after an upload", () => {
  it("retries a worded publication refusal with the same attempt identity", async () => {
    vi.mocked(startSpectraQuizPractice)
      .mockRejectedValueOnce(Object.assign(new Error("This quiz is still publishing."), {
        data: { code: "QUIZ_PRACTICE_NOT_PUBLISHED", message: "This quiz is still publishing." },
      }))
      .mockResolvedValueOnce({
        attemptId: "attempt-1", artifactId: "quiz-1", contentHash: "saved",
        status: "in_progress", questions: [], responses: {}, startedAt: Date.now(),
      });
    const harness = { setContent: () => {} } as unknown as Harness;
    const view = render(<Host harness={harness} published />);
    fireEvent.click(view.getByRole("button", { name: /^Attempt$/ }));
    await waitFor(() => expect(startSpectraQuizPractice).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(vi.mocked(startSpectraQuizPractice).mock.calls[0]).toEqual(
      vi.mocked(startSpectraQuizPractice).mock.calls[1],
    );
    await waitFor(() => expect(view.getByText("Your attempt", { exact: true })).toBeTruthy());
  });

  it("shows a failed start on the surface reached from Attempt", async () => {
    vi.mocked(startSpectraQuizPractice).mockRejectedValue(new Error("The practice service is unavailable."));
    const harness = { setContent: () => {} } as unknown as Harness;
    const view = render(<Host harness={harness} published />);
    fireEvent.click(view.getByRole("button", { name: /^Attempt$/ }));
    await waitFor(() => expect(view.getByText("The practice service is unavailable.")).toBeTruthy());
    expect(startSpectraQuizPractice).toHaveBeenCalledTimes(1);
  });

  it("keeps a collaborator's edit made while a question image uploads", async () => {
    const harness = { setContent: () => {} } as unknown as Harness;
    render(<Host harness={harness} />);
    const input = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    const image = new File(["png"], "cell.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [image] } });
    await waitFor(() => expect(finishUpload).toBeDefined());

    act(() => {
      harness.setContent({
        ...harness.content,
        questions: harness.content.questions.map((item) =>
          item.id === "q2" ? { ...item, prompt: "Two, by a peer" } : item,
        ),
      });
    });
    await act(async () => {
      finishUpload!({ assetId: "asset-1" });
    });

    await waitFor(() => expect(harness.content.questions[0]!.media?.assetId).toBe("asset-1"));
    expect(harness.content.questions[1]!.prompt).toBe("Two, by a peer");
  });
});
