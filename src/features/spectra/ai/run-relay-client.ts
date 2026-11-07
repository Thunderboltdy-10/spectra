/*
 * The page's side of the live relay. Lines arrive exactly as the run's stream
 * would have sent them. When it ends for any reason the caller goes back to
 * the durable log, so nothing here reports an error.
 */

const PROTOCOL = "spectra-run-relay";
const END_FRAME = '{"relay":"end"}';
/** A relay that never answers does not hold the run open. */
const OPEN_TIMEOUT_MS = 5_000;

export type RunRelayInvite = { url: string; ticket: string };

export function isRunRelayInvite(value: unknown): value is RunRelayInvite & { type: "live_relay" } {
  const candidate = value as { type?: unknown; url?: unknown; ticket?: unknown } | null;
  return candidate?.type === "live_relay" && typeof candidate.url === "string" && typeof candidate.ticket === "string";
}

/** Resolves when the relay ends. `onLine` returns true once the page has what it needs. */
export function followRunRelay(
  invite: RunRelayInvite,
  signal: AbortSignal,
  onLine: (line: string) => boolean | void,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || typeof WebSocket === "undefined") return resolve();
    let settled = false;
    let socket: WebSocket;
    try {
      socket = new WebSocket(invite.url, [PROTOCOL, invite.ticket]);
    } catch {
      return resolve();
    }
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(opening);
      signal.removeEventListener("abort", settle);
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      resolve();
    };
    const opening = setTimeout(settle, OPEN_TIMEOUT_MS);
    signal.addEventListener("abort", settle);
    socket.addEventListener("open", () => clearTimeout(opening));
    socket.addEventListener("error", settle);
    socket.addEventListener("close", settle);
    socket.addEventListener("message", (message) => {
      if (typeof message.data !== "string") return;
      for (const line of message.data.split("\n")) {
        if (settled || !line.trim()) continue;
        if (line === END_FRAME) return settle();
        try {
          if (onLine(line) === true) return settle();
        } catch {
          // One bad line must not end a working stream.
        }
      }
    });
  });
}
