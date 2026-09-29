// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuizStudio } from "../components/quiz-studio";
import { StudioContractProvider, type StudioContract } from "../components/artifact-studio-shell";
import type { QuizImportResult } from "../quiz/interchange";

// A quiz import uploads the original and parses it before it lands. It must
// land on the quiz as it is then, keeping a question added in the meantime.

let finishParsing: (result: QuizImportResult) => void = () => {};

vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => ({})), useQuery: () => undefined }));
vi.mock("../data/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../data/api")>()),
  getArtifactAssets: vi.fn(async () => ({ assets: [] })),
  beginArtifactImportOriginal: vi.fn(async () => ({ jobId: "job-1" })),
  uploadArtifactImportOriginal: vi.fn(async () => ({})),
  completeArtifactImport: vi.fn(async () => ({})),
}));
vi.mock("../quiz/interchange", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../quiz/interchange")>()),
  parseQuizImport: vi.fn(() => new Promise((resolve) => (finishParsing = resolve))),
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
} as unknown as StudioContract;

const question = (id: string, prompt: string) => ({
  id,
  type: "multiple_choice",
  prompt,
  options: ["A", "B"],
  answer: "A",
});

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

describe("quiz import", () => {
  it("keeps a question added while the file was being imported", async () => {
    const onChange = vi.fn();
    const view = (content: unknown) => (
      <StudioContractProvider value={contract}>
        <QuizStudio artifactId="quiz-1" mode="tab" content={content} onChange={onChange} />
      </StudioContractProvider>
    );
    const { container, rerender } = render(view({ questions: [question("q1", "One")] }));
    await act(async () => {});

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["{}"], "quiz.json", { type: "application/json" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      fireEvent.change(input);
    });

    // While the file is parsed, a collaborator adds a question.
    rerender(view({ questions: [question("q1", "One"), question("q2", "Peer question")] }));
    await act(async () => {});

    await act(async () => {
      finishParsing({
        content: { questions: [question("q3", "Imported")], settings: {} },
        fidelity: "NATIVE",
        unsupportedFeatures: [],
      } as unknown as QuizImportResult);
    });

    const last = onChange.mock.calls.at(-1)?.[0] as { questions: Array<{ prompt: string }> };
    expect(last.questions.map((item) => item.prompt)).toEqual(["One", "Peer question", "Imported"]);
  });
});
