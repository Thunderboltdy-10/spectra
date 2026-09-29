import { ConvexError } from "convex/values";

/**
 * What a production Convex deployment hands a caller when a function throws.
 *
 * Local dev and convex-test pass the thrown message through, so they cannot
 * show the production failure. A production deployment redacts the message of
 * every error to "Server Error"; only a `ConvexError`'s `data` survives
 * (convex/dist/esm/browser/http_client.js and browser/sync/client.js build the
 * client error from the redacted `errorMessage` and forward `errorData`).
 *
 * `surface: "http"` is `ConvexHttpClient` (server routes); `"react"` is
 * `ConvexReactClient` (`useMutation`, `useAction`), which adds the
 * `[CONVEX M(path)]` frame and "Called by client".
 */
export function asDeployedError(
  thrown: unknown,
  { surface, udf }: { surface: "http" | "react"; udf: string },
): Error {
  const redacted = "[Request ID: 8f2c0a61d9b34e57] Server Error";
  const message =
    surface === "react" ? `[CONVEX ${udf}] ${redacted}\n  Called by client` : redacted;
  if (
    typeof thrown === "object" &&
    thrown !== null &&
    Symbol.for("ConvexError") in thrown
  ) {
    const deployed = new ConvexError(message);
    // The wire carries `data` as JSON and the client decodes it.
    (deployed as { data: unknown }).data = JSON.parse(
      JSON.stringify((thrown as { data?: unknown }).data ?? null),
    );
    return deployed;
  }
  return new Error(message);
}

/** Runs a convex-test call and fails the way it would against production. */
export async function deployed<T>(
  call: Promise<T>,
  options: { surface: "http" | "react"; udf: string },
): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw asDeployedError(error, options);
  }
}
