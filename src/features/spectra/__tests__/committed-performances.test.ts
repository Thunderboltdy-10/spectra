import { afterEach, expect, it, vi } from "vitest";
import { committedPerformancesFor, rememberCommittedPerformance, subscribeCommittedPerformances } from "../collaboration/committed-performances";
import { performancePatches, type AiPerformance } from "../collaboration/performance";
import { PerformanceStage } from "../collaboration/performance-stage";

afterEach(() => vi.useRealTimers());

it("keeps a committed creation for its opening studio after the writer disconnects", () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const before = { title: "Revision", tags: [], content: { blocks: [] } };
  const after = { ...before, content: { blocks: [{ id: "intro", type: "paragraph", text: "Review vectors." }] } };
  const performance: AiPerformance = {
    v: 1, id: "committed-create", runId: "run", operationId: "create", artifactId: "revision",
    typeKey: "document", actor: { clientId: "ai", kind: "ai", name: "Spectra" },
    startAt: 10_000, estimateMs: 2_000, seed: 1, tempo: 1, regionIds: ["artifact:structure"],
    ...performancePatches(before, after),
  };
  const changed = vi.fn();
  const stop = subscribeCommittedPerformances(changed);
  rememberCommittedPerformance(performance, Date.now());
  rememberCommittedPerformance(performance, Date.now());
  expect(changed).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(2_000); // The new studio mounts after the socket is gone.
  const stage = new PerformanceStage(() => after, vi.fn());
  stage.ingest(committedPerformancesFor("revision"));
  expect(stage.presence().get("ai")).toMatchObject({ actorKind: "ai" });
  expect(committedPerformancesFor("another-work")).toEqual([]);
  vi.advanceTimersByTime(30_000);
  expect(stage.presence().size).toBe(0);
  expect(committedPerformancesFor("revision")).toEqual([]);
  expect(rememberCommittedPerformance({ ...performance, id: "history" }, 1)).toBeUndefined();
  expect(rememberCommittedPerformance({ ...performance, id: "refused", withdrawn: true }, Date.now())).toBeUndefined();
  stage.destroy();
  stop();
});
