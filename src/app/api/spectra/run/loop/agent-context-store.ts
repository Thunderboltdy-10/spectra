import { act } from "./io";
import type { AgentContextCheckpoint, AgentContextPersistence } from "@/features/spectra/ai/agent-context";

export async function durableAgentContext(input: {
  runId: string; executionId: string; workerId: string; hasCheckpoint: boolean;
}): Promise<AgentContextPersistence & { finish: () => Promise<void> }> {
  const identity = { runId: input.runId, executionId: input.executionId, workerId: input.workerId };
  const loaded = input.hasCheckpoint
    ? await act<typeof identity, { generation: number; payload: string } | null>("spectraAgentContext:load", identity)
    : null;
  let generation = loaded?.generation ?? 0;
  return {
    initial: loaded ? JSON.parse(loaded.payload) as AgentContextCheckpoint : undefined,
    async save(checkpoint) {
      const saved = await act<object, { generation: number }>("spectraAgentContext:save", {
        ...identity, expectedGeneration: generation, payload: JSON.stringify(checkpoint),
      });
      generation = saved.generation;
    },
    async finish() {
      if (!generation) return;
      await act("spectraAgentContext:finish", { ...identity, expectedGeneration: generation });
      generation = 0;
    },
  };
}
