import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isAuthoredType, readAuthored } from "../authoring";
import { modelCaptionWriter } from "../captions";
import { createCompactor } from "../compaction";
import { MemoryBackend } from "../memory-backend";
import { DEFAULT_PERMISSION_PREFS } from "../permissions";
import { modelSummariser, runHarness, type HarnessEvent, type HarnessRunResult } from "../run";
import { loadSmokeEnv } from "./env";
import { SMOKE_SCENARIOS, type SmokeScenario } from "./scenarios";

const env = loadSmokeEnv();
const only = process.env.SPECTRA_SMOKE_ONLY?.split(",").map((name) => name.trim().toLowerCase());

type Row = {
  name: string;
  pass: boolean;
  problems: string[];
  firstOutputMs: number | null;
  firstCaptionMs: number | null;
  totalMs: number;
  turns: number;
  tools: string[];
  captions: string[];
  title?: string;
  reply: string;
};

const rows: Row[] = [];

async function play(scenario: SmokeScenario): Promise<Row> {
  const backend = new MemoryBackend({ prompt: scenario.prompt, ...scenario.backend });
  const events: HarnessEvent[] = [];
  const passes: HarnessRunResult[] = [];
  const started = Date.now();
  let firstOutputMs: number | null = null;
  let firstCaptionMs: number | null = null;
  const focused = scenario.focus ? backend.artifacts.get(scenario.focus) : undefined;
  const base = {
    runId: `smoke-${scenario.name.replace(/\W+/g, "-")}`,
    backend,
    prompt: scenario.prompt,
    history: scenario.history,
    permissions: DEFAULT_PERMISSION_PREFS,
    wantTitle: true,
    environment: {
      now: Date.now(),
      user: { name: "Alex", role: "student", school: "an IB school", subjects: ["Biology HL", "History SL", "French B"] },
      page: focused ? `Editing ${focused.type} "${focused.title}"` : "Chat",
      ...(focused && isAuthoredType(focused.type)
        ? {
            focused: {
              id: focused.id,
              type: focused.type,
              title: focused.title,
              canEdit: true,
              outline: readAuthored(focused.type, focused.content).slice(0, 1_500),
            },
          }
        : {}),
    },
    captionWriter: modelCaptionWriter,
    compactor: createCompactor({
      contextWindow: scenario.contextWindow ?? 200_000,
      summarise: modelSummariser,
    }),
    sink: {
      emit: (event: HarnessEvent) => {
        const at = Date.now() - started;
        if (firstOutputMs === null && (event.type === "text" || event.type === "caption" || event.type === "step_start"))
          firstOutputMs = at;
        if (firstCaptionMs === null && event.type === "caption") firstCaptionMs = at;
        events.push(event);
      },
      checkpoint: async () => undefined,
    },
  };
  let result = await runHarness({ ...base, signal: AbortSignal.timeout(8 * 60_000) });
  passes.push(result);
  if (result.status === "paused" && scenario.answer) {
    result = await runHarness({
      ...base,
      signal: AbortSignal.timeout(8 * 60_000),
      resume: { state: result.state, answer: scenario.answer(result.pending) },
    });
    passes.push(result);
  }
  const problems = scenario.check({ backend, result, events, passes });
  if (scenario.expectPause && passes.length < 2) problems.push(`expected a ${scenario.expectPause} pause`);
  return {
    name: scenario.name,
    pass: problems.length === 0,
    problems,
    firstOutputMs,
    firstCaptionMs,
    totalMs: Date.now() - started,
    turns: result.state.turns,
    tools: events.filter((event) => event.type === "step_start").map((event) => (event as { label: string }).label),
    captions: events.filter((event) => event.type === "caption").map((event) => (event as { text: string }).text),
    title: (events.find((event) => event.type === "thread_title") as { title?: string } | undefined)?.title,
    reply: result.state.text.slice(0, 400),
  };
}

describe.skipIf(env.missing.length > 0)("Spectra harness smoke run (real model)", () => {
  for (const scenario of SMOKE_SCENARIOS) {
    const skip = only && !only.includes(scenario.name.toLowerCase());
    it.skipIf(Boolean(skip))(scenario.name, async () => {
      const row = await play(scenario);
      rows.push(row);
      console.log(
        `[smoke] ${row.pass ? "PASS" : "FAIL"} ${row.name}: ${row.totalMs} ms total, first output ${row.firstOutputMs ?? "-"} ms, ${row.turns} turns${row.problems.length ? ` - ${row.problems.join("; ")}` : ""}`,
      );
      expect(row.problems).toEqual([]);
    });
  }

  afterAll(() => {
    if (!rows.length) return;
    const dir = path.resolve(".spectra-local/smoke");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `ai-harness-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify({ rows }, null, 2));
    console.log(`[smoke] results written to ${path.relative(process.cwd(), file)}`);
  });
});

if (env.missing.length)
  console.warn(`[smoke] skipped: missing ${env.missing.join(", ")} (looked in ${env.source}).`);
