import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelCaller } from "../../loop";
import type { HarnessMessage, ModelTurn } from "../../types";
import { renderEvalReport, writeEvalReport } from "../report";
import {
  disciplineProblems,
  percentile,
  playScenario,
  readOnlyToolNames,
  runEvals,
  type EvalDeps,
  type EvalResults,
  type RecordedCall,
} from "../runner";
import { EVAL_GROUPS, EVAL_SCENARIOS, type EvalScenario } from "../scenarios";

type Step = ModelTurn | ((messages: HarnessMessage[]) => ModelTurn);

const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, name, arguments: JSON.stringify(args) });

/** A scripted model: one step per call, the last one repeats. */
function scripted(steps: Step[]) {
  const seen: HarnessMessage[][] = [];
  let index = 0;
  const caller: ModelCaller = async ({ messages, onText }) => {
    seen.push(messages);
    const step = steps[Math.min(index, steps.length - 1)]!;
    index += 1;
    const turn = typeof step === "function" ? step(messages) : step;
    if (turn.text) onText(turn.text);
    return { model: "test/model", ...turn };
  };
  return { caller, seen };
}

function deps(callModel: ModelCaller): EvalDeps {
  return { callModel, titleWriter: null, summarise: async () => "Earlier: the dog is Biscuit; the essay is on Versailles." };
}

const scenario = (name: string) => EVAL_SCENARIOS.find((entry) => entry.name === name)!;

describe("eval scenarios", () => {
  it("cover every area with about forty named scenarios", () => {
    expect(EVAL_SCENARIOS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(EVAL_SCENARIOS.map((entry) => entry.name)).size).toBe(EVAL_SCENARIOS.length);
    expect(new Set(EVAL_SCENARIOS.map((entry) => entry.group))).toEqual(new Set(EVAL_GROUPS));
    const created = new Set(EVAL_SCENARIOS.filter((entry) => entry.group === "create").map((entry) => entry.prompt));
    expect(created.size).toBeGreaterThanOrEqual(10);
  });

  it("hold the targets: first output for hello and a simple edit's total", () => {
    expect(scenario("hello").latency).toEqual({ firstOutputMs: 1_500 });
    expect(scenario("small document edit").latency).toEqual({ totalMs: 8_000 });
  });

  it("never pass a run that did nothing", async () => {
    const silent: ModelCaller = async () => ({ text: "", toolCalls: [] });
    const readTools = readOnlyToolNames();
    for (const entry of EVAL_SCENARIOS) {
      const row = await playScenario({ ...entry, repeat: 1 }, deps(silent), readTools);
      expect(row.pass, entry.name).toBe(false);
    }
  }, 60_000);
});

