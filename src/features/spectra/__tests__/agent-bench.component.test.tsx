// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSkill,
  normalizeFoundryContent,
  type AgentFoundryContent,
  type BenchCase,
  type BenchRun,
  type BenchTarget,
} from "../agents/foundry";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  stream: vi.fn(),
  suggest: vi.fn(),
  glow: vi.fn(),
  arrival: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../data/agent-bench", async (original) => ({
  ...(await original<typeof import("../data/agent-bench")>()),
  getAgentBench: mocks.get,
  saveAgentBenchCase: mocks.save,
  removeAgentBenchCase: mocks.remove,
  streamAgentBench: mocks.stream,
  suggestBenchImprovements: mocks.suggest,
}));
vi.mock("../life/use-life", async (original) => ({
  ...(await original<typeof import("../life/use-life")>()),
  useLifeArrival: mocks.arrival,
  useLifeDeparture: vi.fn(),
  useLifeGlow: mocks.glow,
}));
vi.mock("@/components/ui/toast", () => ({
  toast: Object.assign(vi.fn(), { success: mocks.toastSuccess, error: mocks.toastError }),
}));

import { AgentBench, benchBarAction, useAgentBench, type AgentBenchController } from "../components/agent-bench";
import { spectraBus } from "../events";
import { BenchError, type BenchReleaseOption } from "../data/agent-bench";

function agent(): AgentFoundryContent {
  return normalizeFoundryContent({
    routing: { enabled: true, description: "", examples: [], negativeExamples: [] },
    foundry: {
      foundationEstablished: true,
      mission: {
        objective: "Give students precise essay feedback.",
        interactionStyle: { tone: "direct", responseLength: "balanced", clarificationPolicy: "ask_when_needed" },
      },
      skills: [
        createSkill(
          {
            id: "essay",
            name: "Essay feedback",
            purpose: "Mark essays against a rubric",
            status: "verified",
            procedure: [{ order: 1, action: "Read the essay" }],
            outputContract: { shape: "Feedback", mustInclude: [], mustNotInclude: [] },
            examples: [{ id: "x", input: "Here is my essay on the causes of WW1", output: "" }],
          },
          1,
        ),
      ],
    },
  });
}

const savedCase: BenchCase = {
  id: "case1",
  prompt: "Mark my essay intro",
  checks: { mustInclude: ["thesis"], mustNotInclude: [] },
  required: true,
  createdAt: 1,
  updatedAt: 1,
};

function run(prompt: string, output: string, createdAt: number, target: BenchTarget = "draft", releaseNumber?: number): BenchRun {
  return { id: `r${createdAt}`, prompt, target, output, createdAt, ...(releaseNumber ? { releaseNumber } : {}) };
}

/** The bench as the editor holds it, so a test can press the bar's Stop. */
const held: { bench?: AgentBenchController } = {};

function Harness({ content, onApply }: { content: AgentFoundryContent; onApply: (next: AgentFoundryContent) => void }) {
  const bench = useAgentBench({ agentId: "agent_1", enabled: true, content });
  held.bench = bench;
  return <AgentBench bench={bench} content={content} suite={[]} canEdit onApply={onApply} />;
}

function setup(
  state: {
    cases?: BenchCase[];
    runs?: BenchRun[];
    release?: { releaseNumber: number; title: string; content: unknown } | null;
    releases?: BenchReleaseOption[];
  } = {},
) {
  mocks.get.mockResolvedValue({
    cases: state.cases ?? [],
    runs: state.runs ?? [],
    release: state.release ?? null,
    ...(state.releases ? { releases: state.releases } : {}),
  });
  const onApply = vi.fn();
  const view = render(<Harness content={agent()} onApply={onApply} />);
  return { ...view, onApply };
}

