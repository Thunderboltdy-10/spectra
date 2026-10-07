import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Token usage for one run execution. Every provider response is recorded here,
 * including failed, repair and fallback passes, parallel creation workers and
 * web research, because the school model-token ceiling must see every call.
 * Only reporting the final pass's usage under-counted exactly the expensive runs.
 */
export type RunUsageTotals = {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  providerCalls: number;
};

const ledger = new AsyncLocalStorage<RunUsageTotals>();

export function withRunUsageLedger<T>(task: () => Promise<T>) {
  return ledger.run(
    { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, providerCalls: 0 },
    task,
  );
}

/** True inside a run execution, where every provider response is already counted. */
export function insideRunUsageLedger() {
  return ledger.getStore() !== undefined;
}

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Records one provider response's usage (normalized or raw OpenAI-style fields). */
export function recordProviderUsage(usage: unknown) {
  const totals = ledger.getStore();
  if (!totals || !usage || typeof usage !== "object") return;
  const row = usage as Record<string, unknown>;
  const details = row.completion_tokens_details && typeof row.completion_tokens_details === "object"
    ? (row.completion_tokens_details as Record<string, unknown>)
    : {};
  const prompt = count(row.promptTokens ?? row.prompt_tokens);
  const completion = count(row.completionTokens ?? row.completion_tokens);
  totals.promptTokens += prompt;
  totals.completionTokens += completion;
  totals.reasoningTokens += count(row.reasoningTokens ?? details.reasoning_tokens);
  totals.totalTokens += count(row.totalTokens ?? row.total_tokens) || prompt + completion;
  totals.providerCalls += 1;
}

/**
 * The execution's usage so far, merged over a pass's own usage record (which
 * keeps timing fields). Undefined outside a run or before any provider call.
 */
export function runUsageSnapshot<T extends object>(passUsage?: T) {
  const totals = ledger.getStore();
  if (!totals || totals.providerCalls === 0) return passUsage;
  return { ...(passUsage ?? {}), ...totals };
}
