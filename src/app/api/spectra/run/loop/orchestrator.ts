export const AGENT_LOOP_STAGES = [
  "intake",
  "plan",
  "resolve",
  "gather",
  "act",
  "verify",
  "report",
] as const;

export type AgentLoopStage = (typeof AGENT_LOOP_STAGES)[number];

export type AgentLoopTranscriptEntry = {
  runId: string;
  stage: AgentLoopStage;
  status: "entered" | "skipped";
  reason?: string;
};

type AgentLoopExecutionOptions = {
  runId: string;
  startAt?: AgentLoopStage;
  onTransition?: (entry: AgentLoopTranscriptEntry) => void;
};

/**
 * Records the canonical AI-loop boundary without owning leases, persistence,
 * or streaming. Those remain in the durable run engine. Moving from one stage
 * to a later stage records every bypass explicitly so early answers and paused
 * confirmations cannot make an incomplete path look like a mutation path.
 */
export class AgentLoopExecution {
  readonly #runId: string;
  readonly #onTransition?: (entry: AgentLoopTranscriptEntry) => void;
  readonly #transcript: AgentLoopTranscriptEntry[] = [];
  #cursor: number;

  constructor(options: AgentLoopExecutionOptions) {
    this.#runId = options.runId;
    this.#onTransition = options.onTransition;
    this.#cursor = options.startAt
      ? AGENT_LOOP_STAGES.indexOf(options.startAt) - 1
      : -1;
  }

  enter(stage: AgentLoopStage, skippedReason = "not required for this path") {
    const nextIndex = AGENT_LOOP_STAGES.indexOf(stage);
    if (nextIndex <= this.#cursor) {
      const current = AGENT_LOOP_STAGES[this.#cursor] ?? "not started";
      throw new Error(
        `Agent loop cannot move from ${current} back to ${stage}.`,
      );
    }
    for (let index = this.#cursor + 1; index < nextIndex; index += 1) {
      this.#append({
        runId: this.#runId,
        stage: AGENT_LOOP_STAGES[index]!,
        status: "skipped",
        reason: skippedReason,
      });
    }
    this.#append({ runId: this.#runId, stage, status: "entered" });
    this.#cursor = nextIndex;
  }

  snapshot() {
    return this.#transcript.map((entry) => ({ ...entry }));
  }

  currentStage() {
    return this.#cursor >= 0 ? AGENT_LOOP_STAGES[this.#cursor]! : null;
  }

  #append(entry: AgentLoopTranscriptEntry) {
    this.#transcript.push(entry);
    this.#onTransition?.(entry);
  }
}

export function createAgentLoopExecution(options: AgentLoopExecutionOptions) {
  return new AgentLoopExecution(options);
}
