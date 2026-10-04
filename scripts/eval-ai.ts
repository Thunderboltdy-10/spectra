/*
 * npm run eval:ai [-- --only "hello,small document edit"] [-- --group create]
 *
 * Plays the Spectra AI eval scenarios against the real model (OpenRouter,
 * with the model, provider and reasoning from the environment) and an
 * in-memory Spectra, then writes .spectra-local/ai-evals/<date>/report.html.
 * Exits 1 when the model keys are missing or any scenario fails. Prints key
 * names only, never values. It runs under the react-server condition because
 * the harness imports server-only modules.
 */
import path from "node:path";
import { loadEvalEnv } from "../src/features/spectra/ai/harness/evals/env";

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value?.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

async function main() {
  const env = loadEvalEnv();
  if (env.missing.length) {
    console.error(`[eval:ai] missing ${env.missing.join(", ")} (looked in ${env.source}).`);
    process.exit(1);
  }
  // Loaded after the environment so model settings are read from it.
  const { EVAL_SCENARIOS } = await import("../src/features/spectra/ai/harness/evals/scenarios");
  const { runEvals } = await import("../src/features/spectra/ai/harness/evals/runner");
  const { writeEvalReport } = await import("../src/features/spectra/ai/harness/evals/report");
  const { modelCaptionWriter } = await import("../src/features/spectra/ai/harness/captions");
  const { openRouterModelCaller } = await import("../src/features/spectra/ai/harness/model");
  const { modelSummariser } = await import("../src/features/spectra/ai/harness/run");

  const only = option("only");
  const groups = option("group");
  const scenarios = EVAL_SCENARIOS.filter(
    (scenario) => (!only || only.includes(scenario.name.toLowerCase())) && (!groups || groups.includes(scenario.group)),
  );
  if (!scenarios.length) {
    console.error("[eval:ai] no scenario matches --only or --group.");
    process.exit(1);
  }

  console.log(`[eval:ai] ${scenarios.length} scenarios with ${process.env.SPECTRA_MODEL_ID}`);
  const results = await runEvals(
    scenarios,
    { callModel: openRouterModelCaller, captionWriter: modelCaptionWriter, summarise: modelSummariser },
    {
      model: process.env.SPECTRA_MODEL_ID,
      onRow: (row) =>
        console.log(
          `[eval:ai] ${row.pass ? "PASS" : "FAIL"} ${row.name}: first output ${row.firstOutputMs ?? "-"} ms, ${row.totalMs} ms total${row.problems.length ? ` - ${row.problems.join("; ")}` : ""}`,
        ),
    },
  );
  const dir = writeEvalReport(results);
  const { summary } = results;
  console.log(`[eval:ai] ${summary.passed} of ${summary.total} passed`);
  for (const target of summary.latency)
    console.log(`[eval:ai] ${target.name} ${target.metric} p50 ${target.p50 ?? "-"} ms (target ${target.targetMs} ms) ${target.pass ? "ok" : "MISSED"}`);
  console.log(`[eval:ai] report: ${path.relative(process.cwd(), path.join(dir, "report.html"))}`);
  process.exit(summary.failed ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(`[eval:ai] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
