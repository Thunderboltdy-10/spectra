import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_LOOP_STAGES,
  createAgentLoopExecution,
} from "@/app/api/spectra/run/loop/orchestrator";

describe("Spectra agent-loop extraction", () => {
  it("keeps the Next route as a transport-only boundary", () => {
    const route = readFileSync(
      new URL("../../../app/api/spectra/run/route.ts", import.meta.url),
      "utf8",
    );

    expect(route.split(/\r?\n/)).toHaveLength(9);
    expect(route).toContain('from "./runtime"');
    expect(route).not.toMatch(/convex|openrouter|artifact|workspace/i);
  });

  it("fixes the canonical stage order and refuses backward execution", () => {
    expect(AGENT_LOOP_STAGES).toEqual([
      "intake",
      "plan",
      "resolve",
      "gather",
      "act",
      "verify",
      "report",
    ]);
    const onTransition = vi.fn();
    const execution = createAgentLoopExecution({
      runId: "run-contract",
      onTransition,
    });

    execution.enter("intake");
    execution.enter("plan");
    execution.enter("report", "answer path");

    expect(execution.snapshot().map(({ stage, status }) => [stage, status]))
      .toEqual([
        ["intake", "entered"],
        ["plan", "entered"],
        ["resolve", "skipped"],
        ["gather", "skipped"],
        ["act", "skipped"],
        ["verify", "skipped"],
        ["report", "entered"],
      ]);
    expect(() => execution.enter("act")).toThrow(
      "Agent loop cannot move from report back to act.",
    );
    expect(onTransition).toHaveBeenCalledTimes(7);
  });
});
