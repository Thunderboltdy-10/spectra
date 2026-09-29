import { ConvexError } from "convex/values";

/*
 * Spectra's worded errors across the Convex boundary.
 *
 * A production Convex deployment redacts the message of every error a function
 * throws to "[Request ID: …] Server Error". Only a `ConvexError`'s `data`
 * reaches the caller (`ConvexHttpClient`, `ConvexReactClient`, and an action's
 * `ctx.runQuery`/`runMutation`/`runAction`). So Convex functions throw plain
 * `Error("CODE: sentence")`, the function builders in `convex/functions.ts`
 * turn it into a `ConvexError` carrying a `WordedError`, and every caller (web
 * app, routes, collaboration gateway) reads it back with `readConvexError`.
 * Plain JavaScript so the gateway can load it without a build step.
 */

const LEADING_CODE = /^([A-Z][A-Z0-9_]+)(?=:|$)/;

function worded(message) {
  const text = message.trim();
  return { code: text.match(LEADING_CODE)?.[1] ?? null, message: text };
}

function isConvexError(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.for("ConvexError") in value
  );
}

/**
 * The words inside a message that Convex did not redact (local dev, tests, a
 * Next-side throw). A frame with nothing but "Server Error" has no words.
 */
function unframe(raw) {
  const uncaught = raw.match(/Uncaught (?:Convex)?Error:\s*([^\n]+)/);
  if (uncaught) return uncaught[1];
  const text = raw
    .replace(/\[CONVEX [A-Z]+\([^)]*\)\]\s*/g, "")
    .replace(/\[Request ID:[^\]]*\]\s*/gi, "")
    .replace(/\s*Called by client\s*$/, "")
    .trim();
  if (/^Server Error$/i.test(text)) return "";
  const named = text.match(/\b([A-Z][A-Z0-9_]{3,}:\s*[^\n]+)/);
  return (named?.[1] ?? text.split("\n")[0]).replace(/^Server Error:\s*/i, "");
}

/**
 * The Convex function boundary. A plain `Error` becomes a `ConvexError` whose
 * data is the worded error, so it survives production redaction. The message
 * and stack stay as thrown, so logs, local dev and tests read the same text.
 * `ConvexError`s, and runtime faults such as `TypeError` (bugs, not copy), pass
 * through unchanged.
 */
export function toWordedConvexError(thrown) {
  if (
    !(thrown instanceof Error) ||
    thrown.name !== "Error" ||
    isConvexError(thrown)
  )
    return thrown;
  const error = new ConvexError(worded(unframe(thrown.message)));
  error.message = thrown.message;
  error.stack = thrown.stack;
  return error;
}

/**
 * The one reader for a failed Convex call. It prefers the `ConvexError` data
 * (the only part production keeps) and otherwise reads the unredacted message.
 * An empty `message` means Convex redacted it: use the caller's fallback.
 */
export function readConvexError(error) {
  const data =
    typeof error === "object" && error !== null ? error.data : undefined;
  if (
    typeof data === "object" &&
    data !== null &&
    typeof data.message === "string"
  ) {
    const { code, message } = data;
    return {
      code: typeof code === "string" && code ? code : worded(message).code,
      message: message.trim(),
    };
  }
  if (typeof data === "string") return worded(unframe(data));
  const raw =
    typeof error === "string"
      ? error
      : typeof error === "object" &&
          error !== null &&
          typeof error.message === "string"
        ? error.message
        : "";
  return worded(unframe(raw));
}

/**
 * For code that branches on `error.message`: put a redacted `ConvexError`'s
 * words back on its message, then rethrow it. Other errors rethrow unchanged.
 */
export function rethrowWorded(error) {
  const { message } = readConvexError(error);
  if (message && error instanceof Error && "data" in error) error.message = message;
  throw error;
}
