import type { ToolExecutionContext, ToolProgress } from "../registry";
import { spectraToolRegistry } from "../registry";
import { boundedToolData, boundedToolSummary, type ToolResult } from "./tool-result";

type ToolCall = { id: string; name: string; input: unknown };

function errorCode(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "tool_cancelled";
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/^([A-Z0-9_]+)(?::|$)/)?.[1]?.toLowerCase() ?? "tool_failed";
}

function delay(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    }, { once: true });
  });
}

async function consumeExecution(value: Promise<unknown> | AsyncGenerator<ToolProgress, unknown>, context: ToolExecutionContext) {
  if (!(value && typeof value === "object" && Symbol.asyncIterator in value)) return value;
  const iterator = value as AsyncGenerator<ToolProgress, unknown>;
  while (true) {
    const next = await iterator.next();
    if (next.done) return next.value;
    context.emitProgress?.(next.value);
  }
}

export class SpectraToolExecutor {
  private domains = new Map<string, Promise<void>>();

  async execute<T = unknown>(call: ToolCall, context: ToolExecutionContext = {}): Promise<ToolResult<T>> {
    const definition = spectraToolRegistry.require(call.name);
    if (context.signal?.aborted)
      return { ok: false, code: "tool_cancelled", message: "The tool was cancelled before it started.", retryable: false };
    const input = definition.inputSchema.safeParse(call.input);
    if (!input.success)
      return { ok: false, code: "invalid_arguments", message: input.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "), retryable: false };
    if (definition.approval !== "never") {
      const approved = await context.requireApproval?.({ toolId: definition.id, risk: definition.risk, input: input.data });
      if (definition.approval === "always" && approved !== true)
        return { ok: false, code: "approval_required", message: `${definition.title} requires approval.`, retryable: true };
      if (approved === false)
        return { ok: false, code: "approval_declined", message: `${definition.title} was not approved.`, retryable: false };
    }
    const startedAt = Date.now();
    const attempts = Math.max(1, definition.retryPolicy.maxAttempts);
    const requestedTimeout = Number(
      input.data && typeof input.data === "object" && !Array.isArray(input.data)
        ? (input.data as Record<string, unknown>).timeoutMs
        : undefined,
    );
    const safetyLimit = Number.isFinite(requestedTimeout)
      ? Math.min(10 * 60_000, Math.max(5_000, requestedTimeout))
      : definition.hardSafetyLimit;
    const run = async () => {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = safetyLimit ? new AbortController() : null;
        const relayAbort = () => controller?.abort(context.signal?.reason);
        context.signal?.addEventListener("abort", relayAbort, { once: true });
        if (context.signal?.aborted) relayAbort();
        const timer = safetyLimit
          ? setTimeout(() => controller?.abort(new Error("TOOL_HARD_SAFETY_LIMIT")), safetyLimit)
          : null;
        try {
          const output = await consumeExecution(
            definition.execute({ ...context, signal: controller?.signal ?? context.signal }, input.data),
            context,
          );
          const parsed = definition.outputSchema.parse(output);
          const summary = definition.summarizeOutput(parsed);
          return {
            ok: true as const,
            data: boundedToolData(parsed) as T,
            summary: boundedToolSummary(summary.text),
            ...(summary.handles?.length ? { workHandles: summary.handles.map((workId) => ({ workId })) } : {}),
            telemetry: { durationMs: Date.now() - startedAt, attempts: attempt },
          };
        } catch (error) {
          const code = errorCode(error);
          const retryable = definition.retryPolicy.retryableCodes.includes(code);
          if (!retryable || attempt === attempts)
            return {
              ok: false as const,
              code,
              message: error instanceof Error ? error.message : `${definition.title} could not complete.`,
              retryable,
              telemetry: { durationMs: Date.now() - startedAt, attempts: attempt },
            };
          await delay(definition.retryPolicy.backoffMs * attempt, context.signal);
        } finally {
          if (timer) clearTimeout(timer);
          context.signal?.removeEventListener("abort", relayAbort);
        }
      }
      return { ok: false as const, code: "tool_failed", message: `${definition.title} could not complete.`, retryable: false };
    };
    const domain = definition.concurrencyDomain;
    if (!domain) return run();
    const prior = this.domains.get(domain) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const chained = prior.then(() => current);
    this.domains.set(domain, chained);
    await prior;
    try {
      return await run();
    } finally {
      release();
      if (this.domains.get(domain) === chained) this.domains.delete(domain);
    }
  }

  async executeBatch(calls: readonly ToolCall[], context: ToolExecutionContext = {}, concurrency = 4) {
    const output: Array<ToolResult | undefined> = new Array(calls.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, calls.length || 1)) }, async () => {
      while (cursor < calls.length) {
        const index = cursor++;
        const call = calls[index]!;
        const definition = spectraToolRegistry.require(call.name);
        if (!definition.parallelSafe) {
          output[index] = await this.execute(call, context);
          continue;
        }
        output[index] = await this.execute(call, context);
      }
    });
    await Promise.all(workers);
    return output as ToolResult[];
  }
}

export const spectraToolExecutor = new SpectraToolExecutor();
