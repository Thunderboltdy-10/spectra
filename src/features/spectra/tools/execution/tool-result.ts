export type SourceHandle = { sourceId: string; evidenceIds?: string[] };
export type WorkHandle = { workId: string; anchor?: Record<string, unknown> };
export type ToolTelemetry = { durationMs?: number; attempts?: number; bytes?: number; cost?: number };

export type ToolResult<T = unknown> =
  | {
      ok: true;
      data: T;
      summary: string;
      sources?: SourceHandle[];
      workHandles?: WorkHandle[];
      warnings?: string[];
      partial?: boolean;
      cursor?: string;
      telemetry?: ToolTelemetry;
    }
  | {
      ok: false;
      code: string;
      message: string;
      retryable: boolean;
      degradedAlternative?: { id: string; description: string };
      suggestedAction?: string;
      telemetry?: ToolTelemetry;
    };

/** Keep arbitrary provider/database payloads bounded before the next model turn. */
export function boundedToolData(value: unknown, maximumCharacters = 24_000) {
  let remaining = Math.max(1_000, maximumCharacters);
  const visit = (input: unknown, depth: number): unknown => {
    if (remaining <= 0) return "[context limit reached]";
    if (input === null || typeof input === "number" || typeof input === "boolean") return input;
    if (typeof input === "string") {
      const bounded = input.replace(/\u0000/g, "").slice(0, Math.min(4_000, remaining));
      remaining -= bounded.length;
      return bounded.length < input.length ? `${bounded}...` : bounded;
    }
    if (depth >= 7) return "[nested value omitted]";
    if (Array.isArray(input)) return input.slice(0, 40).map((entry) => visit(entry, depth + 1));
    if (typeof input === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(input).slice(0, 80)) {
        if (remaining <= 0) break;
        remaining -= key.length;
        output[key] = visit(entry, depth + 1);
      }
      return output;
    }
    const bounded = String(input).slice(0, Math.min(500, remaining));
    remaining -= bounded.length;
    return bounded;
  };
  return visit(value, 0);
}

export function boundedToolSummary(value: string, maximum = 4_000) {
  const normalized = value.replace(/\u0000/g, "").trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`;
}
