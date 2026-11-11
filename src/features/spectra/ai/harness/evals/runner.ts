import { authoredShape, isAuthoredType, readAuthored } from "../authoring";
import { modelThreadTitleWriter, type ThreadTitleWriter } from "../thread-title";
import { createCompactor, type Summariser } from "../compaction";
import type { ModelCaller } from "../loop";
import { MemoryBackend } from "../memory-backend";
import { DEFAULT_PERMISSION_PREFS } from "../permissions";
import { runHarness, type HarnessEvent, type HarnessRunInput, type HarnessRunResult } from "../run";
import { buildHarnessTools, createSession } from "../tools";
import { runOnlyTools } from "../tools/commands";
import type { HarnessMessage } from "../types";
import type { EvalGroup, EvalScenario } from "./scenarios";

/*
 * Plays eval scenarios through the real harness run. The model, the title
 * writer, the summariser and the clock are injected, so `npm run eval:ai`
 * uses OpenRouter and the unit tests use a scripted model. Besides each
 * scenario's own checks, every run is held to the loop's discipline: the
 * system prompt and tool list stay byte-identical across a conversation (so
 * the provider cache holds), and reads go out in parallel rather than one
 * model turn at a time before the first change.
 */

export type EvalDeps = {
  /** The caller is a subscription CLI rather than a direct model API. */
  subscription?: boolean;
  callModel: ModelCaller;
  titleWriter?: ThreadTitleWriter | null;
  summarise: Summariser;
  clock?: () => number;
  /** The "now" Spectra sees. Fixed, so dates in prompts mean the same every run. */
  environmentNow?: number;
  /** Per run (each pass), in milliseconds. */
  timeoutMs?: number;
};

export type RecordedCall = {
  system: string;
  tools: string;
  toolNames: string[];
  model?: string;
};

export type EvalArtifact = {
  id: string;
  type: string;
  title: string;
  action: "created" | "edited";
  shape: string;
  preview: string;
};

/** Timing is a guide: only a run well over its target counts as a failure. */
const LATENCY_SLACK = 1.5;

export type EvalSample = { firstOutputMs: number | null; totalMs: number };

export type EvalRow = {
  name: string;
  group: EvalGroup;
  prompt: string;
  pass: boolean;
  problems: string[];
  /** Median over the repeats. */
  firstOutputMs: number | null;
  totalMs: number;
  samples: EvalSample[];
  turns: number;
  modelCalls: number;
  steps: string[];
  title?: string;
  reply: string;
  artifacts: EvalArtifact[];
  model?: string;
};

export type LatencyTarget = {
  name: string;
  metric: "first output" | "total";
  p50: number | null;
  targetMs: number;
  pass: boolean;
};

export type EvalSummary = {
  total: number;
  passed: number;
  failed: number;
  groups: Array<{ group: EvalGroup; total: number; passed: number }>;
  latency: LatencyTarget[];
};

export type EvalResults = {
  startedAt: number;
  finishedAt: number;
  model: string | null;
  rows: EvalRow[];
  summary: EvalSummary;
};

/** Spectra's clock in the evals: Monday 5 October 2026, 09:00 in Madrid. */
export const EVAL_NOW = Date.UTC(2026, 9, 5, 7, 0);

const DEFAULT_TIMEOUT_MS = 8 * 60_000;

export function percentile(values: readonly number[], share: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[rank]!;
}

const median = (values: readonly number[]) => percentile(values, 0.5);

/** Wraps a model caller so every request and the calls it chose are kept. */
export function recordingCaller(callModel: ModelCaller) {
  const calls: RecordedCall[] = [];
  const caller: ModelCaller = async (input) => {
    const system = input.messages[0]?.role === "system" ? (input.messages[0].content as string) : "";
    const turn = await callModel(input);
    calls.push({
      system,
      tools: JSON.stringify(input.tools),
      toolNames: turn.toolCalls.map((call) => call.name),
      model: turn.model,
    });
    return turn;
  };
  return { caller, calls };
}

/** Tool names whose effect is always a read. */
export function readOnlyToolNames() {
  const session = createSession({ backend: new MemoryBackend(), prompt: "" });
  return new Set(
    [...buildHarnessTools(session), ...runOnlyTools(session)].filter((tool) => tool.effect === "read").map((tool) => tool.name),
  );
}

/**
 * The loop's discipline over one conversation: a byte-stable prompt and tool
 * list, and no more than `readTurns` model turns in a row that only read
 * before the first change.
 */
export function disciplineProblems(calls: readonly RecordedCall[], readTools: ReadonlySet<string>, readTurns = 1) {
  const problems: string[] = [];
  if (new Set(calls.map((call) => call.system)).size > 1) problems.push("the system prompt changed between model calls");
  if (new Set(calls.map((call) => call.tools)).size > 1) problems.push("the tool list changed between model calls");
  let readOnly = 0;
  for (const call of calls) {
    if (!call.toolNames.length) break;
    // Asking the user ends the streak: what follows acts on their answer.
    if (call.toolNames.includes("ask_user")) break;
    if (!call.toolNames.every((name) => readTools.has(name))) break;
    readOnly += 1;
  }
  if (readOnly > readTurns)
    problems.push(`${readOnly} read-only model turns in a row before the first change (at most ${readTurns}); independent reads go out together`);
  return problems;
}