describe("eval runner", () => {
  it("passes a greeting and measures first output over its repeats", async () => {
    const { caller } = scripted([{ text: "Hi Alex! What are you working on today?", toolCalls: [] }]);
    const row = await playScenario(scenario("hello"), deps(caller));
    expect(row.problems).toEqual([]);
    expect(row.pass).toBe(true);
    expect(row.samples).toHaveLength(3);
    expect(row.firstOutputMs).not.toBeNull();
    expect(row.model).toBe("test/model");
  });

  it("fails a slow first output against the hello target", async () => {
    let time = 0;
    const clock = () => time;
    const caller: ModelCaller = async ({ onText }) => {
      time += 3_000;
      onText("Hi!");
      return { text: "Hi!", toolCalls: [] };
    };
    const row = await playScenario(scenario("hello"), { ...deps(caller), clock });
    expect(row.pass).toBe(false);
    expect(row.problems).toContain("first output 3000 ms at p50, target under 1500 ms");
  });

  it("records a pause, answers it and checks the change", async () => {
    const { caller } = scripted([
      { text: "", toolCalls: [call("s1", "change_settings", { patch: { appearance: { theme: "dark" } } })] },
      { text: "Dark mode is on.", toolCalls: [] },
    ]);
    const row = await playScenario(scenario("settings approval"), deps(caller));
    expect(row.problems).toEqual([]);
  });

  it("checks an edit in place and lists the work it touched", async () => {
    const { caller } = scripted([
      { text: "", toolCalls: [call("e1", "edit_artifact", { id: "wxnotes", operations: [{ op: "replace", find: "Mitosys", replace: "Mitosis" }] })] },
      { text: "Fixed the title.", toolCalls: [] },
    ]);
    const row = await playScenario(scenario("small document edit"), deps(caller));
    expect(row.problems).toEqual([]);
    expect(row.artifacts).toEqual([expect.objectContaining({ id: "wxnotes", action: "edited", preview: expect.stringContaining("# Mitosis") })]);
  });

  it("stops at the first finished step when the user presses Stop", async () => {
    const { caller } = scripted([
      { text: "", toolCalls: [call("c1", "create_artifact", { type: "document", title: "Plate tectonics", content: { markdown: "# Plate tectonics\n\nPlates move on the mantle." } })] },
      { text: "", toolCalls: [call("c2", "create_artifact", { type: "quiz", title: "Plates quiz", content: { items: [] } })] },
    ]);
    const row = await playScenario(scenario("stop mid-run"), deps(caller));
    expect(row.problems).toEqual([]);
    expect(row.artifacts).toHaveLength(1);
  });

  it("delivers a steer to the model after the first step", async () => {
    const { caller, seen } = scripted([
      { text: "", toolCalls: [call("r1", "list_library", {})] },
      { text: "Okay.", toolCalls: [] },
    ]);
    await playScenario(scenario("steer mid-run"), deps(caller));
    expect(JSON.stringify(seen[1])).toContain("Actually make it 4 slides.");
  });

  it("turns a throwing scenario into a failed row", async () => {
    const { caller } = scripted([{ text: "Hello.", toolCalls: [] }]);
    const broken: EvalScenario = {
      name: "broken",
      group: "chat",
      prompt: "hi",
      check: () => {
        throw new Error("boom");
      },
    };
    const row = await playScenario(broken, deps(caller));
    expect(row).toMatchObject({ pass: false, problems: ["the run threw: boom"] });
  });

  it("summarises by area and latency target", async () => {
    const { caller } = scripted([{ text: "Hi there!", toolCalls: [] }]);
    const results = await runEvals([scenario("hello"), scenario("thanks"), scenario("factual question")], deps(caller), { model: "test/model" });
    expect(results.model).toBe("test/model");
    expect(results.summary).toMatchObject({ total: 3, passed: 2, failed: 1 });
    expect(results.summary.groups).toEqual([{ group: "chat", total: 3, passed: 2 }]);
    expect(results.summary.latency).toEqual([expect.objectContaining({ name: "hello", metric: "first output", targetMs: 1_500, pass: true })]);
  });
});

describe("loop discipline", () => {
  const recorded = (toolNames: string[], system = "S", tools = "T"): RecordedCall => ({ system, tools, toolNames });
  const reads = new Set(["read_artifact", "search", "list_library"]);

  it("wants a byte-stable prompt and tool list", () => {
    expect(disciplineProblems([recorded([]), recorded([])], reads)).toEqual([]);
    expect(disciplineProblems([recorded([]), recorded([], "S2")], reads)).toEqual(["the system prompt changed between model calls"]);
    expect(disciplineProblems([recorded([]), recorded([], "S", "T2")], reads)).toEqual(["the tool list changed between model calls"]);
  });

  it("flags reads made one turn at a time before the first change", () => {
    const parallel = [recorded(["search", "read_artifact"]), recorded(["edit_artifact"]), recorded([])];
    const sequential = [recorded(["search"]), recorded(["read_artifact"]), recorded(["edit_artifact"]), recorded([])];
    expect(disciplineProblems(parallel, reads)).toEqual([]);
    expect(disciplineProblems(sequential, reads)).toEqual([expect.stringMatching(/^2 read-only model turns in a row/)]);
    expect(disciplineProblems(sequential, reads, 2)).toEqual([]);
  });

  it("knows which tools only read", () => {
    const names = readOnlyToolNames();
    expect(names.has("read_artifact")).toBe(true);
    expect(names.has("find_commands")).toBe(true);
    expect(names.has("edit_artifact")).toBe(false);
  });

  it("computes percentiles", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([300, 100, 200], 0.5)).toBe(200);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
  });
});

