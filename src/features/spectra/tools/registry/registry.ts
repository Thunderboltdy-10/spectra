import { z, type ZodType } from "zod";

export type ToolCategory = "read" | "write" | "external" | "server" | "interaction";
export type ToolRisk = "low" | "medium" | "high";
export type ToolApproval = "never" | "policy" | "always";
export type DurationClass = "instant" | "short" | "medium" | "long" | "unbounded_progress";

export type ToolRetryPolicy = {
  maxAttempts: number;
  backoffMs: number;
  retryableCodes: readonly string[];
};

export type ToolContextSummary = {
  text: string;
  handles?: string[];
  truncated?: boolean;
};

export type ToolCostEstimate = {
  unit: "requests" | "tokens" | "seconds" | "bytes";
  amount: number;
  upperBound?: number;
};

export type ToolProgress = { summary: string; detail?: string; progress?: number };

export type ToolExecutionContext = {
  signal?: AbortSignal;
  emitProgress?: (progress: ToolProgress) => void;
  requireApproval?: (input: { toolId: string; risk: ToolRisk; input: unknown }) => Promise<boolean>;
  executeRegisteredTool?: (
    toolId: string,
    input: unknown,
    context: ToolExecutionContext,
  ) => Promise<unknown>;
};

export type RegisteredToolDefinition<I, O> = {
  id: string;
  version: number;
  title: string;
  description: string;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  providerInputSchema?: Record<string, unknown>;
  capability: string;
  category: ToolCategory;
  risk: ToolRisk;
  approval: ToolApproval;
  parallelSafe: boolean;
  idempotent: boolean;
  concurrencyDomain?: string;
  expectedDuration?: DurationClass;
  softStallAfter?: number;
  hardSafetyLimit?: number;
  retryPolicy: ToolRetryPolicy;
  cancellable: boolean;
  resumable: boolean;
  estimateCost?: (input: I) => ToolCostEstimate;
  summarizeProgress?: (event: unknown) => string;
  summarizeOutput: (output: O) => ToolContextSummary;
  redactTelemetry?: (value: unknown) => unknown;
  execute(context: ToolExecutionContext, input: I): Promise<O> | AsyncGenerator<ToolProgress, O>;
};

export type AnyToolDefinition = RegisteredToolDefinition<unknown, unknown>;

function providerSchema(schema: ZodType<unknown>) {
  const converted = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  const { $schema: _schema, ...parameters } = converted;
  return parameters;
}

export class SpectraToolRegistry {
  private definitions = new Map<string, AnyToolDefinition>();

  register<I, O>(definition: RegisteredToolDefinition<I, O>) {
    if (this.definitions.has(definition.id))
      throw new Error(`TOOL_ALREADY_REGISTERED: ${definition.id}`);
    if (definition.parallelSafe && definition.category !== "read" && definition.category !== "external")
      throw new Error(`TOOL_PARALLEL_POLICY_INVALID: ${definition.id}`);
    if (definition.hardSafetyLimit !== undefined && definition.hardSafetyLimit <= 0)
      throw new Error(`TOOL_SAFETY_LIMIT_INVALID: ${definition.id}`);
    this.definitions.set(definition.id, definition as AnyToolDefinition);
    return definition;
  }

  has(id: string) {
    return this.definitions.has(id);
  }

  get(id: string) {
    return this.definitions.get(id);
  }

  require(id: string) {
    const definition = this.get(id);
    if (!definition) throw new Error(`TOOL_NOT_REGISTERED: ${id}`);
    return definition;
  }

  list() {
    return [...this.definitions.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  providerTool(id: string, parameters?: Record<string, unknown>) {
    const definition = this.require(id);
    return {
      type: "function" as const,
      function: {
        name: definition.id,
        description: definition.description,
        parameters: parameters ?? definition.providerInputSchema ?? providerSchema(definition.inputSchema),
      },
    };
  }

  providerTools(ids?: readonly string[]) {
    return (ids ?? this.list().map((definition) => definition.id)).map((id) => this.providerTool(id));
  }

  parseInput(id: string, input: unknown) {
    return this.require(id).inputSchema.parse(input);
  }

  parseOutput(id: string, output: unknown) {
    return this.require(id).outputSchema.parse(output);
  }
}

export const spectraToolRegistry = new SpectraToolRegistry();
