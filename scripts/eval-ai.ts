/*
 * npm run eval:ai [-- --only "hello,small document edit"] [-- --group create] [-- --runtime codex]
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
  const { modelThreadTitleWriter } = await import("../src/features/spectra/ai/harness/thread-title");
  const { openRouterModelCaller } = await import("../src/features/spectra/ai/harness/model");
  const { modelSummariser } = await import("../src/features/spectra/ai/harness/run");
  const { subscriptionModelCaller, runtimeStatus } = await import("../src/features/spectra/ai/harness/subscription-runtime");
  const { withRuntimeFallback } = await import("../src/features/spectra/ai/harness/subscription-runtime");
  const { ProviderUnavailableError } = await import("../src/features/spectra/ai/harness/types");
  const mode = option("runtime")?.[0];
  const model = option("model")?.[0];
  const runtime = mode === "codex" || mode === "claude" ? mode : undefined;
  const statuses = mode ? await runtimeStatus(undefined) : null;
  if (statuses) console.log(`[eval:ai] codex ${statuses.codex.state} [${statuses.codex.models.map((row: { id: string }) => row.id).join(", ")}], claude ${statuses.claude.state}`);
  type Caller = typeof openRouterModelCaller;
  // Each new message in a thread goes to the next runtime, on the plain transcript.
  const switching = (): Caller => {
    const order: Caller[] = [subscriptionModelCaller("codex"), subscriptionModelCaller("claude"), openRouterModelCaller];
    return (input) => order[Math.min(input.messages.filter((message) => message.role === "user").length, order.length) - 1]!(input);
  };
  // The subscription stops answering after a turn: the run carries on with OpenRouter.
  const failingOver = (): Caller => {
    const codex = subscriptionModelCaller("codex");
    let calls = 0;
    const flaky: Caller = (input) => {
      calls += 1;
      if (calls >= 2) throw new ProviderUnavailableError("simulated: Codex went away");
      return codex(input);
    };
    return withRuntimeFallback(flaky as never, openRouterModelCaller, (reason) => console.log(`[eval:ai] fell back: ${reason}`));
  };
  const callModel: Caller =
    mode === "switch" ? switching() : mode === "fallback" ? failingOver() : runtime ? subscriptionModelCaller(runtime, model ? { model } : {}) : openRouterModelCaller;

  const only = option("only");
  const groups = option("group");
  const scenarios = EVAL_SCENARIOS.filter(
    (scenario) => (!only || only.includes(scenario.name.toLowerCase())) && (!groups || groups.includes(scenario.group)),
  );
  if (!scenarios.length) {
    console.error("[eval:ai] no scenario matches --only or --group.");
    process.exit(1);
  }

  console.log(`[eval:ai] ${scenarios.length} scenarios with ${mode ? `${mode}${model ? ` ${model}` : ""}` : process.env.SPECTRA_MODEL_ID}`);
  const results = await runEvals(
    scenarios,
    {
      callModel,
      subscription: Boolean(mode),
      titleWriter: modelThreadTitleWriter,
      summarise: modelSummariser,
    },
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