describe("eval report", () => {
  const results: EvalResults = {
    startedAt: Date.UTC(2026, 9, 5, 9, 0),
    finishedAt: Date.UTC(2026, 9, 5, 9, 2),
    model: "test/model",
    rows: [
      {
        name: "hello",
        group: "chat",
        prompt: "hello",
        pass: true,
        problems: [],
        firstOutputMs: 900,
        totalMs: 1_200,
        samples: [{ firstOutputMs: 900, totalMs: 1_200 }],
        turns: 1,
        modelCalls: 1,
        steps: [],
        reply: "Hi <script>alert(1)</script>",
        artifacts: [],
      },
      {
        name: "create a document",
        group: "create",
        prompt: "Write a guide & more",
        pass: false,
        problems: ['expected one document, found 0 "<none>"'],
        firstOutputMs: null,
        totalMs: 30_000,
        samples: [{ firstOutputMs: null, totalMs: 30_000 }],
        turns: 2,
        modelCalls: 2,
        steps: ["Creating *Guide*"],
        reply: "",
        artifacts: [{ id: "wx1", type: "document", title: "Guide", action: "created", shape: "120 words", preview: "# Guide <b>" }],
      },
    ],
    summary: {
      total: 2,
      passed: 1,
      failed: 1,
      groups: [
        { group: "chat", total: 1, passed: 1 },
        { group: "create", total: 1, passed: 0 },
      ],
      latency: [{ name: "hello", metric: "first output", p50: 900, targetMs: 1_500, pass: true }],
    },
  };

  it("renders a self-contained page with escaped content", () => {
    const html = renderEvalReport(results);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toContain("<script>");
    expect(html).toContain("Hi &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("# Guide &lt;b&gt;");
    expect(html).toContain("Write a guide &amp; more");
    expect(html).toContain("1 of 2");
    expect(html).toContain("900 ms");
    expect(html).toContain("test/model");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("writes the page and the results under the run's date", () => {
    const root = mkdtempSync(path.join(tmpdir(), "spectra-evals-"));
    try {
      const dir = writeEvalReport(results, root);
      expect(dir).toBe(path.join(root, "2026-10-05"));
      expect(existsSync(path.join(dir, "report.html"))).toBe(true);
      expect(JSON.parse(readFileSync(path.join(dir, "results.json"), "utf8")).summary.passed).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the golden set", () => {
  it("names twenty scenarios that exist, one behaviour each", async () => {
    const { EVAL_SCENARIOS, GOLDEN_SET } = await import("../scenarios");
    expect(GOLDEN_SET).toHaveLength(20);
    expect(new Set(GOLDEN_SET).size).toBe(20);
    const names = new Set(EVAL_SCENARIOS.map((scenario) => scenario.name));
    expect(GOLDEN_SET.filter((name) => !names.has(name))).toEqual([]);
  });

  it("can undo the previous pass in memory", async () => {
    const { MemoryBackend } = await import("../../memory-backend");
    const { authorNew } = await import("../../authoring");
    const doc = (markdown: string) => authorNew("document", { markdown }, { timeZone: "UTC" }).content;
    const backend = new MemoryBackend({ undo: true, artifacts: [{ id: "a", type: "document", title: "Notes", content: doc("# Notes") }] });
    const before = JSON.stringify(backend.artifacts.get("a")!.content);
    backend.startPass();
    await backend.updateArtifact({ id: "a", type: "document", content: doc("# Notes\n\nMore.") } as never);
    const { id } = await backend.createArtifact({ type: "document", title: "Extra", content: doc("# Extra") } as never);
    backend.startPass();
    const undone = await backend.undoPreviousRun!({ approved: false }, new AbortController().signal);
    expect(undone.ok).toBe(true);
    expect(JSON.stringify(backend.artifacts.get("a")!.content)).toBe(before);
    expect(backend.artifacts.has(id)).toBe(false);
  });
});
