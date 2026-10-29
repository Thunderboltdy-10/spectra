// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuizStudio } from "../components/quiz-studio";
import { saveSpectraQuizPracticeResponse, startSpectraQuizPractice, submitSpectraQuizPractice, type SpectraQuizPracticeAttempt } from "../data/api";
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
  saveSpectraQuizPracticeResponse: vi.fn(),
  submitSpectraQuizPractice: vi.fn(),
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
  vi.mocked(saveSpectraQuizPracticeResponse).mockReset();
  vi.mocked(submitSpectraQuizPractice).mockReset();
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
  it("offers Unpublish beside the published status without opening toolbar menus", async () => {
    const harness = { setContent: () => {} } as unknown as Harness;
    const view = render(<Host harness={harness} published />);
    const unpublish = view.getByRole("button", { name: "Unpublish" });
    expect(unpublish.closest('[role="status"]')).toBeTruthy();
    fireEvent.click(unpublish);
    await waitFor(() => expect(harness.content).toMatchObject({ published: false }));
    expect(view.queryByRole("button", { name: "Unpublish" })).toBeNull();
  });

  const attempt: SpectraQuizPracticeAttempt = {
    attemptId: "attempt-1", artifactId: "quiz-1", contentHash: "saved", status: "in_progress",
    questions: [{ id: "q1", prompt: "What is eight plus eight?", type: "short_answer", options: [], points: 1 }],
    responses: {}, startedAt: 1,
  };

  async function beginShortAnswer(value = "16") {
    vi.mocked(startSpectraQuizPractice).mockResolvedValue(attempt);
    vi.mocked(submitSpectraQuizPractice).mockResolvedValue({ ...attempt, status: "submitted", responses: { q1: "16" } });
    const harness = { setContent: () => {} } as unknown as Harness;
    const view = render(<Host harness={harness} published />);
    fireEvent.click(view.getByRole("button", { name: /^Attempt$/ }));
    const input = await view.findByPlaceholderText("Type your answer");
    fireEvent.change(input, { target: { value } });
    return { view, input };
  }

  it("keeps the Submit click during a blur save and flushes afterward", async () => {
    let finishSave!: (value: Awaited<ReturnType<typeof saveSpectraQuizPracticeResponse>>) => void;
    vi.mocked(saveSpectraQuizPracticeResponse)
      .mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }))
      .mockResolvedValue({ responseId: "response-1", reused: false });
    const { view, input } = await beginShortAnswer();
    fireEvent.blur(input);
    const submit = view.getByRole("button", { name: "Submit attempt" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(submitSpectraQuizPractice).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).disabled).toBe(true);
    await act(async () => finishSave({ responseId: "response-1", reused: false }));
    await waitFor(() => expect(submitSpectraQuizPractice).toHaveBeenCalledOnce());
    expect(saveSpectraQuizPracticeResponse).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveSpectraQuizPracticeResponse).mock.calls[1]?.[0]).toMatchObject({ response: "16" });
  });

  it("preserves the attempt when its final answer cannot be saved", async () => {
    vi.mocked(saveSpectraQuizPracticeResponse).mockRejectedValue(new Error("The connection was interrupted."));
    const { view, input } = await beginShortAnswer();
    fireEvent.blur(input);
    fireEvent.click(view.getByRole("button", { name: "Submit attempt" }));
    await waitFor(() => expect(view.getByText("The connection was interrupted.")).toBeTruthy());
    expect(submitSpectraQuizPractice).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("16");
  });

  it("saves repeated edits to the same answer in the order they were made", async () => {
    let finishSave!: (value: Awaited<ReturnType<typeof saveSpectraQuizPracticeResponse>>) => void;
    vi.mocked(saveSpectraQuizPracticeResponse)
      .mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }))
      .mockResolvedValue({ responseId: "response-1", reused: false });
    const { view, input } = await beginShortAnswer("15");
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "16" } });
    fireEvent.blur(input);
    expect(saveSpectraQuizPracticeResponse).toHaveBeenCalledOnce();
    await act(async () => finishSave({ responseId: "response-1", reused: false }));
    await waitFor(() => expect(saveSpectraQuizPracticeResponse).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveSpectraQuizPracticeResponse).mock.calls.map(([value]) => value.response)).toEqual(["15", "16"]);
    expect(view.getByText("Current answers synchronized")).toBeTruthy();
  });

  it("saves the newer answer after an older save fails without leaving its error", async () => {
    let rejectSave!: (error: Error) => void;
    vi.mocked(saveSpectraQuizPracticeResponse)
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }))
      .mockResolvedValue({ responseId: "response-1", reused: false });
    const { view, input } = await beginShortAnswer("15");
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "16" } });
    fireEvent.blur(input);
    await act(async () => rejectSave(new Error("The old request failed.")));
    await waitFor(() => expect(view.getByText("Current answers synchronized")).toBeTruthy());
    expect(view.queryByText(/The old request failed/)).toBeNull();
    expect(vi.mocked(saveSpectraQuizPracticeResponse).mock.calls[1]?.[0]).toMatchObject({ response: "16" });
  });

  it("still submits saved answers when the server reports that time elapsed", async () => {
    vi.mocked(saveSpectraQuizPracticeResponse).mockRejectedValue(Object.assign(new Error("Time elapsed"), { data: { code: "QUIZ_ATTEMPT_TIME_ELAPSED", message: "Time elapsed" } }));
    const { view } = await beginShortAnswer();
    fireEvent.click(view.getByRole("button", { name: "Submit attempt" }));
    await waitFor(() => expect(submitSpectraQuizPractice).toHaveBeenCalledOnce());
  });

  it("saves bracketed text as a text answer rather than an array", async () => {
    vi.mocked(saveSpectraQuizPracticeResponse).mockResolvedValue({ responseId: "response-1", reused: false });
    const { view } = await beginShortAnswer("[1, 2]");
    fireEvent.click(view.getByRole("button", { name: "Submit attempt" }));
    await waitFor(() => expect(saveSpectraQuizPracticeResponse).toHaveBeenCalledOnce());
    expect(vi.mocked(saveSpectraQuizPracticeResponse).mock.calls[0]?.[0]).toMatchObject({ response: "[1, 2]" });
  });

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
