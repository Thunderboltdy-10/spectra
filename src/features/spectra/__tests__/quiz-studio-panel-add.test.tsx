// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuizStudio } from "../components/quiz-studio";
import {
  StudioContractProvider,
  type StudioContract,
} from "../components/artifact-studio-shell";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => ({})), useQuery: () => undefined }));
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

function contract(surface: StudioContract["surface"]): StudioContract {
  return {
    artifactId: "quiz-1",
    type: "quiz",
    role: "edit",
    can: () => true,
    modes: [],
    readOnly: false,
    surface,
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
}

const initialQuiz = {
  questions: [{ id: "q1", type: "multiple_choice", prompt: "One", options: ["A", "B"], answer: "A" }],
};

function Host({ surface, onContent }: { surface: StudioContract["surface"]; onContent: (next: unknown) => void }) {
  const [content, setContent] = useState<unknown>(initialQuiz);
  return (
    <StudioContractProvider value={contract(surface)}>
      <QuizStudio
        artifactId="quiz-1"
        mode="tab"
        content={content}
        onChange={(next) => {
          onContent(next);
          setContent(next);
        }}
      />
    </StudioContractProvider>
  );
}

async function chooseWorkbarAction(name: string) {
  const direct = screen.queryByRole("button", { name });
  if (direct) {
    fireEvent.click(direct);
    return;
  }
  const more = screen.getAllByRole("button", { name: /More/ })[0]!;
  await act(async () => {
    fireEvent.keyDown(more, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(name) }));
  });
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

describe("Quiz Add question", () => {
  it("is reachable from the workbar in a side panel, where there is no question list", async () => {
    let latest: { questions: unknown[] } | null = null;
    render(<Host surface="panel" onContent={(next) => (latest = next as { questions: unknown[] })} />);
    await chooseWorkbarAction("Add question");
    await waitFor(() => expect(latest?.questions).toHaveLength(2));
  });

  it("stays on the question list in the full surface, not twice in the bar", () => {
    render(<Host surface="full" onContent={() => {}} />);
    const toolbar = screen.getByRole("toolbar", { name: /Quiz/ });
    expect(toolbar.textContent).not.toMatch(/Add question/);
    expect(screen.getAllByRole("button", { name: /Add question/ }).length).toBeGreaterThan(0);
  });
});
