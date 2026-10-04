/**
 * Live semantic eval (`npm run eval:semantic`): indexes the fixture corpus with the real
 * embedding model, runs the labelled queries, measures the Related threshold and sweeps RRF k.
 * Writes report.md and results.json under .spectra-local/semantic-evals/<date>/. Never prints keys.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { embeddingConfig, requestEmbeddings } from "../../convex/embeddingProvider";
import { SEMANTIC_TUNING, SIGNAL_WEIGHTS } from "../../shared/semantic-ranking";
import { formatReport, relatedThreshold, runQueries, sweepRrfK } from "./harness";
import { createSemanticWorld, type SemanticWorld } from "./world";

/** Runs the backfill on real timers until it is done and the queue is empty (at most 3 minutes). */
async function indexLive(target: SemanticWorld) {
  await target.t.mutation(internal.semanticIndex.startBackfill, { restart: true });
  const started = performance.now();
  for (;;) {
    await target.t.finishInProgressScheduledFunctions();
    const status = await target.t.query(internal.semanticIndex.backfillStatus, {});
    const items = await target.t.run(async (ctx) => (await ctx.db.query("semanticItems").collect()).length);
    if (status.backfill?.phase === "done" && status.running === 0 && status.pendingVectors === 0 && items >= status.backfill.enqueued) return;
    if (performance.now() - started > 180_000) throw new Error(`Backfill did not finish: ${JSON.stringify(status)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const runDate = new Date().toISOString().slice(0, 10);
let world: SemanticWorld;
let indexMs = 0;
/** Embedding calls by outcome (HTTP status or error name), to tell endpoint trouble from pipeline trouble. */
const calls: Record<string, number> = {};

beforeAll(async () => {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("No OPENROUTER_API_KEY found in .env.local (set SEMANTIC_EVAL_ENV_FILE).");
  // Only Date is faked (fixed EVAL_NOW, advancing with real time). Scheduling stays real, so
  // the provider's timeouts and backoff behave as in production while the backfill runs.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
    try {
      const response = await realFetch(...args);
      calls[String(response.status)] = (calls[String(response.status)] ?? 0) + 1;
      return response;
    } catch (error) {
      const name = error instanceof Error ? error.name : "error";
      calls[name] = (calls[name] ?? 0) + 1;
      throw error;
    }
  });
  world = await createSemanticWorld();
  const started = performance.now();
  await indexLive(world);
  indexMs = Math.round(performance.now() - started);
});
afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("measures search and related quality with live embeddings", async () => {
  const status = await world.t.query(internal.semanticIndex.backfillStatus, {});
  const items = await world.t.run(async (ctx) => (await ctx.db.query("semanticItems").collect())
    .map((row) => ({ state: row.embeddingState, centroid: Boolean(row.centroid) })));
  const queue = await world.t.run(async (ctx) => (await ctx.db.query("semanticIndexQueue").collect())
    .map((row) => ({ kind: row.itemKind, status: row.status, dueInMs: row.dueAt - Date.now(), attempts: row.attempts, rerun: row.rerun })));
  const report = await runQueries(world);
  const related = await relatedThreshold(world);
  const sweep = await sweepRrfK(world, [5, 10, 20, 40, 60]);
  const config = embeddingConfig();
  // A direct batch call, so a failed index run says whether the endpoint or the pipeline failed.
  const probe = await requestEmbeddings(["cell biology notes", "apuntes de biologia"], { attempts: 1 });
  const summary = {
    probe: probe.ok ? "ok" : probe.code, embeddingCalls: calls, queueAfterIndex: queue,
    date: runDate, env: process.env.SEMANTIC_EVAL_ENV_SOURCE, model: config?.model, provider: config?.provider, version: config?.version,
    tuning: { ...SEMANTIC_TUNING }, weights: SIGNAL_WEIGHTS, indexMs,
    indexed: { items: items.length, complete: items.filter((item) => item.state === "complete").length,
      withCentroid: items.filter((item) => item.centroid).length, backfill: status },
    overall: report.overall, byCategory: report.byCategory, related, rrfSweep: sweep, outcomes: report.outcomes,
  };
  const markdown = [
    formatReport(`live, ${config?.model ?? "no model"} (${runDate})`, report), "",
    `Indexed ${summary.indexed.complete}/${summary.indexed.items} items with vectors in ${indexMs} ms (in-process, real embeddings).`,
    "Latency includes the live query-embedding call; Convex function overhead is not included.", "",
    "## Related threshold", "",
    `Best separating threshold ${related.best.threshold} (F1 ${related.best.f1}); configured ${SEMANTIC_TUNING.relatedMinSimilarity}.`, "",
    "| a | b | related | similarity |", "|---|---|---|---|",
    ...related.pairs.map((pair) => `| ${pair.a} | ${pair.b} | ${pair.related ? "yes" : "no"} | ${pair.similarity} |`), "",
    "## RRF k sweep", "", "| k | recall@5 | MRR | top-1 |", "|---|---|---|---|",
    ...sweep.map((row) => `| ${row.rrfK} | ${row.recallAt5} | ${row.mrr} | ${row.top1} |`), "",
  ].join("\n");
  const dir = path.resolve(".spectra-local/semantic-evals", runDate);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "report.md"), markdown);
  writeFileSync(path.join(dir, "results.json"), JSON.stringify(summary, null, 2));
  process.stdout.write(`${markdown}\nWrote ${path.relative(process.cwd(), dir)}\n`);
  expect(summary.indexed.complete).toBe(summary.indexed.items);
});
