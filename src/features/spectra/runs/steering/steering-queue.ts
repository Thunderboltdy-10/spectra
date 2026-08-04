export type SteerMode = "refine_current_goal" | "redirect_next_step" | "replace_goal" | "cancel_current_action";
export type SteerMessage = {
  id: string;
  runId: string;
  mode: SteerMode;
  text: string;
  createdAt: number;
  applyAt: "next_safe_boundary";
};
export type SafeBoundary = "after_tool_result" | "after_complete_gesture" | "after_patch_checkpoint" | "before_model_continuation" | "after_action_abort";

export class SteeringQueue {
  private readonly queued: SteerMessage[] = [];
  private readonly applied = new Set<string>();

  enqueue(message: SteerMessage) {
    if (this.applied.has(message.id) || this.queued.some((entry) => entry.id === message.id)) return message;
    this.queued.push({ ...message, text: message.text.trim().slice(0, 8_000) });
    this.queued.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    return message;
  }

  apply(runId: string, boundary: SafeBoundary) {
    const index = this.queued.findIndex((entry) => entry.runId === runId);
    if (index < 0) return null;
    const [message] = this.queued.splice(index, 1);
    this.applied.add(message!.id);
    return { message: message!, boundary };
  }

  pending(runId: string) {
    return this.queued.filter((entry) => entry.runId === runId);
  }
}
