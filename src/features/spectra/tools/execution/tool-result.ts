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

/**
 * Keep arbitrary provider/database payloads bounded before the next model turn.
 *
 * A tool that already bounds its own output for the model (read_artifact's
 * 64 KB read with explicit partial coverage, read_thread's 6,000-character
 * chunks) declares `selfBounded` with its budget. Its structure then passes
 * whole: the generic 40-item, 80-key, 4,000-character and depth-7 cuts used
 * to drop document blocks past the 40th, sheet cells past the 80th key, table
 * cells and code past 4,000 characters with no sign anything was missing.
 * Every cut that remains is labelled.
 */
export function boundedToolData(
  value: unknown,
  maximumCharacters = 24_000,
  options: { selfBounded?: boolean } = {},
) {
  let remaining = Math.max(1_000, maximumCharacters);
  const stringCharacters = options.selfBounded ? Number.POSITIVE_INFINITY : 4_000;
  const arrayItems = options.selfBounded ? Number.POSITIVE_INFINITY : 40;
  const objectKeys = options.selfBounded ? Number.POSITIVE_INFINITY : 80;
  const maximumDepth = options.selfBounded ? 48 : 7;
  const visit = (input: unknown, depth: number): unknown => {
    if (remaining <= 0) return "[context limit reached]";
    // An absent field stays absent (as JSON would); it used to become the
    // string "undefined", which reads as a real id or version.
    if (input === undefined || typeof input === "function" || typeof input === "symbol") return undefined;
    if (input === null || typeof input === "number" || typeof input === "boolean") return input;
    if (typeof input === "string") {
      const clean = input.replace(/\u0000/g, "");
      const bounded = clean.slice(0, Math.min(stringCharacters, remaining));
      remaining -= bounded.length;
      return bounded.length < clean.length
        ? `${bounded}... [${(clean.length - bounded.length).toLocaleString("en-US")} more characters not shown]`
        : bounded;
    }
    if (depth >= maximumDepth) return "[nested value omitted]";
    if (Array.isArray(input)) {
      const shown = input.slice(0, arrayItems).map((entry) => visit(entry, depth + 1));
      return shown.length < input.length
        ? [...shown, `[${input.length - shown.length} more items not shown]`]
        : shown;
    }
    if (typeof input === "object") {
      const output: Record<string, unknown> = {};
      const entries = Object.entries(input).filter(([, entry]) => entry !== undefined && typeof entry !== "function" && typeof entry !== "symbol");
      let shownKeys = 0;
      for (const [key, entry] of entries.slice(0, objectKeys)) {
        if (remaining <= 0) break;
        remaining -= key.length;
        output[key] = visit(entry, depth + 1);
        shownKeys += 1;
      }
      if (shownKeys < entries.length)
        output["[omitted]"] = `${entries.length - shownKeys} more fields not shown`;
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

/** Canonical model-facing envelope: 0 succeeded, 1 failed with the useful error. */
export function toModelToolResult(result: unknown) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const rec = result as Record<string, unknown>;
    if (rec.status === 0 || rec.status === 1) return rec;
    if (rec.ok === false) {
      const message =
        typeof rec.message === "string" && rec.message.trim()
          ? rec.message
          : typeof rec.error === "string" && rec.error.trim()
            ? rec.error
            : typeof rec.code === "string"
              ? rec.code
              : "The tool could not complete.";
      return {
        status: 1,
        error: message,
        ...(typeof rec.code === "string" ? { code: rec.code } : {}),
        ...(rec.retryable === true ? { retryable: true } : {}),
        ...(typeof rec.suggestedAction === "string"
          ? { suggestedAction: rec.suggestedAction }
          : {}),
      };
    }
    const { ok: _ok, ...rest } = rec;
    return { status: 0, ...rest };
  }
  return { status: 0, data: result ?? null };
}