function touchedArtifacts(backend: MemoryBackend): EvalArtifact[] {
  return [...backend.artifacts.values()]
    .filter((artifact) => artifact.createdBy === "ai" || artifact.revisions > 0)
    .map((artifact) => {
      const authored = isAuthoredType(artifact.type);
      return {
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        action: artifact.createdBy === "ai" ? "created" : "edited",
        shape: authored ? authoredShape(artifact.type as never, artifact.content) : "",
        preview: (authored ? readAuthored(artifact.type as never, artifact.content) : JSON.stringify(artifact.content)).slice(0, 4_000),
      };
    });
}

type Played = {
  problems: string[];
  sample: EvalSample;
  turns: number;
  modelCalls: number;
  steps: string[];
  title?: string;
  reply: string;
  artifacts: EvalArtifact[];
  model?: string;
};

async function playOnce(scenario: EvalScenario, deps: EvalDeps, readTools: ReadonlySet<string>): Promise<Played> {
  const clock = deps.clock ?? Date.now;
  const backend = new MemoryBackend({ prompt: scenario.prompt, ...scenario.backend });
  const { caller, calls } = recordingCaller(deps.callModel);
  const events: HarnessEvent[] = [];
  const passes: HarnessRunResult[] = [];
  const started = clock();
  let firstOutputMs: number | null = null;
  let stepEnded = false;
  let steered = false;
  const stopper = new AbortController();
  const focused = scenario.focus ? backend.artifacts.get(scenario.focus) : undefined;

  const run = (prompt: string, extra: Partial<HarnessRunInput>) =>
    runHarness({
      runId: `eval-${scenario.name.replace(/\W+/g, "-")}-${passes.length + 1}`,
      backend,
      prompt,
      history: scenario.history,
      permissions: { ...DEFAULT_PERMISSION_PREFS, ...scenario.permissions },
      wantTitle: passes.length === 0,
      environment: {
        now: deps.environmentNow ?? EVAL_NOW,
        user: { name: "Alex", role: "student", school: "an IB school", subjects: ["Biology HL", "History SL", "French B"] },
        page: focused ? `Editing ${focused.type} "${focused.title}"` : "Chat",
        ...(focused ? { open: [{ id: focused.id, type: focused.type, title: focused.title }] } : {}),
      },
      callModel: caller,
      titleWriter: scenario.nameThread ? (deps.titleWriter ?? modelThreadTitleWriter) : (deps.titleWriter ?? null),
      compactor: createCompactor({ contextWindow: scenario.contextWindow ?? 200_000, summarise: deps.summarise }),
      now: clock,
      signal: AbortSignal.any([stopper.signal, AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)]),
      sink: {
        emit: (event) => {
          if (firstOutputMs === null && (event.type === "text" || event.type === "reasoning" || event.type === "step_start"))
            firstOutputMs = clock() - started;
          if (event.type === "step_end" && !stepEnded) {
            stepEnded = true;
            if (scenario.interrupt?.kind === "stop") stopper.abort();
          }
          events.push(event);
        },
        checkpoint: async () => {
          if (scenario.interrupt?.kind !== "steer" || !stepEnded || steered) return undefined;
          steered = true;
          return { steers: [{ text: scenario.interrupt.text }] };
        },
      },
      ...extra,
    });

  let answered = false;
  let history: HarnessMessage[] | undefined = scenario.history;
  for (const prompt of [scenario.prompt, ...(scenario.followUps ?? [])]) {
    backend.startPass();
    let result = await run(prompt, { history });
    passes.push(result);
    while (result.status === "paused" && scenario.answer && !answered) {
      answered = true;
      result = await run(prompt, { resume: { state: result.state, answer: scenario.answer(result.pending) } });
      passes.push(result);
    }
    await result.titling;
    if (result.status !== "completed") break;
    history = result.state.messages;
  }

  const result = passes[passes.length - 1]!;
  const problems = scenario.check({ backend, result, events, passes });
  // A step that starts and never ends spins on the user's screen for good.
  if (result.status === "completed") {
    const open = new Set<string>();
    for (const event of events) {
      if (event.type === "step_start") open.add(event.id);
      if (event.type === "step_end") open.delete(event.id);
    }
    if (open.size) problems.push(`${open.size} step(s) started and never finished`);
  }
  if (scenario.expectPause && !passes.some((pass) => pass.status === "paused" && pass.pending.kind === scenario.expectPause))
    problems.push(`expected a ${scenario.expectPause} pause`);
  // A subscription CLI hands over a turn's calls one by one with no model time
  // between them, so "turns" here says nothing about how it batched its reads.
  problems.push(...disciplineProblems(calls, readTools, deps.subscription ? Infinity : scenario.readTurns));
  return {
    problems,
    sample: { firstOutputMs, totalMs: clock() - started },
    turns: passes.reduce((sum, pass) => sum + pass.state.turns, 0),
    modelCalls: calls.length,
    steps: events.flatMap((event) => (event.type === "step_start" ? [event.label] : [])),
    title: events.flatMap((event) => (event.type === "thread_title" ? [event.title] : []))[0],
    reply: result.state.text.slice(0, 2_000),
    artifacts: touchedArtifacts(backend),
    model: calls.find((call) => call.model)?.model,
  };
}