/** A stream the test finishes by hand, so the middle of an answer can be seen. */
function controlledStream() {
  const calls: Array<{
    target: BenchTarget;
    prompt: string;
    content?: unknown;
    releaseNumber?: number;
    signal?: AbortSignal;
    write: (text: string) => void;
    finish: (output: string) => void;
    fail: (error: unknown) => void;
  }> = [];
  mocks.stream.mockImplementation(
    (input: {
      prompt: string;
      target: BenchTarget;
      content?: unknown;
      releaseNumber?: number;
      signal?: AbortSignal;
      onText: (text: string) => void;
    }) =>
      new Promise<BenchRun>((resolve, reject) => {
        // As fetch does: a stopped request ends the stream with an abort.
        input.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        calls.push({
          target: input.target,
          prompt: input.prompt,
          content: input.content,
          releaseNumber: input.releaseNumber,
          signal: input.signal,
          write: input.onText,
          finish: (output) =>
            resolve(
              run(
                input.prompt,
                output,
                100 + calls.length,
                input.target,
                input.target === "release" ? (input.releaseNumber ?? 2) : undefined,
              ),
            ),
          fail: reject,
        });
      }),
  );
  return calls;
}

describe("the agent bench", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Radix measures its controls; jsdom has no layout to observe.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists saved tests first, then recent questions, and offers its examples", async () => {
    setup({ cases: [savedCase], runs: [run("Explain feudalism", "Lords and vassals.", 5)] });
    await screen.findByText("Explain feudalism");
    const prompts = [...document.querySelectorAll(".agent-bench-prompt")].map((node) => node.textContent);
    expect(prompts).toEqual(["Mark my essay intro", "Explain feudalism"]);
    expect(screen.getByText("Test")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Here is my essay on the causes of WW1/ })).toBeTruthy();
    // Every question forms by hand, as something the creator added.
    expect(mocks.arrival).toHaveBeenCalledWith(expect.anything(), "bench:agent_1:mark my essay intro", "human");
  });

  it("streams a new question's answer with Spectra's light while it is written", async () => {
    const calls = controlledStream();
    setup();
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("A question for the agent"), { target: { value: "What is a thesis?" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ target: "draft", prompt: "What is a thesis?" });
    act(() => calls[0]!.write("A thesis is **the claim**"));
    const writing = document.querySelector('.agent-bench-answer[data-ai-region="true"]')!;
    expect(writing.textContent).toContain("the claim");
    expect(mocks.glow).toHaveBeenCalledWith(expect.anything(), true);
    await act(async () => calls[0]!.finish("A thesis is **the claim** an essay argues."));
    expect(document.querySelector('[data-ai-region="true"]')).toBeNull();
    expect(screen.getByText(/an essay argues/)).toBeTruthy();
    // Rich content: the bold renders as bold, not as asterisks.
    expect(document.querySelector(".agent-bench-rich strong")?.textContent).toBe("the claim");
  });

  it("says what changed since the answer before", async () => {
    setup({
      runs: [
        run("Mark it", "Your thesis is clear and strong. The ending is weak.", 1),
        run("Mark it", "Your thesis is clear and strong. Add a source for the second claim.", 2),
      ],
    });
    const changes = await screen.findByText("What changed");
    const block = changes.parentElement!;
    expect(within(block).getByText("1 new point")).toBeTruthy();
    expect(within(block).getByText("1 point dropped")).toBeTruthy();
    expect(within(block).getByText(/Add a source for the second claim/)).toBeTruthy();
  });

  it("compares with the last release, asking it once when it has not answered yet", async () => {
    const calls = controlledStream();
    setup({ runs: [run("Mark it", "Draft answer.", 1)], release: { releaseNumber: 2, title: "Coach", content: {} } });
    fireEvent.click(await screen.findByRole("radio", { name: "Release 2" }));
    fireEvent.click(screen.getByRole("button", { name: /Run again/ }));
    await waitFor(() => expect(calls.map((call) => call.target).sort()).toEqual(["draft", "release"]));
    await act(async () => {
      calls.find((call) => call.target === "release")!.finish("Release answer.");
      calls.find((call) => call.target === "draft")!.finish("New draft answer.");
    });
    const answers = [...document.querySelectorAll(".agent-bench-answer")].map((node) => node.textContent);
    expect(answers).toEqual(["Release 2Release answer.", "This draftNew draft answer."]);
  });

  it("saves a question as a test with what a good answer must do", async () => {
    mocks.save.mockResolvedValue({ caseId: "case9", created: true });
    setup({ runs: [run("Mark it", "Great work, no notes.", 1)] });
    fireEvent.click(await screen.findByRole("button", { name: /Save as test/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    expect(screen.getByRole("alert").textContent).toBe("Say at least one thing a good answer must or must not do.");
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("A good answer includes"), { target: { value: "thesis\n next step " } });
    fireEvent.change(screen.getByLabelText("A good answer leaves out"), { target: { value: "great work" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save test" })));
    expect(mocks.save).toHaveBeenCalledWith({
      agentId: "agent_1",
      caseId: undefined,
      prompt: "Mark it",
      mustInclude: ["thesis", "next step"],
      mustNotInclude: ["great work"],
      rubric: undefined,
      required: true,
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Saved as a test. Run checks includes it now.");
    // The saved checks grade the answer it already has.
    expect(screen.getByText("0 of 3 checks hold")).toBeTruthy();
    expect(screen.getByText(/Includes .thesis./)).toBeTruthy();
  });

  it("offers a failed check as an adjustment to the skill", async () => {
    const { onApply } = setup({
      cases: [{ ...savedCase, prompt: "Mark my essay", checks: { mustInclude: ["next step"], mustNotInclude: [] } }],
      runs: [run("Mark my essay", "Nice essay.", 1)],
    });
    expect(await screen.findByText(/Essay feedback should include/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to the skill" }));
    const next = onApply.mock.calls[0]![0] as AgentFoundryContent;
    expect(next.foundry.skills[0]!.outputContract.mustInclude).toEqual(["next step"]);
  });

  it("applies edited instructions and runs every question again with them", async () => {
    const calls = controlledStream();
    const { onApply } = setup({ runs: [run("Mark it", "Old.", 1)] });
    await screen.findByText("Old.");
    fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "Give short, kind essay feedback." } });
    expect(screen.getByText("Changed: Objective")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply and run again" }));
    const applied = onApply.mock.calls[0]![0] as AgentFoundryContent;
    expect(applied.foundry.mission.objective).toBe("Give short, kind essay feedback.");
    await waitFor(() => expect(calls).toHaveLength(1));
    // The rerun answers with the edit, not the saved draft.
    expect((calls[0]!.content as AgentFoundryContent).foundry.mission.objective).toBe("Give short, kind essay feedback.");
  });

  it("shows the bench's own words when an answer fails", async () => {
    const calls = controlledStream();
    setup({ runs: [run("Mark it", "Old.", 1)] });
    fireEvent.click(await screen.findByRole("button", { name: /Run again/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0]!.fail(new BenchError("Your school reached its AI usage limit for today.")));
    expect(screen.getByRole("alert").textContent).toBe("Your school reached its AI usage limit for today.");
  });

  it("stops a running answer, says so without alarm, and runs it again", async () => {
    const calls = controlledStream();
    setup({ runs: [run("Mark it", "Old.", 1)] });
    fireEvent.click(await screen.findByRole("button", { name: /Run again/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => calls[0]!.write("Half an ans"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop" })));
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(screen.getByText(/Stopped before the answer finished/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector('[data-ai-region="true"]')).toBeNull();
    // What it wrote stays, marked stopped, and is not compared with the answer before.
    expect(screen.getByText("Half an ans")).toBeTruthy();
    expect(screen.getByText("Stopped", { selector: ".agent-bench-tag" })).toBeTruthy();
    expect(screen.queryByText("What changed")).toBeNull();
    // The answer before is still there, and the question can run again.
    expect(screen.getByText("Old.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Run again/ }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(screen.queryByText(/Stopped before the answer finished/)).toBeNull();
  });

  it("does not grade a stopped answer against its test", async () => {
    controlledStream();
    setup({
      cases: [
        {
          id: "case_1",
          prompt: "Mark it",
          checks: { mustInclude: ["next step"], mustNotInclude: [] },
          required: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      runs: [{ ...run("Mark it", "Half", 2), stopped: true }],
    });
    expect(await screen.findByText("Half")).toBeTruthy();
    expect(screen.getByText("Stopped", { selector: ".agent-bench-tag" })).toBeTruthy();
    expect(screen.queryByText(/checks hold/)).toBeNull();
  });

  it("stops Run all before it asks the next question", async () => {
    const calls = controlledStream();
    setup({ runs: [run("First question", "One.", 2), run("Second question", "Two.", 1)] });
    await screen.findByText("Two.");
    expect(benchBarAction(held.bench!, true)).toMatchObject({ label: "Run all", stops: false, disabled: false });
    expect(benchBarAction(held.bench!, false).disabled).toBe(true);
    let pending: Promise<void> | undefined;
    act(() => {
      pending = held.bench!.runAll();
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    // While it runs, the editor bar's main action is Stop.
    const bar = benchBarAction(held.bench!, true);
    expect(bar).toMatchObject({ label: "Stop", stops: true, disabled: false });
    await act(async () => {
      bar.onSelect();
      await pending;
    });
    expect(benchBarAction(held.bench!, true).label).toBe("Run all");
    expect(held.bench!.runningAll).toBe(false);
    expect(calls).toHaveLength(1);
    expect(screen.getAllByText(/Stopped before the answer finished/)).toHaveLength(1);
  });

  it("compares with an older release the creator picks", async () => {
    const calls = controlledStream();
    setup({
      runs: [run("Mark it", "Draft answer.", 1), run("Mark it", "Release three answer.", 0, "release", 3)],
      release: { releaseNumber: 3, title: "Coach", content: {} },
      releases: [
        { releaseNumber: 3, status: "published", rollout: "published", publishedAt: 30 },
        { releaseNumber: 2, status: "suspended", publishedAt: 20 },
        { releaseNumber: 1, status: "deprecated", publishedAt: 10 },
      ],
    });
    fireEvent.click(await screen.findByRole("radio", { name: "A release" }));
    // The newest release is compared first, from the answer it already gave.
    expect(screen.getByRole("combobox", { name: "Which release" }).textContent).toContain("Release 3");
    expect(document.querySelector(".agent-bench-answer")?.textContent).toBe("Release 3Release three answer.");
    act(() => held.bench!.setCompareRelease(1));
    expect(screen.getByRole("combobox", { name: "Which release" }).textContent).toContain("Release 1, retired");
    expect(screen.getByText("Run it to see how the release answers.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Run again/ }));
    await waitFor(() => expect(calls.map((call) => call.target).sort()).toEqual(["draft", "release"]));
    const asked = calls.find((call) => call.target === "release")!;
    expect(asked.releaseNumber).toBe(1);
    await act(async () => {
      asked.finish("Release one answer.");
      calls.find((call) => call.target === "draft")!.finish("New draft answer.");
    });
    const answers = [...document.querySelectorAll(".agent-bench-answer")].map((node) => node.textContent);
    expect(answers).toEqual(["Release 1Release one answer.", "This draftNew draft answer."]);
  });

  it("does not name the newest release to the route, so the default still answers", async () => {
    const calls = controlledStream();
    setup({ runs: [run("Mark it", "Draft answer.", 1)], release: { releaseNumber: 2, title: "Coach", content: {} } });
    fireEvent.click(await screen.findByRole("radio", { name: "Release 2" }));
    expect(screen.queryByRole("combobox", { name: "Which release" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Run again/ }));
    await waitFor(() => expect(calls.some((call) => call.target === "release")).toBe(true));
    expect(mocks.stream.mock.calls.find(([input]) => input.target === "release")![0]).not.toHaveProperty("releaseNumber");
  });

  it("asks Spectra for improvements, shows them arriving as Spectra's, and applies one only when asked", async () => {
    mocks.suggest.mockResolvedValue([
      {
        key: "include:essay:next step",
        reason: "The answer never tells the student what to do next.",
        edits: [{ kind: "include", skillId: "essay", skillName: "Essay feedback", value: "one next step" }],
      },
      { key: "tone:warm", reason: "Students respond better to warmth.", edits: [{ kind: "tone", value: "warm" }] },
    ]);
    const { onApply } = setup({ cases: [savedCase], runs: [run("Mark my essay intro", "Your intro is fine.", 1)] });
    fireEvent.click(await screen.findByRole("button", { name: /Suggest improvements/ }));
    const list = await screen.findByRole("list", { name: "Spectra's suggestions" });
    expect(mocks.suggest).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent_1",
        prompt: "Mark my essay intro",
        output: "Your intro is fine.",
        checks: savedCase.checks,
      }),
    );
    expect(within(list).getByText("The answer never tells the student what to do next.")).toBeTruthy();
    expect(within(list).getByText("Essay feedback answers include \u201cone next step\u201d")).toBeTruthy();
    expect(within(list).getByText("Tone: Warm")).toBeTruthy();
    expect(mocks.arrival).toHaveBeenCalledWith(
      expect.anything(),
      "bench-idea:agent_1:mark my essay intro:r1:include:essay:next step",
      "ai",
    );
    // Nothing reaches the draft until the creator applies it.
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(within(list).getAllByRole("button", { name: "Apply to the draft" })[1]!);
    const next = onApply.mock.calls[0]![0] as AgentFoundryContent;
    expect(next.foundry.mission.interactionStyle.tone).toBe("warm");
    expect(next.foundry.skills[0]!.outputContract.mustInclude).toEqual([]);
    expect(within(list).getByText("Applied")).toBeTruthy();
    expect(within(list).getAllByRole("button", { name: "Apply to the draft" })).toHaveLength(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Applied to the draft. Run it again to see the difference.");
  });

  it("says when Spectra has nothing to suggest, and words a failure plainly", async () => {
    mocks.suggest.mockResolvedValueOnce([]);
    setup({ runs: [run("Mark it", "Fine.", 1)] });
    fireEvent.click(await screen.findByRole("button", { name: /Suggest improvements/ }));
    expect(await screen.findByText("Spectra has nothing to change for this answer.")).toBeTruthy();
    mocks.suggest.mockRejectedValueOnce(new BenchError("Your school reached its AI usage limit for today."));
    fireEvent.click(screen.getByRole("button", { name: /Suggest again/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("Your school reached its AI usage limit for today.");
    mocks.suggest.mockRejectedValueOnce(new Error("AGENT_X_FAILED"));
    fireEvent.click(screen.getByRole("button", { name: /Suggest improvements/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Spectra could not suggest changes this time. Try again."),
    );
  });

  it("stops asking for suggestions when the creator stops it", async () => {
    let signal: AbortSignal | undefined;
    mocks.suggest.mockImplementation((input: { signal?: AbortSignal }) => {
      signal = input.signal;
      return new Promise(() => undefined);
    });
    setup({ runs: [run("Mark it", "Fine.", 1)] });
    fireEvent.click(await screen.findByRole("button", { name: /Suggest improvements/ }));
    expect(await screen.findByText(/Spectra is reading the answer/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: /Suggest improvements/ })).toBeTruthy();
  });

  it("shows what Spectra asked this agent, or kept as its test, without a reload", async () => {
    setup({ runs: [run("Mark it", "Old.", 1)] });
    expect(await screen.findByText("Old.")).toBeTruthy();
    mocks.get.mockResolvedValue({ cases: [], runs: [run("Mark it", "Spectra asked this.", 2), run("Mark it", "Old.", 1)], release: null });
    act(() => spectraBus.emit("agent.benchChanged", { agentId: "someone-else" }));
    expect(mocks.get).toHaveBeenCalledTimes(1);
    act(() => spectraBus.emit("agent.benchChanged", { agentId: "agent_1" }));
    expect(await screen.findByText("Spectra asked this.", { selector: "p" })).toBeTruthy();
  });

  it("says so when the bench cannot load, and tries again", async () => {
    mocks.get.mockRejectedValueOnce(new Error("offline"));
    setup();
    mocks.get.mockResolvedValue({ cases: [], runs: [], release: null });
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText(/Nothing on the bench yet/)).toBeTruthy());
  });
});
