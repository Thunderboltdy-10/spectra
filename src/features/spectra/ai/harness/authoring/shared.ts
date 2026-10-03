/** An authoring problem the model can fix. The message names the op and field. */
export class AuthoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthoringError";
  }
}

export type IdFactory = (prefix: string) => string;

/** Short unique ids for new nodes, slides, cells and items. */
export function defaultIdFactory(): IdFactory {
  return (prefix) => `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** Deterministic ids for tests. */
export function sequentialIdFactory(): IdFactory {
  const counts = new Map<string, number>();
  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}-${next}`;
  };
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

export function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Placeholder copy that editors insert into new nodes; it counts as empty. */
export const PLACEHOLDER_TEXT = new Set(
  [
    "",
    "add a clear idea",
    "add the supporting idea",
    "add a visual",
    "add a thought",
    "add text",
    "concept",
    "click to add text",
    "title",
    "new slide",
  ].map((entry) => entry.toLowerCase()),
);

export function isPlaceholder(value: unknown) {
  return PLACEHOLDER_TEXT.has(text(value).trim().toLowerCase());
}
