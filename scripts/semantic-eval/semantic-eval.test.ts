/**
 * Offline semantic eval: the labelled fixture queries through the real index and search, with
 * the deterministic embedder. It guards the pipeline (chunking, fusion, cues, hints, grouping)
 * against regressions; model quality is measured live by `npm run eval:semantic`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deterministicEmbedding, embeddingFetch } from "./embedder";
import { SEMANTIC_TUNING } from "../../shared/semantic-ranking";
import { formatReport, relatedThreshold, runQueries, sweepRrfK } from "./harness";
import { createSemanticWorld, indexEverything, type SemanticWorld } from "./world";

vi.mock("../../convex/env", async (importOriginal) => ({ ...await importOriginal<typeof import("../../convex/env")>(),
  getOpenRouterApiKey: () => "synthetic-test" }));

/** Verbose output bypasses the console capture so it prints even under fake timers. */
const show = (text: string) => { if (process.env.SEMANTIC_EVAL_VERBOSE) process.stdout.write(`${text}
`); };

let world: SemanticWorld;
beforeAll(async () => {
  // Real performance clock for latency; fake scheduling and Date for the fixed EVAL_NOW.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "Date"] });
  vi.stubGlobal("fetch", embeddingFetch((texts) => texts.map(deterministicEmbedding)));
  world = await createSemanticWorld();
  await indexEverything(world);
}, 60_000);
afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("offline semantic eval (deterministic embeddings)", () => {
  it("finds the labelled answers", async () => {
    const report = await runQueries(world);
    show(formatReport("offline", report));
    const misses = report.outcomes.filter((outcome) => outcome.rank === null || outcome.rank > 3).map((outcome) => outcome.query);
    expect(misses).toEqual([]);
    expect(report.overall.mrr).toBeGreaterThanOrEqual(0.9);
    expect(report.overall.recallAt5).toBeGreaterThanOrEqual(0.95);
    for (const category of ["exact", "vague"]) expect(report.byCategory[category]!.top1).toBe(1);
  }, 60_000);

  it("separates related from unrelated pairs", async () => {
    const { pairs, best } = await relatedThreshold(world);
    show(JSON.stringify({ pairs, best }));
    expect(best.f1).toBeGreaterThanOrEqual(0.85);
  });

  it("keeps the tuned RRF k at least as good as its neighbours", async () => {
    const tunedK = SEMANTIC_TUNING.rrfK;
    const sweep = await sweepRrfK(world, [tunedK / 2, tunedK, tunedK * 2]);
    show(JSON.stringify(sweep));
    const tuned = sweep.find((row) => row.rrfK === tunedK)!;
    for (const row of sweep) expect(tuned.mrr).toBeGreaterThanOrEqual(row.mrr - 0.02);
  }, 120_000);
});