function failedPlay(error: unknown): Played {
  return {
    problems: [`the run threw: ${error instanceof Error ? error.message : String(error)}`],
    sample: { firstOutputMs: null, totalMs: 0 },
    turns: 0,
    modelCalls: 0,
    steps: [],
    reply: "",
    artifacts: [],
  };
}

/** Plays a scenario (repeated when it asks) into one row. */
export async function playScenario(scenario: EvalScenario, deps: EvalDeps, readTools = readOnlyToolNames()): Promise<EvalRow> {
  const plays: Played[] = [];
  for (let index = 0; index < Math.max(1, scenario.repeat ?? 1); index += 1)
    plays.push(await playOnce(scenario, deps, readTools).catch(failedPlay));

  const samples = plays.map((play) => play.sample);
  const firsts = samples.flatMap((sample) => (sample.firstOutputMs === null ? [] : [sample.firstOutputMs]));
  const firstOutputMs = median(firsts);
  const totalMs = median(samples.map((sample) => sample.totalMs)) ?? 0;
  const problems = [...new Set(plays.flatMap((play, index) => play.problems.map((problem) => (plays.length > 1 ? `run ${index + 1}: ${problem}` : problem))))];
  if (scenario.latency?.firstOutputMs !== undefined && (firstOutputMs === null || firstOutputMs > scenario.latency.firstOutputMs * LATENCY_SLACK))
    problems.push(`first output ${firstOutputMs ?? "never"} ms at p50, target under ${scenario.latency.firstOutputMs} ms`);
  if (scenario.latency?.totalMs !== undefined && totalMs > scenario.latency.totalMs * LATENCY_SLACK)
    problems.push(`took ${totalMs} ms at p50, target under ${scenario.latency.totalMs} ms`);

  const last = plays[plays.length - 1]!;
  return {
    name: scenario.name,
    group: scenario.group,
    prompt: scenario.prompt,
    pass: problems.length === 0,
    problems,
    firstOutputMs,
    totalMs,
    samples,
    turns: last.turns,
    modelCalls: last.modelCalls,
    steps: last.steps,
    title: last.title,
    reply: last.reply,
    artifacts: last.artifacts,
    model: last.model,
  };
}

export function summariseEvals(rows: readonly EvalRow[], scenarios: readonly EvalScenario[]): EvalSummary {
  const groups = new Map<EvalGroup, { total: number; passed: number }>();
  for (const row of rows) {
    const entry = groups.get(row.group) ?? { total: 0, passed: 0 };
    entry.total += 1;
    if (row.pass) entry.passed += 1;
    groups.set(row.group, entry);
  }
  const latency: LatencyTarget[] = [];
  for (const row of rows) {
    const budget = scenarios.find((scenario) => scenario.name === row.name)?.latency;
    if (budget?.firstOutputMs !== undefined)
      latency.push({
        name: row.name,
        metric: "first output",
        p50: row.firstOutputMs,
        targetMs: budget.firstOutputMs,
        pass: row.firstOutputMs !== null && row.firstOutputMs <= budget.firstOutputMs * LATENCY_SLACK,
      });
    if (budget?.totalMs !== undefined)
      latency.push({ name: row.name, metric: "total", p50: row.totalMs, targetMs: budget.totalMs, pass: row.totalMs <= budget.totalMs * LATENCY_SLACK });
  }
  const passed = rows.filter((row) => row.pass).length;
  return {
    total: rows.length,
    passed,
    failed: rows.length - passed,
    groups: [...groups].map(([group, counts]) => ({ group, ...counts })),
    latency,
  };
}

/** Plays scenarios one after another (a live model is rate limited). */
export async function runEvals(
  scenarios: readonly EvalScenario[],
  deps: EvalDeps,
  options: { model?: string; onRow?: (row: EvalRow) => void } = {},
): Promise<EvalResults> {
  const clock = deps.clock ?? Date.now;
  const readTools = readOnlyToolNames();
  const startedAt = clock();
  const rows: EvalRow[] = [];
  for (const scenario of scenarios) {
    const row = await playScenario(scenario, deps, readTools);
    rows.push(row);
    options.onRow?.(row);
  }
  return {
    startedAt,
    finishedAt: clock(),
    model: options.model ?? rows.find((row) => row.model)?.model ?? null,
    rows,
    summary: summariseEvals(rows, scenarios),
  };
}
